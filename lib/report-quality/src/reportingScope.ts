/**
 * reportingScope.ts — what the printed page says about the region it documents.
 *
 * The heading on a printed radiology report is the BILLED identity: the server
 * builds `studyTitle` from the catalog test name, falling back to the worklist
 * StudyDescription. That is right, and this module never touches it — a report has
 * to say what was ordered and billed, and renaming it would break the match
 * between the paper, the bill and the PACS series.
 *
 * What the report *documents* is a separate fact. ADR-004 records it: when the
 * radiologist moves a report to a different reporting region, the transition is
 * written to `structured_json.careRegionTransitions` with the region chosen, the
 * sentences retired, who decided and when. After that decision the body of the
 * report covers less anatomy than its heading names, and the page has said
 * nothing about it — a reader comparing the heading to the findings has no way to
 * tell a deliberate narrowing from an incomplete report.
 *
 * So the note is derived from that record and the heading it sits under, and from
 * nothing else. It does not read the findings, the technique or any other report
 * prose: deciding a region from prose is the guessing ADR-004 exists to prevent.
 *
 * The four things a report can mean by "the region" are deliberately separated:
 *   - booked examination   → the heading, untouched (billed identity)
 *   - documented region    → the last recorded transition (this note)
 *   - selected reporting region → the same record, since ADR-004 only writes one
 *     when the radiologist confirms the change
 *   - anatomy actually imaged → NOT asserted anywhere here. The ERP holds no
 *     series-level coverage evidence, so the note names what the report
 *     documents and never what the scanner acquired.
 *
 * A report with no recorded transition renders exactly as it does today: the note
 * is null, not an empty sentence.
 */

import {
  canonicalContentRegion,
  coverageOfRegion,
  coverageUnionOfRegions,
  type SpineCoverageSegment,
} from "./reportingRegion";

/** One ADR-004 region transition, as little of it as the note can use. */
export type ReportedScopeRecord = {
  toRegion: string | null | undefined;
  /** Kept for callers that read the record; the note is decided by `toRegion`. */
  fromRegion?: string | null | undefined;
  decidedBy?: string | null | undefined;
  at?: string | null | undefined;
};

export type DocumentedReportingScope = {
  /** The region the radiologist recorded, as recorded. */
  toRegion: string;
  /** The examination name the note is printed under, unchanged. */
  bookedTitle: string;
  /** True only when the recorded region covers a proper subset of the booked one. */
  narrowing: boolean;
  decidedBy: string;
  at: string;
};

/**
 * The recorded region and the booked title agree when they acquire the same spine
 * segments. Either side being outside the spine (or the bare "Spine" tab) answers
 * "no opinion", and the note is not printed — saying a scope changed from a name
 * this vocabulary cannot place would be a claim about anatomy.
 */
export function documentedReportingScope(input: {
  bookedTitle: string | null | undefined;
  records: readonly ReportedScopeRecord[] | null | undefined;
}): DocumentedReportingScope | null {
  const bookedTitle = (input.bookedTitle ?? "").trim();
  if (!bookedTitle) return null;
  const records = input.records ?? [];
  if (records.length === 0) return null;

  const last = records[records.length - 1];
  const toRegion = (last?.toRegion ?? "").trim();
  if (!toRegion) return null;

  // A multi-region selection is stored as one label ("Cervical Spine + LS Spine");
  // its coverage is the union of its parts, never of its first word.
  const documented = coverageUnionOfRegions(toRegion.split("+").map((part) => part.trim()));
  const booked = coverageOfExaminationName(bookedTitle);
  if (!documented || !booked) return null;
  if (sameCoverage(documented, booked)) return null;

  return {
    toRegion,
    bookedTitle,
    narrowing: isProperSubset(documented, booked),
    decidedBy: (last.decidedBy ?? "").trim(),
    at: (last.at ?? "").trim(),
  };
}

/**
 * The one line printed under the heading. Every clause is either a name the
 * product already holds or a recorded decision; there is no verb here that could
 * be read as a statement about acquisition.
 */
export function reportedScopeNote(input: {
  bookedTitle: string | null | undefined;
  records: readonly ReportedScopeRecord[] | null | undefined;
}): string | null {
  const scope = documentedReportingScope(input);
  if (!scope) return null;
  const attribution = scope.decidedBy
    ? ` (recorded by ${scope.decidedBy}${formatScopeDate(scope.at) ? ` on ${formatScopeDate(scope.at)}` : ""})`
    : "";
  return `Documented reporting region: ${scope.toRegion}${attribution}. Booked examination: ${scope.bookedTitle}.`;
}

/**
 * The spine segment(s) a booked examination name refers to.
 *
 * `spineSegmentFromRegion` already matches a segment anywhere inside a name
 * ("MRI Cervical Spine" → cervical), so the only gap is the picker's own short
 * aliases, which a clinic can also book ("MRI C-Spine"). The aliases folded here
 * are the same three groups `canonicalContentRegion` maps, applied to a name
 * rather than to a whole selection — this never reads report prose, and never
 * resolves a region for any consumer that should be using `studyRegion.ts`.
 */
function coverageOfExaminationName(name: string): Set<SpineCoverageSegment> | null {
  const canonicalised = canonicalContentRegion(name);
  if (canonicalised.toLowerCase() !== name.toLowerCase()) return coverageOfRegion(canonicalised);
  return coverageOfRegion(
    name
      .replace(/\bc[\s-]?spine\b/gi, "Cervical Spine")
      .replace(/\bcspine\b/gi, "Cervical Spine")
      .replace(/\bt[\s-]?spine\b/gi, "Dorsal Spine")
      .replace(/\bl[\s-]?spine\b/gi, "LS Spine"),
  );
}

function sameCoverage(a: Set<SpineCoverageSegment>, b: Set<SpineCoverageSegment>): boolean {
  return a.size === b.size && [...a].every((segment) => b.has(segment));
}

function isProperSubset(a: Set<SpineCoverageSegment>, b: Set<SpineCoverageSegment>): boolean {
  return a.size < b.size && [...a].every((segment) => b.has(segment));
}

/**
 * The recorded decision's date, in UTC so the same record prints the same day no
 * matter which process renders it. An unparseable timestamp prints no date rather
 * than a guessed one: on a clinical document a fabricated day is worse than none.
 */
function formatScopeDate(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parsed.getUTCDate()} ${months[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}
