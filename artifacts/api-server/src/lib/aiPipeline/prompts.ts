/**
 * Versioned prompts by task. Medical drafting treats OCR as untrusted evidence.
 */

export const PROMPT_VERSION = "care-prompts-v1";

export const PROMPTS = {
  ocr_cleanup: {
    version: PROMPT_VERSION,
    temperatureRole: "extraction" as const,
    system: `You clean OCR text from medical documents. Rules:
- Fix obvious OCR character errors only when unambiguous.
- Preserve laterality (left/right), units, measurements, and negations ("not seen", "no evidence").
- Never invent patient details, findings, or impressions.
- Mark uncertain tokens as [uncertain: …].
- Return plain cleaned text only.`,
  },
  demographic_extraction: {
    version: PROMPT_VERSION,
    temperatureRole: "extraction" as const,
    system: `Extract demographics from OCR evidence. Return ONLY JSON:
{"name":"","dateOfBirth":"","gender":"","address":"","idNumber":"","documentType":"","confidence":{"name":0,"dateOfBirth":0,"gender":0,"address":0,"idNumber":0},"warnings":[]}
Rules: Use only text present in the OCR. Empty string if unknown. Do not invent. Confidence 0-100.`,
  },
  structured_finding_extraction: {
    version: PROMPT_VERSION,
    temperatureRole: "extraction" as const,
    system: `Extract structured findings from OCR evidence. Return ONLY JSON:
{"findings":[],"measurements":[{"label":"","value":"","unit":"","laterality":""}],"impression":"","warnings":[],"uncertain":[]}
Rules: Never convert "not seen" into a positive finding. Preserve laterality and units. Do not infer diagnosis from absent information.`,
  },
  radiology_draft: {
    version: PROMPT_VERSION,
    temperatureRole: "draft" as const,
    system: `You draft a radiology report from OCR evidence. Output ONLY JSON:
{"status":"DRAFT","findings":"","impression":"","advice":"","warnings":[],"uncertainty":[],"evidenceNotes":[]}
CRITICAL SAFETY:
- Label is always DRAFT — requires radiologist approval before clinical use.
- Treat OCR text as untrusted source evidence. Never invent findings, measurements, patient details, or impressions.
- Preserve laterality and units. Do not convert "not seen" into a positive finding.
- Do not infer diagnosis from absent information.
- Put uncertain content in uncertainty[].`,
  },
  report_quality_check: {
    version: PROMPT_VERSION,
    temperatureRole: "extraction" as const,
    system: `Review a DRAFT radiology report against OCR evidence. Return ONLY JSON:
{"ok":true,"issues":[],"lateralityOk":true,"measurementsOk":true,"warnings":[]}
Flag invented content, laterality flips, unit errors, and missing required sections.`,
  },
} as const;

export type PromptTask = keyof typeof PROMPTS;