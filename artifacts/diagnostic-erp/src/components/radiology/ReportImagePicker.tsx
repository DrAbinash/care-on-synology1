/**
 * ReportImagePicker.tsx — Ticket R1.1 Phase 10/11: selected report images.
 *
 * Lives INSIDE the canonical RadiologyReportingWorkspace (no new report
 * page). Browses the study over the SAME browser DICOMweb base the embedded
 * viewer already uses (M1.2 launch contract), and persists selections as
 * DICOM references only (study/series/SOP UID + frame + caption + order) via
 * /api/radiology/report-generator/image-references — never blob URLs. The
 * server resolves pixels into every rendered artifact.
 *
 * R1.3 — the selected references render/manage through the ONE reusable
 * ReportImagePanel (drag reorder, captions, key-image toggle, per-image
 * server-built viewer launch); this component keeps the series browser and
 * selection toggling.
 *
 * Trial simplify: expanding the picker auto-creates a draft via onEnsureDraft
 * so the radiologist never sees “Save the draft once…”.
 */

import { useCallback, useEffect, useState } from "react";
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

export default function ReportImagePicker({
  draftId,
  studyId,
  studyInstanceUID,
  disabled,
  onEnsureDraft,
}: {
  draftId: number | null;
  studyId?: number | null;
  studyInstanceUID: string | null;
  disabled?: boolean;
  /** Auto-create/save a draft so image selection works without a separate Save click. */
  onEnsureDraft?: () => Promise<number | null>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [series, setSeries] = useState<SeriesEntry[]>([]);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceEntry[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [ensuringDraft, setEnsuringDraft] = useState(false);
  const [effectiveDraftId, setEffectiveDraftId] = useState<number | null>(draftId);

  useEffect(() => {
    setEffectiveDraftId(draftId);
  }, [draftId]);

  // Same launch contract the embedded viewer uses — one cache entry.
  const { data: launchData } = useQuery<LaunchData>({
    queryKey: ["viewer-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(studyInstanceUID!)}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 5 * 60_000,
  });
  const dicomWebBase = launchData?.dicomWebBaseUrl ?? null;

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
    try {
      const res = await fetch(`${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series`, {
        headers: { Accept: "application/dicom+json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as Array<Record<string, { Value?: unknown[] }>>;
      setSeries((Array.isArray(data) ? data : [])
        .map((s) => ({
          uid: String(s["0020000E"]?.Value?.[0] ?? ""),
          description: (s["0008103E"]?.Value?.[0] as string) ?? null,
          numInstances: Number(s["00201209"]?.Value?.[0] ?? 0),
        }))
        .filter((s) => s.uid));
    } catch { /* PACS unreachable from this browser — picker stays empty */ }
  }, [dicomWebBase, studyInstanceUID]);

  useEffect(() => { if (expanded) void loadSeries(); }, [expanded, loadSeries]);

  async function handleToggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (!next || effectiveDraftId || disabled) return;
    if (!onEnsureDraft) return;
    setEnsuringDraft(true);
    try {
      const id = await onEnsureDraft();
      if (id) setEffectiveDraftId(id);
    } finally {
      setEnsuringDraft(false);
    }
  }

  const openSeriesInstances = useCallback(async (seriesUid: string) => {
    if (!dicomWebBase || !studyInstanceUID) return;
    setOpenSeries(seriesUid);
    setLoadingInstances(true);
    try {
      const res = await fetch(
        `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesUid)}/instances`,
        { headers: { Accept: "application/dicom+json" } },
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
    if (!effectiveDraftId || !studyInstanceUID) return;
    const already = refs.find((r) => r.sopInstanceUid === inst.uid);
    if (already) { removeRef.mutate(already.id); return; }
    if (refs.length >= MAX_REPORT_IMAGES) {
      toast({ title: `Maximum ${MAX_REPORT_IMAGES} images per report`, variant: "destructive" });
      return;
    }
    try {
      addRef.mutate(buildImageRefPayload({
        draftId: effectiveDraftId,
        studyId: studyId ?? undefined,
        studyInstanceUID,
        seriesInstanceUID: seriesEntry.uid,
        sopInstanceUID: inst.uid,
        caption: seriesEntry.description || `Image ${inst.instanceNumber ?? ""}`.trim(),
        displayOrder: nextDisplayOrder(refs),
      }));
    } catch (err) {
      toast({ title: "Invalid DICOM reference", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="rounded-lg border bg-card" data-testid="report-image-picker">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => void handleToggleExpand()}
        data-testid="picker-toggle"
      >
        <Images size={14} className="text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1">Report images</span>
        {refs.length > 0 && <Badge variant="outline" className="text-[10px]">{refs.length} selected</Badge>}
        {ensuringDraft && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {effectiveDraftId && (
            <ReportImagePanel draftId={effectiveDraftId} dicomWebBase={dicomWebBase} disabled={disabled} />
          )}

          {ensuringDraft && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Preparing image selection…
            </p>
          )}
          {!ensuringDraft && !effectiveDraftId && (
            <p className="text-[11px] text-muted-foreground">
              {onEnsureDraft
                ? "Could not prepare a draft — check connection and retry."
                : "Open a study to select images."}
            </p>
          )}
          {effectiveDraftId && !studyInstanceUID && (
            <p className="text-[11px] text-muted-foreground">No StudyInstanceUID on this study — images unavailable.</p>
          )}
          {effectiveDraftId && studyInstanceUID && !dicomWebBase && (
            <p className="text-[11px] text-muted-foreground">DICOMweb endpoint not configured — check viewer settings.</p>
          )}

          {effectiveDraftId && studyInstanceUID && dicomWebBase && !disabled && (
            <div className="space-y-1.5" data-testid="series-browser">
              {series.map((s) => (
                <div key={s.uid} className="rounded-md border overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left bg-muted/50 hover:bg-muted"
                    onClick={() => (openSeries === s.uid ? setOpenSeries(null) : void openSeriesInstances(s.uid))}
                  >
                    <span className="text-[11px] font-medium flex-1 truncate">{s.description || "Series"}</span>
                    <span className="text-[10px] text-muted-foreground">{s.numInstances}</span>
                    {openSeries === s.uid ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                  {openSeries === s.uid && (
                    <div className="grid grid-cols-4 gap-1 p-1.5">
                      {loadingInstances ? (
                        <div className="col-span-4 flex justify-center py-2"><Loader2 size={13} className="animate-spin text-muted-foreground" /></div>
                      ) : instances.map((inst) => {
                        const selected = refs.some((r) => r.sopInstanceUid === inst.uid);
                        const thumb = thumbnailRenderedUrl(dicomWebBase, {
                          studyInstanceUid: studyInstanceUID, seriesInstanceUid: s.uid, sopInstanceUid: inst.uid,
                        }, 96);
                        return (
                          <button
                            key={inst.uid}
                            type="button"
                            className={`relative aspect-square rounded overflow-hidden border-2 bg-black ${selected ? "border-blue-500" : "border-transparent hover:border-muted-foreground/40"}`}
                            onClick={() => selectInstance(s, inst)}
                            title={`Image ${inst.instanceNumber ?? ""}${selected ? " (selected — click to remove)" : ""}`}
                            data-testid={`instance-thumb-${inst.uid}`}
                          >
                            {thumb && <img src={thumb} alt="" className="h-full w-full object-contain" loading="lazy" />}
                            {selected && <span className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-blue-500 text-white text-[8px] leading-[14px] text-center">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {series.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No series visible via DICOMweb from this browser.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
