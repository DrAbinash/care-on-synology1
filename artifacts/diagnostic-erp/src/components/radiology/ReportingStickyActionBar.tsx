/**
 * Compact sticky report action row — Save status · Undo Last Abnormal ·
 * Finalize · Next. Reuses parent handlers; no duplicate save/finalize engines.
 */
import { Undo2, ChevronRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatHumanSaveStatus,
  saveStatusDotClass,
  type AutoSaveStatus,
} from "@/lib/humanSaveStatus";
import { useEffect, useState } from "react";

type Props = {
  autoSaveStatus: AutoSaveStatus;
  lastSavedAt: Date | null;
  isDirty: boolean;
  isOnline: boolean;
  hasOfflineCopy: boolean;
  canUndoLastAbnormal: boolean;
  onUndoLastAbnormal: () => void;
  onSave: () => void;
  onFinalize: () => void;
  onNextStudy?: () => void;
  finalizeDisabled: boolean;
  finalizeLabel?: string;
  saveDisabled?: boolean;
  className?: string;
};

function HumanSaveStatusChip(props: {
  autoSaveStatus: AutoSaveStatus;
  lastSavedAt: Date | null;
  isDirty: boolean;
  isOnline: boolean;
  hasOfflineCopy: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const status = formatHumanSaveStatus({ ...props, nowMs });
  if (!status) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0"
      data-testid="human-save-status"
      title={status.label}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", saveStatusDotClass(status.tone))}
        aria-hidden
      />
      <span
        className={cn(
          status.tone === "red" && "text-red-700 font-medium",
          status.tone === "amber" && "text-amber-800",
          status.tone === "green" && "text-emerald-800",
        )}
      >
        {status.label}
      </span>
    </span>
  );
}

export function ReportingStickyActionBar({
  autoSaveStatus,
  lastSavedAt,
  isDirty,
  isOnline,
  hasOfflineCopy,
  canUndoLastAbnormal,
  onUndoLastAbnormal,
  onSave,
  onFinalize,
  onNextStudy,
  finalizeDisabled,
  finalizeLabel = "Confirm & Sign",
  saveDisabled,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 flex flex-wrap items-center gap-1.5 border-t border-emerald-200/70 bg-card/95 px-2 py-1.5 backdrop-blur-sm supports-[backdrop-filter]:bg-card/85",
        className,
      )}
      data-testid="reporting-sticky-action-bar"
      role="toolbar"
      aria-label="Report actions"
    >
      <HumanSaveStatusChip
        autoSaveStatus={autoSaveStatus}
        lastSavedAt={lastSavedAt}
        isDirty={isDirty}
        isOnline={isOnline}
        hasOfflineCopy={hasOfflineCopy}
      />
      <div className="flex-1 min-w-[0.5rem]" />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[10px] gap-1"
        onClick={onSave}
        disabled={saveDisabled}
        title="Save draft (Ctrl/⌘+S)"
        data-testid="sticky-save-draft"
      >
        <Save className="h-3 w-3" />
        <span className="hidden sm:inline">Save</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[10px] gap-1"
        disabled={!canUndoLastAbnormal}
        onClick={onUndoLastAbnormal}
        title="Restore the report state before the last abnormal selection. (Alt+U)"
        data-testid="sticky-undo-last-abnormal"
      >
        <Undo2 className="h-3 w-3" />
        <span className="hidden md:inline">Undo Last Abnormal</span>
        <span className="md:hidden">Undo Abn.</span>
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-7 px-2.5 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700"
        disabled={finalizeDisabled}
        onClick={onFinalize}
        title="Finalize / Confirm & Sign (Ctrl/⌘+Enter)"
        data-testid="sticky-finalize"
      >
        {finalizeLabel}
      </Button>
      {onNextStudy ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px] gap-0.5"
          onClick={onNextStudy}
          title="Next study"
          data-testid="sticky-next-study"
        >
          Next
          <ChevronRight className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
