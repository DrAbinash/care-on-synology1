// text/closingStatement.ts — the one owner of the fixed closing statement.
//
// Owner reporting policy (2026-10-27): every RADIOLOGY report closes with exactly
// this sentence — "Please correlate with clinical findings." It is a statement of
// the document, not advice from the radiologist, which is why it lives here rather
// than in the Recommendations field:
//
//   • the editable Recommendations field is still never auto-filled (see
//     `useReportingStudySetup.ts` and the Start Report contract test), so nothing
//     is attributed to a radiologist who did not write it;
//   • an empty Recommendations section still renders no "RECOMMENDATION:" heading
//     over nothing (`recommendationSectionText`), so the fixed line is never the
//     reason a section appears;
//   • the line prints whether or not the field is empty, and it prints ONCE — a
//     radiologist who typed it himself, or a template that authored it, must not
//     end up with the report saying it twice;
//   • pathology and laboratory reports are excluded. They keep their own footer
//     contract, and the gate is the document's type label rather than a guess.
//
// Why a shared module instead of a string in each renderer: two surfaces build a
// radiology document independently — the server's one renderer
// (`reportPresentation.renderReportDocument`, which serves print, staff PDF, the
// public/WhatsApp PDF, email share and the PACS archive) and the client preview
// that Word export converts (`radiologyReportPreviewHtml.buildPreviewHtml`). A
// third path merges the live editor body into server print HTML before it paints
// ("Print like final"), and that merge can change whether the sentence is already
// present. Three call sites, one wording and one detector, or they drift.

/** The sentence, verbatim, as the owner requires it to appear. */
export const RADIOLOGY_CLOSING_STATEMENT = "Please correlate with clinical findings.";

/** The element class the statement prints in. Exported so the live-merge path can
 *  remove the element it did not author without re-typing the markup. */
export const RADIOLOGY_CLOSING_STATEMENT_CLASS = "closing-statement";

/**
 * Words matched loosely (any run of spaces/newlines, any case, trailing period
 * optional) so the guard catches the sentence however it got there — typed by hand
 * with one space missing, authored by a template, or emitted by an earlier render.
 * Matching the words rather than the whole line is deliberate: the sentence is
 * often followed by other advice ("…; repeat MRI in six weeks") and that is still
 * the report saying it once.
 */
const CLOSING_STATEMENT_RE = /please\s+correlate\s+with\s+clinical\s+findings\b/i;

/** Visible text only: tags dropped, entities and NBSP folded, whitespace collapsed. */
function visibleText(markupOrText: string | null | undefined): string {
  return String(markupOrText ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the statement is already in this content, so it must not be added again. */
export function containsRadiologyClosingStatement(markupOrText: string | null | undefined): boolean {
  return CLOSING_STATEMENT_RE.test(visibleText(markupOrText));
}

/** The statement as printed — its own element, outside the report body and outside
 *  the Recommendation section, so presentation makes clear it is not authored advice. */
export function radiologyClosingStatementHtml(): string {
  return `<div class="${RADIOLOGY_CLOSING_STATEMENT_CLASS}">${RADIOLOGY_CLOSING_STATEMENT}</div>`;
}

/** The element when the content does not already carry the sentence, "" when it does. */
export function radiologyClosingStatementHtmlIfAbsent(
  bodyMarkup: string | null | undefined,
): string {
  return containsRadiologyClosingStatement(bodyMarkup) ? "" : radiologyClosingStatementHtml();
}

/**
 * The statement as TEXT, for a document assembled from report sections rather than from
 * the report body — the letter-pad PDF, which draws Findings/Impression/Recommendation
 * itself and has no HTML to append an element to.
 *
 * It exists so the one question a radiology document has to answer ("do my own words
 * already say this?") is asked the same way on every surface. A door that re-typed the
 * check would decide it against only the section it renders, which is how a report ends
 * up saying the sentence twice — or, on a surface nobody re-typed it into, not at all.
 */
export function radiologyClosingStatementForSections(
  parts: readonly (string | null | undefined)[],
): string {
  return containsRadiologyClosingStatement(parts.filter(Boolean).join("\n"))
    ? ""
    : RADIOLOGY_CLOSING_STATEMENT;
}

/**
 * Drop the fixed statement from a rendered document.
 *
 * The "Print like final" preview takes server print HTML — rendered against the
 * stored draft body — and replaces the body with what is in the editor right now.
 * If the radiologist has just typed the sentence himself, the server's copy of the
 * fixed statement is now a duplicate, and only the client can know that.
 */
export function withoutRadiologyClosingStatement(html: string): string {
  return String(html ?? "").replace(
    new RegExp(
      `<div\\b[^>]*\\bclass="[^"]*\\b${RADIOLOGY_CLOSING_STATEMENT_CLASS}\\b[^"]*"[^>]*>[\\s\\S]*?</div>`,
      "i",
    ),
    "",
  );
}
