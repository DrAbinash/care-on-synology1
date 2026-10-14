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
 */
async function heartbeatOwnedLeases(claimedIds: number[], workerId: string): Promise<Set<number>> {
  const held = await db
    .update(integrationOutboxTable)
    .set({ lockedAt: new Date() })
    .where(and(
      inArray(integrationOutboxTable.id, claimedIds),
      eq(integrationOutboxTable.status, "sending"),
      eq(integrationOutboxTable.lockedBy, workerId),
    ))
    .returning({ id: integrationOutboxTable.id });
  return new Set(held.map((h) => h.id));
}

/**
 * Claim up to `limit` pending events and attempt delivery. Concurrency-safe via
 * FOR UPDATE SKIP LOCKED. Returns a small summary for logging/tests.
 */
export async function dispatchPendingOutbox(opts: { limit?: number; workerId?: string; timeoutMs?: number; staleLeaseMs?: number } = {}): Promise<{ claimed: number; sent: number; failed: number; dead: number; recovered: number }> {
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
      sql`SELECT id, attempts, max_attempts FROM integration_outbox
           WHERE status = 'sending'
             AND locked_at IS NOT NULL
             AND locked_at < NOW() - (${leaseMs} || ' milliseconds')::interval
           ORDER BY locked_at ASC
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`,
    );
    const staleRows = ((staleRes as unknown as { rows?: Array<{ id: number; attempts: number; max_attempts: number }> }).rows
      ?? (staleRes as unknown as Array<{ id: number; attempts: number; max_attempts: number }>)) as Array<{ id: number; attempts: number; max_attempts: number }>;

    const abandonedRows: Array<{ id: number; attemptNo: number; dead: boolean }> = [];
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
      abandonedRows.push({ id: s.id, attemptNo, dead: isDead });
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
    if (a.dead) recoveredDead++;
    await recordAttempt(a.id, a.attemptNo, "failure", null, null, "delivery_abandoned", 0);
  }

  let sent = 0, failed = 0, dead = recoveredDead;
  if (claimedIds.length === 0) return { claimed: 0, sent, failed, dead, recovered };

  const rows = await db.select().from(integrationOutboxTable).where(inArray(integrationOutboxTable.id, claimedIds));

  for (const row of rows) {
    const attemptNo = row.attempts + 1;
    const startedAt = Date.now();
    const { cfg } = await deliveryConfigFor(row.partnerId);

    if (!cfg.url || !cfg.secret) {
      // Not configured yet — back off and retry later (do NOT dead-letter a
      // config gap; it clears itself once the partner is provisioned).
      failed++;
      await recordAttempt(row.id, attemptNo, "failure", null, null, "delivery_not_configured", Date.now() - startedAt);
      await db.update(integrationOutboxTable).set({
        status: "pending", attempts: attemptNo, lastError: "delivery_not_configured",
        nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
      }).where(eq(integrationOutboxTable.id, row.id));
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

    // Heartbeat this dispatch's whole held batch, and take that one statement as the
    // ownership proof for the row about to be sent. Two things depend on it:
    //
    //   • the still-queued rows stay inside their lease for as long as this worker is
    //     making progress, so nothing reclaims work that is merely slow;
    //   • if this row is no longer in the returned set, it is no longer ours — it was
    //     reclaimed after our lease lapsed — so we must NOT POST it. Delivering
    //     anyway is exactly the duplicate clinical report this guard exists to
    //     prevent, and it would be a duplicate we caused rather than one we inherited.
    const held = await heartbeatOwnedLeases(claimedIds, workerId);
    if (!held.has(row.id)) {
      console.warn(`[integration] outbox event ${row.id} (${row.eventType}) was reclaimed by another worker before delivery — skipped`);
      continue;
    }

    try {
      const { status, text } = await postWithTimeout(cfg.url, body, headers, timeoutMs);
      const durationMs = Date.now() - startedAt;
      if (status >= 200 && status < 300) {
        sent++;
        await recordAttempt(row.id, attemptNo, "success", status, text, null, durationMs);
        await db.update(integrationOutboxTable).set({ status: "sent", attempts: attemptNo, sentAt: new Date(), lastError: null, lockedAt: null, lockedBy: null }).where(eq(integrationOutboxTable.id, row.id));
        // Mark any result link delivered.
        await db.update(externalResultLinksTable).set({ deliveredAt: new Date() }).where(eq(externalResultLinksTable.emittedOutboxId, row.id)).catch(() => {});
        if (row.eventType === "diagnostic_electronic_film.available") {
          const payload = row.payload as { careFilmArtifactId?: number };
          if (payload?.careFilmArtifactId) {
            const { markFilmHopeSent } = await import("../electronicFilm/hopeEmitter.js");
            await markFilmHopeSent(payload.careFilmArtifactId).catch(() => {});
          }
        }
      } else {
        failed++;
        const isDead = attemptNo >= row.maxAttempts;
        if (isDead) dead++;
        await recordAttempt(row.id, attemptNo, "failure", status, text, `http_${status}`, durationMs);
        await db.update(integrationOutboxTable).set({
          status: isDead ? "dead" : "pending", attempts: attemptNo, lastError: `http_${status}`,
          nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
        }).where(eq(integrationOutboxTable.id, row.id));
      }
    } catch (err) {
      failed++;
      const msg = (err as Error)?.name === "AbortError" ? "timeout" : ((err as Error)?.message ?? "delivery_error").slice(0, 300);
      const isDead = attemptNo >= row.maxAttempts;
      if (isDead) dead++;
      await recordAttempt(row.id, attemptNo, "failure", null, null, msg, Date.now() - startedAt);
      await db.update(integrationOutboxTable).set({
        status: isDead ? "dead" : "pending", attempts: attemptNo, lastError: msg,
        nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)), lockedAt: null, lockedBy: null,
      }).where(eq(integrationOutboxTable.id, row.id));
    }
  }

  return { claimed: claimedIds.length, sent, failed, dead, recovered };
}

async function recordAttempt(outboxId: number, attemptNo: number, status: "success" | "failure", httpStatus: number | null, responseBody: string | null, error: string | null, durationMs: number): Promise<void> {
  try {
    await db.insert(integrationDeliveryAttemptsTable).values({ outboxId, attemptNo, status, httpStatus, responseBody, error, durationMs });
  } catch { /* best effort */ }
}

/** Manual retry of a dead/failed event (admin action). */
export async function retryOutboxEvent(id: number): Promise<void> {
  await db.update(integrationOutboxTable)
    .set({ status: "pending", nextAttemptAt: new Date(), lockedAt: null, lockedBy: null })
    .where(eq(integrationOutboxTable.id, id));
}
