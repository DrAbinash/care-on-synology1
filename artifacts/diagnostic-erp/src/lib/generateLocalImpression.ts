/**
 * Local (non-AI) impression synthesis from findings text or structured sections.
 * Fast first pass before optional AI polish.
 */

export function generateLocalImpression(
  findingsText: string,
  structuredSections?: Record<string, { normal: boolean; text: string }>,
): string[] {
  if (structuredSections && Object.keys(structuredSections).length > 0) {
    const abnormal = Object.entries(structuredSections)
      .filter(([, v]) => !v.normal && v.text.trim())
      .map(([label, v]) => `${label}: ${v.text.trim()}`);
    if (abnormal.length === 0) {
      return ["No significant abnormality detected."];
    }
    return abnormal.slice(0, 6);
  }

  const text = findingsText.trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  if (
    lower.includes("no significant abnormality")
    || lower.includes("unremarkable")
    || lower.includes("within normal limits")
    || lower.includes("appears normal")
  ) {
    return ["No significant abnormality detected."];
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  if (sentences.length === 0) return [text.slice(0, 200)];
  return sentences.slice(0, 4);
}
