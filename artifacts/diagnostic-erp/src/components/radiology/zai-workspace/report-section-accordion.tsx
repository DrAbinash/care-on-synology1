import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FINDINGS_TOOLS,
  FINDINGS_TOOL_SETTINGS,
  REPORT_SECTION_SETTINGS,
  type FindingsToolId,
  type ReportSectionAccent,
  type ReportSectionId,
  type SectionStatus,
} from "@/lib/reportSectionAccordion";
import { compactAccordionSummary } from "@/lib/reportingPaneFocus";
import { SectionSettingsLink } from "./section-settings-link";

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
 *
 * `continuous` keeps a body visible without exclusive collapse (wide desktop
 * Findings+Impression cockpit). On laptop / viewer-focus the workspace turns
 * continuous off so one active section owns remaining height.
 *
 * Header UX:
 *  - Opaque card backgrounds so collapsed rows never bleed into each other.
 *  - `density="compact"`: single-line inactive rows (status · name · summary).
 *  - Comfortable density keeps two-line summaries on wide desktops.
 *  - `emphasis="primary"` for Findings / Impression — the radiologist's work.
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
   * Always-visible warning strip (even when collapsed) so validation /
   * stale-Impression cues stay discoverable.
   */
  collapsedWarning?: ReactNode;
  /**
   * When true, this section body stays visible (no collapse). The live
   * workspace uses this for Findings / Impression so both clinical surfaces
   * remain on-screen together in the mouse-first cockpit.
   */
  continuous?: boolean;
  /**
   * Findings / Impression use `primary` so clinical work reads louder than
   * setup rows (Demography, Region, Technique).
   */
  emphasis?: "default" | "primary";
  /**
   * Laptop / viewer-focus: single-line inactive rows so the active editor
   * keeps remaining height. Comfortable = two-line summary (wide desktop).
   */
  density?: "comfortable" | "compact";
  /** Focus the editor when the radiologist clicks anywhere in the card body. */
  onBodyActivate?: () => void;
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
  collapsedWarning,
  continuous = false,
  emphasis = "default",
  density = "comfortable",
  onBodyActivate,
  children,
}: SectionProps) {
  const showBody = continuous || active;
  const isPrimary = emphasis === "primary";
  const compact = density === "compact";
  // Continuous primary (Findings / Impression) share remaining height so both
  // stay visible without accordion collapse (wide desktop only).
  const continuousPrimary = continuous && isPrimary;
  const compactSummary = !showBody && compact ? compactAccordionSummary(summary) : summary;
  return (
    <section
      data-testid={`report-section-${id}`}
      data-active={showBody ? "true" : "false"}
      data-continuous={continuous ? "true" : "false"}
      data-emphasis={emphasis}
      data-density={density}
      className={cn(
        // Solid backgrounds + overflow clip prevent stacked-row ghosting.
        "flex flex-col overflow-hidden rounded-lg border bg-card transition-colors isolate",
        continuousPrimary
          ? "min-h-0 flex-1 border-emerald-300/80 bg-card shadow-sm shadow-emerald-100/40"
          : continuous
            ? "shrink-0 border-border/50"
            : active
              ? "min-h-0 flex-1 border-emerald-300/80 bg-card shadow-sm shadow-emerald-100/60"
              : isPrimary
                ? "shrink-0 border-emerald-200/80 hover:border-emerald-300"
                : "shrink-0 border-border/70 hover:border-emerald-200",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-transparent pr-1",
          showBody && "border-border/40 bg-muted/20",
          !showBody && isPrimary && "bg-emerald-50/40",
          compact && !showBody && "min-h-0",
        )}
      >
        <button
          type="button"
          onClick={() => onActivate(id)}
          aria-expanded={showBody}
          aria-controls={`report-section-body-${id}`}
          data-testid={`report-section-header-${id}`}
          className={cn(
            "group flex min-w-0 flex-1 rounded-lg text-left",
            "hover:bg-emerald-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60",
            compact && !showBody
              ? "items-center gap-1.5 px-2 py-1"
              : "items-start gap-2 px-2.5 py-2",
          )}
          title={continuous ? label : active ? `Collapse ${label} (Alt+${index})` : `Open ${label} (Alt+${index})`}
        >
          <span
            className={cn(
              "shrink-0 rounded-full",
              compact && !showBody ? "mt-0 h-4 w-0.5" : "mt-0.5 w-1",
              !(compact && !showBody) && (isPrimary ? "h-8" : "h-7"),
              ACCENT_BAR[accent],
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            {compact && !showBody ? (
              <div className="flex min-w-0 items-center gap-1.5">
                {!continuous && (
                  <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                )}
                {status === "attention" || collapsedWarning ? (
                  <AlertTriangle size={11} className="shrink-0 text-amber-500" aria-label="Needs attention" />
                ) : status === "done" ? (
                  <Check size={11} className="shrink-0 text-emerald-600" aria-label="Complete" />
                ) : (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35"
                    aria-hidden
                    title="Not filled yet"
                  />
                )}
                <span className="shrink-0 text-[11px] font-semibold tracking-tight text-foreground/85">
                  {label}
                </span>
                {compactSummary ? (
                  <span
                    className="min-w-0 truncate text-[11px] font-normal text-muted-foreground"
                    data-testid={`report-section-summary-${id}`}
                  >
                    · {compactSummary}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/55">
                  ⌥{index}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  {!continuous && (active ? (
                    <ChevronDown size={14} className="shrink-0 text-emerald-600" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  ))}
                  <span
                    className={cn(
                      "shrink-0 font-semibold tracking-tight",
                      isPrimary ? "text-[13px]" : "text-[12px]",
                      showBody ? "text-emerald-950" : "text-foreground/85",
                    )}
                  >
                    {label}
                  </span>
                  {status === "attention" || collapsedWarning ? (
                    <AlertTriangle size={12} className="shrink-0 text-amber-500" aria-label="Needs attention" />
                  ) : status === "done" ? (
                    <Check size={12} className="shrink-0 text-emerald-600" aria-label="Complete" />
                  ) : (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/35"
                      aria-hidden
                      title="Not filled yet"
                    />
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/55 group-focus-visible:text-muted-foreground/55">
                    ⌥{index}
                  </span>
                </div>
                {!showBody && (
                  <p
                    className={cn(
                      "mt-0.5 truncate pl-5 text-left leading-snug text-foreground/75",
                      isPrimary ? "text-[12px]" : "text-[11px]",
                    )}
                    data-testid={`report-section-summary-${id}`}
                  >
                    {summary}
                  </p>
                )}
              </>
            )}
          </div>
        </button>
        <div className={cn("flex shrink-0 items-center gap-0.5", compact && !showBody ? "pr-0.5" : "pt-1.5")}>
          {!(compact && !showBody) && (
            <SectionSettingsLink
              {...REPORT_SECTION_SETTINGS[id]}
              testId={`report-section-settings-${id}`}
              iconOnly
            />
          )}
          {showBody && headerExtra}
        </div>
      </div>
      {!showBody && collapsedWarning ? (
        <div
          className="mx-2 mb-1.5"
          data-testid={`report-section-collapsed-warning-${id}`}
        >
          {collapsedWarning}
        </div>
      ) : null}
      <div
        id={`report-section-body-${id}`}
        data-testid={`report-section-body-${id}`}
        aria-hidden={!showBody}
        onMouseDown={(e) => {
          if (!onBodyActivate || !showBody) return;
          // Don't steal clicks from buttons, links, or nested controls.
          const t = e.target as HTMLElement | null;
          if (t?.closest("button, a, input, textarea, select, [role='tab'], [role='checkbox']")) return;
          onBodyActivate();
        }}
        className={cn(
          continuousPrimary
            ? (showBody ? "min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-0.5" : "hidden")
            : continuous
              ? (showBody ? "min-h-0 overflow-y-visible px-2.5 pb-2.5 pt-0.5" : "hidden")
              : (active ? "min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-0.5" : "hidden"),
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
  const qsSettings = FINDINGS_TOOL_SETTINGS.quickSelect;
  const structuredSettings = FINDINGS_TOOL_SETTINGS.structured;
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
      {qsSettings ? (
        <SectionSettingsLink {...qsSettings} testId="findings-tool-settings-quickSelect" iconOnly />
      ) : null}
      {structuredSettings ? (
        <SectionSettingsLink {...structuredSettings} testId="findings-tool-settings-structured" iconOnly />
      ) : null}
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
