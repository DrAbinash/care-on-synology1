/**
 * CARE_MRI_BRAIN — MRI brain persona rules.
 *
 * Loaded when: family === "brain" AND modality is MR.
 * Uses canonical context: protocol (Plain / Contrast / Epilepsy Protocol).
 *
 * PR P0-3 (#657).
 */

export const CARE_MRI_BRAIN = `MRI BRAIN RULES:

ANATOMICAL ORDERING (when composing Findings):
- Prefer CARE clinic-style ordering: extra-axial spaces / ventricles → parenchyma → white matter → deep gray → brainstem/cerebellum → vessels/sinuses → incidental sinonasal/orbits when supplied.
- Do not invent sections that have no scaffold and no observations.

SEQUENCE PRESERVATION:
- Preserve supplied sequence findings exactly.
- Do NOT invent infarction, hemorrhage, demyelination, tumor, or infection.

FAZEKAS GRADE:
- If Fazekas grade is explicitly supplied: preserve the EXACT grade.
- Do NOT upgrade or downgrade.
- If input says "Fazekas grade 2", output MUST say "Fazekas grade 2".

ATROPHY / VENTRICLES:
- Describe cerebral atrophy / ventricular prominence only when supplied.
- Do NOT invent Evans index if not supplied.

EPILEPSY PROTOCOL:
- Use resolved protocol context.
- Do NOT invent hippocampal abnormality if none is supplied.

CONTRAST:
- Only say "no abnormal enhancement" if post-contrast imaging/findings exist in supplied context.
- For Plain / non-contrast studies, do NOT mention enhancement.`;
