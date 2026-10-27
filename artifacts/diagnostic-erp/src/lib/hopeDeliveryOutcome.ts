import { HttpError, isHttpError, NetworkError } from "./fetchApi";

/**
 * What the radiologist should be told after the post-sign auto-push to Hope.
 *
 * `POST /api/internal/radiology/send-report-to-hope` answers with
 * `{ ok, emitted, alreadySent, dispatched }` on success and `{ ok: false, error, code }`
 * at 404/409/500 on refusal (internal-radiology.ts:1912-1938). All of that reached the
 * workspace and then fell into one `.catch(() => {})`, so a report that never left CARE
 * looked exactly like a report Hope had.
 *
 * The rule this encodes: **enqueue is not delivery.** `ok: true` only means a row exists
 * in `integration_outbox`; whether Hope accepted it is in `dispatched.sent / .failed`.
 * Nothing here may claim delivery on an enqueue alone.
 */

export type HopeDeliveryKind =
  /** Hope accepted the report. */
  | "delivered"
  /** Queued, or not queued but automatically recoverable — no action needed yet. */
  | "pending"
  /** This study is simply not a Hope referral. Not a failure; says nothing. */
  | "absent"
  /** A genuine delivery failure a person has to be able to see. */
  | "failed";

export interface HopeDeliveryOutcome {
  kind: HopeDeliveryKind;
  /** Toast title. Null means: show nothing at all. */
  title: string | null;
  description: string | null;
  /** Only genuine failures may render destructively. */
  destructive: boolean;
}

export interface HopeEmitSuccess {
  ok: true;
  emitted?: boolean;
  alreadySent?: boolean;
  reportId?: number;
  /** THIS report's own delivery evidence — never a batch counter. `dead` is the
   *  state in which CARE has stopped retrying, which only a person can clear. */
  dispatched?: { sent: number; failed: number; dead?: number } | null;
}

export interface HopeEmitRefusal {
  ok?: false;
  error?: string;
  code?: string;
}

export interface HopeDeliveryToast {
  title: string;
  description?: string;
  variant: "default" | "destructive";
  duration: number;
}

/**
 * The toast props for an outcome, or null when the outcome must stay silent.
 *
 * Kept separate from the classification so the call site cannot re-decide for itself
 * what "success" means — that decision is the defect this module exists to fix.
 */
export function hopeDeliveryToast(outcome: HopeDeliveryOutcome): HopeDeliveryToast | null {
  if (!outcome.title) return null;
  return {
    title: outcome.title,
    description: outcome.description ?? undefined,
    variant: outcome.destructive ? "destructive" : "default",
    // A delivery failure has to be readable; a routine confirmation must not linger.
    duration: outcome.destructive ? 8000 : 2500,
  };
}

/** A study with no Hope referral is the ordinary case, not an error state. */
const BENIGN_CODES = new Set(["NO_REFERRAL"]);

/**
 * Codes meaning the report is NOT on its way to Hope and somebody must see that.
 *
 * `NOT_FOUND` also carries PR #993's cross-patient refusal, where `error` is already a
 * sentence saying the linked report belongs to a different patient. Surfacing that
 * verbatim is the point: a study/report association failure that prints as silence is
 * how a misfiled result leaves the building unnoticed.
 */
const FAILURE_CODES = new Set(["EMIT_FAILED", "NOT_FOUND", "NOT_SIGNED"]);

/**
 * One classification for one refusal body, whichever transport shape it arrived in.
 *
 * Keyed on `code`, never on prose, so `ok:false` cannot mean two different things
 * depending on whether the HTTP layer threw.
 */
