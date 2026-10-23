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
  /** Ledger observations this session will REMOVE on apply (already on the page). */
  pendingRemovals: Map<string, VoiceObservation>;
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
    pendingRemovals: new Map(),
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
  const pendingRemovals = new Map(session.pendingRemovals);
  const baselineRetirements = new Set(session.baselineRetirements);
  const summary: string[] = [];

  for (const op of plan.observations) {
    if (op.operation === "remove") {
      const id = op.targetObservationId ?? op.id ?? observationId(op);
      if (observations.has(id)) {
        const gone = observations.get(id)!;
        observations.delete(id);
        summary.push(`Removed — ${gone.findingsText}`);
      } else if (pendingRemovals.has(id)) {
        // Already pending removal — nothing to do.
      } else {
        // The target is not in this session: it is a LEDGER observation that is
        // already on the page. Carry it as a pending removal so the one Apply
        // removes it from the report. The composer echoed the target's own
        // findingsText, which is what the apply engine strips.
        pendingRemovals.set(id, {
          id,
          concept: op.concept,
          level: op.level ?? null,
          findingsText: op.findingsText,
          impressionText: op.impressionText,
          anatomicalSection: op.anatomicalSection,
          conflictGroup: op.conflictGroup,
          operation: "remove",
          targetObservationId: id,
        });
        summary.push(`Will remove — ${op.findingsText}`);
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
    pendingRemovals,
    baselineRetirements,
    impressionCandidates: [...session.impressionCandidates],
    transcriptLog: [...session.transcriptLog, transcript],
  };
}

/**
 * The one failure message that must never be wrong: the words are safe.
 * Shown when the composer call throws (network down, request timed out) and
 * no better server-side reason exists.
 */
export const DICTATION_PRESERVED_MSG = "Local composer unavailable — dictation preserved";

/**
 * Reason-code UX: the server answers every provider failure with the same
 * generic "Local composer unavailable" — the WHY rides in
 * `diagnostics.failureReason` (PHI-safe reason codes only, PR #1131/#1141).
 * This maps each code to what the single radiologist should DO next, always
 * keeping the preservation promise visible (the words are in the thread and
 * Retry needs no re-dictation). Server-authored reasons — validation
 * refusals, dictated-detail fidelity — are already human and pass through
 * untouched; unknown codes fall back to the preservation promise.
 */
export function dictationFailureMessage(
  error: string | undefined,
  failureReason: string | undefined,
): string {
  const serverMsg = error?.trim();
  switch (failureReason) {
    case "timeout":
      return "Composer timed out — dictation preserved. Press Retry: the model is warm now, so a retry is usually fast.";
    case "network":
      return "Cannot reach Ollama on the AI PC — dictation preserved. Check the Ollama service, then press Retry.";
    case "model_not_found":
      return "Composer model is missing on the AI PC — dictation preserved. Pull the pinned qwen3:14b, then press Retry.";
    case "schema_invalid":
      return "Model returned malformed output — dictation preserved. Press Retry; the automatic repair already tried once.";
    case "endpoint_refused":
      return "Composer endpoint refused the request — dictation preserved. Check the Ollama URL in Settings, then press Retry.";
    default:
      if (failureReason && /^http_5/.test(failureReason)) {
        return "Ollama server error — dictation preserved. Press Retry; check the AI PC if it repeats.";
      }
      if (failureReason && /^http_4/.test(failureReason)) {
        return "Ollama rejected the composer request — dictation preserved. Press Retry; check the Ollama version if it repeats.";
      }
      // Server-authored reasons (validation, fidelity, clarification) are
      // already specific; unknown codes get the preservation promise.
      return serverMsg || DICTATION_PRESERVED_MSG;
  }
}

/** One compose attempt, normalised for the session fold. */
export type ComposeOutcome =
  | { ok: true; plan: VoiceChangePlan; phraseFallback?: boolean }
  /** Route contract: ok:false + error (+ phraseFallbackAvailable from the route). */
  | { ok: false; error?: string; phraseFallbackAvailable?: boolean };

export type FoldedComposeTurn = {
  session: SmartDictationSession;
  /** Message for the error banner; null on success. */
  error: string | null;
  /** Whether the deterministic phrase-catalog retry lane is offered. */
  phraseFallbackAvailable: boolean;
};

/**
 * Fold ONE compose attempt — success OR failure — into the session.
 *
 * The preservation contract: a failed attempt is a visible conversation
 * turn carrying the radiologist's words verbatim (an error turn via
 * applyTurnToSession), and NOTHING else mutates — no observations, no
 * pending removals, no baseline retirements, no transcript-log provenance —
 * so a failed dictation can never reach the Apply button and the clinical
 * report stays untouched. The hook delegates every failure shape here
 * (route !ok, thrown timeout, refused plan) so the words cannot be
 * silently discarded on any path.
 */
export function foldComposeTurn(
  session: SmartDictationSession,
  transcript: string,
  outcome: ComposeOutcome,
): FoldedComposeTurn {
  const text = transcript.trim();
  if (!text) return { session, error: null, phraseFallbackAvailable: false };

  if (outcome.ok) {
    return {
      session: applyTurnToSession(session, text, outcome.plan, {
        phraseFallback: outcome.phraseFallback,
      }),
      error: null,
      phraseFallbackAvailable: false,
    };
  }

  const msg = outcome.error?.trim() || DICTATION_PRESERVED_MSG;
  return {
    session: applyTurnToSession(session, text, null, { error: msg }),
    error: msg,
    phraseFallbackAvailable: outcome.phraseFallbackAvailable === true,
  };
}

/**
 * The trailing failed turn, if any — the single retry source. Reading the
 * session (what the radiologist SEES) instead of a hidden ref means the
 * retry button can never re-send words that are not on screen, and a turn
 * that later succeeded retires its own retry.
 */
export function lastErrorTurn(
  session: SmartDictationSession,
): SmartDictationTurn | null {
  const turns = session.turns;
  const last = turns[turns.length - 1];
  if (!last || last.status !== "error") return null;
  return last.transcript.trim() ? last : null;
}

/**
 * The ONE consolidated plan the Apply button writes. Every accumulated
 * observation is an add (the accumulated set is already the corrected final
 * state), baseline retirements ride along per-observation exactly like a
 * Quick Select tile apply, and the impression candidates mirror only what
 * was dictated.
 */
export function buildConsolidatedPlan(session: SmartDictationSession): VoiceChangePlan {
  const removals = [...session.pendingRemovals.values()].map((o) => ({
    ...o,
    operation: "remove" as const,
    targetObservationId: o.id,
  }));
  const observations = [...session.observations.values()];
  return {
    operation: "report_change_plan",
    observations: [
      ...removals,
      ...observations.map((o) => ({ ...o, operation: "add" as const })),
    ],
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
  return session.observations.size > 0 || session.pendingRemovals.size > 0;
}

/* ── Hybrid staging: dictate continuously, compose on command ──────────────
 *
 * Owner-approved v1 (2026-10-23): the words land on screen the moment they
 * are dictated — typed lines and completed voice captures accumulate in a
 * staging buffer with ZERO model calls — and ONE Compose press sends the
 * whole batch through the composer. On the AI-PC benchmark (qwen3:14b,
 * median 10.5 s per call) that turns a ten-utterance dictation from ten
 * serial inferences into one, and the model sees the full batch together,
 * which is also how it keeps the best overall context.
 */

/**
 * Append one dictated segment to the staging buffer. Pure text
 * accumulation — nothing here touches the network.
 *
 * An exactly identical re-emit (an STT finalizer re-firing the completed
 * capture, a StrictMode double effect) must not duplicate the
 * radiologist's words; a repeated finding that is only PART of the buffer
 * is legitimate re-dictation and still lands.
 */
export function appendStagedSegment(current: string, segment: string): string {
  const seg = segment.trim().replace(/\s+/g, " ");
  if (!seg) return current;
  const cur = current.trim();
  if (!cur) return seg;
  if (cur === seg) return cur;
  return `${cur} ${seg}`;
}

/** Words in the staging buffer — the N on the Compose button. */
export function stagedWordCount(staged: string): number {
  const t = staged.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Auto-compose pause options, in seconds. 0 = OFF and is the ONLY shipped
 * default — the owner's staging decision was manual Compose first, with
 * automatic composition after a pause as a later opt-in.
 */
export const AUTO_COMPOSE_PAUSE_OPTIONS = [0, 3, 5, 8] as const;

/**
 * Normalise a stored/auto-compose preference to one of the four options.
 * Strict by design: anything that is not exactly 0, 3, 5 or 8 (number or
 * string form) — including garbage from a corrupted store — normalises to
 * 0, OFF. Auto-compose must never come on at a delay nobody chose.
 */
export function normalizeAutoComposeSeconds(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0;
  return (AUTO_COMPOSE_PAUSE_OPTIONS as readonly number[]).includes(n) ? n : 0;
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
