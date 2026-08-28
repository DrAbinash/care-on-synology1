/**
 * Section 4 — clinic Quick Findings tiles for the active anatomy group.
 * Anatomy chip navigation lives in FindingsAnatomyChips (above Quick Select wall).
 */

import { useMemo } from "react";
import { Check } from "lucide-react";
import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import { quickFindingsForStudyTab } from "@/lib/pickQuickProtocol";
import { parseQuestions } from "@/lib/structuredFindings";
import { groupByAnatomy, groupByConflict } from "@/lib/findingsAnatomyGroups";

function formatGroupLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return "Findings";
  if (t.length <= 4 && t === t.toUpperCase()) return t;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FindingsAnatomyStrip({
  findings,
  selectedStudyTabId,
  selectedStudyTabName,
  activeAnatomy,
  selectedIds,
  blockedIds,
  onToggle,
  onFindingClick,
  disabled,
}: {
  findings: QuickFinding[];
  selectedStudyTabId: number | null;
  selectedStudyTabName: string | null;
  activeAnatomy: string | null;
  selectedIds: Set<number>;
  blockedIds?: Set<number>;
  onToggle: (finding: QuickFinding, nowSelected: boolean) => void;
  onFindingClick?: (finding: QuickFinding) => void;
  disabled?: boolean;
}) {
  const regionFindings = useMemo(() => {
    const { matched } = quickFindingsForStudyTab(findings, selectedStudyTabId, selectedStudyTabName);
    return matched;
  }, [findings, selectedStudyTabId, selectedStudyTabName]);

  const anatomyGroups = useMemo(() => groupByAnatomy(regionFindings), [regionFindings]);

  const activeFindings = useMemo(() => {
    if (!activeAnatomy) return regionFindings;
    return anatomyGroups.find(([k]) => k === activeAnatomy)?.[1] ?? [];
  }, [anatomyGroups, activeAnatomy, regionFindings]);

  const conflictGroups = useMemo(() => groupByConflict(activeFindings), [activeFindings]);

  const isStructured = (f: QuickFinding) => parseQuestions(f.questionsJson).length > 0;

  const activate = (f: QuickFinding) => {
    if (isStructured(f) && onFindingClick) onFindingClick(f);
    else onToggle(f, !selectedIds.has(f.id));
  };

  if (selectedStudyTabId == null && !selectedStudyTabName) {
    return (
      <p className="text-[10px] text-muted-foreground px-1" data-testid="findings-anatomy-strip">
        Select a Study / Region above to load anatomy-grouped findings.
      </p>
    );
  }

  if (regionFindings.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground px-1" data-testid="findings-anatomy-strip">
        No Quick Findings configured for {selectedStudyTabName ?? "this Study Tab"}.
      </p>
    );
  }

  if (activeFindings.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground px-1" data-testid="findings-anatomy-strip">
        No findings for {activeAnatomy ?? "selected anatomy"}.
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/40 p-2 shadow-sm"
      data-testid="findings-anatomy-strip"
      data-study-tab-id={selectedStudyTabId ?? undefined}
      data-active-anatomy={activeAnatomy ?? undefined}
    >
      {conflictGroups.map(([group, items]) => (
        <div key={group} className="flex flex-wrap items-center gap-1" data-testid={`findings-conflict-${group.replace(/\s+/g, "-").toLowerCase()}`}>
          <span className="text-[9px] font-bold uppercase text-amber-800/80 min-w-[3.5rem] shrink-0">
            {formatGroupLabel(group)}:
          </span>
          {items.map((f) => {
            const selected = selectedIds.has(f.id);
            const blocked = Boolean(selected && blockedIds?.has(f.id));
            return (
              <button
                key={f.id}
                type="button"
                disabled={disabled}
                onClick={() => activate(f)}
                title={f.findingText || f.label}
                data-testid={`findings-anatomy-tile-${f.id}`}
                data-chip-state={blocked ? "blocked-manual-kept" : selected ? "selected" : "idle"}
                className={[
                  "text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-all",
                  selected && !blocked
                    ? "border-amber-500 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm"
                    : blocked
                      ? "border-amber-400 bg-amber-100 text-amber-950"
                      : "border-amber-200 bg-white text-amber-950 hover:border-amber-400 hover:bg-amber-50",
                ].join(" ")}
              >
                <span className="inline-flex items-center gap-1">
                  {selected && !blocked ? <Check size={9} strokeWidth={3} /> : null}
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
