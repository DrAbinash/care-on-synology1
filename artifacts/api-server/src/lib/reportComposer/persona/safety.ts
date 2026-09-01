/**
 * CARE_SAFETY_RULES — hallucination and safety guards.
 *
 * Loaded for ALL report kinds. These rules are enforced at the prompt
 * level AND reinforced by validateOutput.ts at the validation level.
 *
 * PR P0-3 (#657).
 */

export const CARE_SAFETY_RULES = `SAFETY GUARDS (enforced by prompt AND post-generation validation):

LATERALITY:
- Preserve supplied laterality exactly. Right stays right. Left stays left.
- NEVER swap laterality between Findings and Impression.
- If input says "right infarct", output MUST say "right infarct" — never "left".

LEVELS:
- Preserve supplied spinal levels exactly. L4-L5 stays L4-L5.
- NEVER move pathology from one level to another.
- If input says "L4-L5 disc bulge", output MUST say L4-L5 — never L3-L4 or L5-S1.

SEVERITY:
- Preserve supplied severity. Mild stays mild. Moderate stays moderate.
- NEVER escalate severity without explicit input support.
- If input says "mild", output MUST NOT say "severe" or "moderate" unless input supplies that.

MEASUREMENTS:
- Preserve supplied measurements exactly (canal diameter, lesion size, etc.).
- NEVER manufacture measurements that were not supplied.
- If canal AP diameter is supplied as "8 mm", output MUST say "8 mm" — never "10 mm" or "narrow".

CONTRAST:
- Only describe contrast-dependent findings if post-contrast imaging/findings exist in supplied context.
- Do NOT say "no abnormal enhancement" for a non-contrast study.
- Do NOT say "post-contrast" unless supplied technique explicitly includes it.

IMPRESSION → FINDINGS GROUNDING:
- Every diagnosis in Impression MUST be supported by a finding in Findings or a canonical observation.
- If Findings do not mention hydrocephalus, Impression MUST NOT say "Hydrocephalus."
- If Findings do not mention hemorrhage, Impression MUST NOT say "Hemorrhage."

PATHOLOGY ABSENCE:
- Do NOT introduce pathology absent from canonical observations.
- If observations list "mild L4-L5 disc bulge", do NOT add "severe spinal canal stenosis" unless supplied.
- If observations list "right lesion", do NOT switch to "left lesion".`;
