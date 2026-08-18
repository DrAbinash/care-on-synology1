/**
 * ReportImagePanel.tsx — Ticket R1.3: THE reusable enterprise image panel.
 *
 * One component renders and manages a report's selected images everywhere
 * they appear (today: inside ReportImagePicker in the canonical
 * RadiologyReportingWorkspace; any future surface mounts this SAME
 * component). It owns the persisted references only — browsing/adding stays
 * with its host.
 *
 * Features: thumbnail strip (lazy, per-thumb error state), drag reorder
 * (atomic server reorder endpoint), caption editing, key-image badge +
 * toggle, remove, selection count, empty/loading/error states.
 *
 * Viewer launch: clicking a thumbnail asks the SERVER to build the OHIF URL
 * for that exact image (`/ohif-launch?seriesInstanceUID=&sopInstanceUID=`).
 * The server validates the UIDs and degrades SOP → series → study when the
 * configured viewer URL can't express the level. No PACS credential, no
 * internal Orthanc URL and no patient-name matching ever reaches this code.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Crop, GripVertical, ImageOff, Loader2, RefreshCw, Star, Trash2 } from "lucide-react";
import { withDicomWebAuth } from "@/lib/browserDicomWeb";
import {
  launchQueryForRef, ohifUrlForRef, reorderIds, thumbnailRenderedUrl,
  type ReportImageRef,
} from "@/lib/reportImageRefs";
import { parseImageFraming, framingImgStyle, type ImageFraming } from "@/lib/imageFraming";
import ImageFramingEditor from "@/components/radiology/ImageFramingEditor";

interface LaunchResponse {
  ohifUrl?: string | null;
  launchLevel?: "study" | "series" | "sop" | null;
  requestedLevel?: "study" | "series" | "sop" | null;
  error?: string;
}

export default function ReportImagePanel({
  draftId,
  dicomWebBase,
  disabled,
  layout = "stack",
}: {
  draftId: number | null;
  /** Browser DICOMweb base from the M1.2 launch contract (thumbnails only). */
  dicomWebBase: string | null;
  disabled?: boolean;
  /** right-stack = one above the other (default); grid = 2-up. */
  layout?: "stack" | "grid";
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<number, boolean>>({});
  const [framingRef, setFramingRef] = useState<ReportImageRef | null>(null);
  const [layoutMode, setLayoutMode] = useState<"stack" | "grid">(() => {
    try {
      const stored = localStorage.getItem("care_report_images_layout");
      if (stored === "stack" || stored === "grid") return stored;
    } catch { /* ignore */ }
    return layout;
  });

  useEffect(() => {
    const onEvt = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next === "stack" || next === "grid") setLayoutMode(next);
    };
    window.addEventListener("care-report-images-layout", onEvt);
    return () => window.removeEventListener("care-report-images-layout", onEvt);
  }, []);

  const refsQuery = useQuery<ReportImageRef[]>({
    queryKey: ["report-image-references", draftId],
    queryFn: () => api.get(`/api/radiology/report-generator/image-references?draftId=${draftId}`),
    enabled: !!draftId,
  });
  const refs = refsQuery.data ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["report-image-references", draftId] });

  const removeRef = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/report-generator/image-references/${id}`),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Could not remove image", description: err.message, variant: "destructive" }),
  });
  const patchRef = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/api/radiology/report-generator/image-references/${id}`, body),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Could not update image", description: err.message, variant: "destructive" }),
  });
  const reorderRefs = useMutation({
    mutationFn: (orderedIds: number[]) =>
      api.post(`/api/radiology/report-generator/image-references/reorder`, { draftId, orderedIds }),
    // Canonical optimistic pattern: cancel in-flight refetches (a stale GET
    // resolving late must not overwrite the new order), snapshot, write the
    // optimistic order, roll back on error, and re-sync with server truth.
    onMutate: async (orderedIds: number[]) => {
      await qc.cancelQueries({ queryKey: ["report-image-references", draftId] });
      const previous = qc.getQueryData<ReportImageRef[]>(["report-image-references", draftId]);
      const byId = new Map((previous ?? []).map((r) => [r.id, r]));
      qc.setQueryData(
        ["report-image-references", draftId],
        orderedIds.map((id, i) => ({ ...byId.get(id)!, displayOrder: i })),
      );
      return { previous };
    },
    onError: (err: Error, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(["report-image-references", draftId], ctx.previous);
      toast({ title: "Could not reorder images", description: err.message, variant: "destructive" });
    },
    onSettled: invalidate,
  });

  function onDropOn(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); return; }
    const orderedIds = reorderIds(refs.map((r) => r.id), dragIndex, targetIndex);
    setDragIndex(null);
    reorderRefs.mutate(orderedIds);
  }

  async function openInViewer(ref: ReportImageRef) {
    if (!ref.studyInstanceUid) {
      toast({ title: "No StudyInstanceUID on this image", variant: "destructive" });
      return;
    }
    // Open synchronously (popup-blocker safe), then point at the server-built
    // URL. `opener` is severed before navigation.
    const win = window.open("about:blank", "_blank");
    try {
      const launch = await api.get<LaunchResponse>(
        `/api/radiology/studies/${encodeURIComponent(ref.studyInstanceUid)}/ohif-launch${launchQueryForRef(ref)}`,
      );
      // Same scheme guard the R1.1 launch path enforced: only http(s) viewer
      // URLs may ever be navigated (a misconfigured template must not become
      // a javascript:/data: sink in an about:blank tab of our origin).
      const safeUrl = ohifUrlForRef(launch.ohifUrl);
      if (!safeUrl) {
        win?.close();
        toast({ title: "Viewer not configured", description: launch.error ?? "", variant: "destructive" });
        return;
      }
      if (launch.requestedLevel && launch.requestedLevel !== "study" && launch.launchLevel === "study") {
        toast({ title: "Viewer opened at study level", description: "The configured viewer URL cannot navigate to the exact image." });
      }
      if (win) {
        try { win.opener = null; } catch { /* cross-origin after nav — fine */ }
        win.location.href = safeUrl;
      } else {
        window.open(safeUrl, "_blank", "noopener");
      }
    } catch (err) {
      win?.close();
      toast({ title: "Could not open viewer", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  if (!draftId) return null;

  return (
    <div className="space-y-1.5" data-testid="report-image-panel">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">Selected images</span>
        <Badge variant="outline" className="text-[10px]" data-testid="panel-count">{refs.length}</Badge>
        {reorderRefs.isPending && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
        <button
          type="button"
          className="ml-auto text-[10px] text-muted-foreground underline"
          data-testid="selected-images-layout-toggle"
          onClick={() => {
            const next = layoutMode === "stack" ? "grid" : "stack";
            setLayoutMode(next);
            try { localStorage.setItem("care_report_images_layout", next); } catch { /* ignore */ }
            window.dispatchEvent(new CustomEvent("care-report-images-layout", { detail: next }));
          }}
          title="Toggle vertical stack vs grid"
        >
          {layoutMode === "stack" ? "Grid" : "Stack right"}
        </button>
      </div>

      {refsQuery.isLoading && (
        <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground" data-testid="panel-loading">
          <Loader2 size={12} className="animate-spin" /> Loading images…
        </div>
      )}

      {refsQuery.isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2" data-testid="panel-error">
          <AlertTriangle size={12} className="text-destructive shrink-0" />
          <span className="text-[11px] text-destructive flex-1">
            Could not load report images.
            {refsQuery.error instanceof Error && refsQuery.error.message
              ? ` ${refsQuery.error.message}`
              : ""}
          </span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void refsQuery.refetch()}>
            <RefreshCw size={10} className="mr-1" /> Retry
          </Button>
        </div>
      )}

      {refsQuery.isSuccess && refs.length === 0 && (
        <p className="text-[11px] text-muted-foreground py-1" data-testid="panel-empty">
          No images selected yet — pick from Report images.
        </p>
      )}

      <div
        className={layoutMode === "grid" ? "grid grid-cols-2 gap-1.5" : "flex flex-col gap-1.5"}
        data-testid={`selected-images-layout-${layoutMode}`}
      >
      {refs.map((ref, index) => {
        const thumb = dicomWebBase && !brokenThumbs[ref.id] ? withDicomWebAuth(thumbnailRenderedUrl(dicomWebBase, ref)) : null;
        const framing = parseImageFraming(ref.presentationJson);
        return (
          <div
            key={ref.id}
            className={`flex ${layoutMode === "stack" ? "flex-col" : "items-center"} gap-2 rounded-md border p-1.5 bg-card ${dragIndex === index ? "opacity-50" : ""}`}
            draggable={!disabled}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onDropOn(index); }}
            data-testid={`panel-ref-${ref.id}`}
          >
            {!disabled && <GripVertical size={12} className="text-muted-foreground/60 shrink-0 cursor-grab self-start" data-testid={`panel-drag-${ref.id}`} />}
            <button
              type="button"
              className={`relative shrink-0 rounded bg-black overflow-hidden ${layoutMode === "stack" ? "w-full aspect-[4/3]" : "h-12 w-12"}`}
              title="Open this image in the viewer"
              onClick={() => void openInViewer(ref)}
              data-testid={`panel-thumb-${ref.id}`}
            >
              {thumb
                ? <img
                    src={thumb}
                    alt={ref.description}
                    className="absolute inset-0 h-full w-full"
                    style={framingImgStyle(framing)}
                    loading="lazy"
                    onError={() => setBrokenThumbs((b) => ({ ...b, [ref.id]: true }))}
                  />
                : <ImageOff size={12} className="m-auto text-muted-foreground" data-testid={`panel-thumb-broken-${ref.id}`} />}
              {ref.isKeyImage && (
                <span className="absolute top-0 left-0 bg-amber-500 text-white text-[7px] font-bold px-1 rounded-br" data-testid={`panel-key-badge-${ref.id}`}>KEY</span>
              )}
            </button>
            <Input
              defaultValue={ref.description}
              className="h-7 text-xs flex-1"
              disabled={disabled}
              onBlur={(e) => {
                const caption = e.target.value.trim();
                if (caption && caption !== ref.description) patchRef.mutate({ id: ref.id, body: { description: caption } });
              }}
              data-testid={`panel-caption-${ref.id}`}
            />
            {!disabled && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1.5 text-[10px] gap-0.5"
                  title="Edit framing for the Premium Report viewport"
                  onClick={() => setFramingRef(ref)}
                  data-testid={`panel-edit-framing-${ref.id}`}
                >
                  <Crop size={12} />
                  <span className="hidden sm:inline">Edit Framing</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  title={ref.isKeyImage ? "Unmark key image" : "Mark as key image"}
                  onClick={() => patchRef.mutate({ id: ref.id, body: { isKeyImage: !ref.isKeyImage } })}
                  data-testid={`panel-key-toggle-${ref.id}`}
                >
                  <Star size={12} className={ref.isKeyImage ? "text-amber-500 fill-amber-500" : "text-muted-foreground"} />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeRef.mutate(ref.id)} data-testid={`panel-remove-${ref.id}`}>
                  <Trash2 size={12} className="text-red-500" />
                </Button>
              </>
            )}
          </div>
        );
      })}
      </div>
      <ImageFramingEditor
        open={!!framingRef}
        imageSrc={(() => {
          if (!framingRef || !dicomWebBase || brokenThumbs[framingRef.id]) return null;
          const url = thumbnailRenderedUrl(dicomWebBase, framingRef, 512);
          return url ? withDicomWebAuth(url) : null;
        })()}
        caption={framingRef?.description ?? ""}
        initial={framingRef?.presentationJson}
        onClose={() => setFramingRef(null)}
        onApply={(framing: ImageFraming) => {
          if (!framingRef) return;
          patchRef.mutate({ id: framingRef.id, body: { framing: parseImageFraming(framing) } });
          setFramingRef(null);
        }}
      />
    </div>
  );
}
