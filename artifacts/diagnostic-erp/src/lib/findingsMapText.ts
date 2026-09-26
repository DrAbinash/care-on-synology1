/**
 * Structured Normal/Abnormal findingsMap → flat findings text.
 * Extracted from RadiologyReportingWorkspace (Phase 1 — no behavior change).
 */

export function findingsMapToText(
  map: Record<string, { normal: boolean; text: string }>,
): string {
  return Object.entries(map)
    .filter(([, v]) => v.text.trim())
    .map(([label, v]) => `${label}: ${v.text}`)
    .join("\n\n");
}
