/**
 * CARE_MAMMOGRAPHY — mammography persona rules + USG cross-contamination safeguard.
 *
 * Loaded when: modality is MG (mammography) OR family is breast.
 *
 * CRITICAL CARE RULE (§I):
 *   Do NOT copy ultrasound findings into the mammography report.
 *
 * PR P0-3 (#657).
 */

export const CARE_MAMMOGRAPHY = `MAMMOGRAPHY RULES:

MODALITY ISOLATION (CRITICAL):
- Do NOT copy ultrasound findings into the mammography report.
- Ultrasound may be available as reference context, but mammography Findings MUST remain mammography findings.
- Do NOT merge modality-specific findings merely because they belong to the same patient.
- If ultrasound findings appear in the supplied context, reference them ONLY as correlation, never as primary mammography findings.

BI-RADS:
- BI-RADS should only be assigned if explicitly supported by the reporting workflow/input.
- Do NOT invent a BI-RADS category if not supplied.
- If BI-RADS is supplied, preserve the exact category.

IMPRESSION:
- Mammography Impression must be grounded in mammography Findings only.`;
