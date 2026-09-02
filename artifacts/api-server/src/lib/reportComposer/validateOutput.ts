/**
 * Validate composer output: no invented pathology; recommendation optional.
 *
 * PR P0-3 (#657): strengthened with laterality-swap, level-change, and
 * severity-escalation detection. These are deterministic regex-based checks
 * — NOT a new NLP engine. They catch the most dangerous hallucination
 * patterns (right→left, L4-L5→L3-L4, mild→severe) without fragile
 * complexity.
 */
import type { ComposerDraftOutput, ComposerInputSnapshot, ComposeObservation } from "./types";

export type ComposeValidationResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  unsupportedMentions: string[];
  /** PR #657: detected laterality swaps (right in input, left in output, etc.) */
  lateralitySwaps: string[];
  /** PR #657: detected level changes (L4-L5 in input, L3-L4 in output, etc.) */
  levelChanges: string[];
  /** PR #657: detected severity escalations (mild in input, severe in output) */
  severityEscalations: string[];
};

const ABNORMALITY_HINTS = [
  "hemorrhage",
  "haemorrhage",
  "infarct",
  "infarction",
  "fracture",
  "malignancy",
  "metastasis",
  "abscess",
  "dissection",
  "embolism",
  "thrombosis",
  "stenosis",
  "herniation",
  "cord compression",
  "disc bulge",
  "disc herniation",
  "protrusion",
  "extrusion",
  "desiccation",
  "facet hypertrophy",
  "ligamentum flavum",
  "fazekas",
  "gliosis",
  "ventriculomegaly",
  "modic",
];

// PR #657: laterality tokens. We check whether a laterality that appears in
// input gets swapped to the opposite in output.
const LATERALITY_PAIRS: Array<[string, string]> = [
  ["right", "left"],
  ["left", "right"],
  ["bilateral", "unilateral"],
  ["unilateral", "bilateral"],
];

// PR #657: spinal level regex. Matches L3-L4, L4-L5, C5-C6, D7-D8, etc.
const LEVEL_RE = /\b([LCDFST])\d{1,2}-([LCDFST])\d{1,2}\b/gi;

// PR #657: severity tokens. We check whether a milder severity in input gets
// escalated to a more severe one in output.
const SEVERITY_ESCALATIONS: Array<[string, string]> = [
  ["mild", "severe"],
  ["mild", "moderate"],
  ["moderate", "severe"],
  ["minimal", "severe"],
  ["minimal", "moderate"],
];

function groundedCorpus(snapshot: ComposerInputSnapshot): string {
  const parts = [
    snapshot.findings,
    snapshot.impression,
    snapshot.recommendation,
    snapshot.clinicalHistory,
    ...(snapshot.observations ?? []).map((o: ComposeObservation) =>
      [o.concept, o.findingsText, o.impressionText ?? ""].join(" "),
    ),
  ];
  return parts.join("\n").toLowerCase();
}

/**
 * Extract all laterality tokens from a text (case-insensitive).
 * Returns a Set of normalized tokens: "right", "left", "bilateral", "unilateral".
 */
function extractLateralityTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  for (const pair of LATERALITY_PAIRS) {
    for (const t of pair) {
      // Word-boundary match to avoid matching "right" inside "brightness".
      const re = new RegExp(`\\b${t}\\b`, "gi");
      if (re.test(lower)) tokens.add(t);
    }
  }
  return tokens;
}

/**
 * Extract all spinal levels from a text (e.g. L3-L4, L4-L5, C5-C6).
 * Returns a Set of normalized uppercase levels.
 */
function extractLevels(text: string): Set<string> {
  const levels = new Set<string>();
  const matches = text.matchAll(LEVEL_RE);
  for (const m of matches) {
    if (m[0]) levels.add(m[0].toUpperCase());
  }
  return levels;
}

/**
 * Check for laterality swaps between input and output.
 *
 * A swap is flagged when the output contains a laterality token that is the
 * OPPOSITE of a token present in the input, AND the input's token does NOT
 * appear in the output.
 *
 * Example: input has "right infarct", output has "left infarct" and NOT "right"
 * → flagged as a right→left swap.
 */
function detectLateralitySwaps(inputCorpus: string, outputText: string): string[] {
  const swaps: string[] = [];
  const inputTokens = extractLateralityTokens(inputCorpus);
  const outputTokens = extractLateralityTokens(outputText);
  for (const [a, b] of LATERALITY_PAIRS) {
    if (inputTokens.has(a) && outputTokens.has(b) && !outputTokens.has(a)) {
      swaps.push(`${a}→${b}`);
    }
  }
  return swaps;
}

/**
 * Check for spinal level changes between input and output.
 *
 * A level change is flagged when the output contains a level that was NOT
 * present in the input. This catches "L4-L5 in input → L3-L4 in output"
 * hallucinations.
 */
