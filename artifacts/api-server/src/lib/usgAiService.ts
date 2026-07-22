/**
 * usgAiService — LIVE bridge for the P8 advisory AI assistant (final-integration
 * wiring; not a pure core). It reuses the merged P8 safety core
 * (buildUsgAiSuggestion / gateUsgAiVisibility / acceptSuggestionIntoDraft /
 * assertAiWriteAllowed) and the canonical AI enablement policy (resolveAiEnablement).
 *
 * Non-negotiable guarantees enforced here:
 *   - AI is shown only when the canonical enablement says so;
 *   - every suggestion is built through buildUsgAiSuggestion (fetal-sex content
 *     refused, confidence clamped, accept-only, target = draft_suggestion);
 *   - acceptance is explicit + non-destructive and re-asserts the write-guard —
 *     AI output can never reach patient_reports / finalize / sign;
 *   - when the model gateway is unavailable, we return an honest "unavailable"
 *     state and NEVER fabricate output.
 *
 * The provider is INJECTED so the gateway stays a swappable dependency (the route
 * wires the canonical gateway; tests inject a stub). Nothing here calls a model
 * directly.
 */

import { type Enablement } from "./ai/aiPolicy";
import {
  buildUsgAiSuggestion, gateUsgAiVisibility, acceptSuggestionIntoDraft,
  type UsgAiSuggestion, type UsgAiSuggestionKind, type AcceptResult,
} from "./usgAiAssistant";

/** Raw model output before safety validation. */
export interface RawAiSuggestion {
  kind: UsgAiSuggestionKind;
  section?: string | null;
  text: string;
  rationale: string;
  confidence: number;
  evidence?: Record<string, string | number | null>;
}

/** A provider yields raw suggestions, or signals it is unavailable. */
export interface UsgAiProvider {
  available(): Promise<boolean>;
  generate(context: Record<string, unknown>): Promise<RawAiSuggestion[]>;
}

export interface SuggestResult {
  visible: boolean;
  available: boolean;
  reason: string;
  suggestions: UsgAiSuggestion[];
}

/**
 * Produce advisory suggestions. Returns hidden/unavailable states honestly and
 * validates every suggestion through the safety core (a suggestion that violates
 * the PCPNDT/sex guard is dropped, never surfaced).
 */
export async function generateUsgSuggestions(
  provider: UsgAiProvider,
  enablement: Enablement,
  context: Record<string, unknown>,
): Promise<SuggestResult> {
  const vis = gateUsgAiVisibility(enablement);
  if (!vis.visible) return { visible: false, available: false, reason: vis.reason, suggestions: [] };

  if (!(await provider.available())) {
    return { visible: true, available: false, reason: "AI model gateway unavailable — manual reporting unaffected", suggestions: [] };
  }

  const raw = await provider.generate(context);
  const suggestions: UsgAiSuggestion[] = [];
  for (const r of raw) {
    try {
      suggestions.push(buildUsgAiSuggestion(r)); // throws on fetal-sex / gender content → dropped
    } catch {
      // A suggestion that fails the safety guard is silently dropped, never shown.
    }
  }
  return { visible: true, available: true, reason: vis.reason, suggestions };
}

/**
 * Apply an accepted suggestion to a draft section's current text. Re-asserts the
 * write-guard (target must be draft_suggestion) and merges non-destructively.
 * This is the ONLY write path AI output can take, and it is a draft, never a
 * signed report.
 */
export function acceptUsgSuggestion(currentText: string, suggestion: UsgAiSuggestion, accepted: boolean): AcceptResult {
  return acceptSuggestionIntoDraft(currentText, suggestion, accepted);
}
