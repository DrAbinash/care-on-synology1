import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles, AlertTriangle, ListChecks, ClipboardCheck, Stethoscope, GitBranch, Ruler,
  ChevronDown, ChevronRight, Undo2, Info, ShieldCheck,
} from "lucide-react";
import {
  CATEGORY_LABEL, type CopilotReport, type CopilotItem, type CopilotCategory, type Confidence,
} from "@/lib/copilotOrchestrator";

/**
 * CareCopilotPanel — the always-on "senior radiologist beside you" panel (PR #80).
 *
 * It renders the unified CopilotReport (from copilotOrchestrator, which composes
 * the EXISTING observer engine + validator + quality score) as grouped,
 * advisory-only sections. Nothing here changes the report: an item may offer a
 * one-click Insert, but insertion is an explicit user action routed back to the
 * workspace's existing setters (Part 17 safety). Every item exposes Why? (Part
 * 15) and a confidence badge (Part 16). Recent actions are undoable (Part 14).
 */

export interface CopilotAction {
  id: string;
  title: string;
  category: CopilotCategory;
  outcome: "accepted" | "ignored";
}

interface Props {
  report: CopilotReport;
  dismissed: Set<string>;
  onInsert: (item: CopilotItem) => void;
  onDismiss: (item: CopilotItem) => void;
  onGoToConflict: (matchText: string) => void;
  recentActions: CopilotAction[];
  onUndoLast: () => void;
  provider: string;
  analyzing?: boolean;
}

const CATEGORY_ICON: Record<CopilotCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  suggestion: Sparkles,
  missing: ListChecks,
  contradiction: AlertTriangle,
  impression: ClipboardCheck,
  recommendation: Stethoscope,
  differential: GitBranch,
  measurement: Ruler,
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const SECTION_ORDER: CopilotCategory[] = [
  "contradiction", "impression", "suggestion", "missing", "measurement", "recommendation", "differential",
];

function QualityGauge({ score, band }: { score: number; band: string }) {
  const color = band === "Excellent" ? "text-emerald-600" : band === "Good" ? "text-amber-600" : "text-rose-600";
  const bar = band === "Excellent" ? "bg-emerald-500" : band === "Good" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Report Completeness</span>
        <span className={`text-sm font-bold ${color}`}>{score}/100 · {band}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function ItemCard({ item, onInsert, onDismiss, onGoToConflict }: {
  item: CopilotItem;
  onInsert: (i: CopilotItem) => void;
  onDismiss: (i: CopilotItem) => void;
  onGoToConflict: (m: string) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const dot = item.severity === "critical" ? "bg-rose-500" : item.severity === "warning" ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="rounded-md border bg-background p-2 space-y-1">
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{item.title}</span>
            <span className={`rounded px-1 text-[9px] font-semibold uppercase ${CONFIDENCE_STYLE[item.confidence]}`}>{item.confidence}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{item.detail}</p>
        </div>
      </div>
      {showWhy && (
        <p className="ml-4 rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground"><Info size={9} className="mr-1 inline" />{item.why}</p>
      )}
      <div className="ml-4 flex flex-wrap items-center gap-1.5">
        <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setShowWhy((v) => !v)}>
          {showWhy ? "Hide" : "Why?"}
        </button>
        {item.insertText && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onInsert(item)}>
            Insert{item.insertTarget ? ` → ${item.insertTarget}` : ""}
          </Button>
        )}
        {item.matchText && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => onGoToConflict(item.matchText!)}>
            Go to conflict
          </Button>
        )}
        <button className="ml-auto text-[10px] text-muted-foreground hover:text-destructive" onClick={() => onDismiss(item)}>Ignore</button>
      </div>
    </div>
  );
}

export default function CareCopilotPanel({
  report, dismissed, onInsert, onDismiss, onGoToConflict, recentActions, onUndoLast, provider, analyzing,
}: Props) {
  const visible = useMemo(() => report.items.filter((i) => !dismissed.has(i.id)), [report.items, dismissed]);
  const grouped = useMemo(() => {
    const map = new Map<CopilotCategory, CopilotItem[]>();
    for (const it of visible) (map.get(it.category) ?? map.set(it.category, []).get(it.category)!).push(it);
    return SECTION_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [visible]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="care-copilot-panel">
      <div className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-primary" />
        <span className="text-sm font-semibold">CARE Copilot</span>
        {analyzing && <span className="text-[9px] text-muted-foreground">analysing…</span>}
        <span className="ml-auto text-[9px] text-muted-foreground" title="Active AI provider">{provider}</span>
      </div>

      <QualityGauge score={report.quality.score} band={report.quality.band} />

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
          No suggestions right now. Keep reporting — the Copilot updates live and only ever suggests.
        </p>
      ) : (
        grouped.map(({ category, items }) => {
          const Icon = CATEGORY_ICON[category];
          return (
            <div key={category} className="space-y-1">
              <div className="flex items-center gap-1 px-0.5">
                <Icon size={11} className="text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">{CATEGORY_LABEL[category]}</span>
                <span className="text-[9px] text-muted-foreground">({items.length})</span>
              </div>
              {items.map((it) => (
                <ItemCard key={it.id} item={it} onInsert={onInsert} onDismiss={onDismiss} onGoToConflict={onGoToConflict} />
              ))}
            </div>
          );
        })
      )}

      {recentActions.length > 0 && (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase text-muted-foreground">
            Recent AI Actions ({recentActions.length})
          </summary>
          <div className="mt-1 space-y-0.5">
            {recentActions.slice(0, 10).map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className={a.outcome === "accepted" ? "text-emerald-600" : "text-muted-foreground"}>
                  {a.outcome === "accepted" ? "✓ Accepted" : "✕ Ignored"}
                </span>
                <span className="truncate text-muted-foreground">{a.title}</span>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="mt-1.5 h-6 text-[10px]" onClick={onUndoLast}>
            <Undo2 size={11} /> Undo last insertion
          </Button>
        </details>
      )}

      <p className="mt-auto flex items-center gap-1 pt-1 text-[9px] text-muted-foreground">
        <ShieldCheck size={10} /> Advisory only — the Copilot never changes your report. You accept every change.
      </p>
    </div>
  );
}
