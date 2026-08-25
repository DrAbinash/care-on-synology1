/**
 * Local (non-AI) impression synthesis from findings text or structured sections.
 * Fast first pass before optional AI polish.
 */

function sentencesFromFindings(findingsText: string): string[] {
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

  // Prefer prose sentences; also accept bullet lines that end with punctuation.
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\u2022\-*]\s*/, "").trim())
    .filter((s) => s.length > 12 && !/^[A-Z][A-Za-z /&()-]{2,40}$/.test(s));
  if (sentences.length === 0) return [text.slice(0, 200)];
  return sentences.slice(0, 6);
}

export function generateLocalImpression(
  findingsText: string,
  structuredSections?: Record<string, { normal: boolean; text: string }>,
): string[] {
  if (structuredSections && Object.keys(structuredSections).length > 0) {
    const abnormal = Object.entries(structuredSections)
      .filter(([, v]) => !v.normal && v.text.trim())
      .map(([label, v]) => `${label}: ${v.text.trim()}`);
    if (abnormal.length > 0) {
      return abnormal.slice(0, 6);
    }
    // Structured cards all marked normal — still honour free-text findings when
    // the radiologist typed abnormalities outside the cards (common failure mode).
    const fromFreeText = sentencesFromFindings(findingsText);
    if (fromFreeText.length > 0 && fromFreeText[0] !== "No significant abnormality detected.") {
      return fromFreeText;
    }
    return ["No significant abnormality detected."];
  }

  return sentencesFromFindings(findingsText);
}
