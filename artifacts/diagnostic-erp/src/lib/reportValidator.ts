/**
 * reportValidator.ts — rule-based pre-finalize checks for radiology reports.
 *
 * WARN ONLY. The validator returns human-readable warnings shown to the
 * radiologist before finalize; it never blocks and never auto-corrects.
 * Rules are deliberately conservative (few false positives beat many).
 *
 * Pure, dependency-free, unit-tested (reportValidator.test.ts).
 */

export interface ReportForValidation {
  findings: string;
  impression: string[]; // one line per impression point
  recommendation?: string;
}

// Sentence split good enough for report prose (period/newline boundaries).
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12); // ignore tiny fragments like headings
}

const PATHOLOGY_WORDS = [
  "infarct", "hemorrhage", "tumor", "tumour", "lesion", "fracture", "stenosis",
  "compression", "bulge", "herniation", "collection", "edema", "oedema",
  "demyelination", "atrophy", "gliosis", "spondylodiscitis", "tuberculosis",
  "mass effect", "midline shift", "impingement",
];

const NORMAL_PHRASES = [
  "no significant abnormality", "normal study", "unremarkable study",
  "no focal parenchymal lesion",
];

export function validateReport(report: ReportForValidation): string[] {
  const warnings: string[] = [];
  const findings = report.findings || "";
  const impressionText = (report.impression || []).join("\n");
  const findingsLower = findings.toLowerCase();
  const impressionLower = impressionText.toLowerCase();

  // 1. Duplicate sentences inside Findings
  const seen = new Map<string, number>();
  for (const s of sentences(findings)) {
    const key = s.toLowerCase().replace(/\s+/g, " ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      warnings.push(`Duplicate sentence in Findings (appears ${count}×): "${key.slice(0, 70)}${key.length > 70 ? "…" : ""}"`);
    }
  }

  // 2. Duplicate impression lines
  const impSeen = new Set<string>();
  for (const line of report.impression || []) {
    const key = line.trim().toLowerCase();
    if (!key) continue;
    if (impSeen.has(key)) warnings.push(`Duplicate impression line: "${line.trim().slice(0, 70)}"`);
    impSeen.add(key);
  }

  // 3. "Normal study" contradiction: normal phrases + pathology words together
  const saysNormal = NORMAL_PHRASES.some((p) => findingsLower.includes(p) || impressionLower.includes(p));
  if (saysNormal) {
    const pathologyHit = PATHOLOGY_WORDS.find(
      (w) => findingsLower.includes(w) || impressionLower.includes(w),
    );
    if (pathologyHit) {
      warnings.push(`Possible contradiction: report contains a "normal study" phrase AND mentions "${pathologyHit}".`);
    }
  }

  // 4. Laterality consistency: a side named in Impression must appear in Findings
  const findingsLeft = /\bleft\b/i.test(findings);
  const findingsRight = /\bright\b/i.test(findings);
  const impLeft = /\bleft\b/i.test(impressionText);
  const impRight = /\bright\b/i.test(impressionText);
  if (impLeft && !findingsLeft && findingsRight) {
    warnings.push('Laterality check: Impression says "left" but Findings only mention "right".');
  }
  if (impRight && !findingsRight && findingsLeft) {
    warnings.push('Laterality check: Impression says "right" but Findings only mention "left".');
  }

  // 5. Pathology in Findings but Impression empty
  const hasPathology = PATHOLOGY_WORDS.some((w) => findingsLower.includes(w));
  const impressionEmpty = (report.impression || []).every((l) => !l.trim());
  if (hasPathology && impressionEmpty) {
    warnings.push("Findings describe pathology but the Impression section is empty.");
  }

  // 6. Un-filled measurement placeholders left in the text
  if (findings.includes("{value}") || impressionText.includes("{value}")) {
    warnings.push("An un-filled measurement placeholder {value} is still present in the report.");
  }

  return warnings;
}

// ── Report Quality Score (Phase 3) ───────────────────────────────────────────
// Live, warn-only completeness + consistency score shown in the workspace
// header. 100 = complete & consistent. Deductions are deliberately simple
// and explainable — each item in `issues` says exactly what to fix.

export interface QualityInput extends ReportForValidation {
  technique?: string;
  clinicalHistory?: string;
}

export interface QualityScore {
  score: number; // 0-100
  issues: string[];
}

export function computeQualityScore(input: QualityInput): QualityScore {
  const issues: string[] = [];
  let score = 100;

  const deduct = (points: number, reason: string) => {
    score -= points;
    issues.push(reason);
  };

  if (!(input.findings || "").trim()) deduct(30, "Findings section is empty.");
  if ((input.impression || []).every((l) => !l.trim())) deduct(25, "Impression section is empty.");
  if (!(input.technique || "").trim()) deduct(10, "Technique not documented.");
  if (!(input.clinicalHistory || "").trim()) deduct(5, "Clinical history not documented.");
  if (!(input.recommendation || "").trim()) deduct(5, "No recommendation/advice given.");

  // Consistency warnings from the validator each cost 5 points.
  const warnings = validateReport(input);
  for (const w of warnings) deduct(5, w);

  return { score: Math.max(0, score), issues };
}
