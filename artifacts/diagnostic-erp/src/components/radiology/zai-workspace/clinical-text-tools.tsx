import { Eraser, CaseSensitive, WrapText } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  disabled?: boolean;
  onBreakLines: () => void;
  onTitleCase: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * Mouse-first cleanup tools above Findings / Impression editors.
 * One click each — no hotkeys required.
 */
export function ClinicalTextTools({
  disabled = false,
  onBreakLines,
  onTitleCase,
  onClear,
  className,
}: Props) {
  const btn =
    "inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[10px] font-semibold text-foreground/80 shadow-sm hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-testid="clinical-text-tools"
      role="toolbar"
      aria-label="Text cleanup tools"
    >
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={onBreakLines}
        title="Format newlines — one observation per line"
        data-testid="clinical-text-break-lines"
      >
        <WrapText className="h-3 w-3" />
        Format Newlines
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={onTitleCase}
        title="Apply Title Case"
        data-testid="clinical-text-title-case"
      >
        <CaseSensitive className="h-3 w-3" />
        Title Case
      </button>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={onClear}
        title="Clear content"
        data-testid="clinical-text-clear"
      >
        <Eraser className="h-3 w-3" />
        Clear Content
      </button>
    </div>
  );
}
