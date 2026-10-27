import { UserRound } from "lucide-react";
import {
  formatDemographyAgeSexLine,
  hasDemographyValue,
  type ReportDemography,
} from "@/lib/reportDemography";

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
 */
export default function ComposerIdentityStrip({ demography }: { demography: ReportDemography }) {
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
        {hasDemographyValue(demography.studyDescription) ? (
          <span
            className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground"
            title={demography.studyDescription}
          >
            {demography.studyDescription}
          </span>
        ) : null}
      </div>
    </div>
  );
}