function classifyRefusal(body: HopeEmitRefusal, httpStatus?: number): HopeDeliveryOutcome {
  const code = typeof body.code === "string" ? body.code : null;
  const sentence = typeof body.error === "string" && body.error.trim() ? body.error.trim() : null;

  if (code && BENIGN_CODES.has(code)) {
    return { kind: "absent", title: null, description: null, destructive: false };
  }

  const named = code && FAILURE_CODES.has(code)
    ? sentence
    : sentence ?? (httpStatus != null ? `Hope delivery refused (HTTP ${httpStatus}).` : null);

  return {
    kind: "failed",
    title: "Signed, but not sent to Hope",
    description: `${named ?? "Hope delivery did not complete."} The report is signed and stays in CARE.`,
    destructive: true,
  };
}

/**
 * Classify a 2xx body. `ok:false` is handled here too, because a caller may resolve the
 * body without the transport ever throwing.
 */
export function classifyHopeDeliveryResponse(res: unknown): HopeDeliveryOutcome {
  if (res && typeof res === "object" && (res as HopeEmitRefusal).ok === false) {
    return classifyRefusal(res as HopeEmitRefusal);
  }

  const ok = (res ?? {}) as HopeEmitSuccess;
  const dispatched = ok.dispatched ?? null;

  // Checked before `sent`: by construction the two cannot both be set, but a
  // response that claimed both must never resolve to "delivered".
  if (dispatched && (dispatched.dead ?? 0) > 0) {
    return {
      kind: "failed",
      title: "Signed, but Hope stopped receiving it",
      description: "CARE exhausted its retries for this report — it will not go out on its own. The report is signed and stays in CARE. Retry it from “Sync errors” on the Hope connection screen once the cause is fixed.",
      destructive: true,
    };
  }

  if (dispatched && dispatched.sent > 0) {
    return {
      kind: "delivered",
      title: ok.alreadySent ? "Already on Hope" : "Sent to Hope",
      description: "Report is available on Hope ERP investigations.",
      destructive: false,
    };
  }

  if (dispatched && dispatched.failed > 0) {
    // Enqueued but not accepted this pass — the outbox owns the retry, so this is
    // pending. It must not read as success, because it is not yet on Hope.
    return {
      kind: "pending",
      title: "Signed. Queued for Hope.",
      description: "CARE could not reach Hope this time. The report is queued and will be retried automatically.",
      destructive: false,
    };
  }

  // ok:true with no dispatch evidence: queued, delivery unproven.
  return {
    kind: "pending",
    title: "Signed. Queued for Hope.",
    description: "The report is queued for Hope and will be delivered automatically.",
    destructive: false,
  };
}

/** Classify a thrown error from the same call. */
export function classifyHopeDeliveryError(err: unknown): HopeDeliveryOutcome {
  if (isHttpError(err)) {
    const e = err as HttpError;
    return classifyRefusal((e.details ?? {}) as HopeEmitRefusal, e.status);
  }

  // The server never answered, so THIS call enqueued nothing. That is still recoverable
  // rather than lost, by existing machinery: `reconcileResults` (resultsEmitter.ts:45-83)
  // takes referrals with a `care_order_id`, finds reports whose `patient_reports.order_id`
  // equals it, and skips only rows that already have an `external_result_links` row — so a
  // report never enqueued is re-emitted on the next 5-minute tick. That covers exactly the
  // reports the auto-push can reach, because both order_id sources are the same column:
  // the create prefill returns `radiology_studies.order_id` (patient-reports.ts:3737), the
  // emit-time billed fallback reads it (emitReportToHope.ts:171-189), and the
  // reporting-studio writer stores it (internal-reporting-studio.ts:882). Hence "pending",
  // worded to describe that retry without promising a mechanism this PR did not add.
  if (err instanceof NetworkError) {
    return {
      kind: "pending",
      title: "Signed. Hope delivery is retrying.",
      description: "CARE could not reach the delivery service, so it will retry automatically. The report is signed.",
      destructive: false,
    };
  }

  return {
    kind: "failed",
    title: "Signed, but not sent to Hope",
    description: "Hope delivery did not complete. The report is signed and stays in CARE.",
    destructive: true,
  };
}
