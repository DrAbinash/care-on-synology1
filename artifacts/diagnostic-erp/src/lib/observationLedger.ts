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

export function removeLedgerObservation(
  narrative: ReportNarrative,
  provenance: NarrativeProvenance,
  patch: LedgerPatch,
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

  let nextFindings = findings.text;
  let nextImpression = impression.text;
  if (findings.outcome === "removed") {
    nextFindings = restoreBaselineSentences(nextFindings, patch.replacedBaseline.findings);
  }
  if (impression.outcome === "removed") {
    nextImpression = restoreBaselineSentences(nextImpression, patch.replacedBaseline.impression);
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

const SIBLING_STOP = new Set([
  "lesion", "lesions", "signal", "normal", "abnormal", "intensity", "white", "matter",
  "there", "this", "that", "with", "from", "into", "without", "showing", "appear",
  "appearance", "grade", "space", "spaces", "system", "bilateral",
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
 * Conservative: warn only when leftover unowned text denies a distinctive
 * token the new observation asserts. Never deletes the sentence.
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
 */
export function detectUnownedSiblingConflictsForLedger(opts: {
  findings: string;
  patches: Array<{ lastRendered: { findings?: string }; protected?: boolean }>;
}): UnownedSiblingWarning[] {
  const ownedLastRendered = opts.patches.map((p) => p.lastRendered.findings ?? "");
  const seen = new Set<string>();
  const out: UnownedSiblingWarning[] = [];
  for (const p of opts.patches) {
    if (p.protected) continue;
    const incoming = (p.lastRendered.findings ?? "").trim();
    if (!incoming) continue;
    for (const w of detectUnownedSiblingConflicts({
      findings: opts.findings,
      incomingFindings: incoming,
      ownedLastRendered,
    })) {
      const key = `${w.token}::${normalizeContributionMatch(w.sentence)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

export const UNOWNED_SIBLING_HINT = "Review nearby unowned text after this finding changed.";

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

export function impressionNeedsRefreshFromNarrative(
  impressionText: string,
  patches: LedgerPatch[],
  provenance?: FieldProvenanceMap,
): boolean {
  for (const p of patches) {
    if (p.stale && (p.lastRendered.findings ?? "").trim()) return true;
    const c = (p.lastRendered.impression ?? "").trim();
    if (!c) continue;
    if (p.protected || contributionProtected(c, provenance)) continue;
    if (!contributionPresent(impressionText, c)) return true;
  }
  return false;
}

export type CompositionFinalizeGateState = {
  impressionNeedsRefresh: boolean;
  siblingWarnings: Array<{ sentence: string; token: string; hint: string }>;
  stalePatchCount: number;
};

export function collectCompositionFinalizeGate(opts: {
  impressionNeedsRefresh: boolean;
  findings: string;
  patches: LedgerPatch[];
}): CompositionFinalizeGateState {
  const siblingWarnings = detectUnownedSiblingConflictsForLedger({
    findings: opts.findings,
    patches: opts.patches,
  }).map((w) => ({ ...w, hint: UNOWNED_SIBLING_HINT }));
  return {
    impressionNeedsRefresh: opts.impressionNeedsRefresh,
    siblingWarnings,
    stalePatchCount: opts.patches.filter((p) => p.stale).length,
  };
}

/** Stale impression blocks finalize unless refreshed or explicitly acknowledged. Sibling warnings never block. */
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
