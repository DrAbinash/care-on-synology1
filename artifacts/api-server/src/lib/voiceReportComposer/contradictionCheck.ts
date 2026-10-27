/**
 * Clinical contradiction checking — the deterministic review-time adviser.
 *
 * The owner's pick #2 for safe daily reporting (2026-10-23), after Undo
 * after Apply (#1148): the validator BLOCKS plans that would overwrite
 * clinician-owned text, but nothing looks at what the plan SAYS. A plan can
 * be schema-perfect, provenance-clean and fidelity-clean while its
 * Impression denies the very finding its own Findings document — the
 * classic dangerous contradiction that reaches print unless a tired
 * radiologist catches it unaided.
 *
 * Contract — WARN, never BLOCK:
 *   - every warning is advisory; the radiologist reads it in the dictation
 *     thread and decides (a deliberate correction is legitimate dictation
 *     and must never be refused — "actually, no herniation" is how the
 *     radiologist FIXES a wrong plan);
 *   - deterministic only: word lists + concept stems, no inference, no
 *     network — microseconds, fully testable, same vocabulary the
 *     validator/phrase catalog already trust;
 *   - removals are never inspected: a removal contradicts nothing, it is
 *     the correction mechanism itself.
 *
 * PHI lane: warnings quote clinical words (concept, side, severity) and
 * ride the compose response next to the plan — the radiologist's channel.
 * They must NEVER reach diagnostics or logs.
 */
import type { VoiceChangePlan, VoiceObservation } from "./schema";
import { PATHOLOGY_TERMS } from "./validator";
import { conceptStem } from "./composer";
import { normalizeLaterality, normalizeSeverity } from "./phraseCatalog";

export type ComposerContradictionWarning = {
  /** Stable machine code — telemetry/UX routing; the message is for the human. */
  code:
    | "impression_negates_finding"
    | "impression_affirms_negated_finding"
    | "impression_laterality_mismatch"
    | "severity_conflict"
    | "laterality_conflict"
    | "observation_laterality_mismatch"
    | "observation_severity_mismatch";
  /** Advisory shown to the radiologist on the dictation thread. */
  message: string;
  /** Concept key when the warning is about a specific observation family. */
  concept?: string;
};

export type ContradictionCheckInput = {
  plan: VoiceChangePlan;
  /** The page's current Findings text (the report the plan will edit). */
  findingsText?: string;
  /** The page's current Impression text. */
  impressionText?: string;
  /** Accumulated session/ledger observations the plan may be superseding. */
  priorObservations?: VoiceObservation[];
};

/** Sentence splitter — same discipline as validator.ts (newline-separated). */
function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Negation markers — a sentence negates a term when both co-occur in it. */
const NEGATION_RE = /\b(no|without|absent|negative for|free of|normal|unremarkable)\b/i;

function mentionsTerm(sentence: string, term: string): boolean {
  return sentence.toLowerCase().includes(term);
}

function isNegated(sentence: string): boolean {
  return NEGATION_RE.test(sentence);
}

/** Left/right words standing alone — "bilateral" contains neither. */
const LEFT_RE = /\bleft\b/i;
const RIGHT_RE = /\bright\b/i;

function severityWordsIn(text: string): Set<string> {
  const present = new Set<string>();
  const lower = text.toLowerCase();
  if (/\b(mild|minimal|mildly)\b/.test(lower)) present.add("mild");
  if (/\b(moderate|moderately)\b/.test(lower)) present.add("moderate");
  if (/\b(severe|marked)\b/.test(lower)) present.add("severe");
  return present;
}

/** Canonical level key — "l4-l5" and "L4 - L5" are the same site. */
function normalizeLevel(level?: string | null): string | null {
  const l = level?.trim().toUpperCase().replace(/\s+/g, "");
  return l ? l : null;
}

/** ── Impression vs Findings — the classic flips ─────────────────────────── */

function impressionFindingsWarnings(
  impression: string,
  findingsHay: string,
): ComposerContradictionWarning[] {
  const warnings: ComposerContradictionWarning[] = [];
  if (!impression.trim() || !findingsHay.trim()) return warnings;

  const impSentences = splitSentences(impression);
  const findSentences = splitSentences(findingsHay);

  for (const term of PATHOLOGY_TERMS) {
    const affirmedInFindings = findSentences.some(
      (s) => mentionsTerm(s, term) && !isNegated(s),
    );
    const negatedInFindings = findSentences.some(
      (s) => mentionsTerm(s, term) && isNegated(s),
    );
    const mentionedInFindings = affirmedInFindings || negatedInFindings;
    const impressionNegates = impSentences.some(
      (s) => mentionsTerm(s, term) && isNegated(s),
    );
    const impressionAffirms = impSentences.some(
      (s) => mentionsTerm(s, term) && !isNegated(s),
    );

    if (impressionNegates && affirmedInFindings) {
      warnings.push({
        code: "impression_negates_finding",
        message: `Impression denies ${term} but the Findings document ${term} — check before Apply.`,
      });
    } else if (impressionAffirms && mentionedInFindings && !affirmedInFindings) {
      warnings.push({
        code: "impression_affirms_negated_finding",
        message: `Impression states ${term} but the Findings deny it — check before Apply.`,
      });
    }
  }

  // Side flip: impression names a side the findings never do (advisory
  // port of the validator's impression-only check onto the full path).
  const impLower = impression.toLowerCase();
  const findLower = findingsHay.toLowerCase();
  const impLeft = LEFT_RE.test(impLower);
  const impRight = RIGHT_RE.test(impLower);
  const findLeft = LEFT_RE.test(findLower);
  const findRight = RIGHT_RE.test(findLower);
  if (impLeft && findRight && !findLeft) {
    warnings.push({
      code: "impression_laterality_mismatch",
      message: "Impression says left but the Findings say right only — check before Apply.",
    });
  } else if (impRight && findLeft && !findRight) {
    warnings.push({
      code: "impression_laterality_mismatch",
      message: "Impression says right but the Findings say left only — check before Apply.",
    });
  }

  return warnings;
}

