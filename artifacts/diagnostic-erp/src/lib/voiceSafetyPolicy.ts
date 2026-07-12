/**
 * voiceSafetyPolicy.ts — Ticket M1.6B2 Phase 5/6.
 *
 * Pure safety classification + context gating for parsed voice commands.
 * The policy NEVER executes anything: it says what class a command is, whether
 * it needs explicit confirmation, whether Enter may confirm it, and whether
 * the current workspace context forbids it outright. Execution still runs
 * through the existing M1.5 dispatcher handlers, which keep their own guards —
 * voice can only ever be MORE restrictive than keyboard/mouse, never less.
 */

import type { ParsedVoiceCommand, VoiceIntent } from "./voiceCommandGrammar";

export type VoiceSafetyClass =
  | "SAFE_IMMEDIATE"     // focus/search/refresh/close/viewer-view — no data change
  | "REVERSIBLE_EDIT"    // append text, quick select/remove, park, save
  | "CONFIRM_REQUIRED"   // replace text, dirty next/previous, reload, verify
  | "HIGH_RISK";         // finalize/sign

export type VoiceConfirmationPolicy = "standard" | "strict";

/** Safe workspace context the policy may consult (Phase 5 allowlist). */
export interface VoiceContext {
  studyId: number | null;
  dirty: boolean;
  /** statusLocked || lockedByOther — the workspace's ONE editing gate. */
  isLocked: boolean;
  lockedByOther: boolean;
  lockLost: boolean;
  /** canShowVerify from the workspace (permission + lifecycle, server re-enforces). */
  canVerify: boolean;
  /** Findings editor is in structured (per-section) mode — free-text findings
   *  dictation has no unambiguous target there. */
  structuredFindings: boolean;
  /** The embedded viewer is mounted and controllable. */
  viewerAvailable: boolean;
  confirmationPolicy: VoiceConfirmationPolicy;
}

export interface VoiceSafetyVerdict {
  safetyClass: VoiceSafetyClass;
  requiresConfirmation: boolean;
  /** Enter may confirm a pending preview — NEVER for HIGH_RISK (finalize
   *  keeps its existing explicit confirmation UI; no policy allows a voice/
   *  keyboard shortcut past it). */
  confirmViaEnterAllowed: boolean;
  /** Non-null → command must not run in this context; message explains why. */
  blocked: string | null;
}

function classify(intent: VoiceIntent, ctx: VoiceContext): VoiceSafetyClass {
  switch (intent.type) {
    case "cancel":
    case "confirm":   // applies an ALREADY-classified pending preview; the
    case "handsfree": // session refuses it for HIGH_RISK — control-only here
      return "SAFE_IMMEDIATE";
    case "viewer":
    case "viewer-unsupported":
      return "SAFE_IMMEDIATE";
    case "quick-select":
      return intent.action === "search" ? "SAFE_IMMEDIATE" : "REVERSIBLE_EDIT";
    case "quick-modifier":
      return "REVERSIBLE_EDIT";
    case "dictate":
      return intent.mode === "replace" ? "CONFIRM_REQUIRED" : "REVERSIBLE_EDIT";
    case "workflow":
      switch (intent.command) {
        case "focus-findings":
        case "focus-impression":
        case "focus-quick-search":
        case "close-panel":
        case "refresh":
        case "open-viewer":
          return "SAFE_IMMEDIATE";
        case "save":
        case "park":
        case "unpark":
          return "REVERSIBLE_EDIT";
        case "next":
        case "previous":
          // Leaving with unsaved changes needs an explicit look (Phase 6);
          // the existing canLeaveStudy guard STILL runs on execution.
          return ctx.dirty ? "CONFIRM_REQUIRED" : "REVERSIBLE_EDIT";
        case "reload-current":
        case "verify":
          return "CONFIRM_REQUIRED";
        case "finalize":
          return "HIGH_RISK";
      }
  }
}

function contextBlock(intent: VoiceIntent, ctx: VoiceContext): string | null {
  const readOnlyReason = ctx.lockedByOther
    ? "Study is locked by another user — read-only"
    : "Report is finalized — read-only";

  switch (intent.type) {
    case "dictate":
      if (ctx.isLocked) return readOnlyReason;
      if (intent.target === "findings" && ctx.structuredFindings) {
        return "Findings are in structured mode — switch off Structured to dictate free-text findings";
      }
      return null;
    case "quick-select":
      if (intent.action !== "search" && ctx.isLocked) return readOnlyReason;
      return null;
    case "quick-modifier":
      return ctx.isLocked ? readOnlyReason : null;
    case "viewer":
      return ctx.viewerAvailable ? null : "Embedded viewer is not open for this study";
    case "viewer-unsupported":
      return `The embedded viewer does not support ${intent.capability}`;
    case "workflow":
      switch (intent.command) {
        case "save":
          return ctx.isLocked ? readOnlyReason : null;
        case "finalize":
          if (ctx.lockedByOther) return "Study is locked by another user — finalize is disabled";
          if (ctx.lockLost) return "Your lock expired — reclaim the study before finalizing";
          if (ctx.isLocked) return "Report is already finalized";
          return null;
        case "verify":
          return ctx.canVerify ? null : "Verification is not available for you on this report";
        default:
          return null;
      }
    case "cancel":
    case "confirm":
    case "handsfree":
      return null;
  }
}

/** Classify a parsed command in context. Non-CLEAR parses are always blocked
 *  from execution (belt AND braces — the session never executes them either). */
export function evaluateVoiceCommand(parse: ParsedVoiceCommand, ctx: VoiceContext): VoiceSafetyVerdict {
  if (!parse.intent || parse.confidenceBand !== "CLEAR") {
    return {
      safetyClass: "SAFE_IMMEDIATE",
      requiresConfirmation: false,
      confirmViaEnterAllowed: false,
      blocked: parse.confidenceBand === "AMBIGUOUS"
        ? "Ambiguous command — pick one of the alternatives"
        : "Command not recognized",
    };
  }
  const safetyClass = classify(parse.intent, ctx);
  const blocked = contextBlock(parse.intent, ctx);
  const requiresConfirmation =
    safetyClass === "CONFIRM_REQUIRED" || safetyClass === "HIGH_RISK" ||
    (ctx.confirmationPolicy === "strict" && safetyClass === "REVERSIBLE_EDIT");
  return {
    safetyClass,
    requiresConfirmation,
    confirmViaEnterAllowed: requiresConfirmation && safetyClass !== "HIGH_RISK",
    blocked,
  };
}

/** High-risk voice attempts are audited (Phase 11) — minimal metadata only. */
export function shouldAuditVoiceCommand(intent: VoiceIntent | null): boolean {
  return intent?.type === "workflow" && (intent.command === "finalize" || intent.command === "verify");
}
