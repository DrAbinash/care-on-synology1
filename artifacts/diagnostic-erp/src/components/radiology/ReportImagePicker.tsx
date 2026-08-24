/**
 * ReportImagePicker.tsx — Ticket R1.1 Phase 10/11: selected report images.
 *
 * Series browsing uses the ERP DICOMweb proxy with the staff Bearer token
 * (OHIF's iframe has its own Orthanc proxy; a bare fetch() 401s). Images can
 * be picked immediately — a draft is created silently in the background on
 * first selection, matching the legacy workspace (no "Save draft first" gate).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Images, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import ReportImagePanel from "@/components/radiology/ReportImagePanel";
import {
  buildImageRefPayload, MAX_REPORT_IMAGES, nextDisplayOrder, thumbnailRenderedUrl,
  type ReportImageRef,
} from "@/lib/reportImageRefs";
import { BROWSER_DICOMWEB_BASE, dicomWebFetch, withDicomWebAuth } from "@/lib/browserDicomWeb";

interface LaunchData {
  ohifUrl?: string | null;
  dicomWebBaseUrl?: string | null;
}

interface SeriesEntry {
  uid: string;
  description: string | null;
  numInstances: number;
}

interface InstanceEntry {
  uid: string;
  instanceNumber: number | null;
}

type PendingPick = {
  seriesUid: string;
  sopUid: string;
  caption: string;
};

export default function ReportImagePicker({
  draftId,
  studyId,
  studyInstanceUID,
  disabled,
  onEnsureDraft,
  onExpandChange,
  hideSelectedList,
}: {
  draftId: number | null;
  studyId?: number | null;
  studyInstanceUID: string | null;
  disabled?: boolean;
  /** Silent background draft so picks persist without a Save click. */
  onEnsureDraft?: () => Promise<number | null>;
  /** When the picker opens, collapse the OHIF viewer so thumbnails can be large. */
  onExpandChange?: (expanded: boolean) => void;
  /** Selected thumbnails render in a separate right-rail panel. */
  hideSelectedList?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [series, setSeries] = useState<SeriesEntry[]>([]);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceEntry[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [ensuringDraft, setEnsuringDraft] = useState(false);
  const [effectiveDraftId, setEffectiveDraftId] = useState<number | null>(draftId);
  const [pending, setPending] = useState<PendingPick[]>([]);
  const ensuringRef = useRef(false);

  useEffect(() => {
    setEffectiveDraftId(draftId);
  }, [draftId]);

  useQuery<LaunchData>({
    queryKey: ["viewer-launch", studyInstanceUID, studyId],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(studyInstanceUID!)}/ohif-launch${studyId ? `?worklistId=${studyId}` : ""}`),
    enabled: !!studyInstanceUID,
    staleTime: 5 * 60_000,
  });
  const dicomWebBase = studyInstanceUID ? BROWSER_DICOMWEB_BASE : null;

  const { data: refs = [] } = useQuery<ReportImageRef[]>({
    queryKey: ["report-image-references", effectiveDraftId],
    queryFn: () => api.get(`/api/radiology/report-generator/image-references?draftId=${effectiveDraftId}`),
    enabled: !!effectiveDraftId,
  });

  const addRef = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/radiology/report-generator/image-references", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["report-image-references", effectiveDraftId] }),
    onError: (err: Error) => toast({ title: "Could not add image", description: err.message, variant: "destructive" }),
  });
  const removeRef = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/report-generator/image-references/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["report-image-references", effectiveDraftId] }),
  });

  const loadSeries = useCallback(async () => {
    if (!dicomWebBase || !studyInstanceUID) return;
    setLoadingSeries(true);
    setSeriesError(null);
    try {
      const res = await dicomWebFetch(`${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series`);
      if (!res.ok) {
        setSeries([]);
        setSeriesError(
          res.status === 401 || res.status === 403
            ? "Sign in again to load PACS series."
            : `PACS returned ${res.status}. Open OHIF in a new tab to confirm the study is online.`,
        );
        return;
      }
      const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
      setSeries((Array.isArray(data) ? data : [])
        .map((s) => ({
          uid: String(s["0020000E"]?.Value?.[0] ?? ""),
          description: (s["0008103E"]?.Value?.[0] as string) ?? null,
          numInstances: Number(s["00201209"]?.Value?.[0] ?? 0),
        }))
        .filter((s) => s.uid));
    } catch {
      setSeries([]);
      setSeriesError("Could not reach PACS from this browser.");
    } finally {
      setLoadingSeries(false);
    }
  }, [dicomWebBase, studyInstanceUID]);

  useEffect(() => { if (expanded) void loadSeries(); }, [expanded, loadSeries]);

  const ensureDraftSilent = useCallback(async (): Promise<number | null> => {
    if (effectiveDraftId) return effectiveDraftId;
    if (!onEnsureDraft || disabled) return null;
    if (ensuringRef.current) return null;
    ensuringRef.current = true;
    setEnsuringDraft(true);
    try {
      const id = await onEnsureDraft();
      if (id) setEffectiveDraftId(id);
      return id;
    } finally {
      ensuringRef.current = false;
      setEnsuringDraft(false);
    }
  }, [effectiveDraftId, onEnsureDraft, disabled]);

  // Flush queued picks once a draft exists (first Save or silent ensure).
  useEffect(() => {
    if (!effectiveDraftId || !studyInstanceUID || pending.length === 0) return;
    const batch = pending;
    setPending([]);
    for (const pick of batch) {
      try {
        addRef.mutate(buildImageRefPayload({
          draftId: effectiveDraftId,
          studyId: studyId ?? undefined,
          studyInstanceUID,
          seriesInstanceUID: pick.seriesUid,
          sopInstanceUID: pick.sopUid,
          caption: pick.caption,
          displayOrder: nextDisplayOrder(refs),
        }));
      } catch { /* skip malformed */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush once per draft id
  }, [effectiveDraftId]);

  const openSeriesInstances = useCallback(async (seriesUid: string) => {
    if (!dicomWebBase || !studyInstanceUID) return;
    setOpenSeries(seriesUid);
    setLoadingInstances(true);
    try {
      const res = await dicomWebFetch(
        `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances`,
      );
      if (!res.ok) { setInstances([]); return; }
      const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
      setInstances((Array.isArray(data) ? data : [])
        .map((i) => ({
          uid: String(i["00080018"]?.Value?.[0] ?? ""),
          instanceNumber: (i["00200013"]?.Value?.[0] as number) ?? null,
        }))
        .filter((i) => i.uid)
        .slice(0, 60));
    } catch {
      setInstances([]);
    } finally {
      setLoadingInstances(false);
    }
  }, [dicomWebBase, studyInstanceUID]);

  function selectInstance(seriesEntry: SeriesEntry, inst: InstanceEntry) {
    if (!studyInstanceUID) return;
    const alreadyPersisted = refs.find((r) => r.sopInstanceUid === inst.uid);
    if (alreadyPersisted) { removeRef.mutate(alreadyPersisted.id); return; }
    const alreadyPending = pending.some((p) => p.sopUid === inst.uid);
    if (alreadyPending) {
      setPending((prev) => prev.filter((p) => p.sopUid !== inst.uid));
      return;
    }
    if (refs.length + pending.length >= MAX_REPORT_IMAGES) {
      toast({ title: `Maximum ${MAX_REPORT_IMAGES} images per report`, variant: "destructive" });
      return;
    }
    const caption = seriesEntry.description || `Image ${inst.instanceNumber ?? ""}`.trim();
    if (effectiveDraftId) {
      try {
        addRef.mutate(buildImageRefPayload({
          draftId: effectiveDraftId,
          studyId: studyId ?? undefined,
          studyInstanceUID,
          seriesInstanceUID: seriesEntry.uid,
          sopInstanceUID: inst.uid,
          caption,
          displayOrder: nextDisplayOrder(refs),
        }));
      } catch (err) {
        toast({ title: "Invalid DICOM reference", description: err instanceof Error ? err.message : "", variant: "destructive" });
      }
      return;
    }
    setPending((prev) => [...prev, { seriesUid: seriesEntry.uid, sopUid: inst.uid, caption }]);
    void ensureDraftSilent();
  }

  const selectedCount = refs.length + pending.length;

  return (
    <div className="rounded-lg border bg-card" data-testid="report-image-picker">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => {
          setExpanded((v) => {
            const next = !v;
            onExpandChange?.(next);
            return next;
          });
        }}
        data-testid="picker-toggle"
      >
        <Images size={14} className="text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1">Report images</span>
        {selectedCount > 0 && <Badge variant="outline" className="text-[10px]">{selectedCount} selected</Badge>}
        {ensuringDraft && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-2 max-h-[min(70vh,32rem)] overflow-y-auto" data-testid="report-picker-body">
          {effectiveDraftId && !hideSelectedList && (
            <ReportImagePanel draftId={effectiveDraftId} dicomWebBase={dicomWebBase} disabled={disabled} layout="stack" />
          )}
          {!effectiveDraftId && pending.length > 0 && (
            <p className="text-[11px] text-muted-foreground">{pending.length} image(s) selected — saving in the background…</p>
          )}

          {!studyInstanceUID && (
            <p className="text-[11px] text-muted-foreground">No StudyInstanceUID on this study — images unavailable.</p>
          )}
          {studyInstanceUID && !dicomWebBase && (
            <p className="text-[11px] text-muted-foreground">DICOMweb endpoint not configured — check viewer settings.</p>
          )}

          {studyInstanceUID && dicomWebBase && !disabled && (
            <div className="space-y-1" data-testid="series-browser">
              {loadingSeries && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Loading series from PACS…
                </p>
              )}
              {series.map((s) => (
                <div key={s.uid} className="rounded-md border overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-left bg-muted/50 hover:bg-muted"
                    onClick={() => (openSeries === s.uid ? setOpenSeries(null) : void openSeriesInstances(s.uid))}
                  >
                    <span className="text-[11px] font-medium flex-1 truncate">{s.description || "Series"}</span>
                    <span className="text-[10px] text-muted-foreground">{s.numInstances}</span>
                    {openSeries === s.uid ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                  {openSeries === s.uid && (
                    <div className="grid grid-cols-4 gap-1.5 p-1.5">
                      {loadingInstances ? (
                        <div className="col-span-8 flex justify-center py-1"><Loader2 size={13} className="animate-spin text-muted-foreground" /></div>
                      ) : instances.map((inst) => {
                        const selected = refs.some((r) => r.sopInstanceUid === inst.uid) || pending.some((p) => p.sopUid === inst.uid);
                        const thumb = withDicomWebAuth(thumbnailRenderedUrl(dicomWebBase, {
                          studyInstanceUid: studyInstanceUID, seriesInstanceUid: s.uid, sopInstanceUid: inst.uid,
                        }, 256));
                        return (
                          <button
                            key={inst.uid}
                            type="button"
                            className={`relative h-24 w-full rounded overflow-hidden bg-black p-0.5 ${selected ? "ring-2 ring-blue-400/60 ring-inset border-2 border-blue-500" : "border-2 border-transparent hover:border-muted-foreground/40"}`}
                            onClick={() => selectInstance(s, inst)}
                            title={`Image ${inst.instanceNumber ?? ""}${selected ? " (selected — click to remove)" : ""}`}
                            data-testid={`instance-thumb-${inst.uid}`}
                          >
                            {thumb && <img src={thumb} alt="" className="h-full w-full object-contain rounded-sm" loading="lazy" />}
                            {selected && <span className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-blue-500 text-white text-[8px] leading-3.5 text-center font-bold shadow-sm">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {!loadingSeries && series.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {seriesError ?? "No series returned from PACS yet. Expand again after the study has been received, or open OHIF in a new tab to confirm the study is online."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
