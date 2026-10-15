/**
 * Ledger apply/remove for canonical observations.
 * Operates on appliedPathologyPatches + narrative. No second store.
 */

import { removeBlock } from "./quickFindingsMerge";
import {
  type FieldProvenanceMap,
  type InsertSource,
  normalizeForDedupe,
  provenanceFromText,
  splitToSentences,
} from "./reportFieldMerge";
import type {
  NarrativeProvenance,
  PathologyIncoming,
  ReportNarrative,
} from "./pathologyPatch";
import {
  buildCanonicalObservation,
  coerceObservationRole,
  coerceObservationSpecificity,
  contributionPresent,
  contributionProtected,
  type CanonicalObservation,
  type ObservationSlotInput,
} from "./observationSlot";
import { coerceObservationAnchor } from "./observationAnchor";
import {
  filterRestorableBaselines,
  insertAtCanonicalPosition,
  type CanonicalSlot,
  type SuppressingObservation,
} from "./clinicalSelection/normalSuppression";
import {
  assertedAbnormality,
  assertsStudyNormal,
  clinicalContentSignature,
  sectionsContradict,
} from "@workspace/report-quality";
import {
  contributionsMatch,
  fieldContainsContribution,
  normalizeContributionMatch,
} from "./observationMatch";

export {
  normalizeContributionMatch,
  fieldContainsContribution,
  contributionsMatch,
} from "./observationMatch";
export { contributionPresent, contributionProtected } from "./observationSlot";

export type LedgerPatch = {
  id: string;
  observation: CanonicalObservation;
  templates: PathologyIncoming;
  lastRendered: PathologyIncoming;
  replacedBaseline: { findings: string[]; impression: string[] };
  source: InsertSource;
  protected: boolean;
  /** Derived on hydrate — contribution missing and recorded hash disagrees with a fresh render. Never auto-deleted. */
  stale?: boolean;
};

export type RemoveContributionOutcome = "removed" | "preserved-manual" | "no-op-unproven";

/** Contribution as it actually appears after sentence split / merge (normalized match). */
export function renderedInField(incoming: string | undefined, field: string): string {
  const c = (incoming ?? "").trim();
  if (!c) return "";
  if (field.includes(c)) return c;
  const parts = splitToSentences(c);
  const found = parts
    .map((part) => {
      if (field.includes(part)) return part;
      for (const s of splitToSentences(field)) {
        if (contributionsMatch(s, part)) return s;
      }
      return "";
    })
    .filter(Boolean);
  if (found.length > 0) return found.join("\n");
  for (const s of splitToSentences(field)) {
    if (contributionsMatch(s, c)) return s;
  }
  return "";
}

function contributionChunks(contribution: string): string[] {
  const c = contribution.trim();
  if (!c) return [];
  const parts = splitToSentences(c);
  return parts.length > 0 ? parts : [c];
}

function locateContributionInField(fieldText: string, contribution: string): string | null {
  const c = contribution.trim();
  if (!c) return null;
  if (fieldText.includes(c)) return c;
  for (const s of splitToSentences(fieldText)) {
    if (contributionsMatch(s, c)) return s;
  }
  const chunks = contributionChunks(c);
  if (chunks.length > 1 && chunks.every((chunk) => fieldContainsContribution(fieldText, chunk) || fieldText.includes(chunk))) {
    return c;
  }
  return fieldContainsContribution(fieldText, c) ? c : null;
}

export function stripContribution(
  fieldText: string,
  contribution: string | undefined,
  provenance: FieldProvenanceMap | undefined,
): { text: string; outcome: RemoveContributionOutcome } {
  const c = (contribution ?? "").trim();
  if (!c) return { text: fieldText, outcome: "removed" };
  const located = locateContributionInField(fieldText, c);
  if (!located && !contributionPresent(fieldText, c)) {
    return { text: fieldText, outcome: "no-op-unproven" };
  }
  const chunks = contributionChunks(located ?? c);
  if (chunks.some((chunk) => contributionProtected(chunk, provenance)) || contributionProtected(c, provenance) || contributionProtected(located ?? c, provenance)) {
    return { text: fieldText, outcome: "preserved-manual" };
  }
  let next = fieldText;
  const target = located ?? c;
  if (next.includes(target)) {
    next = removeBlock(next, target);
  } else {
    for (const chunk of chunks) {
      const hit = locateContributionInField(next, chunk);
      next = hit ? removeBlock(next, hit) : next;
    }
  }
  return { text: next, outcome: next === fieldText ? "no-op-unproven" : "removed" };
}

export function restoreBaselineSentences(fieldText: string, sentences: string[]): string {
  let next = fieldText;
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if (next.includes(t)) continue;
    next = next.trim() ? `${next.trimEnd()}\n${t}` : t;
  }
  return next;
}

/**
 * Restoration options that make the outcome a property of the surviving selection set rather than of
 * the click sequence.
 *
 * Omitted entirely, `removeLedgerObservation` behaves exactly as it always has — which is what a
 * reporting surface with no v4 catalogue and no canonical order must keep doing. Supply `surviving`
 * and a sentence a still-selected observation falsifies is never put back; supply `canonical*` and a
 * sentence that legitimately returns rejoins its anatomical neighbours instead of landing at the end
 * of the field, beneath the pathology it contradicts.
 */
