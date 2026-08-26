import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupFormatsForContext } from "@/lib/zai-workspace/report-formats-library";
import { filterFormatsByPickerTab } from "@/lib/zai-workspace/fullReportFormat";
import type { ReportFormat } from "@/lib/zai-workspace/types";
import { useMemo, useState } from "react";
import { Search, FileText, X, ChevronRight, Star, Trash2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
function cat(f: ReportFormat): string { const t = f.diagnosisTags.join(" ").toLowerCase(); return t.includes("critical") ? "bg-rose-500" : t.includes("normal") ? "bg-emerald-500" : t.includes("benign") ? "bg-sky-500" : "bg-amber-500"; }
export function ReportFormatPicker() {
  const formats = useWorkspaceSelector(s => s.reportFormats); const sel = useWorkspaceSelector(s => s.selectedFormatIds);
  const toggle = useWorkspaceSelector(s => s.toggleFormatSelection); const apply = useWorkspaceSelector(s => s.applySelectedFormats); const clear = useWorkspaceSelector(s => s.clearFormatSelection);
  const applyById = useWorkspaceSelector(s => s.applyFormatById);
  const toggleFav = useWorkspaceSelector(s => s.toggleFormatFavorite);
  const study = useWorkspaceSelector(s => s.studies.find(x => x.id === s.activeStudyId));
  const reportingContext = useWorkspaceSelector(s => s.reportingContext);
  const openSaveAs = useWorkspaceSelector(s => s.openSaveAsFormatDialog); const del = useWorkspaceSelector(s => s.deleteReportFormat);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "favorites" | "recent">("all");
  const scoped = useMemo(
    () => lookupFormatsForContext(formats, study?.modality, reportingContext, {
      protocolName: reportingContext.protocolName,
      studyDescription: reportingContext.studyDescription ?? study?.studyDescription,
    }),
    [formats, study?.modality, study?.studyDescription, reportingContext],
  );
  const tabbed = useMemo(() => filterFormatsByPickerTab(scoped, tab), [scoped, tab]);
  const filtered = useMemo(() => { if (!search.trim()) return tabbed; const q = search.toLowerCase(); return tabbed.filter(f => f.name.toLowerCase().includes(q) || (f.reportTitle ?? "").toLowerCase().includes(q) || (f.protocolScope ?? "").toLowerCase().includes(q) || f.diagnosisTags.some(t => t.toLowerCase().includes(q)) || f.findings.toLowerCase().includes(q)); }, [tabbed, search]);
  const selected = formats.filter(f => sel.includes(f.id));
  if (!study) return <div className="rounded border border-dashed border-emerald-300/60 bg-emerald-50/30 p-2 text-[11px] text-emerald-700/80 text-center">Select a study</div>;
  return (
    <div className="space-y-2" data-testid="full-report-format-picker">
      <div className="flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600/80">Full Report Formats</div><span className="rounded bg-emerald-50 border border-emerald-200/60 px-1 py-0.5 font-mono text-[9px] text-emerald-700">{study.modality} · {reportingContext.region || study.bodyPart || "unresolved"}</span></div>
      <p className="text-[10px] text-muted-foreground leading-snug">Click a format to apply the complete report (technique, findings, impression). Ctrl-click to select two for merge.</p>
      <div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-emerald-500" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-7 w-full rounded-md border border-emerald-200/60 bg-background pl-6 pr-3 text-[11px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200" data-testid="report-format-search" /></div>
      <div className="flex gap-1">
        {(["all", "favorites", "recent"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", tab === t ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:bg-emerald-50")}
            data-testid={`report-format-tab-${t}`}
          >{t}</button>
        ))}
      </div>
      {selected.length > 0 && <div className="rounded-md border border-emerald-300 bg-emerald-50/40 p-1.5 space-y-1"><div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700">Selected ({selected.length}/2)</div><div className="flex flex-wrap gap-1">{selected.map((f, i) => <div key={f.id} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", i === 0 ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-sky-300 bg-sky-100 text-sky-800")}><span className="font-mono text-[8px] opacity-70">{i === 0 ? "A" : "B"}</span><span>{f.name}</span><button onClick={() => toggle(f.id)} className="rounded p-0.5 hover:bg-white/50"><X className="h-2.5 w-2.5" /></button></div>)}<button onClick={clear} className="text-[9px] text-muted-foreground hover:text-rose-600 px-1">clear</button></div><Button size="sm" className="w-full h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700" onClick={apply}>{selected.length === 1 ? <><ChevronRight className="h-3 w-3 mr-1" /> Apply</> : <><ChevronRight className="h-3 w-3 mr-1" /> Merge & preview ({selected.length})</>}</Button></div>}
      <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">{filtered.map(f => { const isSel = sel.includes(f.id); const idx = sel.indexOf(f.id); return <div key={f.id} className={cn("group relative rounded-md border bg-card p-2 transition cursor-pointer", isSel ? (idx === 0 ? "border-emerald-400 bg-emerald-50/30" : "border-sky-400 bg-sky-50/30") : "border-border hover:border-emerald-300")} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) { toggle(f.id); return; } applyById(f.id); }} data-testid={`report-format-tile-${f.id}`}><div className="flex items-start gap-1.5"><span className={cn("mt-1 h-1.5 w-1.5 rounded-full flex-none", cat(f))} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><FileText className="h-3 w-3 text-muted-foreground flex-none" /><span className="text-xs font-semibold truncate">{f.name}</span>{f.isCommon && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />}{idx >= 0 && <span className={cn("rounded px-1 py-0.5 text-[8px] font-bold", idx === 0 ? "bg-emerald-200 text-emerald-800" : "bg-sky-200 text-sky-800")}>{idx === 0 ? "A" : "B"}</span>}{f.usageCount && f.usageCount > 0 && <span className="rounded bg-muted px-1 text-[8px] font-mono text-muted-foreground">{f.usageCount}×</span>}</div>{(f.reportTitle || f.protocolScope) && <div className="text-[10px] text-emerald-800/80 mt-0.5 truncate">{f.reportTitle || "Heading: current study"}{f.protocolScope ? ` · ${f.protocolScope}` : ""}</div>}<div className="flex flex-wrap gap-1 mt-1">{f.diagnosisTags.map(t => <span key={t} className="rounded bg-muted/60 px-1 text-[9px] text-muted-foreground">#{t}</span>)}</div><div className="text-[10px] text-muted-foreground/80 italic mt-1 line-clamp-2">{f.findings.slice(0, 110)}{f.findings.length > 110 ? "..." : ""}</div></div><div className="flex flex-col items-center gap-0.5"><button type="button" onClick={e => { e.stopPropagation(); toggleFav(f.id); }} className={cn("rounded p-0.5", f.favorite ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500")} title={f.favorite ? "Unfavorite" : "Favorite"} data-testid={`report-format-fav-${f.id}`}><Star className={cn("h-3 w-3", f.favorite && "fill-amber-400")} /></button>{f.custom && <button onClick={e => { e.stopPropagation(); if (confirm(`Delete "${f.name}"?`)) del(f.id); }} className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-2.5 w-2.5" /></button>}</div></div></div>; })}</div>
      <Button size="sm" variant="outline" className="w-full h-7 text-[10px] border-dashed" onClick={openSaveAs} data-testid="save-as-full-format"><Save className="h-3 w-3 mr-1" /> Save current as full format</Button>
    </div>
  );
}
