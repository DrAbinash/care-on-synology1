/**
 * Structured Normal/Abnormal findingsMap → flat findings text.
 * Extracted from RadiologyReportingWorkspace (Phase 1 — no behavior change).
 */

export function findingsMapToText(
  map: Record<string, { normal: boolean; text: string }>,
): string {
  // One labelled section per block, heading on its own line. A heading line is
  // the convention findingsDocument.ts reads, and it is what makes the printed
  // report carry sub-headings instead of one run-on paragraph.
  return Object.entries(map)
    .filter(([, v]) => v.text.trim())
    .map(([label, v]) => `${label}:\n${v.text.trim()}`)
    .join("\n\n");
}
