/**
 * usgConsistency — deterministic report ⇄ impression consistency checks (P2.7).
 *
 * Advisory-only, never mutates the report. Each issue names the organ / field
 * so the radiologist can jump to it. High-signal, conservative checks only —
 * we would rather miss a subtle mismatch than cry wolf on a hand-written
 * impression. Pure and fully unit-testable.
 */

import { organStatus, type UsgOrganSection } from "./usgReportComposer";

export type ConsistencySeverity = "advisory" | "warning";

export interface ConsistencyIssue {
  code: string;
  severity: ConsistencySeverity;
  organ?: string;
  message: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// A finding contradicts a negating statement ONLY of the SAME entity — e.g. a
// calculus finding vs "no calculus". A renal-calculus finding legitimately says
// "No hydronephrosis is noted", so calculus is NOT mapped to a hydronephrosis
// negation.
const NEGATION_RULES: Array<{ findingType: RegExp; negations: RegExp }> = [
  { findingType: /calcul|nephrolith|cholelith/i, negations: /\bno\b[a-z ]*\bcalcul/i },
  { findingType: /hydronephrosis/i, negations: /\bno hydronephrosis\b/i },
];

export function checkReportConsistency(
  sections: UsgOrganSection[],
  impressionLines: string[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const impressionNorm = impressionLines.map(norm);
  const impressionAll = impressionNorm.join(" \n ");

  for (const s of sections) {
    const st = organStatus(s);
    const text = s.text ?? "";
    const textNorm = norm(text);

    // 1 — an abnormal finding's impression contribution is missing from Impression.
    for (const f of s.findings) {
      const line = norm(f.impressionText ?? "");
      if (line && !impressionNorm.some((l) => l.includes(line) || line.includes(l))) {
        issues.push({
          code: "abnormal_not_in_impression", severity: "advisory", organ: s.label,
          message: `${s.label}: "${f.findingType}" is in the findings but not reflected in the Impression.`,
        });
      }
      // 5 — surface the finding builder's own warnings (e.g. volume mismatch).
      for (const w of f.warnings ?? []) {
        issues.push({ code: "finding_warning", severity: "warning", organ: s.label, message: `${s.label}: ${w}` });
      }
    }

    // 2 — prose says "normal" while structured findings exist on the organ.
    if (s.findings.length > 0 && /\bnormal\b/.test(textNorm) && !/no (focal|significant)/.test(textNorm)) {
      // Only flag when the "normal" statement is the organ baseline, not a
      // qualifier like "normal wall thickness" inside a finding.
      if (/is normal in size|normally distended|is normal in echotexture/.test(textNorm)) {
        issues.push({
          code: "normal_wording_with_findings", severity: "warning", organ: s.label,
          message: `${s.label}: text contains a normal statement but the organ has ${s.findings.length} finding(s).`,
        });
      }
    }

    // 3 — negation in prose/impression contradicts an existing finding object.
    for (const f of s.findings) {
      for (const rule of NEGATION_RULES) {
        if (rule.findingType.test(f.findingType) && (rule.negations.test(text) || rule.negations.test(impressionAll))) {
          issues.push({
            code: "negation_conflict", severity: "warning", organ: s.label,
            message: `${s.label}: a "${f.findingType}" finding exists but a negating statement ("no calculus/hydronephrosis") is present.`,
          });
          break;
        }
      }
    }

    // 4 — status wording conflicts.
    if (st === "not_visualized" && /is normal|normally|no focal lesion/.test(textNorm)) {
      issues.push({ code: "not_visualized_described_normal", severity: "warning", organ: s.label,
        message: `${s.label}: marked not visualized but described as normal.` });
    }
    if (st === "surgically_absent" && /is normal|present|normally distended/.test(textNorm)) {
      issues.push({ code: "surgically_absent_described_present", severity: "warning", organ: s.label,
        message: `${s.label}: marked surgically absent but described as present/normal.` });
    }

    // 6 — laterality: a lateralised finding whose OPPOSITE side appears in the
    // impression while its own side does not. Conservative (advisory only).
    for (const f of s.findings) {
      const side = (f.laterality ?? "").toLowerCase();
      if (side === "right" && /\bleft\b/.test(impressionAll) && !/\bright\b/.test(impressionAll)) {
        issues.push({ code: "laterality_mismatch", severity: "advisory", organ: s.label,
          message: `${s.label}: finding is right-sided but the Impression mentions left.` });
      } else if (side === "left" && /\bright\b/.test(impressionAll) && !/\bleft\b/.test(impressionAll)) {
        issues.push({ code: "laterality_mismatch", severity: "advisory", organ: s.label,
          message: `${s.label}: finding is left-sided but the Impression mentions right.` });
      }
    }
  }

  return issues;
}

/** Convenience: does the report have any warning-level (not merely advisory) issue? */
export function hasBlockingConsistencyWarnings(issues: ConsistencyIssue[]): boolean {
  return issues.some((i) => i.severity === "warning");
}
