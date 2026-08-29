// ============================================================================
// Transactional outbox → HOPE (brief §16, §20). Events are enqueued in the same
// transaction as the state change that produced them, then a cron dispatcher
// delivers them to the partner's signed callback URL with retry + exponential
// backoff + dead-lettering. Idempotent on event_id/idempotency_key; the
// receiver dedupes on event_id too. No PHI beyond the minimal payload; secrets
// are read from env, never logged.
// ============================================================================
import { createHmac, randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
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
 * Claim up to `limit` pending events and attempt delivery. Concurrency-safe via
 * FOR UPDATE SKIP LOCKED. Returns a small summary for logging/tests.
 */
export async function dispatchPendingOutbox(opts: { limit?: number; workerId?: string; timeoutMs?: number } = {}): Promise<{ claimed: number; sent: number; failed: number; dead: number }> {
  const limit = opts.limit ?? 20;
  const workerId = opts.workerId ?? `care-${process.pid}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  // Claim.
  const claimedIds = await db.transaction(async (tx) => {
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
    return ids;
  });

  let sent = 0, failed = 0, dead = 0;
  if (claimedIds.length === 0) return { claimed: 0, sent, failed, dead };

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

  return { claimed: claimedIds.length, sent, failed, dead };
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
