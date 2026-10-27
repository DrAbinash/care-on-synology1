/**
 * PacsImagePickerDialog — SELECT IMAGES FROM PACS.
 *
 * The radiologist opens a report, clicks this, sees every sequence of the study
 * that is already bound to the report, clicks through to its images, picks the
 * ones worth printing, and adds them. Nothing here involves OHIF: series and
 * instances come from CARE's DICOMweb proxy and pixels come from Orthanc's own
 * renderer, so the workflow keeps working when the viewer is down.
 *
 * "Add to report" freezes each chosen picture on the server
 * (POST /key-images/from-pacs). The report keeps its images even if Orthanc is
 * later unavailable, and print/PDF — which already build from
 * radiology_report_key_images — shows exactly what was chosen here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { withDicomWebAuth } from "@/lib/browserDicomWeb";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import {
  buildPacsStillBody, frameOptions, instanceListUrl, parsePacsInstances, parsePacsSeries,
  pickKey, renderedImageUrl, seriesListUrl,
  type PacsInstance, type PacsPick, type PacsSeries, type PacsStudyContext,
} from "@/lib/pacsImagePicker";

const THUMB_PX = 220;
const MAX_PICKS = 100;

export default function PacsImagePickerDialog({
  open,
  onClose,
  studyInstanceUid,
  getContext,
  onAttached,
}: {
  open: boolean;
  onClose: () => void;
  studyInstanceUid: string | null;
  /** Resolved at click time: a draft can be created while the dialog is open. */
  getContext: () => PacsStudyContext | null;
  onAttached: (count: number) => void;
}) {
  const [series, setSeries] = useState<PacsSeries[]>([]);
  const [activeSeries, setActiveSeries] = useState<PacsSeries | null>(null);
  const [instances, setInstances] = useState<PacsInstance[]>([]);
  const [picks, setPicks] = useState<Map<string, PacsPick>>(new Map());
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    if (!studyInstanceUid) return;
    let cancelled = false;
    setLoadingSeries(true);
    setSeriesError(null);
    api.get<unknown>(seriesListUrl(studyInstanceUid))
      .then((json) => {
        if (cancelled) return;
        const rows = parsePacsSeries(json);
        setSeries(rows);
        setActiveSeries(rows[0] ?? null);
        if (rows.length === 0) setSeriesError("This study has no series in PACS.");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setSeries([]);
        setActiveSeries(null);
        setSeriesError(err.message || "PACS could not be reached.");
      })
      .finally(() => { if (!cancelled) setLoadingSeries(false); });
    return () => { cancelled = true; };
  }, [open, studyInstanceUid]);

  useEffect(() => {
    if (!open || !activeSeries || !studyInstanceUid) return;
    const seq = ++requestSeq.current;
    let cancelled = false;
    setLoadingInstances(true);
    setInstancesError(null);
    setInstances([]);
    api.get<unknown>(instanceListUrl(studyInstanceUid, activeSeries.uid))
      .then((json) => {
        if (cancelled || seq !== requestSeq.current) return;
        setInstances(parsePacsInstances(json));
      })
      .catch((err: Error) => {
        if (cancelled || seq !== requestSeq.current) return;
        setInstancesError(err.message || "PACS could not list this series.");
      })
      .finally(() => { if (!cancelled && seq === requestSeq.current) setLoadingInstances(false); });
    return () => { cancelled = true; };
  }, [open, activeSeries, studyInstanceUid]);

  const toggle = useCallback((pick: PacsPick, frame: number | null) => {
    const key = pickKey(pick.sopUid, frame);
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (next.size >= MAX_PICKS) return prev;
        next.set(key, { ...pick, frame });
      }
      return next;
    });
  }, []);

  const selectedCount = picks.size;

  const addAll = useCallback(async () => {
    const ctx = getContext();
    if (!ctx || selectedCount === 0) return;
    setBusy(true);
    setResult(null);
    let added = 0;
    const failures: string[] = [];
    for (const pick of Array.from(picks.values())) {
      try {
        await api.post("/api/radiology/report-generator/key-images/from-pacs", buildPacsStillBody(pick, ctx));
        added++;
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    setBusy(false);
    if (added > 0) {
      setPicks(new Map());
      onAttached(added);
    }
    setResult(
      failures.length === 0
        ? `${added} image${added === 1 ? "" : "s"} added to the report.`
        : `${added} added. ${failures.slice(0, 2).join(" · ")}${failures.length > 2 ? ` · ${failures.length - 2} more` : ""}`,
    );
    if (added > 0 && failures.length === 0) onClose();
  }, [getContext, picks, selectedCount, onAttached, onClose]);

  const grouped = useMemo(() => {
    // A multiframe object is chosen frame by frame; a single-frame object is
    // chosen whole, with no frame claim sent at all.
    return instances.map((inst) => ({
      inst,
      frames: frameOptions(inst.numberOfFrames),
    }));
  }, [instances]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select images from PACS"
      data-testid="pacs-image-picker-dialog"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-bold">SELECT IMAGES FROM PACS</h2>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-3 p-4">
          <div className="w-60 shrink-0 overflow-y-auto border-r pr-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sequences {series.length ? `(${series.length})` : ""}
            </div>
            {loadingSeries ? (
              <div className="flex items-center gap-1.5 py-6 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading series from PACS…
              </div>
            ) : seriesError ? (
              <p className="text-xs text-slate-500">{seriesError}</p>
            ) : (
              series.map((s) => (
                <button
                  key={s.uid}
                  type="button"
                  onClick={() => setActiveSeries(s)}
                  className={`mb-1 w-full rounded px-2.5 py-1.5 text-left text-[12px] ${
                    activeSeries?.uid === s.uid ? "bg-indigo-50 font-semibold text-indigo-700" : "hover:bg-slate-100"
                  }`}
                  data-testid={`pacs-series-${s.uid}`}
                >
                  <span className="block truncate">{s.description || `Series ${s.number ?? ""}`}</span>
                  <span className="block text-[10px] text-slate-500">
                    {[s.modality, s.instanceCount != null ? `${s.instanceCount} images` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!activeSeries ? (
              <p className="py-10 text-center text-xs text-slate-500">Choose a sequence.</p>
            ) : loadingInstances ? (
              <div className="flex items-center justify-center gap-1.5 py-10 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading images…
              </div>
            ) : instancesError ? (
              <p className="py-10 text-center text-xs text-slate-500">{instancesError}</p>
            ) : grouped.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-500">This sequence has no images.</p>
            ) : (
              <div className="space-y-3">
                {grouped.map(({ inst, frames }) => {
                  const base = {
                    seriesUid: activeSeries.uid,
                    seriesDescription: activeSeries.description,
                    modality: activeSeries.modality,
                    sopUid: inst.sopUid,
                    instanceNumber: inst.instanceNumber,
                  };
                  const thumbFor = (frame: number | null) =>
                    withDicomWebAuth(renderedImageUrl({
                      studyInstanceUid: studyInstanceUid!,
                      seriesUid: activeSeries.uid,
                      sopUid: inst.sopUid,
                      frame,
                    }, frame == null ? THUMB_PX : 120));
                  if (!frames) {
                    const on = picks.has(pickKey(inst.sopUid, null));
                    return (
                      <Thumb
                        key={inst.sopUid}
                        selected={on}
                        label={inst.instanceNumber != null ? String(inst.instanceNumber) : ""}
                        imgSrc={studyInstanceUid ? thumbFor(null) : null}
                        onToggle={() => toggle({ ...base, frame: null }, null)}
                      />
                    );
                  }
                  return (
                    <div key={inst.sopUid} className="rounded border border-slate-200 p-1.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Image {inst.instanceNumber ?? ""} · {frames.length} frames — choose frames
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {frames.map((frame) => {
                          const on = picks.has(pickKey(inst.sopUid, frame));
                          return (
                            <Thumb
                              key={frame}
                              selected={on}
                              label={String(frame)}
                              small
                              imgSrc={studyInstanceUid ? thumbFor(frame) : null}
                              onToggle={() => toggle({ ...base, frame }, frame)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3">
          <span className="text-xs text-slate-600" data-testid="pacs-picker-status">
            {result ?? (selectedCount > 0 ? `${selectedCount} selected` : "Click images to select them")}
          </span>
          <Button
            type="button"
            onClick={addAll}
            disabled={busy || selectedCount === 0 || !studyInstanceUid || getContext() === null}
            data-testid="pacs-add-to-report"
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            ADD TO REPORT{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Thumb({
  imgSrc, label, selected, small, onToggle,
}: {
  imgSrc: string | null;
  label: string;
  selected: boolean;
  small?: boolean;
  onToggle: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={selected ? "Selected — click to remove" : "Select this image"}
      className={`relative overflow-hidden rounded border-2 bg-black p-0 ${
        small ? "h-20 w-20" : "h-28 w-28"
      } ${selected ? "border-indigo-500" : "border-transparent hover:border-slate-300"}`}
      data-testid={small ? `pacs-frame-${label}` : `pacs-thumb-${label}`}
    >
      {imgSrc && !broken ? (
        <img
          src={imgSrc}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[9px] text-slate-400">no preview</span>
      )}
      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white">{label}</span>
      {selected ? (
        <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">✓</span>
      ) : null}
    </button>
  );
}
