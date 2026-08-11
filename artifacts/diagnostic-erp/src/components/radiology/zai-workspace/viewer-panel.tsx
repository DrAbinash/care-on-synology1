import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { modalityAccent, patientAccent } from "@/lib/zai-workspace/types";
import { Maximize2, Layers, Image as ImageIcon, Crosshair, Stethoscope } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/fetchApi";
export function ViewerPanel() {
  const study = useWorkspaceSelector(s => s.studies.find(x => x.id === s.activeStudyId));
  const measurements = useWorkspaceSelector(s => s.measurements);
  const insertM = useWorkspaceSelector(s => s.insertMeasurement);
  const insertAll = useWorkspaceSelector(s => s.insertAllMeasurements);
  const [activeSeries, setActiveSeries] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (!study?.studyInstanceUID?.trim()) { setUrl(null); setErr(null); setLaunching(false); return; }
    let c = false; setLaunching(true); setErr(null);
    api.get<{ url: string; error?: string }>(`/api/radiology/studies/${encodeURIComponent(study.studyInstanceUID)}/ohif-launch`)
      .then(r => { if (!c) { if (r.url) setUrl(r.url); else if (r.error) setErr(r.error); } })
      .catch(e => { if (!c) setErr(e instanceof Error ? e.message : "Launch failed"); })
      .finally(() => { if (!c) setLaunching(false); });
    return () => { c = true; };
  }, [study?.studyInstanceUID]);
  if (!study) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a study</div>;
  const patient = study.patient ?? { id: "0", name: "Unknown", age: 0, sex: "O" as const, uhid: "", referringDoctor: "" };
  const mod = modalityAccent(study.modality); const a = patientAccent(patient.id || "0"); const series = study.series > 0 ? study.series : 4;
  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2"><div className="flex items-center gap-2"><span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: mod.color }}>{mod.label}</span><span className="text-xs font-semibold text-slate-200">{study.studyDescription}</span><span className="text-[10px] text-slate-400">{study.bodyPart}</span></div><div className="flex items-center gap-2">{launching && <span className="text-[10px] text-slate-400">Launching...</span>}<button className="rounded p-1 text-slate-400 hover:bg-slate-800"><Maximize2 className="h-3.5 w-3.5" /></button></div></div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ background: a.bg, color: a.text }}><div className="h-2 w-2 rounded-full" style={{ background: a.ring }} /><span className="font-semibold">{patient.name}</span><span>·</span><span>{patient.age}{patient.sex}</span><span>·</span><span className="font-mono">{patient.uhid}</span><span className="ml-auto inline-flex items-center gap-1"><Stethoscope className="h-3 w-3" /> {patient.referringDoctor}</span></div>
      <div className="relative flex-1 overflow-hidden">
        {url ? <iframe src={url} className="absolute inset-0 h-full w-full border-0" title="OHIF Viewer" allow="clipboard-read; clipboard-write; fullscreen" /> : err ? <div className="absolute inset-0 flex items-center justify-center bg-slate-950"><div className="text-center max-w-sm p-4"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-900/40 border border-rose-700"><Crosshair className="h-6 w-6 text-rose-400" /></div><div className="text-sm font-semibold text-rose-300">Viewer launch failed</div><div className="text-[10px] text-rose-400/80 mt-1">{err}</div></div></div> :
        !study.studyInstanceUID?.trim() ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
            <div className="text-center max-w-sm p-4">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 border border-slate-700">
                <ImageIcon className="h-6 w-6 text-slate-400" />
              </div>
              <div className="text-sm font-semibold text-slate-200">No DICOM study linked</div>
              <div className="text-[10px] text-slate-400 mt-1">
                This worklist row has no StudyInstanceUID — common after moving or re-indexing Orthanc.
                Re-link from the Worklist, or open via Weasis/OHIF if accession is known.
              </div>
            </div>
          </div>
        ) :
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black" style={{ backgroundImage: `radial-gradient(circle at 50% 45%, hsl(${a.hue}, 30%, 25%) 0%, transparent 60%)` }}>
          <div className="text-center"><div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-2xl border-2 opacity-90" style={{ borderColor: a.ring }}><ImageIcon className="h-10 w-10" style={{ color: a.ring }} /></div><div className="text-sm font-semibold text-slate-200">DICOM Viewer</div><div className="text-[10px] text-slate-400">Series {activeSeries + 1} of {series} · {study.images} images</div><div className="mt-1 font-mono text-[10px] text-slate-500">{study.studyInstanceUID}</div></div>
          <Crosshair className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-emerald-400/70" />
          <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[10px] text-slate-400"><span className="font-mono">W: 400 / L: 40</span><span className="font-mono">Zoom: 100%</span><span className="font-mono">Img: 1/{study.images || 0}</span></div>
        </div>}
        {!url && !!study.studyInstanceUID?.trim() && <div className="absolute bottom-10 left-3 right-3 flex gap-1.5">{Array.from({ length: Math.min(series, 6) }).map((_, i) => <button key={i} onClick={() => setActiveSeries(i)} className={cn("h-12 w-16 rounded border-2 transition", activeSeries === i ? "border-emerald-400" : "border-slate-700 hover:border-slate-500")} style={{ background: `linear-gradient(135deg, hsl(${a.hue + i * 20}, 20%, 18%), hsl(${a.hue + i * 20}, 25%, 8%))` }}><div className="text-[9px] text-slate-400">S{i + 1}</div></button>)}</div>}
      </div>
      {measurements.length > 0 && <div className="border-t border-slate-800 bg-slate-900/80 px-3 py-2"><div className="flex items-center justify-between mb-1.5"><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300"><Layers className="h-3 w-3" /> Measurements ({measurements.filter(m => !m.inserted).length} pending)</span><button onClick={insertAll} className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white hover:bg-emerald-700" disabled={measurements.every(m => m.inserted)}>Insert all</button></div><div className="flex flex-wrap gap-1">{measurements.map(m => <button key={m.id} onClick={() => !m.inserted && insertM(m.id)} disabled={m.inserted} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono transition", m.inserted ? "border-slate-700 bg-slate-800 text-slate-500" : "border-emerald-300 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40 cursor-pointer")}><span>{m.name}</span><span className="font-bold">{m.value}{m.unit}</span>{m.delta !== undefined && m.delta !== 0 && <span className={m.delta > 0 ? "text-rose-300" : "text-emerald-300"}>Δ{m.delta > 0 ? "+" : ""}{m.delta}</span>}{m.source === "ai" && <span className="rounded bg-violet-700 px-0.5 text-[8px] text-white">AI</span>}</button>)}</div></div>}
    </div>
  );
}