export type LedgerRestoreOptions = {
  /** Every observation still selected after this removal. */
  surviving?: readonly SuppressingObservation[];
  canonicalFindings?: readonly CanonicalSlot[];
  canonicalImpression?: readonly CanonicalSlot[];
};

function restoreInto(
  fieldText: string,
  sentences: string[],
  canonical: readonly CanonicalSlot[] | undefined,
): string {
  if (!canonical || canonical.length === 0) return restoreBaselineSentences(fieldText, sentences);
  let next = fieldText;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    next = insertAtCanonicalPosition(next, trimmed, canonical);
  }
  return next;
}

export function removeLedgerObservation(
  narrative: ReportNarrative,
  provenance: NarrativeProvenance,
  patch: LedgerPatch,
  opts?: LedgerRestoreOptions,
): {
  narrative: ReportNarrative;
  provenance: NarrativeProvenance;
  outcome: RemoveContributionOutcome;
  preservedManual: boolean;
} {
  if (patch.protected) {
    return { narrative, provenance, outcome: "preserved-manual", preservedManual: true };
  }
  const findings = stripContribution(narrative.findings, patch.lastRendered.findings, provenance.findings);
  const impression = stripContribution(narrative.impression, patch.lastRendered.impression, provenance.impression);
  const technique = stripContribution(narrative.technique, patch.lastRendered.technique, provenance.technique);
  const recommendation = stripContribution(
    narrative.recommendation,
    patch.lastRendered.recommendation,
    provenance.recommendation,
  );

  const hadContribution = Boolean(
    (patch.lastRendered.findings ?? "").trim()
    || (patch.lastRendered.impression ?? "").trim()
    || (patch.lastRendered.technique ?? "").trim()
    || (patch.lastRendered.recommendation ?? "").trim()
  );
  const preservedManual = [findings, impression, technique, recommendation].some((r) => r.outcome === "preserved-manual");
  const anyRemoved = findings.text !== narrative.findings
    || impression.text !== narrative.impression
    || technique.text !== narrative.technique
    || recommendation.text !== narrative.recommendation;

  // Suppression is a fact about the set that survives, not about which patch happened to delete the
  // sentence first. Two abnormalities that declare the same normal must not disagree about it.
  const restorableFindings = opts?.surviving
    ? filterRestorableBaselines(patch.replacedBaseline.findings, opts.surviving)
    : patch.replacedBaseline.findings;
  const restorableImpression = opts?.surviving
    ? filterRestorableBaselines(patch.replacedBaseline.impression, opts.surviving)
    : patch.replacedBaseline.impression;

  let nextFindings = findings.text;
  let nextImpression = impression.text;
  if (findings.outcome === "removed") {
    nextFindings = restoreInto(nextFindings, restorableFindings, opts?.canonicalFindings);
  }
  if (impression.outcome === "removed") {
    nextImpression = restoreInto(nextImpression, restorableImpression, opts?.canonicalImpression);
  }

  const nextNarrative: ReportNarrative = {
    clinicalHistory: narrative.clinicalHistory,
    findings: nextFindings,
    impression: nextImpression,
    technique: technique.text,
    recommendation: recommendation.text,
  };

  let outcome: RemoveContributionOutcome = "removed";
  if (preservedManual && !anyRemoved) outcome = "preserved-manual";
  else if (!hadContribution || (!anyRemoved && !preservedManual)) outcome = "no-op-unproven";

  return {
    narrative: nextNarrative,
    provenance: dropProvenanceForRemoved(provenance, narrative, nextNarrative),
    outcome,
    preservedManual,
  };
}

function dropProvenanceForRemoved(
  provenance: NarrativeProvenance,
  before: ReportNarrative,
  after: ReportNarrative,
): NarrativeProvenance {
  void before;
  const prune = (field: "findings" | "impression" | "technique" | "recommendation"): FieldProvenanceMap => {
    const map = { ...(provenance[field] ?? {}) };
    const afterKeys = new Set(splitToSentences(after[field]).map((s) => normalizeForDedupe(s)));
    for (const key of Object.keys(map)) {
      if (!afterKeys.has(key)) delete map[key];
    }
    return map;
  };
  return {
    clinicalHistory: provenance.clinicalHistory,
    findings: prune("findings"),
    impression: prune("impression"),
    technique: prune("technique"),
    recommendation: prune("recommendation"),
  };
}

export function observationInputFromVoice(obs: {
  id?: string;
  concept?: string;
  level?: string | null;
  laterality?: string | null;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  findingsText?: string;
}, region: string): ObservationSlotInput {
  return {
    id: obs.id ? `voice-${obs.id}` : `voice-${obs.concept ?? "obs"}`,
    region,
    concept: obs.concept,
    conflictGroup: obs.conflictGroup,
    anatomicalSection: obs.anatomicalSection,
    level: obs.level,
    laterality: obs.laterality,
    findingsText: obs.findingsText,
    baselineReplaces: obs.baselineReplaces,
    source: "radiologist-voice",
  };
}

