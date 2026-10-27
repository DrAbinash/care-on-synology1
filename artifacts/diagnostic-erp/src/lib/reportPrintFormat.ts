/**
 * The Print Preview typography adjustment — per report, relative to Settings.
 *
 * WHY THIS EXISTS. The preview toolbar already had a "Font S/M/L" button, and the
 * workspace already kept a `bodyFontSize` choice. Neither reached a report: the
 * preview iframe is server-rendered HTML fetched from
 * `/api/patient-reports/:id/print`, and that URL was built from the template and the
 * impression style only. Pressing the button changed React state, the button label
 * changed, and the document did not. The same three-way choice also fed
 * `buildDocumentHtml`, which is the BILL and VOUCHER printer — so the name promised
 * "PDF / print layout" while the value went to a different document family entirely.
 * This module replaces that dead control with one that is honoured by the server, in
 * the single place where a style row becomes CSS.
 *
 * Steps are RELATIVE, and the base is the clinic's own Style settings: the owner's
 * rule is "Settings as the default, report-specific adjustments without changing
 * global settings or other reports". An absolute choice would have to be persisted
 * somewhere to survive a reload, and the only place it was persisted before was one
 * localStorage key shared by every report on the workstation.
 */

export type PrintFormatAdjustment = { fontSizeSteps: number; spacingSteps: number };

export const NO_PRINT_FORMAT_ADJUSTMENT: PrintFormatAdjustment = { fontSizeSteps: 0, spacingSteps: 0 };

/** Must match MAX_FORMAT_STEPS on the server; the server clamps anyway. */
export const MAX_PRINT_FORMAT_STEPS = 4;

export type FormatField = "fontSize" | "spacing";

function clampStep(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_PRINT_FORMAT_STEPS, Math.min(MAX_PRINT_FORMAT_STEPS, Math.round(n)));
}

export function adjustPrintFormat(
  current: PrintFormatAdjustment,
  field: FormatField,
  delta: number,
): PrintFormatAdjustment {
  if (field === "fontSize") {
    return { ...current, fontSizeSteps: clampStep(current.fontSizeSteps + delta) };
  }
  return { ...current, spacingSteps: clampStep(current.spacingSteps + delta) };
}

export function hasPrintFormatAdjustment(a: PrintFormatAdjustment | null | undefined): boolean {
  return !!a && (a.fontSizeSteps !== 0 || a.spacingSteps !== 0);
}

/** Query fragment for the server doors. Empty when nothing was adjusted, so a report
 *  nobody touched is served by exactly the URL it was served by before. */
export function printFormatQuery(a: PrintFormatAdjustment | null | undefined): string {
  if (!hasPrintFormatAdjustment(a)) return "";
  const { fontSizeSteps, spacingSteps } = a as PrintFormatAdjustment;
  const parts = [`fontSizeSteps=${fontSizeSteps}`, `spacingSteps=${spacingSteps}`];
  return `&${parts.join("&")}`;
}

/**
 * The adjustment belongs to ONE report. The reporting workspace is reused when the
 * radiologist opens the next study, so state that is not keyed travels with it — and
 * a size chosen to fit yesterday's lumbar spine must not silently apply to today's
 * brain. An unkeyed or mismatched read is no adjustment at all.
 */
export function adjustmentForReport(
  reportKey: string | null | undefined,
  stored: { key: string; adjustment: PrintFormatAdjustment } | null | undefined,
): PrintFormatAdjustment {
  if (!reportKey || !stored || stored.key !== reportKey) return NO_PRINT_FORMAT_ADJUSTMENT;
  return stored.adjustment;
}

/** What the report is identified by for this purpose: its row, else the draft, else
 *  the study. Null only when nothing is open yet. */
export function formatReportKey(input: {
  linkedReportId?: number | null;
  draftId?: number | string | null;
  studyId?: number | string | null;
}): string | null {
  if (input.linkedReportId) return `report-${input.linkedReportId}`;
  if (input.draftId) return `draft-${input.draftId}`;
  if (input.studyId) return `study-${input.studyId}`;
  return null;
}
