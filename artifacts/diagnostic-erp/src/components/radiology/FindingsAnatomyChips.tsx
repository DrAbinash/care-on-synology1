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
  unscopedAnatomySection,
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
      if (activeAnatomy !== null) onAnatomyChange(null);
      return;
    }
    // No selection means no filter: the whole region wall is offered. Selecting the first
    // group on mount narrowed every study to one anatomy — measured on a synthetic MRI Brain
    // Plain study, 48 catalogue boxes reach the strip and 31 were offered, with "Acute Infarct",
    // "DWI restriction", "Midline shift", "Mass effect" and "Hydrocephalus" all behind chips the
    // radiologist had to discover. A chip is a filter the radiologist chooses to apply, not a
    // tab they land on.
    if (activeAnatomy === null) return;
    // A selection carried over from another study tab can name a section this tab does not
    // have, which would hide the entire wall. Clear it rather than guess a replacement.
    if (!anatomyGroups.some(([k]) => k === activeAnatomy)) onAnatomyChange(null);
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
        <button
          type="button"
          disabled={disabled || anatomyGroups.length < 2}
          aria-pressed={activeAnatomy === null}
          onClick={() => onAnatomyChange(null)}
          className={[
            "text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors",
            activeAnatomy === null
              ? "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white border-violet-600 shadow-sm"
              : "bg-white text-violet-900 border-violet-200 hover:border-violet-400 hover:bg-violet-50",
            disabled || anatomyGroups.length < 2 ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
          data-testid="findings-anatomy-all"
          title="Show every anatomy in this study"
        >
          All
        </button>
        {anatomyGroups.map(([section]) => {
          const active = section === activeAnatomy;
          return (
            <button
              key={section}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onAnatomyChange(active ? null : section)}
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
  // A tile that declares no anatomy is not a tile about some other anatomy. Nothing in the
  // product populates `anatomicalSection` on a Quick Select tile — not the admin editor, not the
  // content-pack route (`findingToTile` never sets it) — so reading "unknown" as "excluded" deletes
  // the entire Findings tile wall: 56 tiles scoped, 0 offered. Tiles that do declare a real section
  // still narrow, which is what the chips are for.
  // A section that is still a template placeholder (`{level}`) names no anatomy either: it is
  // filled from the questions dialog at click time, so it must not become a chip label the
  // radiologist reads as an unresolved control, nor hide behind a chip it can never match.
  if (!t || unscopedAnatomySection(tileSection)) return true;
  const a = activeAnatomy.trim().toLowerCase();
  return t === a || t.includes(a) || a.includes(t);
}
