/**
 * Section 4 — compact anatomy-grouped Quick Findings strip.
 *
 * Findings are scoped by study_tab_id (authoritative) with legacy name fallback.
 * Within the selected Study Tab, buttons group by anatomicalSection; within each
 * anatomy, conflictGroup drives modality-aware sub-rows (DISC / CANAL / ROOT…).
 * Clicks route through the parent's pathology overlay (same path as Clinic QS).
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Zap } from "lucide-react";
import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import { quickFindingsForStudyTab } from "@/lib/pickQuickProtocol";
import { parseQuestions } from "@/lib/structuredFindings";

const OTHER_SECTION = "General";

function formatGroupLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return "Findings";
  if (t.length <= 4 && t === t.toUpperCase()) return t;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupByAnatomy(findings: QuickFinding[]): Array<[string, QuickFinding[]]> {
  const groups = new Map<string, QuickFinding[]>();
  for (const f of findings) {
    const key = (f.anatomicalSection ?? "").trim() || OTHER_SECTION;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort((a, b) => {
    const sa = Math.min(...a[1].map((x) => x.sortOrder));
    const sb = Math.min(...b[1].map((x) => x.sortOrder));
    if (sa !== sb) return sa - sb;
    if (a[0] === OTHER_SECTION) return 1;
    if (b[0] === OTHER_SECTION) return -1;
    return a[0].localeCompare(b[0]);
  });
}

function groupByConflict(findings: QuickFinding[]): Array<[string, QuickFinding[]]> {
  const groups = new Map<string, QuickFinding[]>();
  for (const f of findings) {
    const key = (f.conflictGroup ?? "").trim() || (f.category ?? "").trim() || "Findings";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort((a, b) => {
    const sa = Math.min(...a[1].map((x) => x.sortOrder));
    const sb = Math.min(...b[1].map((x) => x.sortOrder));
    return sa - sb || a[0].localeCompare(b[0]);
  });
}

export default function FindingsAnatomyStrip({
  findings,
  selectedStudyTabId,
  selectedStudyTabName,
  selectedIds,
  blockedIds,
  onToggle,
  onFindingClick,
  disabled,
}: {
  findings: QuickFinding[];
  selectedStudyTabId: number | null;
  selectedStudyTabName: string | null;
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

  const [activeAnatomy, setActiveAnatomy] = useState<string | null>(null);

  useEffect(() => {
    if (anatomyGroups.length === 0) {
      setActiveAnatomy(null);
      return;
    }
    setActiveAnatomy((prev) => {
      if (prev && anatomyGroups.some(([k]) => k === prev)) return prev;
      return anatomyGroups[0][0];
    });
  }, [anatomyGroups, selectedStudyTabId]);

  const activeFindings = useMemo(() => {
    if (!activeAnatomy) return [];
    return anatomyGroups.find(([k]) => k === activeAnatomy)?.[1] ?? [];
  }, [anatomyGroups, activeAnatomy]);

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

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/40 p-2 shadow-sm"
      data-testid="findings-anatomy-strip"
      data-study-tab-id={selectedStudyTabId ?? undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm">
          <Zap size={10} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-950">
          Findings{selectedStudyTabName ? ` — ${selectedStudyTabName}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap gap-1" data-testid="findings-anatomy-chips">
        <span className="self-center text-[9px] font-semibold uppercase text-muted-foreground mr-0.5">Anatomy</span>
        {anatomyGroups.map(([section]) => {
          const active = section === activeAnatomy;
          return (
            <button
              key={section}
              type="button"
              disabled={disabled}
              onClick={() => setActiveAnatomy(section)}
              className={[
                "text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors",
                active
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white border-violet-600 shadow-sm"
                  : "bg-white text-violet-900 border-violet-200 hover:border-violet-400 hover:bg-violet-50",
              ].join(" ")}
              data-testid={`findings-anatomy-${section.replace(/\s+/g, "-").toLowerCase()}`}
            >
              {section}
            </button>
          );
        })}
      </div>

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
