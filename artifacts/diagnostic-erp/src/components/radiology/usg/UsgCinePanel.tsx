import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgCinePanel — P7 cine UI, now a real in-panel player (wires the previously
 * orphaned /api/usg-cine endpoints).
 *
 * Flag-gated by ff_radiology_usg_cine. When the study's DICOMweb is reachable
 * (the canonical /ohif-launch endpoint returns a dicomWebBaseUrl), this panel:
 *   - discovers genuine multi-frame US cine loops from study metadata,
 *   - asks the server (POST /describe) for the authoritative, fps-clamped
 *     playback plan (server is the single source of truth for the frame order),
 *   - PLAYS the loop in-panel by rendering WADO-RS frames
 *     (/instances/{sop}/frames/{n}/rendered) — exact frames, never fabricated,
 *   - captures the current frame as a key image (POST /key-frame → usg_key_images,
 *     a DICOM reference: SOP + real frame, never a pixel blob),
 *   - lists previously captured key frames.
 *
 * Honesty: pixels come straight from the PACS renderer; nothing is synthesised.
 * If DICOMweb is unreachable or the study has no multi-frame loop, the panel says
 * so plainly and reporting is unaffected. Frame count / fps come from the DICOM
 * dataset via the server, so a still image can never masquerade as a cine loop.
 */

interface KeyFrame { id: number; sopInstanceUID: string | null; frameNumber: number; label: string; source: string | null }

interface CinePlan {
  canPlay: boolean;
  orderedFrames: number[];
  fps: number;
  frameDelayMs: number;
  loop: boolean;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  totalFrames: number;
}
interface CineDescribe { isCine: boolean; numberOfFrames: number; plan: CinePlan; suggestedKeyFrame: number | null }

type DicomJson = Record<string, { Value?: unknown[] } | undefined>;
function tagStr(ds: DicomJson, tag: string): string | null {
  const v = ds[tag]?.Value?.[0];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}
