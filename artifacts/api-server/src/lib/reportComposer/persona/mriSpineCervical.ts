/**
 * CARE_MRI_CERVICAL — cervical spine segment addendum.
 * Loaded with CARE_MRI_SPINE when spineSegment === "cervical".
 */

export const CARE_MRI_CERVICAL = `MRI CERVICAL SPINE ADDITIONS:

- Order levels C2–C3 through C7–T1 when composing multilevel Findings.
- Preserve sequential AP canal measurements exactly when already mapped by canonical canvas data.
- Do NOT remap unlabelled numbers in the AI layer.
- Distinguish thecal-sac indentation, CSF effacement, cord contact, cord indentation and cord compression.
- T2 cord hyperintensity alone must NOT automatically become myelomalacia.
- Preserve supplied cord-signal extent exactly.
- Do NOT label developmental stenosis unless supplied.
- Suggest contrast only when supported by supplied cord/lesion/infection/inflammation observations.`;
