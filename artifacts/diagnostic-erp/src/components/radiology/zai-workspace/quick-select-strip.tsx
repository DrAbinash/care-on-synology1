import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupTiles } from "@/lib/zai-workspace/quick-select-library";
import type { QuickSelectField, QuickSelectTile } from "@/lib/zai-workspace/types";
import { useMemo, useState, useRef, useEffect } from "react";
import { Plus, Pencil, Star, Search, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
const CAT: Record<string, string> = { normal: "bg-emerald-500", abnormal: "bg-amber-500", critical: "bg-rose-500", variant: "bg-sky-500" };
const LABELS: Record<QuickSelectField, string> = { clinicalHistory: "History", technique: "Technique", findings: "Findings", impression: "Impression", recommendation: "Recommendation" };
export function QuickSelectStrip({ field }: { field: QuickSelectField }) {
  const tiles = useWorkspaceSelector(s => s.quickSelectTiles);
  const study = useWorkspaceSelector(s => s.studies.find(x => x.id === s.activeStudyId));
  const openEditor = useWorkspaceSelector(s => s.openQuickSelectEditor);
  const toggleFav = useWorkspaceSelector(s => s.toggleTileFavorite);
  const incUsage = useWorkspaceSelector(s => s.incrementTileUsage);
  const [search, setSearch] = useState(""); const [showSearch, setShowSearch] = useState(false); const ref = useRef<HTMLInputElement>(null);
  const scoped = useMemo(() => lookupTiles(tiles, field, study?.modality, study?.bodyPart), [tiles, field, study?.modality, study?.bodyPart]);
  const filtered = useMemo(() => { if (!search.trim()) return scoped; const q = search.toLowerCase(); return scoped.filter(t => t.label.toLowerCase().includes(q) || t.sentence.toLowerCase().includes(q) || (t.mnemonic ?? "").toLowerCase().includes(q)); }, [scoped, search]);
  useEffect(() => { if (showSearch) setTimeout(() => ref.current?.focus(), 50); }, [showSearch]);
  if (!study) return <div className="mb-2 text-[10px] text-muted-foreground"><span className="font-semibold uppercase tracking-wider text-emerald-600/80">{LABELS[field]} Quick Select · select a study</span></div>;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-[10px]"><span className="font-semibold uppercase tracking-wider text-emerald-600/80">{LABELS[field]} Quick Select</span><span className="rounded bg-emerald-50 border border-emerald-200/60 px-1 py-0.5 font-mono text-[9px] text-emerald-700">{study.modality} · {study.bodyPart}</span><span className="text-muted-foreground/60">{scoped.length} tiles</span></div>
        <div className="flex items-center gap-0.5">{showSearch ? <div className="relative"><Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-emerald-500" /><input ref={ref} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Escape" && setShowSearch(false)} placeholder="Search..." className="h-6 w-44 rounded-full border border-emerald-300 bg-background pl-6 pr-6 text-[11px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200" /><button onClick={() => { setShowSearch(false); setSearch(""); }} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-rose-600"><X className="h-3 w-3" /></button></div> : <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] hover:bg-emerald-50 hover:text-emerald-700" onClick={() => setShowSearch(true)}><Search className="h-3 w-3" /></Button>}</div>
      </div>
      <div className="flex flex-wrap gap-1 max-h-[88px] overflow-y-auto pr-1">
        {filtered.map(tile => <div key={tile.id} className="group relative inline-flex items-center gap-1 rounded-md border border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/20 px-2 py-1 text-[10.5px] cursor-pointer transition hover:border-emerald-400 hover:shadow-sm hover:shadow-emerald-500/10" onClick={() => { useWorkspace.getState().mergeField(field, tile.sentence, "quick-select"); incUsage(tile.id); }} title={tile.sentence}>
          <span className={cn("h-1.5 w-1.5 rounded-full flex-none", CAT[tile.category])} />
          <span className="font-semibold truncate max-w-[140px]">{tile.label}</span>
          {tile.mnemonic && <span className="rounded bg-emerald-50 text-emerald-600 px-1 font-mono text-[8px] uppercase">{tile.mnemonic}</span>}
          {tile.usageCount && tile.usageCount > 3 && <span className="rounded bg-emerald-100 text-emerald-700 px-0.5 text-[8px] font-mono">{tile.usageCount}</span>}
          <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 ml-1"><button onClick={e => { e.stopPropagation(); toggleFav(tile.id); }} className={cn("rounded p-0.5 hover:bg-muted", tile.favorite ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500")}><Star className={cn("h-2.5 w-2.5", tile.favorite && "fill-current")} /></button><button onClick={e => { e.stopPropagation(); openEditor(tile, field); }} className="rounded p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground"><Pencil className="h-2.5 w-2.5" /></button></div>
          {tile.favorite && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400 ml-0.5 group-hover:hidden" />}
        </div>)}
        <button onClick={() => openEditor(null, field)} className="inline-flex items-center gap-1 rounded-md border-2 border-dashed border-emerald-300/50 bg-emerald-50/20 px-2 py-1 text-[10.5px] text-emerald-600 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50/50 transition"><Plus className="h-3 w-3" /><span>Add tile</span><ChevronRight className="h-2.5 w-2.5 opacity-50" /></button>
      </div>
    </div>
  );
}
