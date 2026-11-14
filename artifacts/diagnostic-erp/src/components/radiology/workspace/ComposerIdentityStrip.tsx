import { AlertTriangle, ScanLine, UserRound } from "lucide-react";
import {
  formatDemographyAgeSexLine,
  hasDemographyValue,
  type ReportDemography,
} from "@/lib/reportDemography";
import type { ComposerScopeDisplay } from "@/lib/composerStudyScopeDisplay";

/**
 * PR #1172 — the composer column's persistent identity strip.
 *
 * Before this, the Reporting Workspace's editing surface never said who it
 * was about in one persistent place: the top bar carried name + age/sex at
 * 10px muted among six other elements (no UHID, no accession), the editable
 * card sat behind the collapsed Study details accordion, and the viewer-focus
 * strip carried its own "Show patient details" link precisely because the
 * identity was otherwise invisible. A radiologist typing a report deserves
 * the same wrong-patient guardrail every other surface of this repo treats
 * as non-negotiable: the name, the UHID, the accession and the age/sex on
 * screen beside the editor, always, not behind a click.
 *
 * Read-only and derived from `canonicalDemography` — the same detail-first
 * merge that feeds the Demography card, so a deep-linked study the reading
 * queue filters out keeps its identity here too. Corrections made on the
 * card appear here immediately (the card's overrides win the merge), which
 * is the point: the strip must agree with what the report will print.
 *
 * Z.AI audit item 22 added the second row: the booked examination and the
 * performed acquisition as TWO statements. Row 1 used to end with the merged
 * demography's description — one string that `mergeReportDemography` fills
 * from the worklist description whenever it has one — so "MRI BRAIN +
 * CX SCR" could sit beside a report being written for a bill of `MRI Brain`
 * with nothing on screen saying which of the two it was, or whether the
 * scanner had sent any images at all. The row now names the bill, names the
 * study, and says when the two describe different examinations. It is the
 * same reading `ReportingScopeConfirmStrip` asks about, so the strip can
 * never contradict the question, and it still gates nothing.
 */
export default function ComposerIdentityStrip({
  demography,
  scope,
}: {
  demography: ReportDemography;
  scope: ComposerScopeDisplay;
}) {
  const ageSex = formatDemographyAgeSexLine(demography.age, demography.sex);
  return (
    <div
      data-testid="composer-identity-strip"
      className="shrink-0 rounded-md border border-emerald-300/80 bg-gradient-to-r from-emerald-50 via-white to-white px-2.5 py-1.5 dark:border-emerald-700/60 dark:from-emerald-950/40 dark:via-slate-950 dark:to-slate-950"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span
          data-testid="composer-identity-name"
          className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold uppercase tracking-wide text-emerald-900 dark:text-emerald-200"
          title="The patient this report is about"
        >
          <UserRound size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          {demography.patientName || "—"}
        </span>
        {ageSex ? (
          <span className="shrink-0 text-[11px] font-medium text-slate-700 dark:text-slate-300">
            {ageSex}
          </span>
        ) : null}
        {hasDemographyValue(demography.uhid) ? (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            UHID {demography.uhid}
          </span>
        ) : null}
        {hasDemographyValue(demography.accessionNumber) ? (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            ACC {demography.accessionNumber}
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex min-w-0 flex-col gap-0.5 border-t border-emerald-200/60 pt-1 dark:border-emerald-900/50">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            data-testid="composer-scope-booked"
            className="flex min-w-0 items-baseline gap-1.5"
            title={
              scope.bookedIsBilled
                ? "The examination the front desk booked"
                : "No billed test name reached this study, so this is the worklist description standing in for it"
            }
          >
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {scope.bookedIsBilled ? "Booked" : "Booked (not billed)"}
            </span>
            <span className="min-w-0 truncate text-[11px] font-semibold text-slate-800 dark:text-slate-200">
              {scope.booked || "—"}
            </span>
          </span>
          <span
            data-testid="composer-scope-acquisition"
            className={
              scope.acquisition.state === "awaiting"
                ? "flex min-w-0 items-baseline gap-1.5 text-amber-700 dark:text-amber-400"
                : "flex min-w-0 items-baseline gap-1.5 text-slate-600 dark:text-slate-300"
            }
            title={scope.acquisition.detail}
          >
            <ScanLine
              size={11}
              className={
                scope.acquisition.state === "awaiting"
                  ? "shrink-0 self-center text-amber-600 dark:text-amber-400"
                  : "shrink-0 self-center text-slate-400 dark:text-slate-500"
              }
            />
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider">
              {scope.acquisition.state === "awaiting" ? "Machine" : "Study says"}
            </span>
            <span className="min-w-0 truncate text-[11px]">{scope.acquisition.label}</span>
          </span>
        </div>
        {scope.notice ? (
          <span
            data-testid="composer-scope-notice"
            className="flex min-w-0 items-start gap-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            title="The bill and the study describe different examinations. Confirm the reporting scope above if the report must cover both."
          >
            <AlertTriangle size={11} className="mt-[1px] shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0">{scope.notice}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
