/**
 * copilotCompletion.ts — CARE Copilot smart auto-completion (PR #80 Part 12).
 *
 * GitHub-Copilot-style: as the radiologist types a Findings sentence, suggest
 * the rest of it. Suggestions are LOCAL and deterministic (a knowledge base of
 * common, non-patient-specific sentence completions — mostly normal boilerplate
 * plus a few high-frequency stems), so there is no per-keystroke AI call and the
 * UI stays instant (Part 18). Nothing is ever inserted automatically — the UI
 * offers the completion and the radiologist accepts with Tab (Part 17 safety).
 *
 * Pure and alias-free so it runs under the root vitest config. The rule table is
 * data — PR #81 grows it (and can add an AI-backed fallback behind the existing
 * provider abstraction) without changing this function.
 */

export interface CompletionRule {
  /** Lower-case phrase the current sentence fragment must END with. */
  trigger: string;
  /** Text appended to continue/finish the sentence (usually ends the sentence). */
  completion: string;
  /** Optional study-description gate (lower-case substring). */
  studyIncludes?: string;
}

// High-frequency, non-patient-specific completions. Normal statements and the
// disc-bulge stem from the spec example. Deliberately conservative — a wrong
// completion is worse than none, and the radiologist edits freely after accept.
export const COMPLETION_RULES: CompletionRule[] = [
  // Spine
  { trigger: "diffuse posterior disc bulge", completion: " causing indentation over the anterior thecal sac.", studyIncludes: "spine" },
  { trigger: "the neural foramina are", completion: " patent bilaterally.", studyIncludes: "spine" },
  { trigger: "the spinal cord shows normal", completion: " signal intensity and calibre.", studyIncludes: "spine" },
  { trigger: "vertebral body heights are", completion: " maintained.", studyIncludes: "spine" },
  { trigger: "no significant central canal", completion: " stenosis is seen.", studyIncludes: "spine" },
  // Brain
  { trigger: "grey-white matter differentiation is", completion: " preserved.", studyIncludes: "brain" },
  { trigger: "the ventricular system is", completion: " normal in size and configuration.", studyIncludes: "brain" },
  { trigger: "the visualized paranasal sinuses", completion: " are clear.", studyIncludes: "brain" },
  { trigger: "no evidence of intracranial", completion: " haemorrhage, infarct or space-occupying lesion.", studyIncludes: "brain" },
  { trigger: "no abnormal restricted diffusion", completion: " is seen to suggest an acute infarct.", studyIncludes: "brain" },
  { trigger: "the basal cisterns are", completion: " normal.", studyIncludes: "brain" },
  // Generic
  { trigger: "no other significant abnormality is", completion: " detected." },
  { trigger: "correlation is advised with", completion: " clinical and laboratory findings." },
];

/** The in-progress sentence fragment ending at the cursor (after the last
 *  sentence break), whitespace-normalised. Exported for testing/preview. */
export function currentFragment(before: string): string {
  const lastBreak = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf(";"));
  return before.slice(lastBreak + 1).replace(/\s+/g, " ").replace(/^\s+/, "");
}

/**
 * Suggest a completion for the text before the cursor, or null when nothing
 * confidently matches. Never suggests when the completion is already present.
 */
export function suggestCompletion(
  before: string,
  opts: { studyDescription?: string; region?: string | null } = {},
): { trigger: string; completion: string } | null {
  const frag = currentFragment(before);
  const fragLower = frag.toLowerCase().replace(/\s+$/, "");
  if (fragLower.length < 6) return null;
  const study = (opts.region ?? opts.studyDescription ?? "").toLowerCase();
  for (const r of COMPLETION_RULES) {
    if (r.studyIncludes && !study.includes(r.studyIncludes)) continue;
    if (!fragLower.endsWith(r.trigger)) continue;
    // Already completed? (the next words match the completion's start)
    const head = r.completion.trim().toLowerCase().slice(0, 10);
    if (head && before.toLowerCase().includes(fragLower + " " + head)) continue;
    return { trigger: r.trigger, completion: r.completion };
  }
  return null;
}
