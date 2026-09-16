import type { ReactNode } from "react";
import {
  Brain,
  ChevronRight,
  FileText,
  History,
  Image,
  LayoutGrid,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ReportingToolsTab =
  | "quick-insert"
  | "structured"
  | "measurements"
  | "priors"
  | "templates"
  | "ai"
  | "more";

export type QuickInsertSource =
  | "quick-select"
  | "quick-add"
  | "macros"
  | "snippets"
  | "composer";

const TABS: Array<{
  id: ReportingToolsTab;
  label: string;
  short: string;
  icon: typeof Plus;
}> = [
  { id: "quick-insert", label: "Quick Insert", short: "Insert", icon: Plus },
  { id: "structured", label: "Structured / Canvas", short: "Structure", icon: LayoutGrid },
  { id: "measurements", label: "Measurements & Images", short: "Measure", icon: Image },
  { id: "priors", label: "Priors & Suggestions", short: "Priors", icon: History },
  { id: "templates", label: "Templates", short: "Templates", icon: FileText },
  { id: "ai", label: "AI & Copilot", short: "AI", icon: Brain },
  { id: "more", label: "More", short: "More", icon: Settings2 },
];

const QUICK_SOURCES: Array<{ id: QuickInsertSource; label: string }> = [
  { id: "quick-select", label: "Quick Select" },
  { id: "quick-add", label: "Quick Add" },
  { id: "macros", label: "Macros" },
  { id: "snippets", label: "My Snippets" },
  { id: "composer", label: "Composer" },
];

type Props = {
  activeTab: ReportingToolsTab;
  onTabChange: (tab: ReportingToolsTab) => void;
  quickSource: QuickInsertSource;
  onQuickSourceChange: (source: QuickInsertSource) => void;
  onClose: () => void;
  disabled?: boolean;
  panes: Record<ReportingToolsTab, ReactNode>;
};

/**
 * One progressive-disclosure shell for every reporting aid.
 * This component owns no report state and renders no report textarea.
 */
export function ReportingToolsPanel({
  activeTab,
  onTabChange,
  quickSource,
  onQuickSourceChange,
  onClose,
  disabled = false,
  panes,
}: Props) {
  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;
  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-emerald-200/70 bg-card"
      data-testid="reporting-tools"
      aria-label="Reporting Tools"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-emerald-200/70 bg-emerald-50/60 px-2.5 py-2">
        <Sparkles className="h-4 w-4 text-emerald-700" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-emerald-950">Reporting Tools</div>
          <div className="truncate text-[9px] text-emerald-800/70">
            Supports the canonical report · never a second report
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-white hover:text-foreground"
          onClick={onClose}
          title="Close Reporting Tools"
          data-testid="reporting-tools-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-4 gap-0.5 border-b border-border/60 bg-muted/20 p-1">
        {TABS.map(({ id, short, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            title={label}
            aria-pressed={activeTab === id}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 rounded px-1 py-1.5 text-[9px] font-semibold",
              activeTab === id
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-white hover:text-foreground",
            )}
            data-testid={`reporting-tools-tab-${id}`}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{short}</span>
          </button>
        ))}
      </div>

      <div className="shrink-0 border-b border-border/50 px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground">
          <ChevronRight className="h-3 w-3 text-emerald-600" />
          {active.label}
        </div>
        {activeTab === "quick-insert" ? (
          <>
            <div className="mt-1 text-[9px] text-muted-foreground">
              Target: <strong className="text-foreground">Canonical Findings</strong>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Quick Insert source">
              {QUICK_SOURCES.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="tab"
                  aria-selected={quickSource === source.id}
                  disabled={disabled}
                  onClick={() => onQuickSourceChange(source.id)}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[9px] font-semibold",
                    quickSource === source.id
                      ? "border-sky-400 bg-sky-50 text-sky-900"
                      : "border-border bg-background text-muted-foreground hover:border-sky-200",
                  )}
                  data-testid={`quick-insert-source-${source.id}`}
                >
                  {source.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        data-testid={`reporting-tools-pane-${activeTab}`}
      >
        {panes[activeTab]}
      </div>
    </aside>
  );
}
