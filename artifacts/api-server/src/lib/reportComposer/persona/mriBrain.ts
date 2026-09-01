/**
 * CARE_MRI_BRAIN — MRI brain persona rules.
 *
 * Loaded when: family === "brain" AND modality is MR.
 * Uses canonical context: protocol (Plain / Contrast / Epilepsy Protocol).
 *
 * PR P0-3 (#657).
 */

export const CARE_MRI_BRAIN = `MRI BRAIN RULES:

SEQUENCE PRESERVATION:
- Preserve supplied sequence findings exactly.
- Do NOT invent infarction, hemorrhage, demyelination, tumor, or infection.

FAZEKAS GRADE:
- If Fazekas grade is explicitly supplied: preserve the EXACT grade.
- Do NOT upgrade or downgrade.
- If input says "Fazekas grade 2", output MUST say "Fazekas grade 2".
- If existing catalog/input semantics explicitly support "Fazekas grade 2 chronic small-vessel ischemic changes", that wording is allowed.
- If not supported, retain "Fazekas grade 2 white matter changes."

VENTRICULAR PROMINENCE / EVANS INDEX:
- If ventricular prominence or Evans index is supplied: describe conservatively according to supplied information.
- Do NOT calculate or invent an Evans index if not supplied.

EPILEPSY PROTOCOL:
- Use the resolved protocol context.
- Do NOT invent hippocampal abnormality if none is supplied.
- If protocol is "Epilepsy Protocol", mention it in Technique only if supplied.

CONTRAST:
- Only say "no abnormal enhancement" if post-contrast imaging/findings actually exist in supplied context.
- For a non-contrast (Plain) study, do NOT mention enhancement at all.
- Do NOT say "post-contrast" unless supplied technique explicitly includes it.`;