function detectLevelChanges(inputCorpus: string, outputText: string): string[] {
  const inputLevels = extractLevels(inputCorpus);
  const outputLevels = extractLevels(outputText);
  const changes: string[] = [];
  for (const ol of outputLevels) {
    if (!inputLevels.has(ol)) {
      changes.push(ol);
    }
  }
  return changes;
}

/**
 * Check for severity escalations between input and output.
 *
 * An escalation is flagged when the input contains a milder severity and the
 * output contains a more severe one (and the milder one is NOT in the output).
 *
 * Example: input "mild disc bulge" → output "severe disc bulge" (and no "mild")
 * → flagged as mild→severe escalation.
 */
function detectSeverityEscalations(inputCorpus: string, outputText: string): string[] {
  const escalations: string[] = [];
  for (const [mild, severe] of SEVERITY_ESCALATIONS) {
    const inputHasMild = new RegExp(`\\b${mild}\\b`, "i").test(inputCorpus);
    const outputHasSevere = new RegExp(`\\b${severe}\\b`, "i").test(outputText);
    const outputHasMild = new RegExp(`\\b${mild}\\b`, "i").test(outputText);
    if (inputHasMild && outputHasSevere && !outputHasMild) {
      escalations.push(`${mild}→${severe}`);
    }
  }
  return escalations;
}

/**
 * Flag abnormality terms that appear in AI output but nowhere in radiologist-supplied input.
 *
 * PR #657: also detects laterality swaps, level changes, and severity escalations.
 */
export function validateComposerOutput(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
): ComposeValidationResult {
  const warnings: string[] = [...(draft.warnings ?? [])];
  const errors: string[] = [];
  const unsupportedMentions: string[] = [];
  const lateralitySwaps: string[] = [];
  const levelChanges: string[] = [];
  const severityEscalations: string[] = [];
  const corpus = groundedCorpus(snapshot);
  const output = [draft.findings, draft.impression, draft.recommendation].join("\n").toLowerCase();

  if (!draft.findings.trim() && !draft.impression.trim()) {
    errors.push("empty_output");
  }

  for (const hint of ABNORMALITY_HINTS) {
    if (output.includes(hint) && !corpus.includes(hint)) {
      unsupportedMentions.push(hint);
    }
  }

  if (unsupportedMentions.length > 0) {
    errors.push("unsupported_abnormality");
    warnings.push(
      `AI mentioned terms not grounded in supplied observations: ${unsupportedMentions.join(", ")}`,
    );
  }

  // PR #657: laterality swap detection.
  // PR #657 hardening: these global regex heuristics are ADVISORY WARNINGS
  // only, NOT hard blocking errors. In multi-finding reports a legitimate
  // right-sided finding + separate left-sided finding can trigger a false
  // positive. We do NOT let these heuristics become hard blocking clinical
  // errors unless a future slot-specific deterministic mapping can prove
  // the conflict. The system-prompt safety rules remain the primary guard.
  lateralitySwaps.push(...detectLateralitySwaps(corpus, output));
  if (lateralitySwaps.length > 0) {
    warnings.push(`AI may have swapped laterality (advisory): ${lateralitySwaps.join(", ")}`);
  }

  // PR #657: level change detection.
  // PR #657 hardening: advisory warning only — a new level in the output may
  // be a legitimate additional finding, not necessarily a mutation of an
  // existing one. The system-prompt safety rules remain the primary guard.
  levelChanges.push(...detectLevelChanges(corpus, output));
  if (levelChanges.length > 0) {
    warnings.push(`AI may have introduced levels not in input (advisory): ${levelChanges.join(", ")}`);
  }

  // PR #657: severity escalation detection.
  // PR #657 hardening: advisory warning only — a mild finding at one level
  // + a severe finding at another is legitimate. The system-prompt safety
  // rules remain the primary guard.
  severityEscalations.push(...detectSeverityEscalations(corpus, output));
  if (severityEscalations.length > 0) {
    warnings.push(`AI may have escalated severity (advisory): ${severityEscalations.join(", ")}`);
  }

  // Recommendation should stay empty unless input supports it (history/findings mention follow-up cues)
  if (draft.recommendation.trim()) {
    const support =
      /follow[\s-]?up|recommend|suggest|correlate|further|clinical correlation/i.test(corpus) ||
      (unsupportedMentions.length === 0 && lateralitySwaps.length === 0 && levelChanges.length === 0 && severityEscalations.length === 0);
    if (!support) {
      warnings.push("recommendation_not_clearly_supported");
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    unsupportedMentions,
    lateralitySwaps,
    levelChanges,
    severityEscalations,
  };
}
