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
import { isPreservingComposeKind } from "./types";

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
  /**
   * Present when the job kind carries the preservation contract: what the
   * radiologist wrote that the proposal does not contain.
   */
  conservation?: ConservationLosses;
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
  // mra/mrv §21: the vascular conclusions an AI proposal is not allowed to introduce on
  // its own. Each of these is a diagnosis a radiologist must select, so a composed report
  // that mentions one without support in the input is flagged rather than signed.
  "aneurysm",
  "aneurysmal",
  "rupture",
  "ruptured",
  "occlusion",
  "occlusive",
  "thrombus",
  "cvst",
  "dural venous sinus",
  "moyamoya",
  // §18/§21: the pattern is not the diagnosis, so a report that says "disease" when the
  // observations only described a pattern is treated as ungrounded.
  "moyamoya disease",
  "avm",
  "arteriovenous malformation",
  "nidus",
  "draining vein",
  "vasospasm",
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

/**
 * The same clinical fact, written in the other spelling. CARE's templates dictate
 * "haemorrhage" and a model trained on both writes "hemorrhage"; the groundedness
 * test is a substring match, so a faithful professionalisation of a brain report
 * was blocked as an invented abnormality — `hemorrhage` appeared in the answer
 * and nowhere in the input, even though `haemorrhage` did. Each entry is a
 * spelling, never a clinical equivalence, and the list is limited to words that
 * actually appear in `ABNORMALITY_HINTS`.
 */
const GROUNDEDNESS_SPELLINGS: Record<string, readonly string[]> = {
  hemorrhage: ["haemorrhage"],
  haemorrhage: ["hemorrhage"],
};

function mentionsGroundedTerm(text: string, term: string): boolean {
  if (text.includes(term)) return true;
  return (GROUNDEDNESS_SPELLINGS[term] ?? []).some((alt) => text.includes(alt));
}

/**
 * The report text a job was handed OUTSIDE the editor — the `additionalReports`
 * of a COMBINE. Two checks have to know about it, and both were wrong without
 * it: a faithful merge names levels and measurements that appear nowhere in the
 * current Findings, which `groundedCorpus` used to report as invented
 * (`level_change`, `unsupported_abnormality`), and `detectConservationLosses`
 * used to compare only the current report, so a merge that silently discarded
 * the second study's facts could not fail.
 *
 * The model was shown all of it, so it is supplied clinical text, not a
 * generation target to be policed.
 */
function additionalReportNarrative(snapshot: ComposerInputSnapshot): string {
  return (snapshot.additionalReports ?? [])
    .map((r) => [r.findings ?? "", r.impression ?? ""].join("\n"))
    .join("\n");
}

