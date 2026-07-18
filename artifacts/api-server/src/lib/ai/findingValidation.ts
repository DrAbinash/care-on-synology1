/**
 * Finding validation gauntlet — Phase P2 / Gate G9 (pure).
 *
 * The deterministic trust checks that run over every AI finding before it is
 * stored: evidence grounding (reuses the P1 validateEvidenceAnchor), laterality,
 * negation, and contradiction — plus the "deterministic overrides AI" merge.
 * Invalid findings are QUARANTINED (kept, flagged, never surfaced), not silently
 * dropped. No DB, no network — fully unit-tested.
 */
import { validateEvidenceAnchor, type EvidenceAnchor } from "./evidence";

export type Laterality = "left" | "right" | "bilateral" | "none";

export interface GauntletFinding {
  key: string;
  text: string;
  laterality?: Laterality;
  negated?: boolean;
  evidence: EvidenceAnchor[];
  /** true when the finding came from the deterministic rules engine (overrides AI). */
  deterministic?: boolean;
}

export interface QuarantinedFinding {
  finding: GauntletFinding;
  reasons: string[];
}

export interface GauntletResult {
  valid: GauntletFinding[];
  quarantined: QuarantinedFinding[];
}

const NEGATION_CUES = /(^|\b)(no|without|negative for|absence of|no evidence of|not seen)\b/i;

/** A negated statement presented as a positive finding is a conflict. */
export function detectNegationConflict(f: GauntletFinding): string | null {
  const looksNegated = NEGATION_CUES.test(f.text);
  if (looksNegated && f.negated !== true) {
    return "text is negated but the finding is asserted as positive (negation conflict)";
  }
  return null;
}

function lateralitiesInText(text: string): Set<Laterality> {
  const out = new Set<Laterality>();
  if (/\bleft\b/i.test(text)) out.add("left");
  if (/\bright\b/i.test(text)) out.add("right");
  if (/\bbilateral\b/i.test(text)) out.add("bilateral");
  return out;
}

/** A stated laterality that contradicts the text's laterality is a conflict. */
export function detectLateralityConflict(f: GauntletFinding): string | null {
  if (!f.laterality || f.laterality === "none" || f.laterality === "bilateral") return null;
  const inText = lateralitiesInText(f.text);
  if (inText.size === 0) return null; // text is silent on side — nothing to contradict
  if (!inText.has(f.laterality)) {
    return `stated laterality "${f.laterality}" conflicts with text laterality (${[...inText].join("/")})`;
  }
  return null;
}

/** At least one evidence anchor must ground the finding in the study snapshot. */
export function isGrounded(f: GauntletFinding, snapshotInstances: Array<{ seriesUid: string; sopUid: string }>): boolean {
  if (f.evidence.length === 0) return false;
  return f.evidence.some((ev) => validateEvidenceAnchor({ ...ev, findingKey: ev.findingKey || f.key }, snapshotInstances).ok);
}

function normalizeEntity(text: string): string {
  return text
    .toLowerCase()
    .replace(NEGATION_CUES, " ")
    .replace(/\b(left|right|bilateral)\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .sort()
    .join(" ");
}

/**
 * Detect contradictions across findings (same entity, opposite negation or
 * opposite laterality) and against the impression (an impression that negates a
 * positively-asserted finding). Returns the set of finding keys to quarantine.
 */
export function detectContradictions(findings: GauntletFinding[], impression: string[]): Map<string, string> {
  const flagged = new Map<string, string>();
  // finding-vs-finding
  const byEntity = new Map<string, GauntletFinding[]>();
  for (const f of findings) {
    const e = normalizeEntity(f.text);
    if (!e) continue;
    if (!byEntity.has(e)) byEntity.set(e, []);
    byEntity.get(e)!.push(f);
  }
  for (const group of byEntity.values()) {
    if (group.length < 2) continue;
    const negs = new Set(group.map((g) => g.negated === true));
    const sides = new Set(group.map((g) => g.laterality ?? "none"));
    const oppositeSides = sides.has("left") && sides.has("right");
    if (negs.size > 1 || oppositeSides) {
      for (const g of group) if (!g.deterministic) flagged.set(g.key, "contradicts another finding for the same entity");
    }
  }
  // finding-vs-impression
  const impressionText = impression.join(" ").toLowerCase();
  for (const f of findings) {
    if (f.negated === true || f.deterministic) continue;
    const entity = normalizeEntity(f.text);
    if (!entity) continue;
    const tokens = entity.split(" ");
    const negatedInImpression = NEGATION_CUES.test(impressionText) && tokens.every((tok) => impressionText.includes(tok));
    if (negatedInImpression) flagged.set(f.key, "positively asserted but negated in the impression");
  }
  return flagged;
}

/**
 * Run the full gauntlet. Deterministic findings are added first and always win;
 * AI findings are validated and either kept or quarantined with reasons.
 */
export function applyTrustGauntlet(
  aiFindings: GauntletFinding[],
  snapshotInstances: Array<{ seriesUid: string; sopUid: string }>,
  impression: string[],
  deterministicFindings: GauntletFinding[] = [],
): GauntletResult {
  const valid: GauntletFinding[] = [];
  const quarantined: QuarantinedFinding[] = [];

  // Deterministic findings override AI — kept unconditionally.
  for (const df of deterministicFindings) valid.push({ ...df, deterministic: true });
  const deterministicEntities = new Set(deterministicFindings.map((d) => normalizeEntity(d.text)));

  const survivors: GauntletFinding[] = [];
  for (const f of aiFindings) {
    const reasons: string[] = [];
    if (!isGrounded(f, snapshotInstances)) reasons.push("ungrounded — no valid evidence anchor in the study snapshot");
    const neg = detectNegationConflict(f);
    if (neg) reasons.push(neg);
    const lat = detectLateralityConflict(f);
    if (lat) reasons.push(lat);
    // A deterministic rule already covering this entity overrides the AI finding.
    if (deterministicEntities.has(normalizeEntity(f.text))) reasons.push("overridden by a deterministic rule for the same entity");
    if (reasons.length > 0) quarantined.push({ finding: f, reasons });
    else survivors.push(f);
  }

  // Contradiction detection over the survivors (+ deterministic) and impression.
  const contradictions = detectContradictions([...valid, ...survivors], impression);
  for (const f of survivors) {
    const reason = contradictions.get(f.key);
    if (reason) quarantined.push({ finding: f, reasons: [reason] });
    else valid.push(f);
  }

  return { valid, quarantined };
}
