/**
 * The signing door's content refusal, and the one documented way back.
 *
 * Ruling 3 (owner, 2026-11-06) makes an empty Findings/Impression, a blank
 * report or an unresolved `{token}` a reason to refuse a signature, and allows
 * the radiologist past it only with a written reason. The server says all of
 * that in the 409 body (`signedContentRefusal` in
 * `api-server/src/lib/signedReportContentGuard.ts`); this module is the client
 * half of that same contract, and nothing here re-decides policy:
 *
 *  - the minimum reason length comes from the response, not from a copy of the
 *    server's constant, so the two cannot drift apart silently;
 *  - the refusal's own sentence is what the screen shows, because that sentence
 *    is the single place the rule is worded;
 *  - a reason the client rejects is rejected before the request, so the
 *    radiologist is not told to write more by a 409 that has already audited
 *    the attempt.
 *
 * The refusal is deliberately recognised by `code`, never by the message text:
 * `sanitizeApiErrorMessage` hands `error` through verbatim, so a match on the
 * sentence would work in tests and break the first time the wording changed.
 */
import { HttpError } from "./fetchApi";

export type ContentRefusalLevel = "empty" | "placeholder" | "incomplete";

export type ContentRefusal = {
  level: ContentRefusalLevel;
  code: string;
  /** The server's own sentence, shown as written. */
  sentence: string;
  /** Sections judged empty — `findings`, `impression`. */
  sections: string[];
  /** Unresolved tokens, for the `placeholder` level. */
  placeholders: string[];
  /** What the door will accept as a documented reason. */
  minReasonChars: number;
};

/**
 * Only used when the response carries no `override.minReasonChars`. It is the
 * server's current number, and a refusal that predates this feature simply does
 * not carry the field at all — defaulting keeps the way back open rather than
 * inventing a longer rule than the door enforces.
 */
const FALLBACK_MIN_REASON_CHARS = 15;

const LEVELS: ContentRefusalLevel[] = ["empty", "placeholder", "incomplete"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * A content refusal, or null for anything else. `details` is the parsed JSON
 * body the transport attaches to `HttpError` (fetchApi.ts), which is why the
 * classification is read from `code`/`level` rather than from the message.
 */
export function parseContentRefusal(err: unknown): ContentRefusal | null {
  if (!(err instanceof HttpError)) return null;
  const d = err.details as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return null;
  const code = str(d.code);
  const level = str(d.level) as ContentRefusalLevel;
  if (!code.startsWith("report_content_") || !LEVELS.includes(level)) return null;
  const override = d.override as Record<string, unknown> | undefined;
  const minReasonChars = Number(override?.minReasonChars);
  return {
    level,
    code,
    sentence: str(d.error) || err.message,
    sections: Array.isArray(d.sections) ? d.sections.map(str).filter(Boolean) : [],
    placeholders: Array.isArray(d.placeholders) ? d.placeholders.map(str).filter(Boolean) : [],
    minReasonChars: Number.isInteger(minReasonChars) && minReasonChars > 0
      ? minReasonChars
      : FALLBACK_MIN_REASON_CHARS,
  };
}

/**
 * Why this reason cannot be sent, or null when it can. Compared after
 * `trim()`, the same rule the door applies (`readContentOverride`), so a reason
 * the screen accepts is a reason the door accepts.
 */
export function overrideReasonProblem(reason: string, minReasonChars: number): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return `Write why this report is being signed as it stands, in at least ${minReasonChars} characters.`;
  }
  if (trimmed.length < minReasonChars) {
    return `${trimmed.length} of ${minReasonChars} characters — say what the report documents, not just "ok".`;
  }
  return null;
}

/** The exact two fields the door reads; sent on the retry, never on a first attempt. */
export function contentOverrideFields(reason: string): {
  contentOverride: true;
  contentOverrideReason: string;
} {
  return { contentOverride: true, contentOverrideReason: reason.trim() };
}

/**
 * What the refusal block says, in the screen's own words. The sentence from the
 * door is kept because it names the sections and the tokens; this adds the
 * recovery the door's sentence assumes the client has: where to type.
 */
export function contentRefusalHeadline(level: ContentRefusalLevel): string {
  return level === "incomplete"
    ? "Report is unfinished"
    : level === "placeholder"
      ? "Report still has placeholder text"
      : "Report has no content";
}

/**
 * The sign-dialog answer the radiologist ALREADY gave, or null to ask him again.
 *
 * Ruling 3's documented retry re-runs the whole finalize gauntlet on purpose:
 * every service check, the identity assertion and the completion bookkeeping
 * must apply to the retry exactly as they apply to the first attempt. The cost
 * of that design was invisible until someone pressed the button in a real
 * browser — the gauntlet ends in `promptFinalize`, so the retry opened
 * "Finalize and sign this report?" a second time underneath a dialog whose
 * button says "Sign with this reason". One decision, asked twice, with no way
 * for the radiologist to tell that the first answer had already been used; and
 * when that second ask was answered with `Refresh Impression now`, the attempt
 * died on the post-dialog re-check and left the override dialog standing.
 *
 * Reuse is allowed only on the documented-retry leg, only when an answer was
 * actually recorded, and only a CONFIRMED one — so a Cancel, or an answer from
 * any leg he never approved, can never be replayed as his consent. Everything
 * after the prompt still runs: the identity assertion, the live-store re-check
 * of the composition gate, the re-save and the server's own guards.
 */
export function reusableSignPromptAnswer<T extends { confirmed: boolean }>(input: {
  /** True when this leg carries a documented reason, i.e. it IS the retry. */
  overrideAttempt: boolean;
  remembered: T | null;
}): T | null {
  if (!input.overrideAttempt) return null;
  if (input.remembered === null) return null;
  return input.remembered.confirmed ? input.remembered : null;
}
