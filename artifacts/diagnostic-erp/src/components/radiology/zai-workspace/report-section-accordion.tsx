import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FINDINGS_TOOLS,
  type FindingsToolId,
  type ReportSectionAccent,
  type ReportSectionId,
  type SectionStatus,
} from "@/lib/reportSectionAccordion";

/**
 * Compact accordion chrome for the main reporting pane.
 *
 * Two hard rules encoded here:
 *  1. Children stay MOUNTED when the section is collapsed — the content is
 *     hidden with `display:none`, so no editor, drawer or panel ever loses its
 *     internal state (search terms, structured nav position, edit drafts) and
 *     no effect re-runs / re-inserts text on expand.
 *  2. The active section is the flex-grower and scrolls internally, so the pane
 *     is viewport-height instead of one endless page.
 */

const ACCENT_BAR: Record<ReportSectionAccent, string> = {
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

interface SectionProps {
  id: ReportSectionId;
  /** 1-based position, shown as the Alt+N hint. */
  index: number;
  label: string;
  accent: ReportSectionAccent;
  /** One-line orientation text shown while collapsed. */
  summary: string;
  status: SectionStatus;
  active: boolean;
  onActivate: (id: ReportSectionId) => void;
  /** Small controls kept on the header row (visible when expanded). */
  headerExtra?: ReactNode;
  /**
   * Reporting Canvas R2 — continuous scroll layout. Body always visible;
   * accordion chrome becomes a compact sticky label. Legacy accordion
   * components remain for git rollback when continuous is false.
   */
  continuous?: boolean;
  children: ReactNode;
}

export function ReportAccordionSection({
  id,
  index,
  label,
  accent,
  summary,
  status,
  active,
  onActivate,
  headerExtra,
  continuous = false,
  children,
}: SectionProps) {
  const showBody = continuous || active;
  return (
    <section
      data-testid={`report-section-${id}`}
      data-active={showBody ? "true" : "false"}
      data-continuous={continuous ? "true" : "false"}
      className={cn(
        "flex flex-col rounded-lg border bg-card/60 transition-colors",
        continuous
          ? "shrink-0 border-border/50 bg-card/80"
          : active
            ? "min-h-0 flex-1 border-emerald-300/80 bg-card shadow-sm shadow-emerald-100/60"
            : "shrink-0 border-border/60 hover:border-emerald-200",
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 pr-2">
        <button
          type="button"
          onClick={() => onActivate(id)}
          aria-expanded={showBody}
          aria-controls={`report-section-body-${id}`}
          data-testid={`report-section-header-${id}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-emerald-50/60"
          title={continuous ? label : active ? `Collapse ${label} (Alt+${index})` : `Open ${label} (Alt+${index})`}
        >
          <span className={cn("h-3.5 w-1 shrink-0 rounded-full", ACCENT_BAR[accent])} aria-hidden />
          {!continuous && (active ? (
            <ChevronDown size={12} className="shrink-0 text-emerald-600" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          ))}
          <span
            className={cn(
              "shrink-0 text-[10px] font-bold uppercase tracking-wide",
              showBody ? "text-emerald-900" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          {!showBody && (
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-foreground/70"
              data-testid={`report-section-summary-${id}`}
            >
              {summary}
            </span>
          )}
          {status === "attention" ? (
            <AlertTriangle size={11} className="shrink-0 text-amber-500" aria-label="Needs attention" />
          ) : status === "done" ? (
            <Check size={11} className="shrink-0 text-emerald-600" aria-label="Complete" />
          ) : null}
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground/50">⌥{index}</span>
        </button>
        {showBody && headerExtra}
      </div>
      <div
        id={`report-section-body-${id}`}
        data-testid={`report-section-body-${id}`}
        aria-hidden={!showBody}
        className={cn(
          showBody ? "min-h-0 overflow-y-visible px-2.5 pb-2.5 pt-0.5" : "hidden",
          continuous ? "" : active ? "flex-1 overflow-y-auto" : "",
        )}
      >
        {children}
      </div>
    </section>
  );
}

interface ToolTabsProps {
  active: FindingsToolId | null;
  onSelect: (id: FindingsToolId) => void;
  /** Optional per-tab count badge (e.g. tile count, selected quick findings). */
  badges?: Partial<Record<FindingsToolId, number | string | null>>;
  /** Tabs whose underlying panel has nothing to show for this study. */
  unavailable?: Partial<Record<FindingsToolId, boolean>>;
}

/**
 * Findings assistance selector. Exactly one drawer is open at a time; clicking
 * the open tab closes the drawer and gives the height back to the editor.
 */
export function FindingsToolTabs({ active, onSelect, badges, unavailable }: ToolTabsProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1"
      role="tablist"
      aria-label="Findings assistance"
      data-testid="findings-tool-tabs"
    >
      {FINDINGS_TOOLS.map((tool) => {
        const on = active === tool.id;
        const badge = badges?.[tool.id];
        const dim = unavailable?.[tool.id];
        return (
          <button
            key={tool.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(tool.id)}
            data-testid={`findings-tool-${tool.id}`}
            title={on ? `Hide ${tool.label}` : `Show ${tool.label}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors",
              on
                ? "border-emerald-500 bg-emerald-600 text-white shadow-sm"
                : dim
                  ? "border-transparent bg-transparent text-muted-foreground/50 hover:bg-background"
                  : "border-transparent bg-background text-foreground/70 hover:border-emerald-200 hover:text-emerald-800",
            )}
          >
            {tool.label}
            {badge != null && badge !== "" && (
              <span
                className={cn(
                  "rounded px-1 font-mono text-[9px] font-semibold",
                  on ? "bg-white/25 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={() => onSelect(active)}
          className="ml-auto px-1.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          data-testid="findings-tool-collapse"
        >
          Hide
        </button>
      )}
    </div>
  );
}

/** Wrapper for one assistance drawer — kept mounted, hidden when inactive. */
export function FindingsToolDrawer({
  id,
  active,
  children,
}: {
  id: FindingsToolId;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`findings-drawer-${id}`}
      aria-hidden={!active}
      className={cn("mt-1.5", active ? "max-h-[38vh] overflow-y-auto" : "hidden")}
    >
      {children}
    </div>
  );
}
