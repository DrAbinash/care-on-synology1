/**
 * Sticky anatomy sub-category chips for Section 4 Findings.
 * Sits directly above the Quick Select tile wall; filters tiles by anatomicalSection.
 */

import { useEffect, useMemo } from "react";
import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import { quickFindingsForStudyTab } from "@/lib/pickQuickProtocol";
import {
  cycleAnatomySection,
  groupByAnatomy,
  isSpinalLevelNavigation,
} from "@/lib/findingsAnatomyGroups";

export default function FindingsAnatomyChips({
  findings,
  selectedStudyTabId,
  selectedStudyTabName,
  activeAnatomy,
  onAnatomyChange,
  disabled,
  sticky = true,
  compact = false,
}: {
  findings: QuickFinding[];
  selectedStudyTabId: number | null;
  selectedStudyTabName: string | null;
  activeAnatomy: string | null;
  onAnatomyChange: (section: string | null) => void;
  disabled?: boolean;
  sticky?: boolean;
  compact?: boolean;
}) {
  const regionFindings = useMemo(() => {
    const { matched } = quickFindingsForStudyTab(findings, selectedStudyTabId, selectedStudyTabName);
    return matched;
  }, [findings, selectedStudyTabId, selectedStudyTabName]);

  const anatomyGroups = useMemo(() => groupByAnatomy(regionFindings), [regionFindings]);
  const sectionNames = useMemo(() => anatomyGroups.map(([s]) => s), [anatomyGroups]);
  const spinalNav = useMemo(() => isSpinalLevelNavigation(sectionNames), [sectionNames]);

  useEffect(() => {
    if (anatomyGroups.length === 0) {
      onAnatomyChange(null);
      return;
    }
    if (activeAnatomy && anatomyGroups.some(([k]) => k === activeAnatomy)) return;
    onAnatomyChange(anatomyGroups[0]![0]);
  }, [anatomyGroups, selectedStudyTabId, activeAnatomy, onAnatomyChange]);

  useEffect(() => {
    if (!spinalNav || sectionNames.length < 2) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const next = cycleAnatomySection(sectionNames, activeAnatomy, e.key === "ArrowDown" ? 1 : -1);
        if (next) onAnatomyChange(next);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const next = cycleAnatomySection(sectionNames, activeAnatomy, e.key === "]" ? 1 : -1);
        if (next) onAnatomyChange(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spinalNav, sectionNames, activeAnatomy, onAnatomyChange]);

  if (selectedStudyTabId == null && !selectedStudyTabName) return null;
  if (regionFindings.length === 0) return null;

  return (
    <div
      className={[
        "z-10 border-b border-violet-200/80 bg-gradient-to-r from-violet-50/95 via-white/95 to-fuchsia-50/90 backdrop-blur-sm",
        sticky ? "sticky top-0" : "",
        compact ? "px-1 py-1" : "px-2 py-1.5",
      ].join(" ")}
      data-testid="findings-anatomy-chips-bar"
      data-study-tab-id={selectedStudyTabId ?? undefined}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] font-bold uppercase tracking-wide text-violet-800 shrink-0">Anatomy</span>
        {anatomyGroups.map(([section]) => {
          const active = section === activeAnatomy;
          return (
            <button
              key={section}
              type="button"
              disabled={disabled}
              onClick={() => onAnatomyChange(section)}
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
        {spinalNav && (
          <span
            className="ml-auto text-[8px] text-violet-700/70 font-medium"
            data-testid="findings-anatomy-hotkey-hint"
            title="Cycle spinal levels without mouse"
          >
            Alt+↑↓ or [ ]
          </span>
        )}
      </div>
    </div>
  );
}

/** Exported for Quick Select tile filtering (matches anatomicalSection loosely). */
export function tileMatchesAnatomy(
  tileSection: string | undefined | null,
  activeAnatomy: string | null,
): boolean {
  if (!activeAnatomy) return true;
  const t = (tileSection ?? "").trim().toLowerCase();
  const a = activeAnatomy.trim().toLowerCase();
  if (!t) return activeAnatomy === "General";
  return t === a || t.includes(a) || a.includes(t);
}