export function ledgerPatchFromApply(opts: {
  id: string;
  observation: CanonicalObservation;
  templates: PathologyIncoming;
  lastRendered: PathologyIncoming;
  replacedFindings: string[];
  replacedImpression: string[];
  source: InsertSource;
}): LedgerPatch {
  return {
    id: opts.id,
    observation: opts.observation,
    templates: opts.templates,
    lastRendered: opts.lastRendered,
    replacedBaseline: {
      findings: opts.replacedFindings,
      impression: opts.replacedImpression,
    },
    source: opts.source,
    protected: false,
  };
}

export { buildCanonicalObservation, provenanceFromText };

export const OBSERVATION_LEDGER_KIND = "care.observation_ledger.v1";

export type SerializedObservationLedger = {
  kind: typeof OBSERVATION_LEDGER_KIND;
  version: 1;
  patches: Array<{
    id: string;
    observation: CanonicalObservation;
    templates: PathologyIncoming;
    lastRendered: PathologyIncoming;
    replacedBaseline: { findings: string[]; impression: string[] };
    source: InsertSource;
    protected: boolean;
    lastRenderedHashes?: { findings?: string; impression?: string; recommendation?: string };
  }>;
  /** Editor provenance — restored on reopen so deselect/protection still work. */
  fieldProvenance?: NarrativeProvenance;
  /**
   * Optional advisory coverage marks (Reporting Canvas R2).
   * Additive — old drafts without this field hydrate normally.
   * Never used as a finalize hard gate.
   */
  careCoverageMarks?: unknown;
};

function hashText(s: string | undefined): string {
  const t = normalizeContributionMatch(s ?? "");
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return `${t.length}:${h.toString(16)}`;
}

export function serializeObservationLedger(
  patches: LedgerPatch[],
  fieldProvenance?: NarrativeProvenance,
  careCoverageMarks?: unknown,
  impressionBasis?: ImpressionBasis | null,
): SerializedObservationLedger {
  return {
    kind: OBSERVATION_LEDGER_KIND,
    version: 1,
    patches: patches.map((p) => ({
      id: p.id,
      observation: p.observation,
      templates: p.templates,
      lastRendered: p.lastRendered,
      replacedBaseline: p.replacedBaseline,
      source: p.source,
      protected: p.protected,
      lastRenderedHashes: {
        findings: hashText(p.lastRendered.findings),
        impression: hashText(p.lastRendered.impression),
        recommendation: hashText(p.lastRendered.recommendation),
      },
    })),
    fieldProvenance: fieldProvenance && Object.keys(fieldProvenance).length > 0 ? fieldProvenance : undefined,
    ...(careCoverageMarks != null ? { careCoverageMarks } : {}),
    ...(impressionBasis ? { impressionBasis } : {}),
  };
}

function isValidLedgerPatch(raw: unknown): raw is LedgerPatch {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return false;
  const obs = row.observation as Record<string, unknown> | undefined;
  if (!obs || typeof obs !== "object") return false;
  if (typeof obs.slotKey !== "string" || !obs.slotKey.trim()) return false;
  return true;
}

function coerceLedgerPatch(raw: unknown): LedgerPatch | null {
  if (!isValidLedgerPatch(raw)) return null;
  const row = raw as LedgerPatch & { lastRenderedHashes?: { findings?: string; impression?: string; recommendation?: string } };
  const obs = row.observation;
  const observation: CanonicalObservation = {
    ...obs,
    role: coerceObservationRole((obs as { role?: unknown }).role),
    specificity: coerceObservationSpecificity((obs as { specificity?: unknown }).specificity),
    ...(coerceObservationAnchor((obs as { anchor?: unknown }).anchor)
      ? { anchor: coerceObservationAnchor((obs as { anchor?: unknown }).anchor) }
      : {}),
    ...((obs as { createdAt?: unknown }).createdAt && typeof (obs as { createdAt?: unknown }).createdAt === "string"
      ? { createdAt: (obs as { createdAt: string }).createdAt }
      : {}),
    ...((obs as { updatedAt?: unknown }).updatedAt && typeof (obs as { updatedAt?: unknown }).updatedAt === "string"
      ? { updatedAt: (obs as { updatedAt: string }).updatedAt }
      : {}),
  };
  return {
    id: row.id,
    observation,
    templates: row.templates ?? {},
    lastRendered: row.lastRendered ?? {},
    replacedBaseline: row.replacedBaseline ?? { findings: [], impression: [] },
    source: row.source,
    protected: Boolean(row.protected),
  };
}

export type LedgerParseStatus = "restored" | "absent" | "malformed" | "incompatible";

export type ParsedObservationLedger = {
  status: LedgerParseStatus;
  patches: LedgerPatch[];
  fieldProvenance?: NarrativeProvenance;
};

