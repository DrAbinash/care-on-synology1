/**
 * AI Quality Check Service for USG/Doppler reports
 * Mandatory checklist before allowing finalization.
 */

import type { UsgMeasurement, UsgDopplerMeasurement } from "@workspace/db/schema";

export interface QualityCheckInput {
  draftContent: string;
  templateType: string;
  measurement?: UsgMeasurement | null;
  dopplerMeasurements?: UsgDopplerMeasurement[];
  patientName?: string | null;
  patientAge?: string | null;
  patientSex?: string | null;
  referringDoctor?: string | null;
  criticalAlertAcknowledged?: boolean; // if critical findings exist, are they handled?
}

export interface QualityCheckResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function runQualityCheck(input: QualityCheckInput): QualityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const c = input.draftContent;
  const lower = c.toLowerCase();

  // 1. Impression present
  if (!lower.includes("impression")) {
    errors.push("Report must contain an IMPRESSION section");
  } else {
    const impressionMatch = lower.match(/impression[:\s]+(.+)/s);
    if (!impressionMatch || impressionMatch[1].trim().length < 5) {
      errors.push("IMPRESSION section appears empty or too short");
    }
  }

  // 2. No empty findings (look for placeholder "___" in findings area)
  const findingsMatch = lower.match(/findings[:\s]+(.*?)(?=impression|$)/s);
  if (findingsMatch) {
    const findingsBlock = findingsMatch[1];
    const emptyLines = findingsBlock.split("\n").filter((l) => l.includes("___"));
    if (emptyLines.length > 3) {
      errors.push(`${emptyLines.length} empty placeholder(s) remain in FINDINGS — fill or remove them`);
    } else if (emptyLines.length > 0) {
      warnings.push(`${emptyLines.length} placeholder(s) still present in FINDINGS`);
    }
  }

  // 3. No left/right mismatch for paired organs
  const hasRight = lower.includes("right");
  const hasLeft = lower.includes("left");
  const hasPairedOrgan = lower.includes("kidney") || lower.includes("ovary") || lower.includes("testis");
  if (hasPairedOrgan) {
    if (hasRight && !hasLeft) {
      warnings.push("Only RIGHT side mentioned for paired organs — verify LEFT is intentionally omitted");
    } else if (hasLeft && !hasRight) {
      warnings.push("Only LEFT side mentioned for paired organs — verify RIGHT is intentionally omitted");
    }
  }

  // 4. No male/female anatomy mismatch
  if (input.patientSex) {
    const sex = input.patientSex.toLowerCase();
    if (sex === "male" && lower.includes("uterus")) {
      errors.push("Anatomy mismatch: uterus mentioned for a male patient");
    }
    if (sex === "male" && lower.includes("ovary")) {
      errors.push("Anatomy mismatch: ovary mentioned for a male patient");
    }
    if (sex === "female" && lower.includes("scrotum")) {
      errors.push("Anatomy mismatch: scrotum mentioned for a female patient");
    }
  }

  // 5. Measurements required for selected template are present
  const tpl = input.templateType;
  const obTemplates = ["OB_EARLY", "OB_GROWTH", "OB_ANOMALY"];
  if (obTemplates.includes(tpl)) {
    if (!input.measurement?.crl && !input.measurement?.bpd && !input.measurement?.fl) {
      warnings.push("OB template selected but no fetal biometry (CRL/BPD/FL) present");
    }
  }
  if (["PELVIS_FEMALE", "KUB", "WHOLE_ABDOMEN"].includes(tpl)) {
    if (!input.measurement?.rightKidney && !input.measurement?.leftKidney) {
      warnings.push("Abdominal/pelvic template selected but no kidney measurements present");
    }
  }
  if (["PROSTATE"].includes(tpl)) {
    if (!input.measurement?.prostateVolume) {
      warnings.push("Prostate template selected but no prostate volume present");
    }
  }
  if (["THYROID"].includes(tpl)) {
    if (!input.measurement?.thyroidNoduleSizeMm && lower.includes("nodule")) {
      warnings.push("Thyroid nodules referenced but no size/TIRADS entered");
    }
  }

  // 6. Critical findings are acknowledged or marked N/A
  if (lower.includes("critical") || lower.includes("urgent")) {
    if (!input.criticalAlertAcknowledged) {
      errors.push("Critical/urgent findings detected — acknowledge the alert or mark as N/A before finalizing");
    }
  }

  // 7. No contradiction between findings and impression
  // Simple heuristic: if findings say "normal" but impression says "abnormal" (or vice versa)
  const findingsNormal = /normal|no abnormality|unremarkable/.test(lower);
  const impressionNormal = /normal|no significant abnormality/.test(lower);
  const impressionAbnormal = /abnormal|pathology|lesion|mass|calculi|dilatation|enlarged|thickened/.test(lower);
  if (findingsNormal && impressionAbnormal && !impressionNormal) {
    warnings.push("FINDINGS describe everything as normal but IMPRESSION suggests abnormality — verify consistency");
  }

  // 8. Doctor/radiologist selected (via referringDoctor or content)
  if (!input.referringDoctor || input.referringDoctor.trim().length < 2) {
    warnings.push("No referring doctor listed — add referrer name if available");
  }

  // 9. Patient demographics complete
  if (!input.patientName || input.patientName.trim().length < 2) {
    errors.push("Patient name is missing or incomplete");
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
