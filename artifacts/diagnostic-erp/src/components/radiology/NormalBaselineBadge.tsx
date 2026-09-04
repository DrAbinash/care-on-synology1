/**
 * Editing-only badge for PR #677 normal-format bootstrap. Never printed.
 */
import { deriveNormalBaselineBadge } from "@/lib/normalBaselineBadge";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { cn } from "@/lib/utils";

type Props = {
  appliedFormatName: string | null | undefined;
  appliedFormatReportTitle?: string | null;
  appliedPathologyPatches: readonly AppliedPathologyPatch[];
  className?: string;
};

export function NormalBaselineBadge({
  appliedFormatName,
  appliedFormatReportTitle,
  appliedPathologyPatches,
  className,
}: Props) {
  const badge = deriveNormalBaselineBadge({
    appliedFormatName,
    appliedFormatReportTitle,
    appliedPathologyPatches,
  });
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[9px] font-medium leading-tight",
        badge.mode === "baseline"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-slate-300 bg-slate-50 text-slate-800",
        className,
      )}
      data-testid="normal-baseline-badge"
      data-editor-only="normal-baseline-badge"
      data-print-exclude="true"
      title={`Applied format: ${badge.formatName} — editing cue only; does not mean images were reviewed or that the report is complete.`}
    >
      {badge.text}
    </span>
  );
}
