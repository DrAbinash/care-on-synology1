/**
 * structuredFindings — the Structured Finding Assistant's pure core.
 *
 * It generalises the abnormality property model (side/severity/level) into a
 * fully CONFIGURABLE set of per-finding "questions" (label, options, default,
 * required) and generates the finding / impression text from the answered
 * values. The generated text then flows through the EXISTING Smart Findings
 * Engine (the findingsMap section flip) — no second reporting engine.
 *
 * Text templates support:
 *   - {key}            — substituted with the value for that question
 *   - [ … {key} … ]    — an OPTIONAL clause, dropped whole when any of its keys
 *                        is null-like ("Normal" / "None" / "" / "Nil" / …), so
 *                        the sentence stays grammatical without dropdowns for
 *                        absent features.
 * The anatomical section may itself be templated (e.g. "{level}") so one
 * generic "Disc Bulge" finding maps to the selected level's section.
 */

export type StructuredQuestion = {
  key: string;
  label: string;
  type: "select" | "text";
  options: string[];
  default: string;
  required: boolean;
  sortOrder: number;
};

/** Values treated as "absent" — they drop their optional clause and render as
 *  empty in a bare {key}. Case-insensitive. */
const NULLISH = new Set(["", "normal", "none", "nil", "no", "n/a", "na", "-", "absent", "not seen", "unremarkable"]);
function isNullish(v: string | undefined): boolean {
  return NULLISH.has((v ?? "").trim().toLowerCase());
}

/** Parse the JSON question definitions stored on a finding (safe / ordered). */
export function parseQuestions(json: string | null | undefined): StructuredQuestion[] {
  if (!json) return [];
  let arr: unknown;
  try { arr = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((q): q is Record<string, unknown> => !!q && typeof (q as { key?: unknown }).key === "string" && !!(q as { key: string }).key)
    .map((q, i) => ({
      key: String(q.key),
      label: typeof q.label === "string" && q.label ? q.label : String(q.key),
      type: q.type === "text" ? "text" as const : "select" as const,
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : [],
      default: typeof q.default === "string" ? q.default : "",
      required: q.required === true,
      sortOrder: Number.isFinite(Number(q.sortOrder)) ? Number(q.sortOrder) : i,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Fill a template: resolve [optional clauses] then {key} placeholders, then
 *  tidy grammar. Null-like values drop their clause / render empty. */
export function fillStructuredTemplate(template: string, values: Record<string, string>): string {
  if (!template) return "";
  // 1. Optional clauses: keep only when every key inside resolves non-null.
  let t = template.replace(/\[([^[\]]*)\]/g, (_m, clause: string) => {
    const keys = Array.from(clause.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
    if (keys.length && keys.some((k) => isNullish(values[k]))) return "";
    return clause;
  });
  // 2. Substitute remaining placeholders (null-like → "").
  t = t.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = (values[k] ?? "").trim();
    return isNullish(v) ? "" : v;
  });
  // 3. Grammar cleanup.
  t = t
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*(and\b|with\b|causing\b)/gi, " $1")
    .replace(/\s*,\s*\./g, ".")
    .replace(/\.\s*\./g, ".")
    .trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

/** Resolve a (possibly templated) section label against the answered values. */
export function resolveSection(sectionTemplate: string | null | undefined, values: Record<string, string>): string {
  const s = (sectionTemplate ?? "").trim();
  if (!s.includes("{")) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (values[k] ?? "").trim()).trim();
}

/** Initial answers for a finding's questions: session memory → default → first
 *  option → "". Drives "fewest clicks" (often the radiologist just hits Apply). */
export function initialValues(questions: StructuredQuestion[], memory: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    out[q.key] = memory[q.key] ?? (q.default || (q.options[0] ?? ""));
  }
  return out;
}

/** Labels of required questions still unanswered. */
export function missingRequired(questions: StructuredQuestion[], values: Record<string, string>): string[] {
  return questions.filter((q) => q.required && !(values[q.key] ?? "").trim()).map((q) => q.label);
}

export type StructuredRender = {
  section: string;
  finding: string;
  impression: string;
  technique: string;
  recommendation: string;
};

/** Generate the report contributions for a structured finding from its values. */
export function generateStructuredFinding(
  f: { anatomicalSection: string; findingText: string; impressionText: string; techniqueText: string; recommendationText: string },
  values: Record<string, string>,
): StructuredRender {
  return {
    section: resolveSection(f.anatomicalSection, values),
    finding: fillStructuredTemplate(f.findingText, values),
    impression: fillStructuredTemplate(f.impressionText, values),
    technique: fillStructuredTemplate(f.techniqueText, values),
    recommendation: fillStructuredTemplate(f.recommendationText, values),
  };
}