/** ── Same-concept conflicts — silent supersession made visible ─────────── */

type ConceptSlot = {
  concept: string;
  level: string | null;
  severity: string | null;
  laterality: string | null;
};

function conceptConflictWarnings(
  plan: VoiceChangePlan,
  priorObservations: VoiceObservation[],
): ComposerContradictionWarning[] {
  const warnings: ComposerContradictionWarning[] = [];
  const slots: ConceptSlot[] = [];

  const collect = (observations: VoiceObservation[]) => {
    for (const o of observations) {
      if (o.operation === "remove") continue;
      slots.push({
        concept: o.concept,
        level: normalizeLevel(o.level),
        severity: normalizeSeverity(o.severity),
        laterality: normalizeLaterality(o.laterality),
      });
    }
  };
  collect(plan.observations);
  collect(priorObservations);

  // Group by concept family + exact level site. Different levels are
  // different findings (L3-L4 mild vs L4-L5 severe is a report, not a
  // conflict); a level-less entry never groups with a levelled one.
  const groups = new Map<string, ConceptSlot[]>();
  for (const slot of slots) {
    const key = `${conceptStem(slot.concept)}|${slot.level ?? ""}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(slot);
    else groups.set(key, [slot]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const label = group[0].concept.replace(/_/g, " ");
    const at = group[0].level ? ` at ${group[0].level}` : "";

    const severities = [...new Set(group.map((g) => g.severity).filter((s): s is string => Boolean(s)))];
    if (severities.length >= 2) {
      warnings.push({
        code: "severity_conflict",
        concept: group[0].concept,
        message: `Severity conflict — ${label}${at}: "${severities[0]}" vs "${severities[1]}". Confirm which is intended before Apply.`,
      });
    }

    const sides = [...new Set(group.map((g) => g.laterality).filter((s): s is string => Boolean(s)))];
    if (sides.length >= 2) {
      warnings.push({
        code: "laterality_conflict",
        concept: group[0].concept,
        message: `Laterality conflict — ${label}${at}: "${sides[0]}" vs "${sides[1]}". Confirm which is intended before Apply.`,
      });
    }
  }

  return warnings;
}

/** ── Observation field vs its own findings wording ─────────────────────── */

function observationInternalWarnings(
  plan: VoiceChangePlan,
): ComposerContradictionWarning[] {
  const warnings: ComposerContradictionWarning[] = [];
  for (const o of plan.observations) {
    if (o.operation === "remove") continue;
    const textLower = o.findingsText.toLowerCase();

    const fieldSide = normalizeLaterality(o.laterality);
    const textLeft = LEFT_RE.test(textLower);
    const textRight = RIGHT_RE.test(textLower);
    // Bilateral fields are consistent with any side wording (bilateral
    // subsumes both); flag only an exclusive left-vs-right disagreement.
    if (fieldSide === "left" && textRight && !textLeft) {
      warnings.push({
        code: "observation_laterality_mismatch",
        concept: o.concept,
        message: `${o.concept.replace(/_/g, " ")}: side field says "left" but the wording says "right" — check before Apply.`,
      });
    } else if (fieldSide === "right" && textLeft && !textRight) {
      warnings.push({
        code: "observation_laterality_mismatch",
        concept: o.concept,
        message: `${o.concept.replace(/_/g, " ")}: side field says "right" but the wording says "left" — check before Apply.`,
      });
    }

    const fieldSeverity = normalizeSeverity(o.severity);
    if (fieldSeverity) {
      const present = severityWordsIn(textLower);
      const others = [...present].filter((s) => s !== fieldSeverity);
      // The field's own word present anywhere in the wording = elaboration
      // ("mild to moderate"), not a contradiction.
      if (others.length > 0 && !present.has(fieldSeverity)) {
        warnings.push({
          code: "observation_severity_mismatch",
          concept: o.concept,
          message: `${o.concept.replace(/_/g, " ")}: severity field says "${fieldSeverity}" but the wording says "${others[0]}" — check before Apply.`,
        });
      }
    }
  }
  return warnings;
}

/**
 * The one entry point: everything the composer knows about a turn — the
 * plan, the page text it will edit, and the accumulated observations it may
 * be superseding. Returns the advisory warnings (empty = clean); never
 * throws, never blocks, never calls a model.
 */
export function checkContradictions(
  input: ContradictionCheckInput,
): ComposerContradictionWarning[] {
  const { plan } = input;
  const impression =
    plan.impressionUpdate?.trim() || plan.impressionCandidates?.[0]?.trim() || "";
  const planFindings = plan.observations
    .filter((o) => o.operation !== "remove")
    .map((o) => o.findingsText)
    .join("\n");
  const findingsHay = [planFindings, input.findingsText ?? ""].filter(Boolean).join("\n");

  return [
    ...impressionFindingsWarnings(impression, findingsHay),
    ...conceptConflictWarnings(plan, input.priorObservations ?? []),
    ...observationInternalWarnings(plan),
  ];
}
