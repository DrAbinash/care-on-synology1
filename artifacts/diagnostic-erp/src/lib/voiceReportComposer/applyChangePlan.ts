/**
 * Apply validated voice change plans through existing pathology patch engine.
 */
import {
  applyPathologyPatch,
  type PathologyOwnership,
  type ReportNarrative,
  type NarrativeProvenance,
} from "../pathologyPatch";
import {
  mergeReportFieldContentWithProvenance,
  normalizeForDedupe,
  splitToSentences,
  type FieldProvenanceMap,
  type InsertSource,
} from "../reportFieldMerge";
import type { VoiceChangePlan, VoiceObservation } from "./types";

export type ApplyChangePlanInput = {
  narrative: ReportNarrative;
  provenance: NarrativeProvenance;
  plan: VoiceChangePlan;
  source?: InsertSource;
  activeObservations?: VoiceObservation[];
};

export type ApplyChangePlanResult = {
  ok: boolean;
  narrative?: ReportNarrative;
  provenance?: NarrativeProvenance;
  replacedBaselines?: string[];
  addedObservations?: string[];
  conflicts?: string[];
  error?: string;
  activeObservations?: VoiceObservation[];
};

export type ChangePreview = {
  adds: string[];
  removes: string[];
  impression?: string;
  untouched: string[];
  conflicts: string[];
  hasConflicts: boolean;
};

const PROTECTED_SOURCES: InsertSource[] = ["manual", "quick-findings", "quick-select"];

function isProtectedSentence(sentence: string, provenance: FieldProvenanceMap | undefined): boolean {
  const key = normalizeForDedupe(sentence);
  if (!key || !provenance?.[key]) return false;
  return provenance[key].some((s) => PROTECTED_SOURCES.includes(s));
}

export function detectProtectedConflicts(
  plan: VoiceChangePlan,
  findings: string,
  provenance?: FieldProvenanceMap,
): string[] {
  const conflicts: string[] = [];
  for (const obs of plan.observations) {
    if (obs.operation === "remove") continue;
    for (const s of splitToSentences(findings)) {
      const owned =
        (obs.baselineReplaces && s.includes(obs.baselineReplaces))
        || (obs.findingsText && normalizeForDedupe(s) === normalizeForDedupe(obs.findingsText));
      if (owned && isProtectedSentence(s, provenance)) {
        conflicts.push(s);
      }
    }
  }
  return conflicts;
}

const VOICE_SOURCE: InsertSource = "radiologist-voice";

function ownershipFromObservation(obs: VoiceObservation): PathologyOwnership {
  const levelKey = (obs.level ?? "").replace(/\s+/g, "").toUpperCase();
  const baseGroup = obs.conflictGroup ?? obs.anatomicalSection;
  return {
    anatomicalSection: obs.anatomicalSection,
    conflictGroup: levelKey && baseGroup ? `${baseGroup}_${levelKey}` : baseGroup,
    baselineReplaces: obs.baselineReplaces,
  };
}

function removeObservationFromNarrative(
  narrative: ReportNarrative,
  provenance: NarrativeProvenance,
  obs: VoiceObservation,
): { narrative: ReportNarrative; provenance: NarrativeProvenance } {
  const strip = (text: string, target: string) =>
    text
      .split(/\n+/)
      .filter((line) => line.trim() !== target.trim())
      .join("\n");

  const findings = strip(narrative.findings, obs.findingsText);
  const impression = obs.impressionText
    ? strip(narrative.impression, obs.impressionText)
    : narrative.impression;

  return {
    narrative: { ...narrative, findings, impression },
    provenance: { ...provenance },
  };
}

