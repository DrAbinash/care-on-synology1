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
    snapshot.technique,
    ...(snapshot.observations ?? []).map((o: ComposeObservation) =>
      [o.concept, o.findingsText, o.impressionText ?? "", o.recommendationText ?? ""].join(" "),
    ),
  ];
  return parts.join("\n").toLowerCase();
}

const MEASUREMENT_TOKEN_RE = /\b\d+(?:\.\d+)?\s*(?:mm|cm|ml|cc|hu)\b/gi;
const FILLER_RECOMMENDATION_RE =
  /^(please\s+)?(clinical\s+correlation(\s+is)?\s+advised\.?|correlate\s+clinically\.?|clinical\s+correlation\.?)$/i;

function extractMeasurementTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(MEASUREMENT_TOKEN_RE)) {
    if (m[0]) out.add(m[0].toLowerCase().replace(/\s+/g, ""));
  }
  return out;
}

function detectMissingMeasurements(inputCorpus: string, outputText: string): string[] {
  const input = extractMeasurementTokens(inputCorpus);
  const output = extractMeasurementTokens(outputText);
  const missing: string[] = [];
  for (const t of input) {
    if (!output.has(t)) missing.push(t);
  }
  return missing;
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

function slotKey(o: ComposeObservation): string {
  const norm = (s: string | null | undefined) =>
    (s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().toLowerCase();
  return `${norm(o.region)}|${norm(o.concept)}|${norm(o.level)}|${norm(o.laterality)}`;
}

function oppositeLaterality(lat: string): string | null {
  const l = lat.toLowerCase();
  if (l === "right") return "left";
  if (l === "left") return "right";
  return null;
}

/**
 * Definite (hard-fail) clinical mutations using canonical observation slots.
 * Returns only unambiguous cases; ambiguous multi-lesion stays advisory-only.
 */
export function detectDefiniteClinicalMutations(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const observations = snapshot.observations ?? [];
  const output = [draft.findings, draft.impression, draft.recommendation].join("\n");
  const outputLower = output.toLowerCase();
  const scaffold = [snapshot.findings, snapshot.impression, snapshot.technique].join("\n");
  const suppliedLevels = new Set<string>();
  for (const lv of extractLevels(
    [
      scaffold,
      ...observations.map((o) => [o.level, o.findingsText, o.impressionText].filter(Boolean).join(" ")),
    ].join("\n"),
  )) {
    suppliedLevels.add(lv);
  }

  // 1) Unique supplied measurement disappears or changes
  const inputMeasurements = extractMeasurementTokens(
    [
      scaffold,
      ...observations.map((o) => [o.findingsText, o.impressionText].filter(Boolean).join(" ")),
    ].join("\n"),
  );
  const outputMeasurements = extractMeasurementTokens(output);
  if (inputMeasurements.size === 1) {
    const only = [...inputMeasurements][0]!;
    if (!outputMeasurements.has(only)) {
      errors.push("measurement_mutation");
      warnings.push(`Unique supplied measurement '${only}' was dropped or changed.`);
    }
  } else if (inputMeasurements.size > 1) {
    // Multiple measurements: hard-fail only when ALL unique tokens from a single
    // observation slot disappear; otherwise remain advisory (handled elsewhere).
    for (const o of observations) {
      const obsTokens = extractMeasurementTokens(
        [o.findingsText, o.impressionText ?? ""].join(" "),
      );
      if (obsTokens.size !== 1) continue;
      const tok = [...obsTokens][0]!;
      // Unique across entire input?
      let count = 0;
      for (const t of inputMeasurements) if (t === tok) count += 1;
      // extractMeasurementTokens is a Set so uniqueness is global
      const appearsInOther = observations.some((other) => {
        if (other === o) return false;
        return extractMeasurementTokens(
          [other.findingsText, other.impressionText ?? ""].join(" "),
        ).has(tok);
      });
      if (!appearsInOther && !outputMeasurements.has(tok)) {
        // Only hard-fail if this was the sole occurrence of this measurement token
        // and the slot is uniquely identifiable.
        const sameConcept = observations.filter((x) => slotKey(x) === slotKey(o));
        if (sameConcept.length === 1) {
          errors.push("measurement_mutation");
          warnings.push(`Supplied measurement '${tok}' for slot ${slotKey(o)} was dropped or changed.`);
        }
      }
    }
  }

  // 2) Single-observation right↔left swap (definite)
  const lateralityObs = observations.filter(
    (o) => o.laterality && /^(right|left)$/i.test(o.laterality.trim()),
  );
  if (lateralityObs.length === 1) {
    const o = lateralityObs[0]!;
    const from = o.laterality!.trim().toLowerCase();
    const to = oppositeLaterality(from);
    if (to) {
      const outputHasTo = new RegExp(`\\b${to}\\b`, "i").test(outputLower);
      const outputHasFrom = new RegExp(`\\b${from}\\b`, "i").test(outputLower);
      if (outputHasTo && !outputHasFrom) {
        errors.push("laterality_swap");
        warnings.push(`Definite laterality swap detected: ${from}→${to}.`);
      }
    }
  }

  // 3) Output spinal level absent from all supplied observations/scaffold
  const outputLevels = extractLevels(output);
  const introduced = [...outputLevels].filter((lv) => !suppliedLevels.has(lv));
  if (introduced.length > 0 && suppliedLevels.size > 0) {
    errors.push("level_change");
    warnings.push(
      `Output spinal level absent from supplied observations/scaffold: ${introduced.join(", ")}.`,
    );
  }

  // 4) mild→severe / moderate→severe within the same canonical observation slot
  for (const o of observations) {
    const sev = (o.severity ?? "").trim().toLowerCase();
    if (!sev) continue;
    const sameSlotPeers = observations.filter((x) => slotKey(x) === slotKey(o));
    if (sameSlotPeers.length !== 1) continue; // ambiguous multi-slot
    for (const [mild, severe] of [
      ["mild", "severe"],
      ["moderate", "severe"],
      ["minimal", "severe"],
    ] as const) {
      if (sev !== mild) continue;
      const level = (o.level ?? "").trim();
      const concept = (o.concept ?? "").trim();
      // Require the severe token near the same level/concept in output, and
      // the original mild severity for this slot to be absent.
      const severeNearSlot = level
        ? new RegExp(`${severe}[\\s\\S]{0,40}${level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]{0,40}${severe}`, "i")
        : new RegExp(`\\b${severe}\\b`, "i");
      const mildPresent = new RegExp(`\\b${mild}\\b`, "i").test(outputLower);
      if (severeNearSlot.test(output) && !mildPresent) {
        // If another observation already supplies `severe` at a different slot, skip (not definite).
        const otherSevere = observations.some(
          (x) => slotKey(x) !== slotKey(o) && (x.severity ?? "").toLowerCase() === severe,
        );
        if (!otherSevere) {
          errors.push("severity_escalation");
          warnings.push(
            `Definite severity escalation in slot ${slotKey(o)}: ${mild}→${severe}` +
              (concept ? ` (${concept})` : "") +
              ".",
          );
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Flag abnormality terms that appear in AI output but nowhere in radiologist-supplied input.
 *
 * PR #657: also detects laterality swaps, level changes, and severity escalations.
 * Draft-composer hardening: measurement drop advisories, screening wording,
 * filler recommendation clearing, impression grounding.
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

  // Advisory heuristics (multi-finding false positives possible) — keep warnings.
  lateralitySwaps.push(...detectLateralitySwaps(corpus, output));
  if (lateralitySwaps.length > 0) {
    warnings.push(`AI may have swapped laterality (advisory): ${lateralitySwaps.join(", ")}`);
  }

  levelChanges.push(...detectLevelChanges(corpus, output));
  if (levelChanges.length > 0) {
    warnings.push(`AI may have introduced levels not in input (advisory): ${levelChanges.join(", ")}`);
  }

  severityEscalations.push(...detectSeverityEscalations(corpus, output));
  if (severityEscalations.length > 0) {
    warnings.push(`AI may have escalated severity (advisory): ${severityEscalations.join(", ")}`);
  }

  const missingMeasurements = detectMissingMeasurements(corpus, output);
  if (missingMeasurements.length > 0) {
    warnings.push(`AI may have dropped measurements (advisory): ${missingMeasurements.join(", ")}`);
  }

  // ── Definite clinical mutations → hard-block READY ─────────────────────
  // Conservative: only hard-fail when correlation is unambiguous via canonical
  // observation slots (region|concept|level|laterality). Bilateral / multilevel
  // / multi-lesion ambiguity remains advisory (warnings above).
  const definite = detectDefiniteClinicalMutations(snapshot, draft);
  for (const e of definite.errors) {
    if (!errors.includes(e)) errors.push(e);
  }
  for (const w of definite.warnings) warnings.push(w);

  const hasScreening = (snapshot.regions ?? []).some((r) => /screening/i.test(r))
    || /screening/i.test(snapshot.protocol ?? "")
    || /screening/i.test(snapshot.reportTitle ?? "");
  if (hasScreening) {
    const draftFindingsLower = draft.findings.toLowerCase();
    const techAndFindings = `${snapshot.technique}\n${draft.findings}`.toLowerCase();
    const hasLimitedWording = /limited[\s-]*(planar|sequence)/i.test(techAndFindings);
    const claimsFullWholeSpine = /multiplanar\s+multisequence.*whole\s+spine|whole\s+spine\s+mri/i.test(
      draftFindingsLower,
    );
    // Warn when draft Findings describe screening as a full diagnostic whole-spine
    // study, even if Technique already carries limited-sequence wording.
    if (claimsFullWholeSpine && (!hasLimitedWording || /whole\s+spine\s+mri/i.test(draftFindingsLower))) {
      warnings.push("screening_wording_may_be_missing");
    }
  }

  if (draft.recommendation.trim()) {
    if (FILLER_RECOMMENDATION_RE.test(draft.recommendation.trim())) {
      draft.recommendation = "";
      warnings.push("filler_recommendation_cleared");
    } else {
      const support =
        /follow[\s-]?up|recommend|suggest|further|mri|ct|repeat|correlation/i.test(corpus)
        || (snapshot.observations ?? []).some((o) => (o.recommendationText ?? "").trim().length > 0);
      if (!support) {
        warnings.push("recommendation_not_clearly_supported");
      }
    }
  }

  if (draft.impression.trim() && unsupportedMentions.length === 0) {
    const impLower = draft.impression.toLowerCase();
    const grounded = groundedCorpus({
      ...snapshot,
      findings: `${snapshot.findings}\n${draft.findings}`,
    });
    for (const hint of ABNORMALITY_HINTS) {
      if (impLower.includes(hint) && !grounded.includes(hint)) {
        errors.push("impression_ungrounded");
        warnings.push(`Impression mentions '${hint}' not grounded in Findings/observations`);
        break;
      }
    }
  }

  // Selected-image assisted mode hardening
  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    const selectedCount = (snapshot.selectedKeyImages ?? []).length;
    if (selectedCount === 0) {
      errors.push("selected_images_empty");
      warnings.push("Selected-image mode was requested but no key images were selected.");
    }
    const claimsComplete =
      /complete\s+(mri|study|examination)|entire\s+(mri|study)|full\s+mri\s+dataset|reviewed\s+the\s+entire/i.test(
        output,
      );
    if (claimsComplete) {
      errors.push("selected_images_claimed_complete_review");
      warnings.push("Selected-image draft claimed complete MRI review — blocked.");
    }
    if (
      /\brestricted\s+diffusion\b|\bdiffusion\s+restriction\b/i.test(output) &&
      !/\badc\b/i.test(corpus)
    ) {
      errors.push("unsupported_diffusion_restriction");
      warnings.push("Diffusion restriction claimed without ADC evidence in observations.");
    }
    if (
      /\bno\s+abnormal\s+enhancement\b|\bno\s+abnormal\s+contrast\s+enhancement\b/i.test(output) &&
      !/\benhanc|post[\s-]?contrast|gadolinium/i.test(corpus)
    ) {
      errors.push("unsupported_enhancement_claim");
      warnings.push("Enhancement claim without post-contrast evidence in observations.");
    }
    if (/\bmyelomalacia\b/i.test(output) && !/\bmyelomalacia\b/i.test(corpus)) {
      errors.push("unsupported_myelomalacia");
      warnings.push("Myelomalacia claimed without a supporting observation.");
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
