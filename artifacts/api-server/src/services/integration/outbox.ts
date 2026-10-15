// ============================================================================
// Transactional outbox → HOPE (brief §16, §20). Events are enqueued in the same
// transaction as the state change that produced them, then a cron dispatcher
// delivers them to the partner's signed callback URL with retry + exponential
// backoff + dead-lettering. Idempotent on event_id/idempotency_key; the
// receiver dedupes on event_id too. No PHI beyond the minimal payload; secrets
// are read from env, never logged.
//
// Delivery is AT-LEAST-ONCE with a stable event_id, by design: a POST that times
// out may still have been accepted by HOPE, and every retry re-sends the same
// event_id, body field and x-care-event-id header, so the receiver dedupes rather
// than the sender pretending to know. Reclaiming an abandoned 'sending' event
// re-enters that same path and inherits exactly that guarantee — it adds no new
// duplicate window, because the timeout-retry path already re-sends.
//
// At-least-once applies to the HTTP request. It does NOT apply to the event's state:
// every write-back is fenced on `status='sending' AND locked_by=<this dispatch> AND
// locked_at=<the stamp this dispatch wrote>`, so only the worker that currently owns
// an event decides whether it is sent, retried or dead-lettered. Two independent
// deliveries of one event_id are survivable by HOPE; a `dead` written over a report
// HOPE already received, or a `pending` written over one, is not.
// ============================================================================
import { createHmac, randomUUID } from "node:crypto";
import { sql, and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  integrationOutboxTable,
  integrationDeliveryAttemptsTable,
  integrationPartnersTable,
  externalResultLinksTable,
} from "@workspace/db";
import type { Executor } from "./db";

export interface EnqueueInput {
  eventType: string;
  eventVersion?: string;
  idempotencyKey?: string;
  correlationId?: string | null;
  aggregateType?: string;
  aggregateId?: string | null;
  partnerId?: number | null;
  destinationOrg?: string;
  payload: Record<string, unknown>;
}

/**
 * Enqueue an outbound event. Pass a transaction (`exec`) to make the enqueue
 * atomic with the state change. Idempotent: a duplicate idempotency_key is a
 * no-op that returns the existing row.
 */
