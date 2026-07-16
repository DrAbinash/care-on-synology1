/**
 * usgCompanionAutoPopulate.ts — CARE USG Companion (Phase 2)
 *
 * DETERMINISTIC, non-destructive auto-population planner. Given the machine
 * measurements + the study's already-loaded template/protocol text + the
 * current (possibly hand-edited) report state, it produces a PLAN of blocks to
 * insert — it never mutates anything itself. The workspace applies the plan
 * through its EXISTING setters/merge primitives (handleAutoTechnique,
 * mergeBlock, handleUsgMeasurementInsert upsert), so there is no new report
 * engine and manual text is never overwritten.
 *
 * Safety guarantees encoded here:
 *   - Only high/medium-confidence measurements populate; low-confidence values
 *     are skipped (left blank) with an explicit reason — never invented.
 *   - Technique/Impression fill ONLY when the field is empty.
 *   - Findings-normals and Recommendation are dedupe-merged (re-run safe).
 *   - Nothing populates a finalized/locked report (the caller gates on that).
 *   - Every block carries its provenance kind so the UI can show what came from
 *     where (Machine Derived / Template Normal / Rule-based).
 *
 * Pure + alias-free (root-testable).
 */

export type PopulateSection = "technique" | "findings" | "impression" | "recommendation";
export type PopulateKind = "machine" | "template" | "rule" | "protocol";

export interface PopulateBlock {
  id: string;
  section: PopulateSection;
  kind: PopulateKind;
  /** The exact text this block contributes (for a measurement: "Label: value unit"). */
  text: string;
  label?: string;
  value?: string;
  unit?: string;
  field?: string;      // usg_measurements column — enables Trace linking
  confidence?: string;
  source?: string;
}

export interface AutoPopulateSkip {
  section: PopulateSection;
  label?: string;
  reason: string;
}

export interface AutoPopulatePlan {
  blocks: PopulateBlock[];
  eligible: boolean;
  reasons: string[];
  skipped: AutoPopulateSkip[];
}

export interface AutoPopulateMeasurement {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  field?: string;
  confidence: string;   // high | medium | low
  source: string;
  present: boolean;
}

export interface AutoPopulateInputs {
  measurementItems: AutoPopulateMeasurement[];
  techniqueText?: string | null;
  normalsText?: string | null;
  recommendationText?: string | null;
  /** Rule-based impression lines (e.g. from POST /api/radiology/smart/generate). */
  ruleImpressionLines?: string[];
  current: {
    technique: string;
    findings: string;
    impression: string[];
    recommendation: string;
  };
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Build the measurement sentence exactly as handleUsgMeasurementInsert stores it. */
export function measurementLine(label: string, value: string, unit?: string | null): string {
  const v = unit ? `${value} ${unit}` : value;
  return `${label}: ${v}`;
}

export function buildAutoPopulatePlan(input: AutoPopulateInputs): AutoPopulatePlan {
  const blocks: PopulateBlock[] = [];
  const skipped: AutoPopulateSkip[] = [];
  const reasons: string[] = [];
  const cur = input.current;

  const presentMeasurements = input.measurementItems.filter((m) => m.present && norm(m.value) !== "");
  const eligible = presentMeasurements.length > 0 || !!(input.normalsText && input.normalsText.trim());
  if (!eligible) {
    reasons.push("Not enough machine information to populate yet — waiting for approved measurements or a study template.");
    return { blocks, eligible, reasons, skipped };
  }

  // Technique — fill only when empty (never overwrite a written technique).
  if (input.techniqueText && input.techniqueText.trim()) {
    if (!cur.technique.trim()) {
      blocks.push({ id: "technique", section: "technique", kind: "template", text: input.techniqueText.trim() });
    } else {
      skipped.push({ section: "technique", reason: "Technique already written — left as is." });
    }
  }

  // Findings — baseline normals (dedupe-merged; safe to re-run).
  if (input.normalsText && input.normalsText.trim()) {
    const normalsText = input.normalsText.trim();
    if (norm(cur.findings).includes(norm(normalsText))) {
      skipped.push({ section: "findings", reason: "Baseline normals already present." });
    } else {
      blocks.push({ id: "findings-normals", section: "findings", kind: "template", text: normalsText });
    }
  }

  // Findings — machine measurements (high/medium confidence only; low = skip/blank).
  for (const m of presentMeasurements) {
    if (norm(m.confidence) === "low") {
      skipped.push({ section: "findings", label: m.label, reason: "Low-confidence value — verify and enter manually." });
      continue;
    }
    blocks.push({
      id: `meas:${m.key}`,
      section: "findings",
      kind: "machine",
      text: measurementLine(m.label, m.value, m.unit),
      label: m.label,
      value: m.value,
      unit: m.unit ?? undefined,
      field: m.field,
      confidence: m.confidence,
      source: m.source,
    });
  }

  // Impression — RULE-BASED ONLY. Fill only when empty and a rule actually fired.
  const ruleLines = (input.ruleImpressionLines ?? []).map((l) => l.trim()).filter(Boolean);
  if (ruleLines.length > 0) {
    if (cur.impression.filter(Boolean).length === 0) {
      ruleLines.forEach((line, i) =>
        blocks.push({ id: `impr:${i}`, section: "impression", kind: "rule", text: line }));
    } else {
      skipped.push({ section: "impression", reason: "Impression already written — left for the radiologist." });
    }
  } else {
    skipped.push({ section: "impression", reason: "No impression rule matched — left blank (never invented)." });
  }

  // Recommendation — protocol default (dedupe-merged).
  if (input.recommendationText && input.recommendationText.trim()) {
    const recText = input.recommendationText.trim();
    if (norm(cur.recommendation).includes(norm(recText))) {
      skipped.push({ section: "recommendation", reason: "Recommendation already present." });
    } else {
      blocks.push({ id: "recommendation", section: "recommendation", kind: "protocol", text: recText });
    }
  }

  reasons.push(`${presentMeasurements.length} machine measurement(s) available; ${blocks.length} section(s) to populate.`);
  return { blocks, eligible, reasons, skipped };
}

// ── Provenance status (Imported / Machine / Template / Rule / Manual / Edited) ──
// After population, derive whether each block's text is still present verbatim
// (kept), altered (edited), or gone (removed) in the current report field.

export type BlockStatus = "present" | "edited" | "removed";

export interface BlockProvenance extends PopulateBlock {
  status: BlockStatus;
}

/** Current field text for a given section (impression joined by newline). */
function fieldText(section: PopulateSection, current: AutoPopulateInputs["current"]): string {
  switch (section) {
    case "technique": return current.technique;
    case "findings": return current.findings;
    case "impression": return current.impression.join("\n");
    case "recommendation": return current.recommendation;
  }
}

export function blockStatus(block: PopulateBlock, current: AutoPopulateInputs["current"]): BlockStatus {
  const field = norm(fieldText(block.section, current));
  if (field.includes(norm(block.text))) return "present";
  // For a measurement, the label lingering with a different value = edited.
  if (block.label && field.includes(norm(block.label))) return "edited";
  if (!block.label && block.value && field.includes(norm(block.value))) return "edited";
  return "removed";
}

export function deriveProvenance(blocks: PopulateBlock[], current: AutoPopulateInputs["current"]): BlockProvenance[] {
  return blocks.map((b) => ({ ...b, status: blockStatus(b, current) }));
}

/** Count how many populated blocks the radiologist subsequently changed/removed. */
export function countEdits(blocks: PopulateBlock[], current: AutoPopulateInputs["current"]): number {
  return blocks.reduce((n, b) => (blockStatus(b, current) === "present" ? n : n + 1), 0);
}
