/**
 * Whether identifiers were actually removed from what CARE sends to an AI
 * provider.
 *
 * This is a measured value, not a copy of the "Anonymize Patient Data"
 * setting: that setting only prepends a sentence to the prompt, while the
 * images themselves come from the PACS as rendered JPEGs with the overlay text
 * (patient name, ID, date of birth) composited into the pixels. No code path
 * strips a DICOM tag or masks a pixel today.
 *
 * Audit rows used to record the setting, or a literal `true`, which turned the
 * AI Audit Log into a positive record of a control that does not exist. Flip
 * this when real de-identification lands and the audit inserts need no change.
 */
export const DICOM_REDACTION_PERFORMED = false;