export function parseObservationLedger(raw: unknown): ParsedObservationLedger {
  if (raw == null) return { status: "absent", patches: [] };
  if (typeof raw !== "object") return { status: "malformed", patches: [] };
  let rec = raw as Record<string, unknown>;
  if (rec.careObservationLedger && typeof rec.careObservationLedger === "object") {
    rec = rec.careObservationLedger as Record<string, unknown>;
  }
  if (rec.kind != null && rec.kind !== OBSERVATION_LEDGER_KIND) {
    return { status: "malformed", patches: [] };
  }
  if (rec.kind === OBSERVATION_LEDGER_KIND && rec.version != null && rec.version !== 1) {
    return { status: "incompatible", patches: [] };
  }
  if (rec.kind === OBSERVATION_LEDGER_KIND && !Array.isArray(rec.patches)) {
    return { status: "malformed", patches: [] };
  }
  if (rec.kind !== OBSERVATION_LEDGER_KIND) {
    return { status: "malformed", patches: [] };
  }
  const seen = new Set<string>();
  const patches: LedgerPatch[] = [];
  for (const row of rec.patches as unknown[]) {
    const coerced = coerceLedgerPatch(row);
    if (!coerced) continue;
    if (seen.has(coerced.id)) continue;
    seen.add(coerced.id);
    patches.push(coerced);
  }
  if ((rec.patches as unknown[]).length > 0 && patches.length === 0) {
    return { status: "malformed", patches: [] };
  }
  const fieldProvenance = rec.fieldProvenance && typeof rec.fieldProvenance === "object"
    ? rec.fieldProvenance as NarrativeProvenance
    : undefined;
  return { status: "restored", patches, fieldProvenance };
}

export function deserializeObservationLedger(raw: unknown): LedgerPatch[] | null {
  const parsed = parseObservationLedger(raw);
  if (parsed.status !== "restored") return null;
  return parsed.patches;
}

export type LedgerHydrationResult = {
  ok: boolean;
  mode: "restored" | "narrative-only";
  reason: LedgerParseStatus;
  patchCount: number;
  warning?: string;
};

export function logLedgerHydrationSafe(result: LedgerHydrationResult): void {
  if (result.ok) return;
  console.warn("[care.observation_ledger] hydration failed; opening narrative-only", {
    reason: result.reason,
    patchCount: result.patchCount,
  });
}

export function reconstructProvenanceFromLedger(
  narrative: ReportNarrative,
  patches: LedgerPatch[],
): NarrativeProvenance {
  const build = (field: "findings" | "impression" | "technique" | "recommendation"): FieldProvenanceMap => {
    const map: FieldProvenanceMap = {};
    for (const s of splitToSentences(narrative[field])) {
      const key = normalizeForDedupe(s);
      if (!key) continue;
      const owners = patches.filter((p) => contributionPresent(p.lastRendered[field] ?? "", s) || (p.lastRendered[field] ?? "").includes(s));
      if (owners.length === 0) {
        map[key] = ["template"];
        continue;
      }
      const sources = new Set<InsertSource>();
      for (const o of owners) {
        if (o.protected) sources.add("manual");
        if (o.source) sources.add(o.source);
      }
      map[key] = [...sources];
    }
    return map;
  };
  return {
    clinicalHistory: provenanceFromText(narrative.clinicalHistory, "template"),
    findings: build("findings"),
    impression: build("impression"),
    technique: build("technique"),
    recommendation: build("recommendation"),
  };
}

/**
 * Words that are anatomy or grammar rather than a finding, so asserting one
 * says nothing another sentence could contradict. "intracranial" is here because
 * the scaffold's own two normals disagree about it without disagreeing about
 * anything: "Flow voids in major intracranial vessels are preserved." beside
 * "No intracranial hemorrhage is seen." Measured across both click orders of all
 * 528 pairs of the 33 shipped MRI Brain findings boxes, that one pair accounted
 * for 276 of the 280 warnings the ownership change below produces on its own.
 */
const SIBLING_STOP = new Set([
  "lesion", "lesions", "signal", "normal", "abnormal", "intensity", "white", "matter",
  "there", "this", "that", "with", "from", "into", "without", "showing", "appear",
  "appearance", "grade", "space", "spaces", "system", "bilateral", "intracranial",
]);
const SIBLING_DENIAL =
  /\b(no|without|absence of|not identified|not seen|free of|no evidence|no definite|no obvious|no apparent|no significant)\b/i;

function assertedDistinctiveTokens(text: string): string[] {
  const tokens = (text.toLowerCase().match(/[a-z]{6,}/g) ?? [])
    .filter((t) => !SIBLING_STOP.has(t));
  return [...new Set(tokens)].slice(0, 8);
}

export type UnownedSiblingWarning = { sentence: string; token: string };

/**
 * Conservative: warn only when text this observation does not own denies a
 * distinctive token the observation asserts. Never deletes the sentence.
 *
 * `ownedLastRendered` is the asserting observation's own rendered text — pass the
 * whole ledger here and a contradiction between two observations disappears,
 * because each one's sentence exempts the other's. See the ledger wrapper below.
 */