export async function enqueueOutboxEvent(exec: Executor, input: EnqueueInput) {
  const eventId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? `${input.eventType}:${input.aggregateId ?? ""}:${eventId}`;

  // Idempotency guard (works both in and out of a transaction).
  const existing = await exec
    .select()
    .from(integrationOutboxTable)
    .where(eq(integrationOutboxTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing[0]) return existing[0];

  const [row] = await exec
    .insert(integrationOutboxTable)
    .values({
      eventId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? "1.0",
      idempotencyKey,
      correlationId: input.correlationId ?? null,
      aggregateType: input.aggregateType ?? "diagnostic_referral",
      aggregateId: input.aggregateId ?? null,
      partnerId: input.partnerId ?? null,
      destinationOrg: input.destinationOrg ?? "HOPE",
      payload: input.payload as never,
      status: "pending",
      nextAttemptAt: new Date(),
    })
    .returning();
  return row;
}

/** HMAC-SHA256 over `${timestamp}.${body}`, hex. */
export function signBody(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

interface DeliveryConfig {
  url: string | null;
  secret: string | null;
}

async function deliveryConfigFor(partnerId: number | null): Promise<{ code: string; cfg: DeliveryConfig }> {
  let code = "HOPE";
  let dbUrl: string | null = null;
  if (partnerId != null) {
    const [p] = await db.select().from(integrationPartnersTable).where(eq(integrationPartnersTable.id, partnerId)).limit(1);
    if (p) {
      code = p.code;
      dbUrl = p.callbackUrl ?? null;
    }
  }
  const envUrl = process.env[`INTEGRATION_${code}_CALLBACK_URL`] ?? null;
  const secret = process.env[`INTEGRATION_${code}_SIGNING_SECRET`] ?? null;
  return { code, cfg: { url: envUrl ?? dbUrl, secret } };
}

function backoffMs(attempts: number): number {
  // 30s, 60s, 120s ... capped at 1h.
  return Math.min(30_000 * Math.pow(2, Math.max(0, attempts - 1)), 60 * 60 * 1000);
}

/**
 * How long a `sending` row may go without its owner touching it before another
 * worker may take it back.
 *
 * A timeout is NOT evidence that a worker is dead, so the lease has to be provably
 * longer than the gap a live worker leaves between touches. `heartbeatOwnedLeases`
 * below re-stamps every row this dispatch still holds, immediately before each row's
 * own HTTP attempt, so that gap is one delivery (`timeoutMs`) plus a query — never
 * the whole batch. Stamping only the row about to be sent would leave its still-
 * queued siblings on the claim-time stamp: at production settings (limit 50, 15s
 * each) row 8 would lapse 90s into a 12.5-minute batch and be reclaimed and delivered
 * a second time by the next tick while this worker was still healthy. That is a
 * duplicate clinical report caused by the recovery mechanism itself.
 *
 * Three times `timeoutMs`, floored at 90s, keeps the margin wide without making a
 * crashed job wait long: the dispatcher ticks every minute, so an abandoned event is
 * moving again within two or three ticks.
 */
export function staleLeaseMs(timeoutMs: number): number {
  return Math.max(timeoutMs * 3, 90_000);
}

async function postWithTimeout(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    const text = await res.text().catch(() => "");
    return { status: res.status, text: text.slice(0, 2000) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-stamp `locked_at` on every claimed row this worker still owns and return that
 * set. Rows that left the batch (sent, failed back to pending, dead-lettered, or
 * reclaimed by someone else) do not match and are absent from the result, so callers
 * get a fresh lease and an ownership check for the price of one statement.
 *
 * `stamp` is written, not read: the caller keeps it and hands it to
 * `finalizeOwnedTransition` as the fencing token for the row it is about to deliver.
 */
async function heartbeatOwnedLeases(claimedIds: number[], workerId: string, stamp: Date): Promise<Set<number>> {
  const held = await db
    .update(integrationOutboxTable)
    .set({ lockedAt: stamp })
    .where(and(
      inArray(integrationOutboxTable.id, claimedIds),
      eq(integrationOutboxTable.status, "sending"),
      eq(integrationOutboxTable.lockedBy, workerId),
    ))
    .returning({ id: integrationOutboxTable.id });
  return new Set(held.map((h) => h.id));
}

/**
 * Apply a delivery outcome to an event only if this dispatch still owns it, and
 * report whether it was applied.
 *
 * PR #995's guard sits BEFORE the POST and so cannot cover the write-back: in the
 * window between "I still hold this row" and "here is what HOPE answered" the lease
 * can lapse and the recovery reclaim the event, another worker can deliver it, or an
 * administrator can retry it. An unconditional `UPDATE … WHERE id = ?` then let the
 * stale worker decide the state of an event it no longer owned — measured on the
 * merged code: its 200 wrote `sent` over a live owner, its 500 pushed a held event
 * back to `pending`, its timeout dead-lettered a row another worker was holding, and
 * a late failure moved an event HOPE had already received from `sent` back to
 * `pending`. On a clinical integration the last two are the dangerous ones: a report
 * HOPE has gets re-queued for a second delivery, or is marked permanently dead.
 *
 * The predicate is the heartbeat's own, plus the `locked_at` this dispatch wrote —
 * that stamp is the fencing token. `locked_by` alone is not sufficient: a caller that
 * supplies its own `workerId` (the admin trigger, a re-entrant tick, a test) can have
 * a row taken over by a different dispatch carrying the same name, and only the
 * token separates them. Tested directly (Test 21).
 *
 * PostgreSQL returns no error for an UPDATE that matched nothing, so the decision is
 * read from `RETURNING`, never inferred from the call succeeding.
 */
async function finalizeOwnedTransition(
  rowId: number,
  workerId: string,
  leaseToken: Date,
  patch: Partial<typeof integrationOutboxTable.$inferInsert>,
): Promise<boolean> {
  const adopted = await db
    .update(integrationOutboxTable)
    .set(patch)
    .where(and(
      eq(integrationOutboxTable.id, rowId),
      eq(integrationOutboxTable.status, "sending"),
      eq(integrationOutboxTable.lockedBy, workerId),
      eq(integrationOutboxTable.lockedAt, leaseToken),
    ))
    .returning({ id: integrationOutboxTable.id });
  if (adopted.length === 0) {
    console.warn(`[integration] outbox event ${rowId} changed hands during delivery — outcome not applied, owner preserved`);
    return false;
  }
  return true;
}

/**
 * Claim up to `limit` pending events and attempt delivery. Concurrency-safe via
 * FOR UPDATE SKIP LOCKED, and ownership-safe on the way out: a result is only ever
 * written to an event this dispatch still holds. Returns a small summary for
 * logging/tests; `conflicts` counts deliveries whose outcome was refused because the
 * event changed hands mid-flight, which should be rare and is never silent.
 */
export async function dispatchPendingOutbox(opts: { limit?: number; workerId?: string; timeoutMs?: number; staleLeaseMs?: number } = {}): Promise<{ claimed: number; sent: number; failed: number; dead: number; recovered: number; conflicts: number }> {
  const limit = opts.limit ?? 20;
  // Unique per dispatch, not per process: `cron.schedule` does not await a tick, so
  // two overlapping batches share a PID, and a lease-keyed reclaim can hand a row to
  // the second batch while the first is still holding it. Ownership is only a guard
  // if the two holders have different names.
  const workerId = opts.workerId ?? `care-${process.pid}-${randomUUID()}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const leaseMs = opts.staleLeaseMs ?? staleLeaseMs(timeoutMs);

  // Claim.
  const { claimedIds, abandoned } = await db.transaction(async (tx) => {
    // Reclaim first, in the SAME transaction as the claim, so `FOR UPDATE SKIP
    // LOCKED` guards both: two dispatchers running on the same tick can never take
    // the same abandoned row, and a row another worker is actively finishing is
    // either lock-held or has a fresh `locked_at` and is not selected at all.
    //
    // This is the whole point of the step. The claim below only ever selects
    // `status = 'pending'`, so a worker killed between the claim (which writes
    // 'sending') and any of the write-backs left the event in 'sending' forever —
    // invisible to every later tick, invisible to reconcile, recoverable only if an
    // admin happened to open Integration Administration and pressed Retry. A report
    // sitting in 'sending' is a report nobody was told had stopped moving.
    const staleRes = await tx.execute(
      sql`SELECT id, attempts, max_attempts, event_type, payload FROM integration_outbox
           WHERE status = 'sending'
             AND locked_at IS NOT NULL
             AND locked_at < NOW() - (${leaseMs} || ' milliseconds')::interval
           ORDER BY locked_at ASC
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`,
    );
    type StaleRow = { id: number; attempts: number; max_attempts: number; event_type: string; payload: unknown };
    const staleRows = ((staleRes as unknown as { rows?: StaleRow[] }).rows ?? (staleRes as unknown as StaleRow[]));

    const abandonedRows: Array<{ id: number; attemptNo: number; dead: boolean; eventType: string; payload: unknown }> = [];
    for (const s of staleRows) {
      // Consume one attempt. A crash before the write-back does NOT increment
      // `attempts`, so reclaiming without charging an attempt would let a worker that
      // dies on the same row every tick loop forever and never dead-letter. Charging
      // it keeps the existing budget, the existing backoff curve and the existing
      // dead-letter behaviour authoritative over recovered work too.
      const attemptNo = s.attempts + 1;
      const isDead = attemptNo >= s.max_attempts;
      await tx
        .update(integrationOutboxTable)
        .set({
          status: isDead ? "dead" : "pending",
          attempts: attemptNo,
          lastError: "delivery_abandoned",
          nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(integrationOutboxTable.id, s.id));
      abandonedRows.push({ id: s.id, attemptNo, dead: isDead, eventType: s.event_type, payload: s.payload });
    }

    const res = await tx.execute(
      sql`SELECT id FROM integration_outbox WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY next_attempt_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
    );
    const rows = ((res as unknown as { rows?: Array<{ id: number }> }).rows ?? (res as unknown as Array<{ id: number }>)) as Array<{ id: number }>;
    const ids = rows.map((r) => Number(r.id));
    if (ids.length) {
      await tx
        .update(integrationOutboxTable)
        .set({ status: "sending", lockedAt: new Date(), lockedBy: workerId })
        .where(inArray(integrationOutboxTable.id, ids));
    }
    return { claimedIds: ids, abandoned: abandonedRows };
  });

  // The reclaim and the claim are one atomic step; the attempt history is written
  // after commit because `recordAttempt` is best-effort by design and a failure to
  // log must not roll back a state change that has already been decided.
  let recovered = 0, recoveredDead = 0;
  for (const a of abandoned) {
    recovered++;
    if (a.dead) {
      recoveredDead++;
      // A reclaimed dead-letter is the same terminal event as a refusal that exhausted
      // its budget, and the film has to be told either way. Until now only the two HTTP
      // legs called this, so a film dead-lettered by reclaim kept `HOPE_PENDING` forever:
      // no badge, no worklist marker, no exit — the one path where the worker that would
      // have marked it is the worker that died.
      await markFilmHopeUndelivered({ eventType: a.eventType, payload: a.payload }, "delivery_abandoned");
    }
    await recordAttempt(a.id, a.attemptNo, "failure", null, null, "delivery_abandoned", 0);
  }

  let sent = 0, failed = 0, dead = recoveredDead, conflicts = 0;
  if (claimedIds.length === 0) return { claimed: 0, sent, failed, dead, recovered, conflicts };

  const rows = await db.select().from(integrationOutboxTable).where(inArray(integrationOutboxTable.id, claimedIds));

  for (const row of rows) {
    const attemptNo = row.attempts + 1;
    const startedAt = Date.now();

    // Heartbeat this dispatch's whole held batch, and take that one statement as the
    // ownership proof for the row about to be worked on. Two things depend on it:
    //
    //   • the still-queued rows stay inside their lease for as long as this worker is
    //     making progress, so nothing reclaims work that is merely slow;
    //   • if this row is no longer in the returned set, it is no longer ours — it was
    //     reclaimed after our lease lapsed — so we must neither POST it nor write an
    //     outcome to it. Delivering anyway is the duplicate clinical report this
    //     guard exists to prevent, and it would be a duplicate we caused.
    //
    // It runs before the configuration check as well, because that branch writes
    // state too: a row handed over while this dispatch was working through its batch
    // must not be pushed back to `pending` by a worker that no longer holds it.
    const leaseToken = new Date();
    const held = await heartbeatOwnedLeases(claimedIds, workerId, leaseToken);
    if (!held.has(row.id)) {
      console.warn(`[integration] outbox event ${row.id} (${row.eventType}) was reclaimed by another worker before delivery — skipped`);
      continue;
    }

    const { cfg } = await deliveryConfigFor(row.partnerId);

    if (!cfg.url || !cfg.secret) {
      // Not configured yet — back off and retry later (do NOT dead-letter a
      // config gap; it clears itself once the partner is provisioned). No request was
      // made, so nothing is recorded in the attempt history if the write is refused.
      //
      // And no attempt is charged. This branch is reached before any `fetch`, so burning
      // the budget here means a row that waited out the provisioning gap arrives at its
      // FIRST real failure with `attempts` already at `max_attempts` — and the transport
      // leg below then dead-letters it on one refused request. The clinic's own state on
      // 2026-10-15 is that shape: the callback route is not configured to answer, the
      // outbox is empty because HOPE carries no traffic yet, and the first report sent
      // after HOPE is switched on would have had its retries spent before it started.
      // `nextAttemptAt` still moves, so the row keeps being revisited on the backoff curve
      // rather than spinning every tick.
      const adopted = await finalizeOwnedTransition(row.id, workerId, leaseToken, {
        status: "pending", attempts: row.attempts, lastError: "delivery_not_configured",
        nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
      });
      if (adopted) {
        failed++;
        await recordAttempt(row.id, attemptNo, "failure", null, null, "delivery_not_configured", Date.now() - startedAt);
      } else {
        conflicts++;
      }
      continue;
    }

    const body = JSON.stringify({
      eventId: row.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      sourceOrg: row.sourceOrg,
      destinationOrg: row.destinationOrg,
      occurredAt: row.createdAt,
      data: row.payload,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      "content-type": "application/json",
      "x-care-event-id": row.eventId,
      "x-care-event-type": row.eventType,
      "x-care-timestamp": timestamp,
      "x-care-signature": `sha256=${signBody(cfg.secret, body, timestamp)}`,
    };

    try {
      const { status, text } = await postWithTimeout(cfg.url, body, headers, timeoutMs);
      const durationMs = Date.now() - startedAt;
      if (status >= 200 && status < 300) {
        const adopted = await finalizeOwnedTransition(row.id, workerId, leaseToken, {
          status: "sent", attempts: attemptNo, sentAt: new Date(), lastError: null, lockedAt: null, lockedBy: null,
        });
        // An attempt really was made and HOPE really answered 2xx, so it is recorded
        // either way — erasing it would destroy the evidence of a possible second
        // delivery. It is annotated so it can never be read as the event's state: the
        // row itself was left to the worker that currently owns it.
        await recordAttempt(row.id, attemptNo, "success", status, text, adopted ? null : "state_not_applied_owner_changed", durationMs);
        if (!adopted) {
          conflicts++;
          continue;
        }
        sent++;
        // Only the worker that adopted the transition may say HOPE has the report.
        await db.update(externalResultLinksTable).set({ deliveredAt: new Date() }).where(eq(externalResultLinksTable.emittedOutboxId, row.id)).catch(() => {});
        if (row.eventType === "diagnostic_electronic_film.available") {
          const payload = row.payload as { careFilmArtifactId?: number };
          if (payload?.careFilmArtifactId) {
            const { markFilmHopeSent } = await import("../electronicFilm/hopeEmitter.js");
            await markFilmHopeSent(payload.careFilmArtifactId).catch(() => {});
          }
        }
      } else {
        const isDead = attemptNo >= row.maxAttempts;
        const adopted = await finalizeOwnedTransition(row.id, workerId, leaseToken, {
          status: isDead ? "dead" : "pending", attempts: attemptNo, lastError: `http_${status}`,
          nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
        });
        await recordAttempt(row.id, attemptNo, "failure", status, text, adopted ? `http_${status}` : `http_${status}; state_not_applied_owner_changed`, durationMs);
        if (!adopted) {
          conflicts++;
          continue;
        }
        failed++;
        if (isDead) {
          dead++;
          await markFilmHopeUndelivered(row, `http_${status}`);
        }
      }
    } catch (err) {
      const msg = deliveryErrorReason(err);
      const isDead = attemptNo >= row.maxAttempts;
      const adopted = await finalizeOwnedTransition(row.id, workerId, leaseToken, {
        status: isDead ? "dead" : "pending", attempts: attemptNo, lastError: msg,
        nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
      });
      await recordAttempt(row.id, attemptNo, "failure", null, null, adopted ? msg : `${msg}; state_not_applied_owner_changed`, Date.now() - startedAt);
      if (!adopted) {
        conflicts++;
        continue;
      }
      failed++;
      if (isDead) {
        dead++;
        await markFilmHopeUndelivered(row, msg);
      }
    }
  }

  return { claimed: claimedIds.length, sent, failed, dead, recovered, conflicts };
}

/**
 * A film whose event is dead has not reached HOPE, and its own row has to say so.
 *
 * `hope_delivery_status` is written to `PENDING` at enqueue and, until now, only ever
 * written again by a 2xx — so every terminal failure left the artifact waiting forever
 * on an outbox row that had already given up. `ElectronicFilmPanel` renders `FAILED` as
 * its warning badge and worklist marker, which is what turns an undelivered film into
 * something a human can see.
 *
 * This is deliberately only the terminal transition. A refusal that is still inside its
 * retry budget must leave the film pending, or the bounded-retry policy #995-#997
 * implement would be contradicted by its own bookkeeping. And `ingest_status` stays
 * untouched: HOPE's refusal is a delivery outcome, not a reason to hide a stored film
 * from the pipeline — `enqueueElectronicFilmToHope` still accepts `HOPE_PENDING`, so a
 * dead letter an operator retries can still become a delivery.
 *
 * Only ever called behind the ownership fence, for the same reason the 2xx leg is.
 */
async function markFilmHopeUndelivered(
  row: { eventType: string; payload: unknown },
  reason: string,
): Promise<void> {
  if (row.eventType !== "diagnostic_electronic_film.available") return;
  const artifactId = (row.payload as { careFilmArtifactId?: number } | null)?.careFilmArtifactId;
  if (!artifactId) return;
  const { markFilmHopeFailed } = await import("../electronicFilm/hopeEmitter.js");
  await markFilmHopeFailed(artifactId, `Hope did not accept this film: ${reason}`)
    .catch((e) => console.error(`[integration] film artifact ${artifactId} failure marking failed:`, (e as Error)?.message));
}

async function recordAttempt(outboxId: number, attemptNo: number, status: "success" | "failure", httpStatus: number | null, responseBody: string | null, error: string | null, durationMs: number): Promise<void> {
  try {
    await db.insert(integrationDeliveryAttemptsTable).values({ outboxId, attemptNo, status, httpStatus, responseBody, error, durationMs });
  } catch { /* best effort */ }
}

/**
 * Why a delivery actually failed, in the words that let an operator fix it.
 *
 * `fetch` does not report a transport failure — it rejects with a `TypeError` whose
 * message is the constant string "fetch failed", and puts the reason one level down in
 * `err.cause` (`ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ETIMEDOUT`, a certificate
 * error). Recording only `err.message` therefore wrote "fetch failed" into
 * `last_error` and into every attempt row for a route that was dead for a specific,
 * findable reason — which is exactly what the clinic measured on 2026-10-15: the
 * CARE→HOPE callback address does not answer, and the outbox said nothing more useful
 * than "fetch failed" while an operator had to work out whether it was DNS, a firewall,
 * or a container that had been recreated under a new IP.
 *
 * Only the code and the cause's own message are appended; nothing that could carry a
 * secret or a body is.
 */
export function deliveryErrorReason(err: unknown): string {
  if (typeof err === "string") return err.slice(0, 300);
  const e = err as (Error & { cause?: unknown }) | null | undefined;
  const name = e?.name === "AbortError" ? "timeout" : (e?.message ?? "delivery_error");
  if (e?.name === "AbortError") return name;
  const cause = e?.cause as (Error & { code?: string }) | string | null | undefined;
  const code = cause && typeof cause === "object" ? cause.code : undefined;
  const causeText = cause && typeof cause === "object" ? cause.message : (typeof cause === "string" ? cause : undefined);
  const parts = [name];
  if (code && !name.includes(code)) parts.push(code);
  if (causeText && causeText !== name && !name.includes(causeText)) parts.push(causeText);
  return parts.join(": ").slice(0, 300);
}

/** Manual retry of a dead/failed event (admin action). */
export async function retryOutboxEvent(id: number): Promise<void> {
  // The budget is reset as well as the status, or Retry is a single shot at the very
  // thing it exists to survive. A dead row has `attempts >= max_attempts`; setting only
  // `status` makes the next attempt compute `attemptNo = attempts + 1`, which is still
  // over the limit, so the row dead-letters again on its FIRST failure and the operator
  // pressing Retry a second time is doing the same thing a third time. Retrying means
  // "we fixed the route, give it its normal budget back" — so give it the budget.
  await db.update(integrationOutboxTable)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, lastError: "manual_retry" })
    .where(eq(integrationOutboxTable.id, id));
}
