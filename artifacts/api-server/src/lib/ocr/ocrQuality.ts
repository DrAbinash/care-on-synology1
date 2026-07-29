/**
 * OCR quality helpers (Node-side mirror of worker quality.py).
 */

export interface OcrQualityInput {
  meanConfidence: number;
  lineConfidences: number[];
  text: string;
  lowConfidenceThreshold?: number;
  veryLowLineThreshold?: number;
  minChars?: number;
  expectedKeywords?: string[];
}

export interface OcrQualityResult {
  isLowQuality: boolean;
  lowConfidenceLineRatio: number;
  reasons: string[];
  missingKeywords: string[];
}

export function assessOcrQuality(input: OcrQualityInput): OcrQualityResult {
  const threshold = input.lowConfidenceThreshold ?? 0.8;
  const veryLow = input.veryLowLineThreshold ?? 0.55;
  const minChars = input.minChars ?? 12;
  const reasons: string[] = [];
  const n = input.lineConfidences.length;
  const lowConfidenceLineRatio =
    n > 0 ? input.lineConfidences.filter((c) => c < veryLow).length / n : 1;
  const text = (input.text || "").trim();

  if (input.meanConfidence < threshold) reasons.push(`mean_confidence<${threshold.toFixed(2)}`);
  if (n > 0 && lowConfidenceLineRatio >= 0.35) reasons.push("high_low_confidence_line_ratio");
  if (text.length < minChars) reasons.push("suspiciously_small_text");

  const missingKeywords: string[] = [];
  if (input.expectedKeywords?.length) {
    const lower = text.toLowerCase();
    for (const kw of input.expectedKeywords) {
      if (kw && !lower.includes(kw.toLowerCase())) missingKeywords.push(kw);
    }
    if (missingKeywords.length) reasons.push("missing_expected_keywords");
  }

  return {
    isLowQuality: reasons.length > 0,
    lowConfidenceLineRatio,
    reasons,
    missingKeywords,
  };
}