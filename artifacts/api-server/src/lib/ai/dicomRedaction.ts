/**
 * Whether identifiers were actually removed from what CARE sends to an AI
 * provider.
 *
 * This is a measured value, not a copy of the "Anonymize Patient Data"
 * setting. Two things travel and neither is treated: the prompt, which carries
 * whatever demographics the clinic has enabled, and the images, which are the
 * pixels as the scanner stored them. The PACS render adds no DICOM tags, but
 * text the modality burned into the picture — routine on ultrasound, where the
 * patient name sits in the corner — survives untouched. No code path scrubs a
 * prompt or masks a pixel today.
 *
 * Audit rows used to record the setting, or a literal `true`, which turned the
 * AI Audit Log into a positive record of a control that does not exist. Flip
 * this when real de-identification lands and the audit inserts need no change.
 */
export const DICOM_REDACTION_PERFORMED = false;