export function detectUnownedSiblingConflicts(opts: {
  findings: string;
  incomingFindings?: string;
  ownedLastRendered: string[];
}): UnownedSiblingWarning[] {
  const incoming = (opts.incomingFindings ?? "").trim();
  if (!incoming) return [];
  const asserted = assertedDistinctiveTokens(incoming).filter((token) => {
    const re = new RegExp(`\\b${token}\\b`, "i");
    const idx = incoming.toLowerCase().search(re);
    if (idx < 0) return false;
    return !SIBLING_DENIAL.test(incoming.slice(Math.max(0, idx - 36), idx));
  });
  if (asserted.length === 0) return [];
  const incomingSet = new Set(splitToSentences(incoming));
  const ownedChunks = opts.ownedLastRendered.flatMap((t) => splitToSentences(t));
  const out: UnownedSiblingWarning[] = [];
  for (const s of splitToSentences(opts.findings)) {
    if (incomingSet.has(s)) continue;
    if (ownedChunks.some((c) => c === s || s.includes(c))) continue;
    if (!SIBLING_DENIAL.test(s)) continue;
    const token = asserted.find((t) => new RegExp(`\\b${t}\\b`, "i").test(s));
    if (!token) continue;
    out.push({ sentence: s, token });
  }
  return out;
}

/**
 * Re-run sibling detection over the full active ledger (finalize + banner).
 * Never deletes leftover sentences.
 *
 * Each observation is judged against the text it does NOT own. Flattening the
 * whole ledger into the exempt set — what this function used to do — made every
 * observation exempt every other one's sentences, so the detector could only ever
 * fire on text no observation claimed at all. Two boxes disagreeing about one
 * anatomy is the case a radiologist actually meets: "Basal ganglia hemorrhage"
 * renders "Mass effect with midline shift of ___ mm." and "Hydrocephalus" renders
 * "…No midline shift.", and clicked in that order both reach the page.
 */