function tagNum(ds: DicomJson, tag: string): number | null {
  const v = ds[tag]?.Value?.[0];
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** A multi-frame US instance discovered from study metadata. */
interface CineInstance {
  seriesInstanceUID: string;
  sopInstanceUID: string;
  numberOfFrames: number;
  seriesDescription: string | null;
  /** The trimmed DICOM-JSON dataset we hand to the server for describe/capture. */
  dataset: DicomJson;
}

const US_MULTIFRAME_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.3.1";
// Tags the server's parseCineClip reads — we forward exactly these, nothing more.
const CINE_TAGS = ["0020000D", "0020000E", "00080018", "00080016", "00280008", "00180040", "00082144", "00181063"];

function pickCineTags(ds: DicomJson): DicomJson {
  const out: DicomJson = {};
  for (const t of CINE_TAGS) if (ds[t] !== undefined) out[t] = ds[t];
  return out;
}

export default function UsgCinePanel({
  studyInstanceUID, onOpenViewer,
}: { studyInstanceUID: string | null | undefined; onOpenViewer?: () => void }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_cine") && !!studyInstanceUID;

  // Reuse the canonical launch endpoint (same query key as the embedded viewer,
  // so the two share one cached fetch when mounted together).
  const dicomWebBase = studyInstanceUID ? BROWSER_DICOMWEB_BASE : null;

  const keyFramesQ = useQuery<{ keyFrames: KeyFrame[] }>({
    queryKey: ["usg-cine-keyframes", studyInstanceUID],
    queryFn: () => api.get(`/api/usg-cine/studies/${encodeURIComponent(studyInstanceUID!)}/key-frames`),
    enabled,
  });

  const [clips, setClips] = useState<CineInstance[] | null>(null);
  const [discoverError, setDiscoverError] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [plan, setPlan] = useState<CinePlan | null>(null);
  const [frame, setFrame] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  // ── Discover genuine multi-frame US cine loops from study metadata ──────────
  useEffect(() => {
    if (!enabled || !dicomWebBase || !studyInstanceUID) return;
    let cancelled = false;
    setClips(null); setDiscoverError(false);
    (async () => {
      try {
        const res = await fetch(
          `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID)}/metadata`,
          { headers: { Accept: "application/dicom+json" } },
        );
        if (!res.ok) { if (!cancelled) setDiscoverError(true); return; }
        const data = (await res.json()) as DicomJson[];
        const found: CineInstance[] = [];
        for (const ds of Array.isArray(data) ? data : []) {
          const frames = tagNum(ds, "00280008") ?? 1;   // NumberOfFrames
          const sopClass = tagStr(ds, "00080016");
          const modality = tagStr(ds, "00080060");
          // A real cine loop: >1 frame, and US (by modality or the US multi-frame SOP class).
          if (frames > 1 && (modality === "US" || sopClass === US_MULTIFRAME_SOP_CLASS)) {
            const sop = tagStr(ds, "00080018");
            const series = tagStr(ds, "0020000E");
            if (sop && series) {
              found.push({
                seriesInstanceUID: series,
                sopInstanceUID: sop,
                numberOfFrames: Math.floor(frames),
                seriesDescription: tagStr(ds, "0008103E"),
                dataset: pickCineTags(ds),
              });
            }
          }
        }
        if (!cancelled) { setClips(found); setSelectedIdx(0); }
      } catch {
        if (!cancelled) setDiscoverError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, dicomWebBase, studyInstanceUID]);

  const selected = clips && clips[selectedIdx] ? clips[selectedIdx] : null;

  // ── Ask the server for the authoritative playback plan for the selected clip ─
  useEffect(() => {
    if (!selected) { setPlan(null); return; }
    let cancelled = false;
    setPlaying(false);
    api.post<CineDescribe>("/api/usg-cine/describe", { clip: selected.dataset })
      .then((d) => {
        if (cancelled) return;
        setPlan(d.plan);
        setFrame(d.suggestedKeyFrame ?? 1);
      })
      .catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [selected]);

  // ── Playback loop — advance the frame index at the plan's delay ─────────────
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!playing || !plan || !plan.canPlay || plan.orderedFrames.length === 0) return;
    timerRef.current = setInterval(() => {
      setFrame((f) => {
        const frames = plan.orderedFrames;
        const idx = frames.indexOf(f);
        const nextIdx = idx < 0 ? 0 : idx + 1;
        if (nextIdx >= frames.length) return plan.loop ? frames[0] : f;
        return frames[nextIdx];
      });
    }, Math.max(16, plan.frameDelayMs));
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [playing, plan]);

  const frameUrl = useMemo(() => {
    if (!dicomWebBase || !selected) return null;
    return `${dicomWebBase}/studies/${encodeURIComponent(studyInstanceUID!)}/series/${encodeURIComponent(selected.seriesInstanceUID)}/instances/${encodeURIComponent(selected.sopInstanceUID)}/frames/${frame}/rendered?quality=90&viewport=512,512`;
  }, [dicomWebBase, selected, studyInstanceUID, frame]);

  const capture = useCallback(async () => {
    if (!selected || !studyInstanceUID) return;
    setCaptureMsg(null);
    try {
      const r = await api.post<{ created: boolean; frameNumber: number }>(
        `/api/usg-cine/studies/${encodeURIComponent(studyInstanceUID)}/key-frame`,
        { clip: selected.dataset, studyInstanceUID, selectedFrame: frame, label: `Cine key frame ${frame}/${selected.numberOfFrames}` },
      );
      setCaptureMsg(r.created ? `Captured frame ${r.frameNumber}` : `Frame ${r.frameNumber} already captured`);
      void keyFramesQ.refetch();
    } catch {
      setCaptureMsg("Capture failed — reporting is unaffected.");
    }
  }, [selected, studyInstanceUID, frame, keyFramesQ]);

  if (!enabled) return null;

  return (
    <div className="text-xs space-y-1.5" data-testid="usg-cine-panel">
      <div className="font-medium text-sm">Cine / key frames</div>

      {!dicomWebBase && <p className="text-amber-600">Cine unavailable — viewer/PACS not connected. Reporting is unaffected.</p>}
      {dicomWebBase && discoverError && <p className="text-amber-600">Could not read study images from PACS. Reporting is unaffected.</p>}
      {dicomWebBase && !discoverError && clips === null && <p className="text-muted-foreground">Scanning study for cine loops…</p>}
      {dicomWebBase && !discoverError && clips !== null && clips.length === 0 && (
        <p className="text-muted-foreground">No multi-frame cine loops in this study.</p>
      )}

      {selected && (
        <div className="space-y-1.5">
          {clips!.length > 1 && (
            <select
              className="w-full rounded border bg-background px-1 py-0.5"
              value={selectedIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
            >
              {clips!.map((c, i) => (
                <option key={c.sopInstanceUID} value={i}>
                  {c.seriesDescription || `Series ${c.seriesInstanceUID.slice(-6)}`} · {c.numberOfFrames} frames
                </option>
              ))}
            </select>
          )}

          <div className="relative w-full aspect-square bg-black rounded overflow-hidden flex items-center justify-center">
            {frameUrl
              ? <img src={frameUrl} alt={`Frame ${frame}`} className="max-w-full max-h-full object-contain" draggable={false} />
              : <span className="text-muted-foreground">—</span>}
          </div>

          {plan && plan.canPlay ? (
            <>
              <div className="flex items-center gap-2">
                <button className="px-2 py-0.5 rounded border" onClick={() => setPlaying((p) => !p)}>
                  {playing ? "Pause" : "Play"}
                </button>
                <input
                  type="range" className="flex-1"
                  min={plan.orderedFrames[0]} max={plan.orderedFrames.at(-1)} value={frame}
                  onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
                />
                <span className="tabular-nums text-muted-foreground w-16 text-right">f{frame}/{plan.totalFrames}</span>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-0.5 rounded border" onClick={capture}>Capture key frame</button>
                <span className="text-muted-foreground">{plan.fps} fps</span>
                {captureMsg && <span className="text-emerald-600">{captureMsg}</span>}
              </div>
            </>
          ) : plan ? (
            <p className="text-muted-foreground">This image is a still frame, not a cine loop.</p>
          ) : (
            <p className="text-muted-foreground">Loading clip…</p>
          )}
        </div>
      )}

      {keyFramesQ.data && keyFramesQ.data.keyFrames.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t">
          <div className="text-muted-foreground">Captured key frames</div>
          <ul className="space-y-0.5">
            {keyFramesQ.data.keyFrames.map((k) => (
              <li key={k.id} className="flex items-center gap-2">
                <span className="flex-1">{k.label || `Frame ${k.frameNumber}`}</span>
                <span className="text-muted-foreground">SOP {k.sopInstanceUID ? `${k.sopInstanceUID.slice(0, 8)}…` : "—"} · f{k.frameNumber}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        {onOpenViewer && <button className="px-2 py-0.5 rounded border" onClick={onOpenViewer}>Open in viewer</button>}
      </div>
      <p className="text-[10px] text-muted-foreground">Frames are rendered by the PACS on demand; key frames are stored as DICOM references (SOP + frame), never image blobs.</p>
    </div>
  );
}
