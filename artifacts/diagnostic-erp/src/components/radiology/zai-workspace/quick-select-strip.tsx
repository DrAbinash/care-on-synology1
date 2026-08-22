import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupTilesForContext } from "@/lib/zai-workspace/quick-select-library";
import type { QuickSelectField, QuickSelectTile } from "@/lib/zai-workspace/types";
import { useMemo, useState, useRef, useEffect } from "react";
import { Plus, Pencil, Star, Search, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const CAT_DOT: Record<string, string> = {
  normal: "bg-emerald-500 shadow-emerald-400/50",
  abnormal: "bg-amber-500 shadow-amber-400/50",
  critical: "bg-rose-500 shadow-rose-400/50",
  variant: "bg-sky-500 shadow-sky-400/50",
};

/** Bright category chrome for the chocolate-box tiles. */
const CAT_TILE: Record<string, string> = {
  normal:
    "border-emerald-300/90 bg-gradient-to-br from-emerald-50 via-teal-50/90 to-white text-emerald-950 hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-300/40 hover:-translate-y-px",
  abnormal:
    "border-amber-300/90 bg-gradient-to-br from-amber-50 via-orange-50/80 to-white text-amber-950 hover:border-amber-500 hover:shadow-md hover:shadow-amber-300/40 hover:-translate-y-px",
  critical:
    "border-rose-300/90 bg-gradient-to-br from-rose-50 via-pink-50/80 to-white text-rose-950 hover:border-rose-500 hover:shadow-md hover:shadow-rose-300/40 hover:-translate-y-px",
  variant:
    "border-sky-300/90 bg-gradient-to-br from-sky-50 via-cyan-50/80 to-white text-sky-950 hover:border-sky-500 hover:shadow-md hover:shadow-sky-300/40 hover:-translate-y-px",
};

const CAT_BADGE: Record<string, string> = {
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
  abnormal: "bg-amber-100 text-amber-800 border-amber-200",
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  variant: "bg-sky-100 text-sky-700 border-sky-200",
};

const FIELD_ACCENT: Record<QuickSelectField, string> = {
  clinicalHistory: "text-teal-700",
  technique: "text-indigo-700",
  findings: "text-emerald-700",
  impression: "text-violet-700",
  recommendation: "text-fuchsia-700",
};

const FIELD_PILL: Record<QuickSelectField, string> = {
  clinicalHistory: "bg-teal-100 border-teal-200 text-teal-800",
  technique: "bg-indigo-100 border-indigo-200 text-indigo-800",
  findings: "bg-emerald-100 border-emerald-200 text-emerald-800",
  impression: "bg-violet-100 border-violet-200 text-violet-800",
  recommendation: "bg-fuchsia-100 border-fuchsia-200 text-fuchsia-800",
};

const LABELS: Record<QuickSelectField, string> = {
  clinicalHistory: "History",
  technique: "Technique",
  findings: "Findings",
  impression: "Impression",
  recommendation: "Recommendation",
};

export function QuickSelectStrip({
  field,
  bodyPart,
}: {
  field: QuickSelectField;
  /**
   * Region to scope tiles by, overriding the study's own bodyPart. PACS
   * worklist rows carry no BodyPartExamined, so `study.bodyPart` is empty and
   * every region-scoped tile (MR + "Brain", MR + "LS Spine", …) scored out of
   * `lookupTiles`. Passing the region selected in the workspace's Region
   * section makes the tiles follow that choice.
   */
  bodyPart?: string | null;
}) {
  const tiles = useWorkspaceSelector((s) => s.quickSelectTiles);
  const study = useWorkspaceSelector((s) => s.studies.find((x) => x.id === s.activeStudyId));
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  const openEditor = useWorkspaceSelector((s) => s.openQuickSelectEditor);
  const toggleFav = useWorkspaceSelector((s) => s.toggleTileFavorite);
  const incUsage = useWorkspaceSelector((s) => s.incrementTileUsage);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const scopeBodyPart = bodyPart?.trim() || study?.bodyPart;
  const scoped = useMemo(
    () => lookupTilesForContext(tiles, field, study?.modality, reportingContext),
    [tiles, field, study?.modality, reportingContext],
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return scoped;
    const q = search.toLowerCase();
    return scoped.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.sentence.toLowerCase().includes(q) ||
        (t.mnemonic ?? "").toLowerCase().includes(q),
    );
  }, [scoped, search]);
  useEffect(() => {
    if (showSearch) setTimeout(() => ref.current?.focus(), 50);
  }, [showSearch]);

  if (!study) {
    return (
      <div className="mb-2 text-[10px] text-muted-foreground">
        <span className={cn("font-bold uppercase tracking-wider", FIELD_ACCENT[field])}>
          {LABELS[field]} Quick Select · select a study
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-xl border border-white/60 bg-gradient-to-r from-white/80 via-slate-50/40 to-white/80 p-2 shadow-sm shadow-slate-200/40">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className={cn("font-bold uppercase tracking-wider", FIELD_ACCENT[field])}>
            {LABELS[field]} Quick Select
          </span>
          <span className={cn("rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold", FIELD_PILL[field])}>
            {study.modality} · {reportingContext.region || scopeBodyPart || "unresolved"}
          </span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
            {scoped.length} tiles
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {showSearch ? (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-violet-500" />
              <input
                ref={ref}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setShowSearch(false)}
                placeholder="Search..."
                className="h-7 w-44 rounded-full border border-violet-300 bg-white pl-6 pr-6 text-[11px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearch("");
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] hover:bg-violet-50 hover:text-violet-700"
              onClick={() => setShowSearch(true)}
            >
              <Search className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex max-h-[104px] flex-wrap gap-1.5 overflow-y-auto pr-1">
        {filtered.map((tile) => (
          <QuickSelectTileBox
            key={tile.id}
            tile={tile}
            field={field}
            onPick={() => {
              const ws = useWorkspace.getState();
              if (field === "findings" || field === "impression") {
                const ownership = {
                  anatomicalSection: tile.anatomicalSection || tile.scopeBodyPart || undefined,
                  conflictGroup: tile.conflictGroup || tile.scopeBodyPart || undefined,
                  baselineReplaces: tile.baselineReplaces,
                };
                const templates = field === "findings"
                  ? { findings: tile.sentence, impression: tile.impressionSentence }
                  : { impression: tile.sentence };
                ws.applyPathologyOverlay({
                  incoming: templates,
                  templates,
                  ownership,
                  source: "quick-select",
                  id: `qs-${tile.id}`,
                  force: tile.category === "abnormal" || tile.category === "critical",
                });
              } else {
                ws.mergeField(field, tile.sentence, "quick-select");
              }
              incUsage(tile.id);
            }}
            onFav={() => toggleFav(tile.id)}
            onEdit={() => openEditor(tile, field)}
          />
        ))}
        <button
          onClick={() => openEditor(null, field)}
          className="inline-flex items-center gap-1 rounded-xl border-2 border-dashed border-violet-300/70 bg-gradient-to-br from-violet-50 to-fuchsia-50/50 px-2.5 py-1.5 text-[10.5px] font-semibold text-violet-700 transition hover:border-violet-500 hover:bg-violet-100/80 hover:text-violet-900"
        >
          <Plus className="h-3 w-3" />
          <span>Add tile</span>
          <ChevronRight className="h-2.5 w-2.5 opacity-50" />
        </button>
      </div>
    </div>
  );
}