export function applyChangePlan(input: ApplyChangePlanInput & { force?: boolean }): ApplyChangePlanResult {
  const source = input.source ?? VOICE_SOURCE;
  let narrative = { ...input.narrative };
  let provenance: NarrativeProvenance = {
    findings: { ...input.provenance.findings },
    impression: { ...input.provenance.impression },
    technique: { ...input.provenance.technique },
    recommendation: { ...input.provenance.recommendation },
  };

  const replacedBaselines: string[] = [];
  const addedObservations: string[] = [];
  let activeObservations = [...(input.activeObservations ?? [])];

  if (input.plan.clarificationRequired?.trim()) {
    return { ok: false, error: input.plan.clarificationRequired.trim() };
  }

  const conflicts = detectProtectedConflicts(
    input.plan,
    narrative.findings,
    provenance.findings,
  );
  if (conflicts.length && !input.force) {
    return {
      ok: false,
      error: "Cannot overwrite explicit manual or Quick Select finding",
      conflicts,
    };
  }

  // Impression-only update
  if (input.plan.impressionUpdate?.trim() && !input.plan.observations.length) {
    const merged = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: narrative.impression,
      incoming: input.plan.impressionUpdate.trim(),
      source,
      existingProvenance: provenance.impression ?? {},
    });
    narrative.impression = merged.text;
    provenance.impression = merged.provenance;
    return { ok: true, narrative, provenance, activeObservations };
  }

  for (const obs of input.plan.observations) {
    const op = obs.operation ?? "add";

    if (op === "remove") {
      const target = activeObservations.find(
        (o) => o.id === obs.targetObservationId || o.concept === obs.concept,
      );
      if (target) {
        const removed = removeObservationFromNarrative(narrative, provenance, target);
        narrative = removed.narrative;
        provenance = removed.provenance;
        activeObservations = activeObservations.filter((o) => o.id !== target.id);
      }
      continue;
    }

    if (op === "update") {
      const target = activeObservations.find(
        (o) => o.id === obs.targetObservationId || o.concept === obs.concept,
      );
      if (target) {
        const removed = removeObservationFromNarrative(narrative, provenance, target);
        narrative = removed.narrative;
        provenance = removed.provenance;
        activeObservations = activeObservations.filter((o) => o.id !== target.id);
      }
    }

    const levelDistinctAdd =
      op === "add" &&
      obs.level &&
      activeObservations.some((o) => o.level && o.level !== obs.level);

    if (levelDistinctAdd) {
      const merged = mergeReportFieldContentWithProvenance({
        field: "findings",
        existing: narrative.findings,
        incoming: obs.findingsText,
        source,
        existingProvenance: provenance.findings ?? {},
      });
      narrative.findings = merged.text;
      provenance.findings = merged.provenance;
      if (obs.impressionText?.trim()) {
        const imp = mergeReportFieldContentWithProvenance({
          field: "impression",
          existing: narrative.impression,
          incoming: obs.impressionText,
          source,
          existingProvenance: provenance.impression ?? {},
        });
        narrative.impression = imp.text;
        provenance.impression = imp.provenance;
      }
      addedObservations.push(obs.findingsText);
      const obsId = obs.id ?? `voice_${obs.concept}_${Date.now().toString(36)}`;
      activeObservations = [...activeObservations.filter((o) => o.id !== obsId), { ...obs, id: obsId }];
      continue;
    }

    const ownership = ownershipFromObservation(obs);
    const patch = applyPathologyPatch({
      existing: narrative,
      incoming: {
        findings: obs.findingsText,
        impression: obs.impressionText,
      },
      ownership,
      provenance,
      source,
    });

    narrative = patch.narrative;
    provenance = patch.provenance;
    replacedBaselines.push(...patch.replacedSentences);
    addedObservations.push(obs.findingsText);

    const obsId = obs.id ?? `voice_${obs.concept}_${Date.now().toString(36)}`;
    activeObservations = [
      ...activeObservations.filter((o) => o.id !== obsId),
      { ...obs, id: obsId },
    ];
  }

  const impCandidate = input.plan.impressionUpdate ?? input.plan.impressionCandidates?.[0];
  if (impCandidate?.trim()) {
    const merged = mergeReportFieldContentWithProvenance({
      field: "impression",
      existing: narrative.impression,
      incoming: impCandidate.trim(),
      source,
      existingProvenance: provenance.impression ?? {},
    });
    narrative.impression = merged.text;
    provenance.impression = merged.provenance;
  }

  return {
    ok: true,
    narrative,
    provenance,
    replacedBaselines,
    addedObservations,
    activeObservations,
  };
}

export function buildChangePreview(input: ApplyChangePlanInput): ChangePreview {
  const beforeSentences = splitToSentences(input.narrative.findings);
  const conflicts = detectProtectedConflicts(
    input.plan,
    input.narrative.findings,
    input.provenance.findings,
  );

  if (input.plan.clarificationRequired?.trim()) {
    return { adds: [], removes: [], untouched: beforeSentences, conflicts, hasConflicts: true };
  }

  const result = applyChangePlan({ ...input, force: true });
  if (!result.ok || !result.narrative) {
    return {
      adds: [],
      removes: [],
      untouched: beforeSentences,
      conflicts,
      hasConflicts: conflicts.length > 0,
    };
  }

  const afterSentences = splitToSentences(result.narrative.findings);
  const removedSet = new Set((result.replacedBaselines ?? []).map(normalizeForDedupe));
  const untouched = beforeSentences.filter((s) => {
    const key = normalizeForDedupe(s);
    return !removedSet.has(key) && afterSentences.some((a) => normalizeForDedupe(a) === key);
  });

  return {
    adds: result.addedObservations ?? [],
    removes: result.replacedBaselines ?? [],
    impression: input.plan.impressionUpdate ?? input.plan.impressionCandidates?.[0],
    untouched,
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

export function previewChangePlan(input: ApplyChangePlanInput): {
  adds: string[];
  removes: string[];
  impression?: string;
} {
  const preview = buildChangePreview(input);
  return {
    adds: preview.adds,
    removes: preview.removes,
    impression: preview.impression,
  };
}
