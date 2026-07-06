import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Zap, Settings2 } from "lucide-react";
import { Link } from "wouter";

/**
 * QuickFindingsPanel — billing-desk-style one-click buttons for radiology
 * reporting. Multi-select study tabs at the top; each selected tab's
 * finding buttons appear below (merged, not replaced). Toggling a finding
 * ON inserts its text; toggling OFF removes exactly what was inserted —
 * never the radiologist's own typed text.
 *
 * Text-merge safety model (why insert/remove works without markers):
 *   - INSERT: the parent appends `findingText` as its own paragraph only if
 *     that exact text isn't already present (dedupe by exact block).
 *   - REMOVE: the parent removes the exact block ONLY if it is still
 *     present verbatim. If the radiologist edited the inserted sentence,
 *     removal silently no-ops — their edited text is preserved. This is
 *     deliberately conservative: worst case is a leftover sentence to
 *     delete manually; never lost work.
 *
 * The panel itself is stateless about report content — it only reports
 * (finding, selected) transitions upward via onToggle, so it can be reused
 * on any editor page.
 */

export type QuickFinding = {
  id: number;
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type QuickStudyTab = {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

type QuickSelectData = { tabs: QuickStudyTab[]; findings: QuickFinding[] };

// ── Pure text-merge helpers (extracted to lib/quickFindingsMerge.ts so the
//    root vitest suite can unit-test them; re-exported here for callers) ─────
export { mergeBlock, removeBlock, mergeImpression, removeImpression } from "@/lib/quickFindingsMerge";

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  selectedIds: Set<number>;
  onToggle: (finding: QuickFinding, nowSelected: boolean) => void;
  disabled?: boolean;
  /** Pre-select tabs matching the study (e.g. bodyPart "BRAIN" → Brain tab). */
  initialStudyHint?: string | null;
  isAdmin?: boolean;
}

export default function QuickFindingsPanel({ selectedIds, onToggle, disabled, initialStudyHint, isAdmin }: Props) {
  const { data, isLoading } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000, // matches the server-side 5-min cache
  });

  const activeTabs = useMemo(
    () => (data?.tabs ?? []).filter((t) => t.isActive),
    [data],
  );

  // Multi-select tabs. Initialize from the study hint once data arrives.
  const [selectedTabs, setSelectedTabs] = useState<Set<string> | null>(null);
  const effectiveTabs = useMemo(() => {
    if (selectedTabs) return selectedTabs;
    if (!initialStudyHint || activeTabs.length === 0) return new Set<string>();
    const hint = initialStudyHint.toLowerCase();
    const match = activeTabs.find((t) => hint.includes(t.name.toLowerCase()));
    return match ? new Set([match.name]) : new Set<string>();
  }, [selectedTabs, initialStudyHint, activeTabs]);

  function toggleTab(name: string) {
    const next = new Set(effectiveTabs);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedTabs(next);
  }

  // Findings from ALL selected tabs, merged (not replaced), tab order first.
  const visibleFindings = useMemo(() => {
    if (!data) return [];
    const tabOrder = activeTabs.map((t) => t.name);
    return data.findings
      .filter((f) => f.isActive && effectiveTabs.has(f.studyType))
      .sort((a, b) => {
        const ta = tabOrder.indexOf(a.studyType);
        const tb = tabOrder.indexOf(b.studyType);
        if (ta !== tb) return ta - tb;
        return a.sortOrder - b.sortOrder;
      });
  }, [data, effectiveTabs, activeTabs]);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-3">Loading quick select…</p>;
  }
  if (!data || activeTabs.length === 0) {
    return (
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground">No quick-select study tabs configured.</p>
        {isAdmin && (
          <Link href="/settings/radiology-quick-select" className="text-xs text-primary underline inline-flex items-center gap-1">
            <Settings2 size={11} /> Configure quick select
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Study tabs — multi-select */}
      <div className="flex flex-wrap gap-1">
        {activeTabs.map((tab) => {
          const active = effectiveTabs.has(tab.name);
          return (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.name)}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Finding buttons for all selected tabs */}
      {effectiveTabs.size === 0 ? (
        <p className="text-[11px] text-muted-foreground px-1">Select one or more study tabs above.</p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto">
          {visibleFindings.map((f) => {
            const selected = selectedIds.has(f.id);
            return (
              <Button
                key={f.id}
                size="sm"
                variant={selected ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onToggle(f, !selected)}
                className="h-7 justify-start text-[11px] font-normal"
                title={f.findingText || f.impressionText}
              >
                <Zap size={10} className={selected ? "" : "text-muted-foreground"} />
                <span className="truncate">{f.label}</span>
                {effectiveTabs.size > 1 && (
                  <span className="ml-auto text-[9px] text-muted-foreground">{f.studyType}</span>
                )}
              </Button>
            );
          })}
          {visibleFindings.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-1">No active findings for the selected tab(s).</p>
          )}
        </div>
      )}

      {isAdmin && (
        <Link href="/settings/radiology-quick-select" className="text-[10px] text-muted-foreground hover:text-primary underline inline-flex items-center gap-1 px-1">
          <Settings2 size={10} /> Manage buttons
        </Link>
      )}
    </div>
  );
}
