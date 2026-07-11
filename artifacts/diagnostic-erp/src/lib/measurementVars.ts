/**
 * measurementVars.ts — Smart Measurements (Phase 3).
 *
 * A measurement template like "Common bile duct measures {value} mm." acts
 * as a linked variable: inserting it again with a new value UPDATES the
 * existing sentence in place instead of appending a duplicate. All
 * occurrences of that measurement in the text update together.
 *
 * Pure, dependency-free, unit-tested (phase3.test.ts).
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a regex matching a FILLED instance of the template (any value). */
export function filledTemplateRegex(templateText: string): RegExp {
  const escaped = escapeRegex(templateText);
  // {value} was escaped to \{value\}; swap it for a number-capture group.
  const pattern = escaped.replace(/\\\{value\\\}/g, "([0-9]+(?:\\.[0-9]+)?(?:\\s*[x×]\\s*[0-9]+(?:\\.[0-9]+)?)*)");
  return new RegExp(pattern, "g");
}

/**
 * Inserts (or updates) a measurement in `text`.
 * - If a filled instance of the template already exists → replace the value
 *   in EVERY occurrence (linked-variable behavior).
 * - Otherwise → append the filled sentence as a new paragraph.
 * Returns the new text plus whether it was an update or an insert.
 */
export function upsertMeasurement(
  text: string,
  templateText: string,
  value: string,
): { text: string; updated: boolean } {
  const filled = templateText.replace(/\{value\}/g, value.trim());
  const re = filledTemplateRegex(templateText);
  if (re.test(text)) {
    return { text: text.replace(filledTemplateRegex(templateText), filled), updated: true };
  }
  const base = text.trimEnd();
  return { text: base ? `${base}\n${filled}` : filled, updated: false };
}

/** Reads the current value of a measurement from the text (first match). */
export function readMeasurement(text: string, templateText: string): string | null {
  const m = filledTemplateRegex(templateText).exec(text);
  return m ? m[1] : null;
}