export function detectUnownedSiblingConflictsForLedger(opts: {
  findings: string;
  patches: Array<{ lastRendered: { findings?: string }; protected?: boolean }>;
}): UnownedSiblingWarning[] {
  const seen = new Set<string>();
  const out: UnownedSiblingWarning[] = [];
  for (const p of opts.patches) {
    if (p.protected) continue;
    const incoming = (p.lastRendered.findings ?? "").trim();
    if (!incoming) continue;
    for (const w of detectUnownedSiblingConflicts({
      findings: opts.findings,
      incomingFindings: incoming,
      ownedLastRendered: [incoming],
    })) {
      const key = `${w.token}::${normalizeContributionMatch(w.sentence)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

/**
 * Named for the unowned-leftover case it was written for; it now also covers a
 * sentence another observation owns, which is why it names the contradiction
 * rather than the provenance. Nothing is deleted either way.
 */
export const UNOWNED_SIBLING_HINT =
  "Another sentence in these Findings contradicts this finding. Re-read both before signing.";

export const ORPHANED_RECOMMENDATION_HINT =
  "This advice came from a finding that has since changed or been removed. Re-read it before signing.";

export type OrphanedRecommendationWarning = { sentence: string; hint: string };

/**
 * Advice still sitting in the Recommendation box whose owning observation no
 * longer stands — either stale on hydrate, or protected because a manual edit
 * removed or rewrote the finding it was derived from.
 *
 * Never deletes and never blocks. Only sentences still traceable to a ledger
 * patch are named: advice with no owning observation is indistinguishable from
 * the radiologist's own, including a legitimate follow-up on a normal study, so
 * flagging it would train the signer to ignore the whole panel.
 */
export function detectOrphanedRecommendationsForLedger(opts: {
  recommendation: string;
  patches: Array<{ lastRendered: { recommendation?: string }; protected?: boolean; stale?: boolean }>;
  provenance?: FieldProvenanceMap;
}): OrphanedRecommendationWarning[] {
  const seen = new Set<string>();
  const out: OrphanedRecommendationWarning[] = [];
  for (const p of opts.patches) {
    if (!p.stale && !p.protected) continue;
    const rendered = (p.lastRendered.recommendation ?? "").trim();
    if (!rendered) continue;
    // The radiologist adopted this sentence — it is their advice now.
    if (contributionProtected(rendered, opts.provenance)) continue;
    for (const raw of splitToSentences(rendered)) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const key = normalizeContributionMatch(sentence);
      if (!key || seen.has(key)) continue;
      if (!fieldContainsContribution(opts.recommendation, sentence)) continue;
      seen.add(key);
      out.push({ sentence, hint: ORPHANED_RECOMMENDATION_HINT });
    }
  }
  return out;
}

export function extractCareObservationLedger(column: unknown): unknown {
  if (!column || typeof column !== "object") return null;
  const rec = column as Record<string, unknown>;
  if (rec.kind === OBSERVATION_LEDGER_KIND) return rec;
  if (rec.careObservationLedger) return rec.careObservationLedger;
  return null;
}

export function collectImpressionContributions(patches: LedgerPatch[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of patches) {
    if (p.protected) continue;
    const t = (p.lastRendered.impression ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Why the Impression is considered out of date with the Findings. Named, so the
 * sign dialog can say which fact moved instead of showing a generic warning, and
 * so a test can prove a formatting change produced no reason at all.
 */
export type ImpressionDependencyReason =
  | "findings-changed"
  | "never-reconciled"
  | "contribution-lost"
  | "stale-patch"
  | "impression-contradicts-findings"
  /**
   * The radiologist changed which observations take part in the Impression. This is
   * a decision about the dependency itself, not a text change the predicate can
   * infer — the excluded sentence is removed cleanly and the included one is
   * deliberately not written — so the site names it. It moves the basis to
   * unreconciled like any other arm, so it survives the reload.
   */
  | "participation-changed";

/**
 * The Findings the Impression was written against, as the clinical-content
 * signature of that moment. Recorded whenever the summary is (re)owned — an
 * authored write, a refresh, or the radiologist's acknowledgement at sign — and
 * compared on every re-derivation, including the one after a reload. This is the
 * dependency link the ledger alone could not express: a hand-typed Findings
 * sentence has no patch behind it, so before this field existed nothing about it
 * survived save → close → reopen.
 */
export type ImpressionBasis = {
  /** The clinical content of the Findings the summary was written against. */
  findingsSignature: string;
  /** The summary's own words, format-folded — what the radiologist actually read. */
  impressionFingerprint: string;
  recordedBy: "impression-write" | "refresh" | "review" | "unreconciled";
};

export type ImpressionDependencyState = {
  needsRefresh: boolean;
  reasons: ImpressionDependencyReason[];
  findingsSignature: string;
  impressionFingerprint: string;
  /** The basis to store: the one compared against, or the new one just recorded. */
  basis: ImpressionBasis | null;
};

/**
 * The Impression as it was reviewed: the same words whatever the punctuation,
 * spacing or capitalisation around them.
 *
 * Deliberately stricter than the Findings signature. A Findings edit only breaks
 * the dependency if it changes a clinical fact — re-heading or re-flowing prose is
 * not a new examination — but an acknowledgement binds to the sentence the
 * radiologist actually read, because "the study is normal" and "no abnormality is
 * seen, the ventricles are normal" are different claims even when my vocabulary
 * table cannot tell them apart.
 */
export function impressionFingerprint(impressionText: string): string {
  return normalizeContributionMatch(impressionText ?? "");
}

/**
 * The ledger half of the dependency: an observation the radiologist selected whose
 * own conclusion has left the Impression, or one the narrative no longer matches.
 * Kept as its own function so {@link impressionNeedsRefreshFromNarrative} stays
 * exactly the predicate its existing tests pin.
 */
export function impressionContributionReasons(
  impressionText: string,
  patches: LedgerPatch[],
  provenance?: FieldProvenanceMap,
): ImpressionDependencyReason[] {
  const reasons: ImpressionDependencyReason[] = [];
  for (const p of patches) {
    if (p.stale && (p.lastRendered.findings ?? "").trim() && !reasons.includes("stale-patch")) {
      reasons.push("stale-patch");
    }
    const c = (p.lastRendered.impression ?? "").trim();
    if (!c) continue;
    if (p.protected || contributionProtected(c, provenance)) continue;
    if (!contributionPresent(impressionText, c) && !reasons.includes("contribution-lost")) {
      reasons.push("contribution-lost");
    }
  }
  return reasons;
}

export function impressionNeedsRefreshFromNarrative(
  impressionText: string,
  patches: LedgerPatch[],
  provenance?: FieldProvenanceMap,
): boolean {
  return impressionContributionReasons(impressionText, patches, provenance).length > 0;
}

/**
 * The one predicate for "does this Impression still follow from these Findings?".
 *
 * Three independent readings, any of which arms it:
 *
 *  1. the Findings' clinical content differs from the signature recorded when the
 *     summary was owned — a level, side, size, severity or abnormality moved;
 *  2. the ledger's own contributions are no longer in the Impression;
 *  3. the Impression does not follow from the Findings — it calls the study normal
 *     while the Findings assert (or hold open) an abnormality, or it moves the side,
 *     the spinal level or the severity grade of a fact the Findings state. This is
 *     the reading itself, which does not care who typed either field, so a
 *     hand-written summary cannot step around it.
 *
 * Halves 1 and 3 are computed from the shared clinical vocabulary in
 * `@workspace/report-quality`, which is the same table the report-quality rules and
 * the editor's live badge read. This is not a second engine; it is the existing one
 * asked on demand rather than only when a badge is drawn. Half 3 asks the same six
 * Findings↔Impression questions the badge prints, so a contradiction the radiologist
 * can see is a contradiction that arms the dependency — and the two cannot disagree,
 * because they are the same function.
 *
 * One thing silences half 3: the radiologist's own acknowledgement, and only for
 * the exact pairing acknowledged. A review that did not hold would nag on every
 * reopen until the click-through reflex set in, which is a worse report than the
 * one it warns about; a review that held forever would cover a later clinical
 * change, which is worse still. So it is bound to both sides' content — the next
 * Findings edit re-arms through half 1, and any rewrite of the Impression re-arms
 * because the acknowledged pairing no longer exists.
 */
export function evaluateImpressionDependency(opts: {
  findings: string;
  impression: string;
  patches: LedgerPatch[];
  provenance?: FieldProvenanceMap;
  basis?: ImpressionBasis | null;
  /**
   * This write takes ownership of the pairing now: the basis is recorded from the
   * text in front of it instead of being compared. `"review"` additionally silences
   * half 3, because the radiologist has read these words against these findings and
   * says they stand; `"impression-write"` and `"refresh"` do not, since a rewrite —
   * a tile, a template, a regenerated summary — is a claim about the words, not a
   * reading of them.
   */
  recordedNow?: ImpressionBasis["recordedBy"];
  /**
   * The Findings were just written. With no basis to compare against — a report
   * nobody has summarised yet in this session — that is still a reason to re-read
   * the Impression, and it is what CARE has always done. It is asked rather than
   * inferred, so opening a saved report does not flag it for text no one changed.
   */
  findingsJustChanged?: boolean;
}): ImpressionDependencyState {
  const findings = opts.findings ?? "";
  const impression = opts.impression ?? "";
  const findingsSignature = clinicalContentSignature(findings);
  const fingerprint = impressionFingerprint(impression);
  const reasons = impressionContributionReasons(impression, opts.patches, opts.provenance);
  const recorded = (who: ImpressionBasis["recordedBy"]): ImpressionBasis => ({
    findingsSignature,
    impressionFingerprint: fingerprint,
    recordedBy: who,
  });
  const basis = opts.recordedNow ? recorded(opts.recordedNow) : opts.basis ?? null;

  /**
   * "Unreconciled" is a state, not an event: once the Findings have moved past the
   * summary, an accepted AI sentence, a re-read headline or a reload must not make
   * the report look reconciled again. Only a write that owns both sides, a refresh
   * or the radiologist's own review moves it out — and that is the rule CARE's
   * B-04 acceptance boundary already asserts, now expressible after a reload.
   */
  if (!basis) {
    if (opts.findingsJustChanged) reasons.push("never-reconciled");
  } else if (basis.recordedBy === "unreconciled") {
    reasons.push("findings-changed");
  } else if (basis.findingsSignature !== findingsSignature) {
    reasons.push("findings-changed");
  }
  const armedUnreconciled = !basis
    ? !!opts.findingsJustChanged
    : basis.recordedBy !== "unreconciled" && basis.findingsSignature !== findingsSignature;
  const nextBasis: ImpressionBasis | null = opts.recordedNow
    ? basis
    : armedUnreconciled
      ? recorded("unreconciled")
      : basis;

  const reviewedThisPairing =
    basis !== null
    && basis.recordedBy === "review"
    && basis.findingsSignature === findingsSignature
    && basis.impressionFingerprint === fingerprint;
  // Half 3 asks one question — do these two sections disagree? — and reads it twice,
  // because the two readings are not the same question and neither subsumes the
  // other. The study-normal arm compares a whole-section claim against a single
  // abnormality anywhere; the shared contract compares fact against fact, so it also
  // sees a summary that moved the side, the level or the grade without claiming the
  // study was normal at all. Dropping either would leave a contradiction the
  // dependency cannot see.
  const saysNormalStudy = assertedAbnormality(findings) !== null && assertsStudyNormal(impression);
  if (!reviewedThisPairing && (saysNormalStudy || sectionsContradict(findings, impression))) {
    reasons.push("impression-contradicts-findings");
  }

  return {
    needsRefresh: reasons.length > 0,
    reasons,
    findingsSignature,
    impressionFingerprint: fingerprint,
    basis: nextBasis,
  };
}

/**
 * The basis stored with a draft. Accepts the ledger envelope or the whole
 * `structured_json` column, because callers hold both at different moments; a
 * draft saved before this field existed simply has none, and gets no retroactive
 * "findings-changed" flag for text nobody has had the chance to re-review.
 */
export function extractImpressionBasis(raw: unknown): ImpressionBasis | null {
  if (!raw || typeof raw !== "object") return null;
  let rec = raw as Record<string, unknown>;
  if (rec.careObservationLedger && typeof rec.careObservationLedger === "object") {
    rec = rec.careObservationLedger as Record<string, unknown>;
  }
  const row = rec.impressionBasis as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") return null;
  if (typeof row.findingsSignature !== "string" || !row.findingsSignature) return null;
  if (typeof row.impressionFingerprint !== "string") return null;
  const recordedBy = row.recordedBy;
  if (
    recordedBy !== "impression-write" && recordedBy !== "refresh" && recordedBy !== "review"
    && recordedBy !== "unreconciled"
  ) return null;
  return {
    findingsSignature: row.findingsSignature,
    impressionFingerprint: row.impressionFingerprint,
    recordedBy,
  };
}

export type CompositionFinalizeGateState = {
  impressionNeedsRefresh: boolean;
  siblingWarnings: Array<{ sentence: string; token: string; hint: string }>;
  orphanedRecommendations: OrphanedRecommendationWarning[];
  stalePatchCount: number;
};

export function collectCompositionFinalizeGate(opts: {
  impressionNeedsRefresh: boolean;
  findings: string;
  recommendation: string;
  patches: LedgerPatch[];
  provenance?: FieldProvenanceMap;
}): CompositionFinalizeGateState {
  const siblingWarnings = detectUnownedSiblingConflictsForLedger({
    findings: opts.findings,
    patches: opts.patches,
  }).map((w) => ({ ...w, hint: UNOWNED_SIBLING_HINT }));
  const orphanedRecommendations = detectOrphanedRecommendationsForLedger({
    recommendation: opts.recommendation,
    patches: opts.patches,
    provenance: opts.provenance,
  });
  return {
    impressionNeedsRefresh: opts.impressionNeedsRefresh,
    siblingWarnings,
    orphanedRecommendations,
    stalePatchCount: opts.patches.filter((p) => p.stale).length,
  };
}

/**
 * Stale impression blocks finalize unless refreshed or explicitly acknowledged.
 * Sibling warnings and orphaned recommendations never block — they are named so
 * the signer sees them, because deleting either would destroy radiologist text.
 */
export function compositionFinalizeAllowed(opts: {
  impressionNeedsRefresh: boolean;
  impressionRefreshed: boolean;
  impressionReviewedAnyway: boolean;
}): boolean {
  if (!opts.impressionNeedsRefresh || opts.impressionRefreshed) return true;
  return opts.impressionReviewedAnyway;
}

export function patchFindingsContributionBlocked(
  patch: { lastRendered: { findings?: string } },
  findingsText: string,
): boolean {
  const last = (patch.lastRendered.findings ?? "").trim();
  if (!last) return false;
  return !contributionPresent(findingsText, last);
}

export type LedgerHashRow = { findings?: string; impression?: string; recommendation?: string };

/**
 * Flag a restored patch stale when its lastRendered contribution is absent from
 * the live narrative AND the recorded hash differs from a fresh render of that
 * contribution. NEVER auto-deletes.
 */
export function reconcilePatchAgainstNarrative(
  patch: LedgerPatch,
  narrative: ReportNarrative,
  recordedHashes?: LedgerHashRow,
): LedgerPatch {
  const fields: Array<"findings" | "impression"> = ["findings", "impression"];
  let stale = false;
  for (const field of fields) {
    const last = (patch.lastRendered[field] ?? "").trim();
    if (!last) continue;
    const present = contributionPresent(narrative[field], last);
    if (present) continue;
    const recorded = recordedHashes?.[field];
    const fresh = hashText(last);
    if (!recorded || recorded !== fresh || recorded !== hashText(renderedInField(last, narrative[field]))) {
      stale = true;
    }
  }
  return stale ? { ...patch, stale: true } : patch;
}

export function extractRecordedHashes(raw: unknown): Map<string, LedgerHashRow> {
  const out = new Map<string, LedgerHashRow>();
  if (!raw || typeof raw !== "object") return out;
  let rec = raw as Record<string, unknown>;
  if (rec.careObservationLedger && typeof rec.careObservationLedger === "object") {
    rec = rec.careObservationLedger as Record<string, unknown>;
  }
  if (!Array.isArray(rec.patches)) return out;
  for (const row of rec.patches as Array<{ id?: string; lastRenderedHashes?: LedgerHashRow }>) {
    if (row?.id && row.lastRenderedHashes) out.set(row.id, row.lastRenderedHashes);
  }
  return out;
}

export function stampVoiceAuthoredProvenance(
  provenance: NarrativeProvenance,
  written: { findings?: string; impression?: string; recommendation?: string; technique?: string },
): NarrativeProvenance {
  const stamp = (field: keyof typeof written, map: FieldProvenanceMap | undefined): FieldProvenanceMap => {
    const next = { ...(map ?? {}) };
    for (const s of splitToSentences(written[field] ?? "")) {
      const key = normalizeForDedupe(s);
      if (!key) continue;
      const prev = next[key] ?? [];
      next[key] = prev.includes("radiologist-voice") ? prev : [...prev, "radiologist-voice"];
    }
    return next;
  };
  return {
    clinicalHistory: provenance.clinicalHistory,
    findings: stamp("findings", provenance.findings),
    impression: stamp("impression", provenance.impression),
    technique: stamp("technique", provenance.technique),
    recommendation: stamp("recommendation", provenance.recommendation),
  };
}

export function refreshImpressionFromObservations(opts: {
  currentImpression: string;
  patches: LedgerPatch[];
  remainingAbnormalLines: string[];
  provenance?: FieldProvenanceMap;
}): string {
  const keptManual: string[] = [];
  for (const s of splitToSentences(opts.currentImpression)) {
    if (contributionProtected(s, opts.provenance)) keptManual.push(s);
  }
  const fromObs = collectImpressionContributions(opts.patches);
  const seen = new Set(keptManual.map((s) => s.toLowerCase()));
  const out = [...keptManual];
  for (const line of fromObs) {
    if (seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
  }
  for (const line of opts.remainingAbnormalLines) {
    const t = line.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.join("\n");
}
