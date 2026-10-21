/**
 * Smart Dictation session — the client-side ChatGPT-style accumulator.
 *
 * Task 15 (Part E): the radiologist dictates multiple findings naturally,
 * sees ONE consolidated preview, applies everything in a single write, and
 * can keep correcting conversationally afterwards. The backend compose call
 * stays stateless; THIS module is the session state that makes it
 * conversational:
 *
 *   - every turn composes against the observations accumulated SO FAR
 *   - add    -> upsert by concept+level (restating a finding updates it)
 *   - update -> replaces the target's text with the corrected template
 *   - remove -> drops the target from the session
 *   - the consolidated plan is the accumulated set as adds + the union of
 *     every baselineReplaces, so normal retirement happens once, on apply,
 *     through the SAME pathology-patch engine Quick Select uses.
 *
 * Preservation guarantees (owner contract):
 *   - clinician-owned text, unrelated normals and measurements are never in
 *     the plan — they are only ever filtered OUT of the report by the
 *     protected-provenance + baseline-replacement rules in applyChangePlan
 *   - nothing is invented: every observation came back from the composer,
 *     which only maps dictated phrases onto catalog wording
 */

import type { VoiceChangePlan, VoiceObservation } from "./types";

export type SmartDictationTurn = {
  /** Ordinal within the session (1-based). */
  n: number;
  transcript: string;
  /** "accepted" | "clarification" | "error" */
  status: "accepted" | "clarification" | "error";
  /** What the composer recognised — shown as the assistant reply. */
  summary?: string[];
  /** Composer explanation for clarification/error turns. */
  note?: string;
  phraseFallback?: boolean;
};

export type SmartDictationSession = {
  turns: SmartDictationTurn[];
  /** Accumulated observation set keyed by id. */
  observations: Map<string, VoiceObservation>;
  /** Union of every baselineReplaces the dictations will retire on apply. */
  baselineRetirements: Set<string>;
  /** Union of impression candidates. */
  impressionCandidates: string[];
  /** Full transcript log — applied as provenance when the plan is written. */
  transcriptLog: string[];
};

export function newSmartDictationSession(): SmartDictationSession {
  return {
    turns: [],
    observations: new Map(),
    baselineRetirements: new Set(),
    impressionCandidates: [],
    transcriptLog: [],
  };
}

function observationId(obs: VoiceObservation): string {
  if (obs.id) return obs.id;
  if (obs.targetObservationId) return obs.targetObservationId;
  return `obs_${obs.concept}_${obs.level ?? "unlevelled"}`;
}

/**
 * Fold one composer plan into the session. Returns the turn record for the
 * conversation UI. Clarifications and errors change nothing (zero-mutation).
 */
export function applyTurnToSession(
  session: SmartDictationSession,
  transcript: string,
  plan: VoiceChangePlan | null,
  opts?: { phraseFallback?: boolean; error?: string },
): SmartDictationSession {
  const turn: SmartDictationTurn = {
    n: session.turns.length + 1,
    transcript,
    status: "accepted",
    phraseFallback: opts?.phraseFallback,
  };

  if (opts?.error) {
    turn.status = "error";
    turn.note = opts.error;
    return { ...session, turns: [...session.turns, turn] };
  }

  if (!plan) {
    turn.status = "error";
    turn.note = "No change plan returned — dictation preserved";
    return { ...session, turns: [...session.turns, turn] };
  }

  if (plan.clarificationRequired?.trim()) {
    turn.status = "clarification";
    turn.note = plan.clarificationRequired.trim();
    return { ...session, turns: [...session.turns, turn] };
  }

  const observations = new Map(session.observations);
  const baselineRetirements = new Set(session.baselineRetirements);
  const summary: string[] = [];

  for (const op of plan.observations) {
    if (op.operation === "remove") {
      const id = op.targetObservationId ?? op.id ?? observationId(op);
      if (observations.has(id)) {
        const gone = observations.get(id)!;
        observations.delete(id);
        summary.push(`Removed — ${gone.findingsText}`);
      } else {
        // Concept-scoped removal (target id resolved server-side only as a
        // hint): drop every accumulated observation of the same concept family.
        for (const key of [...observations.keys()]) {
          const o = observations.get(key)!;
          if (o.concept === op.concept) {
            observations.delete(key);
            summary.push(`Removed — ${o.findingsText}`);
          }
        }
      }
      continue;
    }

    // add | update — upsert the accumulated set.
    const id = op.id ?? op.targetObservationId ?? observationId(op);
    const replaced = observations.get(id);
    observations.set(id, { ...op, id, operation: "add" });
    summary.push(
      replaced
        ? `Updated — ${op.findingsText}`
        : `Will add — ${op.findingsText}`,
    );
    if (op.baselineReplaces?.trim()) baselineRetirements.add(op.baselineReplaces.trim());
  }

  if (plan.impressionUpdate?.trim()) {
    summary.push(`Impression — ${plan.impressionUpdate.trim()}`);
  }
  for (const imp of plan.impressionCandidates ?? []) {
    if (imp?.trim() && !session.impressionCandidates.includes(imp)) {
      session.impressionCandidates.push(imp);
    }
  }

  return {
    turns: [...session.turns, { ...turn, summary }],
    observations,
    baselineRetirements,
    impressionCandidates: [...session.impressionCandidates],
    transcriptLog: [...session.transcriptLog, transcript],
  };
}

/**
 * The ONE consolidated plan the Apply button writes. Every accumulated
 * observation is an add (the accumulated set is already the corrected final
 * state), baseline retirements ride along per-observation exactly like a
 * Quick Select tile apply, and the impression candidates mirror only what
 * was dictated.
 */
export function buildConsolidatedPlan(session: SmartDictationSession): VoiceChangePlan {
  const observations = [...session.observations.values()];
  return {
    operation: "report_change_plan",
    observations: observations.map((o) => ({ ...o, operation: "add" as const })),
    removeConflictingBaselineConcepts: [...session.baselineRetirements],
    impressionCandidates: [...session.impressionCandidates],
    uncertainties: [],
    clarificationRequired: null,
  };
}

/** Active observations array — the priorObservations for the NEXT compose. */
export function sessionObservations(session: SmartDictationSession): VoiceObservation[] {
  return [...session.observations.values()];
}

/** True when the session carries at least one pending change. */
export function sessionHasPending(session: SmartDictationSession): boolean {
  return session.observations.size > 0;
}

/**
 * Six-exam gate (frontend copy of api-server voiceReportComposer/regions.ts —
 * kept dependency-free so it can run in the Vite graph without importing the
 * API server). Covers MRI Brain / LS Spine / Cervical Spine complete plus
 * the lumbar, cervical and whole-spine screening protocols; dorsal composes
 * only inside whole-spine.
 */
export function smartDictationSupportedForStudy(
  region: string | null | undefined,
  modality: string | null | undefined,
): boolean {
  if (!region) return false;
  const r = String(region).trim();
  if (!r) return false;
  if (modality && /us|usg|ct|xr|x-ray|xray|mg|mammo/i.test(modality)) return false;
  if (/^\s*dorsal(?:\s+spine)?\s*$/i.test(r)) return false;
  if (/^dorsal/i.test(r) && !/whole/i.test(r)) return false;
  return /\b(brain|ls spine|ls-spine|lumbar|lumbosacral|cervical|whole spine|whole-spine)\b/i.test(r);
}
