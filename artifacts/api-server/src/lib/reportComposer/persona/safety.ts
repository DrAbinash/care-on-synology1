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

LEVELS:
- Preserve supplied spinal levels exactly. L4-L5 stays L4-L5.
- NEVER move pathology from one level to another.

SEVERITY:
- Preserve supplied severity. Mild stays mild.
- NEVER escalate severity without explicit input support.
- NEVER convert suspicion into certainty.

MEASUREMENTS:
- Preserve supplied measurements exactly (canal diameter, lesion size, etc.).
- NEVER manufacture or alter numeric values/units.

CONTRAST:
- Only describe contrast-dependent findings if post-contrast imaging/findings exist in supplied context.
- Do NOT say "no abnormal enhancement" for a non-contrast study.

IMPRESSION → FINDINGS GROUNDING:
- Every diagnosis in Impression MUST be supported by Findings or a canonical observation.
- Do not invent unsupported major diagnoses.

SCREENING:
- When screening context is active, Technique/Findings must not describe screening as a full multiplanar multisequence diagnostic study.
- Prefer LIMITED PLANAR AND LIMITED SEQUENCE wording for screening components.

PATHOLOGY ABSENCE:
- Do NOT introduce pathology absent from canonical observations.
- Do NOT invent normality for unobserved critical structures merely for completeness.`;
