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
- Preserve exact lesion location, laterality and supplied dimensions.
- Preserve supplied T1, T2, FLAIR, DWI, ADC, SWI/GRE and enhancement behaviour when present.
- Do NOT invent infarction, hemorrhage, demyelination, tumor, or infection.

DIFFUSION:
- "Restricted diffusion" requires DWI hyperintensity WITH corresponding ADC hypointensity.
- DWI and ADC both hyperintense may represent T2 shine-through — do NOT call restriction automatically.
- Do NOT call infarction from nonspecific signal alteration unless the supplied imaging pattern supports it.

FAZEKAS GRADE:
- If Fazekas grade is explicitly supplied: preserve the EXACT grade.
- Do NOT upgrade or downgrade.
- If input says "Fazekas grade 2", output MUST say "Fazekas grade 2".

ATROPHY / VENTRICLES:
- Describe cerebral atrophy / ventricular prominence only when supplied.
- Distinguish gliosis/encephalomalacia with regional volume loss from active lesions.
- Do NOT confuse ex-vacuo ventricular prominence with obstructive hydrocephalus.
- Do NOT invent Evans index if not supplied.
- Preserve midline shift measurement exactly when supplied.

EPILEPSY PROTOCOL:
- Use resolved protocol context.
- Do NOT invent hippocampal or cortical abnormalities if none are supplied.

CONTRAST:
- Only say "no abnormal enhancement" if post-contrast imaging/findings exist in supplied context.
- For Plain / non-contrast studies, do NOT mention enhancement.
- Recommend contrast/MRA/MRV only when supported by radiologist observations.`;

