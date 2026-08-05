import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * CollapsibleSection — Phase 3 dynamic reporting panels.
 *
 * Wraps a report section (Technique, Findings, Impression, …) in a
 * collapsible panel. The expanded/collapsed state is remembered per
 * `layoutKey` group in this browser's localStorage, so a radiologist's
 * preferred layout survives reloads and applies across studies.
 *
 * Purely presentational — the child editors are untouched, so wrapping an
 * existing section changes nothing about how its content works.
 */

function readLayout(layoutKey: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(layoutKey) || "{}");
  } catch {
    return {};
  }
}

function writeLayout(layoutKey: string, id: string, collapsed: boolean) {
  try {
    const layout = readLayout(layoutKey);
    layout[id] = collapsed;
    localStorage.setItem(layoutKey, JSON.stringify(layout));
  } catch {
    /* storage blocked — non-fatal, layout just won't persist */
  }
}

interface Props {
  /** localStorage key shared by all sections of one page, e.g. "radiology_report_layout" */
  layoutKey: string;
  /** Unique id of this section within the layout, e.g. "technique" */
  id: string;
  title: string;
  /** Small extra element rendered on the header row (e.g. dictation button) */
  headerExtra?: ReactNode;
  defaultCollapsed?: boolean;
  /** Optional accent — left color tick on the section header (e.g. "teal", "amber"). */
  accent?: "teal" | "slate" | "amber" | "violet" | "emerald" | "rose" | "sky";
  children: ReactNode;
}

const ACCENT_DOT: Record<NonNullable<Props["accent"]>, string> = {
  teal: "bg-teal-500",
  slate: "bg-slate-400",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
};

export default function CollapsibleSection({ layoutKey, id, title, headerExtra, defaultCollapsed = false, accent, children }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const saved = readLayout(layoutKey)[id];
    return typeof saved === "boolean" ? saved : defaultCollapsed;
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeLayout(layoutKey, id, next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 text-xs font-semibold hover:text-primary transition-colors"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {accent && <span className={`w-1.5 h-3 rounded-full shrink-0 ${ACCENT_DOT[accent]}`} aria-hidden />}
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {title}
        </button>
        {!collapsed && headerExtra}
      </div>
      {!collapsed && children}
    </div>
  );
}
