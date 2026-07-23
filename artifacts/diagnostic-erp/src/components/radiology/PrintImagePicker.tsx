/**
 * PrintImagePicker.tsx — print-from-workspace bridge integration.
 *
 * A SEPARATE, print-only image selection — independent of ReportImagePicker's
 * persisted report-image references. Nothing here is written to the database;
 * selection lives only in this component's local state and is cleared once a
 * print job is sent. That keeps "what's on the printed photo-paper page" free
 * to differ from "what's embedded in the written report", which is the whole
 * point of a distinct picker rather than reusing the report's selection.
 *
 * Browses the study over the SAME browser DICOMweb base the embedded viewer
 * and ReportImagePicker use (M1.2 launch contract). On "Print", forwards the
 * selected study/series/SOP references to POST /api/radiology/print-images,
 * which fetches full-resolution pixels from Orthanc server-side and forwards
 * them to the NAS DICOM print bridge (drabinash/dicomtowindows).
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Printer, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { thumbnailRenderedUrl } from "@/lib/reportImageRefs";

const MAX_PRINT_IMAGES = 100; // mirrors the server route's own cap

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

interface SelectedImage {
  seriesInstanceUid: string;
  sopInstanceUid: string;
  label: string;
}

interface PrintJobResult {
  requested?: number;
  fetched?: number;
  skipped?: number;
  pages?: number;
}

export default function PrintImagePicker({
  studyInstanceUID,
  disabled,
}: {
  studyInstanceUID: string | null;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [series, setSeries] = useState<SeriesEntry[]>([]);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceEntry[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedImage>>(new Map());
  const [copies, setCopies] = useState(1);

  // Same launch contract + React Query cache key ReportImagePicker uses —
  // mounting both components costs one network fetch, not two.
  const { data: launchData } = useQuery<LaunchData>({
    queryKey: ["viewer-launch", studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(studyInstanceUID!)}/ohif-launch`),
    enabled: !!studyInstanceUID,
    staleTime: 5 * 60_000,
  });
  const dicomWebBase = launchData?.dicomWebBaseUrl ?? null;

  const printMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PrintJobResult>("/api/radiology/print-images", body),
    onSuccess: (data) => {
      const skippedNote = data.skipped ? ` (${data.skipped} image(s) were not included — PACS fetch issue or batch too large)` : "";
      toast({
        title: "Sent to printer",
        description: `${data.fetched ?? selected.size} image(s) across ${data.pages ?? "?"} page(s)${skippedNote}`,
      });
      setSelected(new Map());
    },
    onError: (err: Error) => toast({ title: "Print failed", description: err.message, variant: "destructive" }),
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

  function toggleSelect(seriesEntry: SeriesEntry, inst: InstanceEntry) {
    setSelected((prev) => {
      if (prev.has(inst.uid)) {
        const next = new Map(prev);
        next.delete(inst.uid);
        return next;
      }
      if (prev.size >= MAX_PRINT_IMAGES) {
        toast({ title: `Maximum ${MAX_PRINT_IMAGES} images per print job`, variant: "destructive" });
        return prev;
      }
      const next = new Map(prev);
      next.set(inst.uid, {
        seriesInstanceUid: seriesEntry.uid,
        sopInstanceUid: inst.uid,
        label: seriesEntry.description || `Image ${inst.instanceNumber ?? ""}`.trim(),
      });
      return next;
    });
  }

  function handlePrint() {
    if (!studyInstanceUID || selected.size === 0 || printMutation.isPending) return;
    const images = Array.from(selected.values()).map((s) => ({
      studyInstanceUid: studyInstanceUID,
      seriesInstanceUid: s.seriesInstanceUid,
      sopInstanceUid: s.sopInstanceUid,
    }));
    printMutation.mutate({ images, copies: Math.max(1, Math.min(20, copies)) });
  }

  return (
    <div className="rounded-lg border bg-card" data-testid="print-image-picker">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="print-picker-toggle"
      >
        <Printer size={14} className="text-emerald-600 shrink-0" />
        <span className="text-xs font-semibold flex-1">Print images</span>
        {selected.size > 0 && <Badge variant="outline" className="text-[10px]">{selected.size} selected</Badge>}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {!studyInstanceUID && (
            <p className="text-[11px] text-muted-foreground">No StudyInstanceUID on this study — images unavailable.</p>
          )}
          {studyInstanceUID && !dicomWebBase && (
            <p className="text-[11px] text-muted-foreground">DICOMweb endpoint not configured — check viewer settings.</p>
          )}

          {selected.size > 0 && (
            <div className="flex items-center gap-2 rounded-md border bg-emerald-50/50 p-2" data-testid="print-selection-bar">
              <span className="text-[11px] text-muted-foreground flex-1">{selected.size} image(s) ready to print</span>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Copies
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="h-6 w-14 text-[11px] px-1.5"
                  disabled={disabled || printMutation.isPending}
                  data-testid="print-copies-input"
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => setSelected(new Map())}
                disabled={printMutation.isPending}
                data-testid="print-clear-selection"
              >
                <X size={12} className="mr-1" /> Clear
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-6 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                onClick={handlePrint}
                disabled={disabled || printMutation.isPending}
                data-testid="print-send-button"
              >
                {printMutation.isPending
                  ? <Loader2 size={12} className="mr-1 animate-spin" />
                  : <Printer size={12} className="mr-1" />}
                Print {selected.size} image{selected.size === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {/* Series browser */}
          {studyInstanceUID && dicomWebBase && !disabled && (
            <div className="space-y-1.5" data-testid="print-series-browser">
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
                        const isSelected = selected.has(inst.uid);
                        const thumb = thumbnailRenderedUrl(dicomWebBase, {
                          studyInstanceUid: studyInstanceUID, seriesInstanceUid: s.uid, sopInstanceUid: inst.uid,
                        }, 96);
                        return (
                          <button
                            key={inst.uid}
                            type="button"
                            className={`relative aspect-square rounded overflow-hidden border-2 bg-black ${isSelected ? "border-emerald-500" : "border-transparent hover:border-muted-foreground/40"}`}
                            onClick={() => toggleSelect(s, inst)}
                            title={`Image ${inst.instanceNumber ?? ""}${isSelected ? " (selected for print — click to remove)" : ""}`}
                            data-testid={`print-instance-thumb-${inst.uid}`}
                          >
                            {thumb && <img src={thumb} alt="" className="h-full w-full object-contain" loading="lazy" />}
                            {isSelected && (
                              <span className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                <Printer size={9} />
                              </span>
                            )}
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
