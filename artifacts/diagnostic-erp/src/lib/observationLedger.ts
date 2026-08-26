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
  contributionPresent,
  contributionProtected,
  type CanonicalObservation,
  type ObservationSlotInput,
} from "./observationSlot";

export type LedgerPatch = {
  id: string;
  observation: CanonicalObservation;
  templates: PathologyIncoming;
  lastRendered: PathologyIncoming;
  replacedBaseline: { findings: string[]; impression: string[] };
  source: InsertSource;
  protected: boolean;
};

export type RemoveContributionOutcome = "removed" | "preserved-manual" | "no-op-unproven";

/** Contribution as it actually appears after sentence split / merge. */
export function renderedInField(incoming: string | undefined, field: string): string {
  const c = (incoming ?? "").trim();
  if (!c) return "";
  if (field.includes(c)) return c;
  const parts = splitToSentences(c).filter((s) => field.includes(s));
  return parts.join("\n");
}

function contributionChunks(contribution: string): string[] {
  const c = contribution.trim();
  if (!c) return [];
  const parts = splitToSentences(c);
  return parts.length > 0 ? parts : [c];
}

export function stripContribution(
  fieldText: string,
  contribution: string | undefined,
  provenance: FieldProvenanceMap | undefined,
): { text: string; outcome: RemoveContributionOutcome } {
  const c = (contribution ?? "").trim();
  if (!c) return { text: fieldText, outcome: "removed" };
  if (!contributionPresent(fieldText, c)) {
    return { text: fieldText, outcome: "no-op-unproven" };
  }
  const chunks = contributionChunks(c);
  if (chunks.some((chunk) => contributionProtected(chunk, provenance)) || contributionProtected(c, provenance)) {
    return { text: fieldText, outcome: "preserved-manual" };
  }
  let next = fieldText;
  if (next.includes(c)) {
    next = removeBlock(next, c);
  } else {
    for (const chunk of chunks) {
      next = removeBlock(next, chunk);
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
};

function hashText(s: string | undefined): string {
  const t = (s ?? "").trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return `${t.length}:${h.toString(16)}`;
}

export function serializeObservationLedger(patches: LedgerPatch[]): SerializedObservationLedger {
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
  };
}

export function deserializeObservationLedger(raw: unknown): LedgerPatch[] | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.kind !== OBSERVATION_LEDGER_KIND || rec.version !== 1) return null;
  if (!Array.isArray(rec.patches)) return null;
  return rec.patches.map((p) => {
    const row = p as LedgerPatch;
    return {
      id: row.id,
      observation: row.observation,
      templates: row.templates ?? {},
      lastRendered: row.lastRendered ?? {},
      replacedBaseline: row.replacedBaseline ?? { findings: [], impression: [] },
      source: row.source,
      protected: Boolean(row.protected),
    };
  });
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

export function impressionNeedsRefreshFromNarrative(
  impressionText: string,
  patches: LedgerPatch[],
  provenance?: FieldProvenanceMap,
): boolean {
  for (const p of patches) {
    const c = (p.lastRendered.impression ?? "").trim();
    if (!c) continue;
    if (p.protected || contributionProtected(c, provenance)) continue;
    if (!contributionPresent(impressionText, c)) return true;
  }
  return false;
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