function groundedCorpus(snapshot: ComposerInputSnapshot): string {
  const parts = [
    snapshot.findings,
    snapshot.impression,
    snapshot.recommendation,
    snapshot.clinicalHistory,
    snapshot.technique,
    additionalReportNarrative(snapshot),
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
  const scaffold = [
    snapshot.findings,
    snapshot.impression,
    snapshot.technique,
    additionalReportNarrative(snapshot),
  ].join("\n");
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
 * ──────────────────────────────── CLINICAL CONSERVATION ────────────────────────────────
 *
 * Every other rule in this file asks "did the AI ADD something it was not told?".
 * A professionalize / refine / combine job has the opposite duty, and CARE had no
 * check for it at all: "did the answer keep everything the radiologist wrote?"
 *
 * That gap was silent by construction. The refinement prompt used to withhold the
 * back half of the report, and a dropped measurement was an advisory warning
 * (`validateComposerOutput` line ~430) that still let the job reach READY and be
 * accepted into the report of record. A 2,400-character lumbar report asked to be
 * "made more professional" could come back with three of its five canal
 * diameters, and nothing anywhere said so.
 *
 * So for the kinds whose contract is preservation, facts that were IN the input
 * text are required IN the output text. Numbers and vertebral levels are counted,
 * not paraphrased — they are the two classes of radiology content where a
 * rewording is never an excuse for an omission.
 */

const MEASUREMENT_UNIT = String.raw`(?:mm|cm|ml|cc|hu)`;
const MEASUREMENT_SINGLE_RE = new RegExp(
  String.raw`\b\d+(?:\.\d+)?\s*${MEASUREMENT_UNIT}\b`,
  "gi",
);
/**
 * A comma list sharing one unit — how dictated measurements actually arrive:
 * "AP canal 12, 11, 9, 10, 13 mm". The single-value regex above reads only
 * "13 mm" from that string, which is why five measurements used to be protected
 * as one.
 *
 * The separators are deliberately loose because a professionalised report writes
 * the same dictation as "12, 11, 9, 10 and 13 mm", and a guard that fails an
 * honest rewrite is worse than no guard. What holds the looseness in check is the
 * comma requirement below: "the patient is 45 and 12 mm of stenosis" and
 * "bulge at L4-L5 and 8 mm canal" must not be read as measurement series.
 */
const MEASUREMENT_SERIES_RE = new RegExp(
  String.raw`\b(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)+(?:\s+(?:and|or|&)\s+\d+(?:\.\d+)?)?)\s*(${MEASUREMENT_UNIT})\b`,
  "gi",
);

/** L4-L5, L4-5, L4/5, L4 to L5, C5-C6, C7-T1. Groups: letter, n1, optional 2nd letter, n2. */
const LEVEL_PAIR_RE = /\b([lcdst])(\d{1,2})\s*(?:-|–|—|\/|\bto\b)\s*([lcdst])?(\d{1,2})\b/gi;
/** L5, S1, T12 — after pairs are removed, so "L4-L5" does not also demand "L4". */
const LEVEL_SINGLE_RE = /\b([lcdst])(\d{1,2})\b/gi;

function normMeasurement(value: string, unit: string): string {
  return `${value.replace(/\s+/g, "")}${unit.toLowerCase()}`;
}

export function extractConservationMeasurements(text: string): Set<string> {
  const raw = text ?? "";
  const out = new Set<string>();
  for (const m of raw.matchAll(MEASUREMENT_SINGLE_RE)) {
    const hit = m[0] ?? "";
    const value = hit.match(/\d+(?:\.\d+)?/)?.[0];
    const unit = hit.match(/(mm|cm|ml|cc|hu)/i)?.[1];
    if (value && unit) out.add(normMeasurement(value, unit));
  }
  for (const m of raw.matchAll(MEASUREMENT_SERIES_RE)) {
    const list = m[1] ?? "";
    const unit = m[2] ?? "";
    for (const part of list.split(/\s*(?:,|\band\b|\bor\b|&)\s*/i)) {
      const value = part.match(/\d+(?:\.\d+)?/)?.[0];
      if (value) out.add(normMeasurement(value, unit));
    }
  }
  return out;
}

/**
 * Level tokens, normalised so "L4-5", "L4/L5", "l4 to l5" and "L4-L5" are the
 * same fact: the input is allowed to be sloppy and the output is not allowed to
 * lose the level. `components` holds the two singles a pair implies, which is
 * what lets the checker accept "at L4 and L5" as preservation of "L4-L5".
 */
export type ConservationLevelToken = { canonical: string; components: string[] };

export function extractConservationLevels(text: string): ConservationLevelToken[] {
  const raw = text ?? "";
  const out: ConservationLevelToken[] = [];
  const seen = new Set<string>();
  let rest = raw;
  for (const m of raw.matchAll(LEVEL_PAIR_RE)) {
    const openLetter = (m[1] ?? "").toUpperCase();
    const first = m[2] ?? "";
    const closeLetter = (m[3] ?? "").toUpperCase() || openLetter;
    const second = m[4] ?? "";
    if (!openLetter || !first || !second) continue;
    const canonical = `${openLetter}${first}-${second}`;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push({
        canonical,
        components: [`${openLetter}${first}`, `${closeLetter}${second}`],
      });
    }
    rest = rest.split(m[0]).join(" ");
  }
  for (const m of rest.matchAll(LEVEL_SINGLE_RE)) {
    const letter = (m[1] ?? "").toUpperCase();
    const num = m[2] ?? "";
    if (!letter || !num) continue;
    const canonical = `${letter}${num}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ canonical, components: [] });
  }
  return out;
}

/** Did a whole section that had content come back empty? */
function droppedSections(input: ComposerInputSnapshot, draft: ComposerDraftOutput): string[] {
  const out: string[] = [];
  if ((input.findings ?? "").trim() && !draft.findings.trim()) out.push("FINDINGS");
  if ((input.impression ?? "").trim() && !draft.impression.trim()) out.push("IMPRESSION");
  return out;
}

export type ConservationLosses = {
  droppedMeasurements: string[];
  droppedLevels: string[];
  droppedLaterality: string[];
  droppedSections: string[];
  /** Facts carried only by the observation list, not the narrative. Advisory. */
  observationOnlyLosses: string[];
  errors: string[];
  warnings: string[];
};

/**
 * What the preserving kinds were given in their own report text, and what came
 * back. Narrative facts (Findings/Impression) are demanded; facts that appear
 * only in the structured observation list are reported, because a legitimate
 * restructure can move or fold them.
 */
export function detectConservationLosses(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
): ConservationLosses {
  const inputNarrative = [
    snapshot.findings ?? "",
    snapshot.impression ?? "",
    // For a COMBINE, the merged report is part of what must survive. For every
    // other preserving kind this is empty and the check is unchanged.
    additionalReportNarrative(snapshot),
  ].join("\n");
  const outputText = [draft.findings, draft.impression].join("\n");
  const obsNarrative = (snapshot.observations ?? [])
    .map((o) => [o.findingsText, o.impressionText ?? "", o.measurement ?? ""].join(" "))
    .join("\n");

  const errors: string[] = [];
  const warnings: string[] = [];

  const inM = extractConservationMeasurements(inputNarrative);
  const outM = extractConservationMeasurements(outputText);
  const droppedMeasurements = [...inM].filter((t) => !outM.has(t));
  if (droppedMeasurements.length > 0) {
    errors.push("measurement_dropped");
    warnings.push(
      `Dropped measurement(s) the radiologist had written: ${droppedMeasurements.join(", ")}.`,
    );
  }

  const inLevels = extractConservationLevels(inputNarrative);
  const outLevels = extractConservationLevels(outputText);
  const outCanonical = new Set(outLevels.map((t) => t.canonical));
  const outSingles = new Set<string>();
  for (const t of outLevels) {
    outSingles.add(t.canonical);
    for (const c of t.components) outSingles.add(c);
  }
  const droppedLevels = inLevels
    .filter((t) => {
      // A pair counts as preserved when the output states the pair, or states
      // both of its levels separately — "at L4 and L5" is not an omission of
      // "L4-L5", and reading it as one would fail honest rewrites.
      if (outCanonical.has(t.canonical)) return false;
      if (t.components.length === 2) {
        const [a, b] = t.components;
        if (outSingles.has(a ?? "") && outSingles.has(b ?? "")) return false;
      }
      return true;
    })
    .map((t) => t.canonical);
  if (droppedLevels.length > 0) {
    errors.push("level_dropped");
    warnings.push(
      `Dropped vertebral/disc level(s) the radiologist had written: ${[...new Set(droppedLevels)].join(", ")}.`,
    );
  }

  const inLat = extractLateralityTokens(inputNarrative);
  const outLat = extractLateralityTokens(outputText);
  const droppedLaterality = [...inLat].filter((t) => !outLat.has(t));
  if (droppedLaterality.length > 0) {
    errors.push("laterality_dropped");
    warnings.push(
      `Dropped laterality the radiologist had written: ${droppedLaterality.join(", ")}.`,
    );
  }

  const sections = droppedSections(snapshot, draft);
  if (sections.length > 0) {
    errors.push("section_dropped");
    warnings.push(`Section(s) came back empty although the report had content in them: ${sections.join(", ")}.`);
  }

  const obsOnly: string[] = [];
  for (const t of extractConservationMeasurements(obsNarrative)) {
    if (!outM.has(t) && !inM.has(t)) obsOnly.push(t);
  }
  if (obsOnly.length > 0) {
    warnings.push(
      `Observation measurement(s) not present in the proposal (advisory): ${obsOnly.join(", ")}.`,
    );
  }

  return {
    droppedMeasurements,
    droppedLevels,
    droppedLaterality,
    droppedSections: sections,
    observationOnlyLosses: obsOnly,
    errors,
    warnings,
  };
}

/**
 * Shorthand a radiologist dictates for a structure whose canonical name the
 * structured proposal should use. Grounding compares facts, not characters:
 * without this, a faithful row for "LF hypertrophy" is deleted because the
 * dictation never spelled out "ligamentum flavum".
 *
 * Deliberately tiny, and limited to abbreviations CARE itself already treats as
 * the same fact (`MriLumbarLevelBlock.tsx:467` labels the tile "LF hypertrophy"
 * and writes the phrase "Ligamentum flavum hypertrophy is noted."). A wrong
 * expansion would licence an invented finding, which is the exact failure the
 * grounding below exists to prevent.
 */
const DICTATION_ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bLF\b/gi, "ligamentum flavum"],
  [/\bPLL\b/gi, "posterior longitudinal ligament"],
];

function expandDictationAbbreviations(text: string): string {
  let out = text;
  for (const [pattern, expansion] of DICTATION_ABBREVIATIONS) {
    out = out.replace(pattern, expansion);
  }
  return out;
}

/**
 * Operation 1 grounding: a proposed observation row may only contain what the
 * dictation actually said.
 *
 * Rows are DROPPED, not failed, because one invented row should not throw away
 * the four faithful ones the radiologist wants — and because a dropped row is
 * reported by name, so the omission is visible rather than silent. What may not
 * happen is a proposal that quietly becomes the canonical ledger: a level the
 * dictation never mentioned, or a canal diameter that appeared from the model's
 * expectation of what an L4-5 bulge usually measures, is exactly the class of
 * fabrication every other rule in this file exists to stop.
 */
export function pruneUngroundedObservationRows(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = draft.observations ?? [];
  const dictation = snapshot.findings ?? "";
  const dictationLevels = new Set(extractConservationLevels(dictation).map((t) => t.canonical));
  const dictationMeasurements = extractConservationMeasurements(dictation);
  const dictationNumbers = new Set(
    (dictation.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n),
  );
  const dictationLower = expandDictationAbbreviations(dictation).toLowerCase();

  const kept: NonNullable<ComposerDraftOutput["observations"]> = [];
  for (const row of rows) {
    const rowText = [row.concept, row.findingsText, row.impressionText ?? ""].join(" ");
    const problems: string[] = [];

    for (const level of extractConservationLevels([row.level ?? "", rowText].join(" "))) {
      if (!dictationLevels.has(level.canonical)) problems.push(`level ${level.canonical}`);
    }
    for (const lat of ["right", "left", "bilateral", "unilateral"]) {
      const inRow =
        (row.laterality ?? "").toLowerCase().includes(lat) ||
        extractLateralityTokens(rowText).has(lat);
      const inDictation =
        dictationLower.includes(lat) || extractLateralityTokens(dictation).has(lat);
      if (inRow && !inDictation) problems.push(`laterality ${lat}`);
    }
    const measurement = (row.measurement ?? "").trim();
    if (measurement) {
      const nums = measurement.match(/\d+(?:\.\d+)?/g) ?? [];
      for (const n of nums) {
        if (!dictationNumbers.has(n)) problems.push(`measurement ${measurement}`);
      }
      for (const token of extractConservationMeasurements(measurement)) {
        if (!dictationMeasurements.has(token)) problems.push(`measurement ${token}`);
      }
    }
    for (const hint of ABNORMALITY_HINTS) {
      if (!rowText.toLowerCase().includes(hint)) continue;
      if (mentionsGroundedTerm(dictationLower, hint)) continue;
      // Grounded on the finding, not on the radiologist's vocabulary. A dictation
      // of "L4-5 diffuse bulge" normalised to the canonical concept "diffuse disc
      // bulge" is the whole point of Operation 1, so the phrase match alone would
      // delete faithful rows. The head noun ("bulge") is the fact being asserted;
      // if the dictation never names it, the row claims an abnormality that was
      // never dictated and it goes. The cost of the looser rule is a row that
      // restates a negation as a finding, which is what the separate
      // severity/level/laterality checks and the radiologist's own review screen
      // are for — an observation row is a proposal, never a report.
      const head = hint.trim().split(/\s+/).slice(-1)[0];
      if (head && dictationLower.includes(head)) continue;
      problems.push(`finding "${hint}"`);
    }

    if (problems.length > 0) {
      warnings.push(
        `Observation dropped as ungrounded (${[...new Set(problems)].join(", ")}): `
          + `"${(row.findingsText || row.concept).slice(0, 120)}"`,
      );
      continue;
    }
    kept.push(row);
  }

  if (kept.length !== rows.length) {
    draft.observations = kept;
  }
  if (rows.length === 0) {
    errors.push("no_observations_returned");
    warnings.push("The model returned no observation rows for this dictation.");
  } else if (kept.length === 0) {
    errors.push("no_grounded_observations");
    warnings.push("Every proposed observation was ungrounded in the dictation, so none were kept.");
  }
  return { errors, warnings };
}

/**
 * Flag abnormality terms that appear in AI output but nowhere in radiologist-supplied input.
 *
 * PR #657: also detects laterality swaps, level changes, and severity escalations.
 * Draft-composer hardening: measurement drop advisories, screening wording,
 * filler recommendation clearing, impression grounding.
 *
 * `opts.kind` enables the conservation contract for the preserving task kinds.
 * Omitting it keeps the previous behaviour exactly, so every existing caller —
 * including the overnight draft path — is unchanged.
 */
export function validateComposerOutput(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
  opts?: { kind?: string | null },
): ComposeValidationResult {
  const warnings: string[] = [...(draft.warnings ?? [])];
  const errors: string[] = [];
  const unsupportedMentions: string[] = [];
  const lateralitySwaps: string[] = [];
  const levelChanges: string[] = [];
  const severityEscalations: string[] = [];
  const corpus = groundedCorpus(snapshot);
  const output = [draft.findings, draft.impression, draft.recommendation].join("\n").toLowerCase();

  // An OBSERVATIONS job answers in structured rows, not in report prose, so an
  // empty Findings and Impression is the CORRECT answer for that task and must
  // not be read as a model that said nothing.
  const isObservationTask = opts?.kind === "OBSERVATIONS";
  let conservation: ConservationLosses | undefined;

  if (!isObservationTask && !draft.findings.trim() && !draft.impression.trim()) {
    errors.push("empty_output");
  }

  if (isObservationTask) {
    const pruned = pruneUngroundedObservationRows(snapshot, draft);
    for (const e of pruned.errors) {
      if (!errors.includes(e)) errors.push(e);
    }
    for (const w of pruned.warnings) warnings.push(w);

    // The rows ARE the answer, so the same conservation contract is measured
    // against them. A dictation that states four facts and comes back as one row
    // is an omission, and this task's whole purpose is that nothing dictated gets
    // quietly left out. Impression and Recommendation are compared as empty on
    // both sides because this task does not answer in them.
    if (pruned.errors.length === 0) {
      const rowText = (draft.observations ?? [])
        .map((o) =>
          [o.level, o.laterality, o.severity, o.measurement, o.findingsText, o.impressionText]
            .filter(Boolean)
            .join(" "),
        )
        .join("\n");
      conservation = detectConservationLosses(
        { ...snapshot, impression: "", recommendation: "" },
        { ...draft, findings: rowText, impression: "", recommendation: "" },
      );
      for (const e of conservation.errors) {
        if (!errors.includes(e)) errors.push(e);
      }
      for (const w of conservation.warnings) warnings.push(w);
    }
  }

  for (const hint of ABNORMALITY_HINTS) {
    if (output.includes(hint) && !mentionsGroundedTerm(corpus, hint)) {
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
  //
  // Not applied to an OBSERVATIONS answer: every rule here compares the report
  // PROSE the model wrote against the prose it was handed, and that task's
  // answer is structured rows with deliberately empty Findings and Impression.
  // Running it there turns the correct answer into "measurement_mutation". The
  // rows are guarded row-by-row, on level, laterality and measurement, by
  // `pruneUngroundedObservationRows` above.
  if (!isObservationTask) {
    const definite = detectDefiniteClinicalMutations(snapshot, draft);
    for (const e of definite.errors) {
      if (!errors.includes(e)) errors.push(e);
    }
    for (const w of definite.warnings) warnings.push(w);
  }

  // ── Conservation: nothing the radiologist wrote may go missing ──────────
  // Only for the kinds whose whole purpose is to keep the report and improve
  // its prose. A DRAFT kind (`FULL_REPORT`, `IMPRESSION`) is free to
  // restructure what it was handed, so it is not held to this. (`OBSERVATIONS`
  // was already measured against its rows above.)
  if (opts?.kind && isPreservingComposeKind(opts.kind)) {
    conservation = detectConservationLosses(snapshot, draft);
    for (const e of conservation.errors) {
      if (!errors.includes(e)) errors.push(e);
    }
    for (const w of conservation.warnings) warnings.push(w);
  }

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
    ...(conservation ? { conservation } : {}),
  };
}
