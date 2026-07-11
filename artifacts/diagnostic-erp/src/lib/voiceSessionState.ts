/**
 * voiceSessionState.ts — Ticket M1.6B2 Phase 5/8.
 *
 * Pure session-state rules for the voice layer: study/nonce binding (stale
 * results after a study switch are DISCARDED, never executed) and the
 * keyboard-key decisions for the voice controls. Kept separate from
 * matchWorkspaceShortcut so the pinned M1.4/M1.5 shortcut matrix is untouched;
 * the workspace consults voiceKeyAction FIRST and falls through to the
 * existing shortcuts when it returns null.
 */

// ── Capture binding / staleness ──────────────────────────────────────────────

export interface VoiceCaptureBinding {
  studyId: number | null;
  nonce: number;
}

/** A transcription result is stale when the workspace moved on — different
 *  study OR a newer capture generation. Stale results must be discarded. */
export function isStaleVoiceResult(
  bound: VoiceCaptureBinding,
  currentStudyId: number | null,
  currentNonce: number,
): boolean {
  return bound.studyId !== currentStudyId || bound.nonce !== currentNonce;
}

// ── Voice keyboard controls (Phase 8) ────────────────────────────────────────

export type VoiceKeyAction = "toggle-listen" | "ptt-start" | "confirm-pending" | "cancel";

export interface VoiceKeyState {
  /** Voice layer enabled AND a provider is usable. */
  enabled: boolean;
  /** Configured push-to-talk key ("Space" or "off"). */
  pttKey: "Space" | "off";
  /** Currently listening or processing a capture. */
  capturing: boolean;
  /** A parsed command preview is awaiting confirm/cancel. */
  hasPendingPreview: boolean;
  /** Enter may confirm the pending preview (never for HIGH_RISK). */
  confirmViaEnterAllowed: boolean;
}

/** Tags where plain-key voice controls must NEVER fire: typing fields plus
 *  focusable controls Space/Enter already activate natively. */
const BLOCKED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"]);

export function voiceKeyAction(
  e: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
    target?: { tagName?: string; isContentEditable?: boolean } | null;
  },
  state: VoiceKeyState,
): VoiceKeyAction | null {
  if (!state.enabled) return null;
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const key = e.key.toLowerCase();
  const tag = e.target?.tagName?.toUpperCase() ?? "";
  const typing = BLOCKED_TAGS.has(tag) || Boolean(e.target?.isContentEditable);

  // Escape cancels ONLY while the voice layer is active — otherwise null so
  // the existing workspace escape behavior (diagnostics/preview) runs.
  if (key === "escape" && !mod && !e.altKey) {
    return state.capturing || state.hasPendingPreview ? "cancel" : null;
  }

  // Ctrl/Cmd+Space toggles listening — free in the pinned shortcut matrix.
  if (key === " " && mod && !e.altKey && !e.shiftKey) return "toggle-listen";

  // Plain Space = push-to-talk, ONLY outside typing/interactive elements and
  // never on key auto-repeat (hold produces one start; keyup stops).
  if (
    key === " " && !mod && !e.altKey && !e.shiftKey && !typing && !e.repeat &&
    state.pttKey === "Space" && !state.capturing && !state.hasPendingPreview
  ) {
    return "ptt-start";
  }

  // Plain Enter confirms a pending NON-high-risk preview, outside typing.
  if (
    key === "enter" && !mod && !e.altKey && !e.shiftKey && !typing &&
    state.hasPendingPreview && state.confirmViaEnterAllowed
  ) {
    return "confirm-pending";
  }

  return null;
}
