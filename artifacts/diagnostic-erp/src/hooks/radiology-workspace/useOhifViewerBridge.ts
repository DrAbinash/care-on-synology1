/**
 * OHIF viewer bridge + viewer measurement ingest for RadiologyReportingWorkspace.
 * Phase 4 extraction — behavior unchanged.
 *
 * Owns: viewerMeasurementsQ + ingest, canalApByLevel, OHIF capture/preflight,
 * subscribeCareOhifBridge, caption-refresh, key-image detach / slot-displace.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type RefObject,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  useViewerMeasurements,
} from "@/components/radiology/ViewerMeasurementsPanel";
import {
  subscribeCareOhifBridge,
  captureResultToBlob,
  requestOhifViewportCapture,
  requestOhifDisplayedAnchor,
  deriveOhifAllowedOrigins,
  resolveOhifTargetOrigin,
} from "@/lib/ohifViewerBridge";
import { viewportToAnchor } from "@/lib/observationAnchor";
import { formatViewerMeasurementLabel } from "@/lib/formatViewerMeasurementLine";
import {
  removeStructuredMeasurementByAnnotation,
  structuredFromViewerRow,
  annotationIdFromCoordinates,
  classifyViewerRowIngestMode,
} from "@/lib/structuredViewerMeasurements";
import {
  uploadFrozenKeyImage,
  frozenKeyImagesQueryKey,
  type FrozenKeyImage,
} from "@/components/radiology/FrozenKeyImagesRail";
import { buildObservationKeyImageCaption, maybeRefreshCaption } from "@/lib/keyImageCaption";
import { canalApValue, discLevelFromLabel, parseCanalApNumber } from "@/lib/spineCanalAp";
import type { EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import type { WorkspaceLayoutMode } from "@/lib/workspaceLayoutPrefs";

export type UseOhifViewerBridgeOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  isLocked: boolean;
  isFinalized: boolean;
  captureBusy: boolean;
  showEmbeddedViewer: boolean;
  layoutMode: WorkspaceLayoutMode;
  workflow: {
    currentRow: {
      studyInstanceUID?: string | null;
      patientId?: number | null;
      studyId?: number | null;
      status?: string | null;
    } | null;
  };
  embeddedViewerRef: RefObject<EmbeddedViewerHandle | null>;
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
  ensureDraftOnce: () => Promise<number | null>;
  imageRefs: any[];
  frozenKeyImagesQ: {
    data?: { items?: FrozenKeyImage[] } | undefined;
  };
  appliedPathologyPatches: any[];
};

export function useOhifViewerBridge(opts: UseOhifViewerBridgeOptions) {
  const {
    studyId,
    draftId,
    isLocked,
    isFinalized,
    captureBusy,
    showEmbeddedViewer,
    layoutMode,
    workflow,
    embeddedViewerRef,
    toast,
    ensureDraftOnce,
    imageRefs,
    frozenKeyImagesQ,
    appliedPathologyPatches,
  } = opts;

  const qc = useQueryClient();
  const [ohifUnavailable, setOhifUnavailable] = useState(false);
  const canalApProvenance = useWorkspace((s) => s.canalApProvenance);

  // Detach frozen key images when an observation is removed (preserve evidence).
  useEffect(() => {
    const handler = (ev: Event) => {
      const observationId = (ev as CustomEvent<{ observationId?: string }>).detail?.observationId;
      const id = draftId;
      if (!observationId || !id || isLocked || isFinalized) return;
      void api
        .post("/api/radiology/report-generator/key-images/detach-observation", {
          draftId: id,
          observationId,
        })
        .then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) }))
        .catch(() => undefined);
    };
    window.addEventListener("care:observation-removed", handler as EventListener);
    return () => window.removeEventListener("care:observation-removed", handler as EventListener);
  }, [draftId, isLocked, isFinalized, qc]);

  // Slot-displace merge: remap key-image observationId onto the surviving observation.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ fromObservationId?: string; toObservationId?: string }>).detail;
      const fromId = detail?.fromObservationId;
      const toId = detail?.toObservationId;
      const id = draftId;
      if (!fromId || !toId || !id || isLocked || isFinalized) return;
      const items = frozenKeyImagesQ.data?.items ?? [];
      const toRemap = items.filter((img) => img.observationId === fromId);
      if (toRemap.length === 0) return;
      void Promise.all(
        toRemap.map((img) =>
          api.put(`/api/radiology/report-generator/key-images/${img.id}`, {
            observationId: toId,
          }).catch(() => undefined),
        ),
      ).then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) }));
    };
    window.addEventListener("care:observation-reassigned", handler as EventListener);
    return () => window.removeEventListener("care:observation-reassigned", handler as EventListener);
  }, [draftId, isLocked, isFinalized, qc, frozenKeyImagesQ.data?.items]);

  const viewerMeasurementsQ = useViewerMeasurements(workflow.currentRow?.studyInstanceUID);

  // Bridge viewer_measurements → MEASURE rail (Zustand) + structured measurements.
  // Historical hydration never uses live Measure toolbar / selection / activeAnchor.
  // Only rows first seen AFTER the study's first successful query resolution are new_event.
  const knownViewerRowIdsRef = useRef<Set<number>>(new Set());
  const viewerHydratedStudyUidRef = useRef<string | null>(null);
  const viewerHydrationCompleteRef = useRef(false);
  useEffect(() => {
    if (isLocked || isFinalized) return;
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    if (uid !== viewerHydratedStudyUidRef.current) {
      knownViewerRowIdsRef.current = new Set();
      viewerHydrationCompleteRef.current = false;
      viewerHydratedStudyUidRef.current = uid;
    }
    // Wait for the first successful resolution (data may be []). While loading /
    // undefined, do not mark hydration complete and do not ingest.
    if (!viewerMeasurementsQ.isSuccess) return;

    const rows = viewerMeasurementsQ.data ?? [];
    const mapped = rows
      .filter((m) => m.status !== "ignored")
      .map((m) => {
        const label =
          discLevelFromLabel(m.measurementType)
          ?? discLevelFromLabel(m.measurementId)
          ?? formatViewerMeasurementLabel(m);
        const num = Number(parseCanalApNumber(m.value) || m.value);
        return {
          id: `vm-${m.id}`,
          name: label,
          value: Number.isFinite(num) ? num : 0,
          unit: m.unit || "mm",
          source: "viewer" as const,
          inserted: m.status === "imported",
        };
      });
    useWorkspace.getState().setMeasurements(mapped);

    const store = useWorkspace.getState();
    const existingItems = store.structuredViewerMeasurements.items;
    const seenBefore = knownViewerRowIdsRef.current;
    const hydrationComplete = viewerHydrationCompleteRef.current;
    for (const m of rows) {
      const prior = existingItems.find(
        (x) =>
          x.viewerMeasurementRowId === m.id
          || (() => {
            const ann = annotationIdFromCoordinates(m.imageCoordinates);
            return Boolean(ann && x.viewerAnnotationId === ann);
          })(),
      );
      const mode = classifyViewerRowIngestMode({
        hydrationComplete,
        rowId: m.id,
        knownRowIds: seenBefore,
        hasPriorStructured: Boolean(prior),
      });
      // Track every row id from the successful response (including ignored).
      seenBefore.add(m.id);
      if (m.status === "ignored") continue;
      const isNewEvent = mode === "new_event";
      const payload = structuredFromViewerRow({
        row: m,
        mode,
        liveIntent: isNewEvent ? store.measurementIntent : null,
        liveCanalLevel: isNewEvent ? store.canalIntentLevel : null,
        liveSelectedObservationId: isNewEvent ? store.selectedObservationId : null,
        prior: prior ?? null,
      });
      store.upsertStructuredViewerMeasurement(payload);
    }
    // First successful resolution — even [] or ignored-only — completes hydration.
    viewerHydrationCompleteRef.current = true;
  }, [
    viewerMeasurementsQ.data,
    viewerMeasurementsQ.isSuccess,
    isLocked,
    isFinalized,
    workflow.currentRow?.studyInstanceUID,
  ]);

  /**
   * The level blocks' view of the canal numbers — a READ of the canonical
   * record, keyed by canonical level.
   *
   * This used to parse a disc level out of each measurement's NAME text, which
   * meant the number that reached the report came from a different place than
   * the number in the canal table, and only existed at all if somebody had
   * typed "L4-L5" into the OHIF caliper label.
   */
  const canalApByLevel = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [level, rec] of Object.entries(canalApProvenance)) {
      const value = canalApValue(rec);
      if (value != null) out[level] = value;
    }
    return out;
  }, [canalApProvenance]);

  // OHIF postMessage → viewer_measurements / report image-references / capture
  const ohifCapturePendingRef = useRef<Set<string>>(new Set());
  const ohifAnchorPendingRef = useRef<Set<string>>(new Set());
  const ohifTargetOriginRef = useRef<string | null>(null);
  const captionRefreshInFlightRef = useRef<Set<number>>(new Set());

  /**
   * D2 Phase 6 — ask the viewer which image it is showing *now*, at the moment
   * CARE needs to know, instead of trusting an anchor cached from an earlier
   * push. Returns false when there is no viewer to ask (Frames mode, OHIF not
   * loaded, or no resolved origin to send to) and the caller keeps the anchor it
   * already has rather than inventing one.
   */
  const requestFreshDisplayedAnchor = useCallback(() => {
    const requestId = `anc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ok = requestOhifDisplayedAnchor({
      target: embeddedViewerRef.current?.getOhifWindow?.(),
      requestId,
      targetOrigin: ohifTargetOriginRef.current,
    });
    if (!ok) return false;
    ohifAnchorPendingRef.current.add(requestId);
    window.setTimeout(() => ohifAnchorPendingRef.current.delete(requestId), 15_000);
    return true;
  }, [embeddedViewerRef]);

  const requestOhifAnnotatedCapture = useCallback(() => {
    if (isLocked || isFinalized || ohifUnavailable) return;
    const requestId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    ohifCapturePendingRef.current.add(requestId);
    const win = embeddedViewerRef.current?.getOhifWindow?.();
    let targetOrigin = ohifTargetOriginRef.current;
    if (!targetOrigin) {
      const launch = embeddedViewerRef.current?.getOhifLaunchUrl?.();
      if (launch) {
        try { targetOrigin = new URL(launch).origin; } catch { /* ignore */ }
      }
    }
    const ok = requestOhifViewportCapture({
      target: win,
      requestId,
      targetOrigin,
    });
    if (!ok) {
      ohifCapturePendingRef.current.delete(requestId);
      toast({
        title: "OHIF capture unavailable",
        description: "OHIF iframe is not ready. Switch to Frames or open OHIF in a new tab.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Annotated capture requested",
      description: "Waiting for CARE OHIF extension. Falls back to Frames/upload if unsupported.",
    });
    window.setTimeout(() => {
      ohifCapturePendingRef.current.delete(requestId);
    }, 60_000);
  }, [isLocked, isFinalized, ohifUnavailable, toast, embeddedViewerRef]);

  /** Key Images rail camera — same capture paths as Frames / OHIF Annotate buttons. */
  const requestFrozenKeyImageCapture = useCallback(async () => {
    if (isLocked || isFinalized || captureBusy) return;
    const result = await embeddedViewerRef.current?.captureKeyImage?.();
    if (result === "frames" || result === "ohif") return;
    toast({
      title: "Capture unavailable",
      description: "Switch to Frames with a loaded image, or stay in OHIF and wait for the viewer to load.",
      variant: "destructive",
    });
  }, [isLocked, isFinalized, captureBusy, toast, embeddedViewerRef]);

  useEffect(() => {
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    if (!uid || !showEmbeddedViewer) {
      setOhifUnavailable(false);
      return;
    }
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const url = embeddedViewerRef.current?.getOhifLaunchUrl?.() ?? null;
      setOhifUnavailable(!url);
    };
    check();
    const raf = requestAnimationFrame(check);
    const timer = window.setTimeout(check, 600);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [workflow.currentRow?.studyInstanceUID, studyId, showEmbeddedViewer, layoutMode, embeddedViewerRef]);

  useEffect(() => {
    const uid = workflow.currentRow?.studyInstanceUID ?? null;
    if (!uid) return;
    const mutationsAllowed = !(isLocked || isFinalized);
    const liveLaunchUrl =
      embeddedViewerRef.current?.getOhifLaunchUrl?.()
      || (typeof window !== "undefined" ? window.localStorage.getItem("care_ohif_launch_url") : null);
    const viteExtras =
      typeof import.meta !== "undefined"
      && typeof (import.meta as ImportMeta & { env?: { VITE_OHIF_ALLOWED_ORIGINS?: string } }).env?.VITE_OHIF_ALLOWED_ORIGINS === "string"
        ? (import.meta as ImportMeta & { env: { VITE_OHIF_ALLOWED_ORIGINS: string } }).env.VITE_OHIF_ALLOWED_ORIGINS
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    const allowAny =
      typeof import.meta !== "undefined"
      && (import.meta as ImportMeta & { env?: { VITE_OHIF_ALLOW_ANY?: string } }).env?.VITE_OHIF_ALLOW_ANY === "1";
    const ohifOrigins = deriveOhifAllowedOrigins({
      pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
      ohifLaunchUrl: liveLaunchUrl,
      extraOrigins: viteExtras,
      allowAny,
    });
    ohifTargetOriginRef.current = resolveOhifTargetOrigin({
      ohifLaunchUrl: liveLaunchUrl,
      allowedOrigins: ohifOrigins,
      pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
    });

    return subscribeCareOhifBridge({
      studyInstanceUID: uid,
      patientId: workflow.currentRow?.patientId ?? null,
      studyId: workflow.currentRow?.studyId ?? studyId ?? null,
      draftId: draftId ?? null,
      getImageRefs: () => imageRefs,
      pendingCaptureRequestIds: ohifCapturePendingRef.current,
      pendingAnchorRequestIds: ohifAnchorPendingRef.current,
      mutationsAllowed,
      allowedOrigins: ohifOrigins,
      getExpectedSourceWindow: () => embeddedViewerRef.current?.getOhifWindow?.() ?? null,
      onMeasurementSaved: () => {
        if (!mutationsAllowed) return;
        void qc.invalidateQueries({ queryKey: ["viewer-measurements", uid] });
      },
      onKeyImageSaved: () => {
        if (!mutationsAllowed) return;
        void qc.invalidateQueries({ queryKey: ["report-image-references", draftId] });
        toast({ title: "Key image added from viewer" });
      },
      onActiveAnchor: (ctx) => {
        useWorkspace.getState().setActiveAnchor(viewportToAnchor(ctx));
      },
      onActiveAnchorUnavailable: () => {
        // D2-I6: the viewer could not name the image it is showing. Say so and
        // leave the previous anchor alone — nothing here touches report text.
        toast({
          title: "Image identity unavailable",
          description: "The viewer could not identify the displayed image, so nothing was anchored to it.",
        });
      },
      onMeasurementDeleted: (annotationId) => {
        if (!mutationsAllowed) return;
        const store = useWorkspace.getState();
        const prev = store.structuredViewerMeasurements;
        const hit = prev.items.find((x) => x.viewerAnnotationId === annotationId);
        store.setStructuredViewerMeasurements(
          removeStructuredMeasurementByAnnotation(prev, annotationId),
        );
        // Persist ignore so refetch does not rehydrate the deleted annotation.
        if (hit?.viewerMeasurementRowId) {
          void api
            .patch(`/api/radiology-lesions/viewer-measurements/${hit.viewerMeasurementRowId}`, {
              status: "ignored",
            })
            .then(() => qc.invalidateQueries({ queryKey: ["viewer-measurements", uid] }))
            .catch(() => undefined);
        }
      },
      onViewportCaptureResult: async (msg) => {
        if (!mutationsAllowed) return;
        const blob = captureResultToBlob(msg);
        if (!blob) {
          toast({
            title: "OHIF capture failed",
            description: "Annotated image payload was unreadable.",
            variant: "destructive",
          });
          return;
        }
        let id = draftId;
        if (!id) id = await ensureDraftOnce();
        if (!id) {
          toast({ title: "Could not save draft for capture", variant: "destructive" });
          return;
        }
        const selectedId = useWorkspace.getState().selectedObservationId;
        const selectedPatch = selectedId
          ? useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === selectedId)
          : null;
        const caption = selectedPatch
          ? buildObservationKeyImageCaption({
              level: selectedPatch.observation?.level,
              laterality: selectedPatch.observation?.laterality,
              concept: selectedPatch.observation?.concept,
              region: selectedPatch.observation?.region,
              lastRenderedFindings: selectedPatch.lastRendered.findings,
            })
          : "Key image (OHIF annotated capture)";
        const fd = new FormData();
        fd.append("image", blob, "ohif-capture.jpg");
        fd.append("draftId", String(id));
        fd.append("sourceType", "VIEWPORT_CAPTURE");
        fd.append("caption", caption);
        fd.append("captionManual", "false");
        fd.append("includeInReport", "true");
        fd.append("viewer", "ohif");
        if (selectedId) fd.append("observationId", selectedId);
        if (msg.studyInstanceUID) fd.append("studyInstanceUID", msg.studyInstanceUID);
        if (msg.seriesInstanceUID) fd.append("seriesInstanceUID", msg.seriesInstanceUID);
        if (msg.sopInstanceUID) fd.append("sopInstanceUID", msg.sopInstanceUID);
        if (msg.frameNumber != null) fd.append("frameNumber", String(msg.frameNumber));
        if (msg.annotations != null) {
          fd.append("annotationMetadataJson", JSON.stringify(msg.annotations).slice(0, 8000));
        }
        await uploadFrozenKeyImage(fd);
        void qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(id) });
        toast({ title: "Annotated key image captured from OHIF" });
      },
    });
  }, [
    workflow.currentRow?.studyInstanceUID,
    workflow.currentRow?.patientId,
    workflow.currentRow?.studyId,
    studyId,
    draftId,
    imageRefs,
    qc,
    toast,
    ensureDraftOnce,
    isLocked,
    isFinalized,
    embeddedViewerRef,
  ]);

  // Caption refresh: linked observation text changed + captionManual=false → refresh.
  // Harden: skip images already in-flight to avoid PUT storms.
  useEffect(() => {
    if (!draftId || isLocked || isFinalized) return;
    const items = frozenKeyImagesQ.data?.items ?? [];
    const patches = useWorkspace.getState().appliedPathologyPatches;
    for (const img of items) {
      if (!img.observationId || img.captionManual) continue;
      if (captionRefreshInFlightRef.current.has(img.id)) continue;
      const patch = patches.find((p) => p.id === img.observationId);
      if (!patch) continue;
      const next = buildObservationKeyImageCaption({
        level: patch.observation?.level,
        laterality: patch.observation?.laterality,
        concept: patch.observation?.concept,
        region: patch.observation?.region,
        lastRenderedFindings: patch.lastRendered.findings,
      });
      const refreshed = maybeRefreshCaption({
        captionManual: Boolean(img.captionManual),
        currentCaption: img.caption || "",
        nextAutoCaption: next,
      });
      if (refreshed === (img.caption || "")) continue;
      captionRefreshInFlightRef.current.add(img.id);
      void api
        .put(`/api/radiology/report-generator/key-images/${img.id}`, {
          caption: refreshed,
          captionManual: false,
        })
        .then(() => qc.invalidateQueries({ queryKey: frozenKeyImagesQueryKey(draftId) }))
        .catch(() => undefined)
        .finally(() => {
          captionRefreshInFlightRef.current.delete(img.id);
        });
    }
  }, [
    draftId,
    isLocked,
    isFinalized,
    appliedPathologyPatches,
    frozenKeyImagesQ.data,
    qc,
  ]);

  return {
    ohifUnavailable,
    viewerMeasurementsQ,
    canalApByLevel,
    requestOhifAnnotatedCapture,
    requestFreshDisplayedAnchor,
    requestFrozenKeyImageCapture,
    ohifCapturePendingRef,
    ohifTargetOriginRef,
    captionRefreshInFlightRef,
    knownViewerRowIdsRef,
    viewerHydratedStudyUidRef,
    viewerHydrationCompleteRef,
  };
}