function QuickSelectTileBox({
  tile,
  field,
  onPick,
  onFav,
  onEdit,
}: {
  tile: QuickSelectTile;
  field: QuickSelectField;
  onPick: () => void;
  onFav: () => void;
  onEdit: () => void;
}) {
  const cat = tile.category in CAT_TILE ? tile.category : "normal";
  return (
    <div
      className={cn(
        "group relative inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10.5px] transition duration-150",
        CAT_TILE[cat],
      )}
      onClick={onPick}
      title={tile.sentence}
      data-testid={`qs-tile-${field}-${tile.id}`}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full shadow-sm", CAT_DOT[cat])} />
      <span className="max-w-[150px] truncate font-bold tracking-tight">{tile.label}</span>
      {tile.mnemonic && (
        <span className={cn("rounded-md border px-1 font-mono text-[8px] uppercase", CAT_BADGE[cat])}>
          {tile.mnemonic}
        </span>
      )}
      {tile.usageCount && tile.usageCount > 3 && (
        <span className="rounded-md bg-white/80 px-0.5 font-mono text-[8px] text-slate-600">{tile.usageCount}</span>
      )}
      <div className="ml-0.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
          aria-label={tile.favorite ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "rounded-md p-0.5 hover:bg-white/70",
            tile.favorite ? "text-amber-500" : "text-slate-400 hover:text-amber-500",
          )}
        >
          <Star className={cn("h-2.5 w-2.5", tile.favorite && "fill-current")} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Edit ${tile.label}`}
          className="rounded-md p-0.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>
      {tile.favorite && <Star className="ml-0.5 h-2.5 w-2.5 fill-amber-400 text-amber-400 group-hover:hidden" />}
    </div>
  );
}
