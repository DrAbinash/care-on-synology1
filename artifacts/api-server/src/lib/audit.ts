import { db, auditLogsTable } from "@workspace/db";
import type { InsertAuditLog } from "@workspace/db/schema";
import type { Request } from "express";
import { logger } from "./logger";
import { asc, desc, sql } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Advisory-lock key for the single global audit hash-chain.
 *
 * Uses the same `hashtext(name)` convention as the schema-migration lock in
 * index.ts and the per-domain locks in day-close.ts, so the key is stable
 * across processes/restarts and human-readable. `pg_advisory_xact_lock` is
 * transaction-scoped: Postgres releases it automatically when the wrapping
 * transaction commits or rolls back, so a failed audit write can never leak
 * the lock (no manual unlock, no leak on error).
 */
const AUDIT_CHAIN_XACT_LOCK = sql`pg_advisory_xact_lock(hashtext('care_erp_audit_chain'))`;

/** Anything that can run a drizzle select/insert — the module pool or a caller's
 *  transaction. Structurally compatible with both. */
export type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The audit row after `auditLog`'s normalization, before the chain fields are
 *  added. One type so `writeAuditChain` and the hashing recipe cannot drift. */
type NormalizedAuditPayload = Omit<
  Parameters<typeof canonicalHashPayload>[0],
  "createdAt" | "previousHash"
>;

/**
 * Compute the canonical JSON string for chain hashing.
 * Order is fixed to ensure deterministic hashes regardless of object key order.
 *
 * Exported (Ticket D5) so the structured-finalize transaction can insert its
 * `action='finalize'` row with the exact same hashing recipe while holding the
 * chain lock inside its own transaction (auditLog() manages its own separate
 * transaction, which would break finalize atomicity). The recipe itself is
 * unchanged — `id` is deliberately NOT part of the hashed payload, which is
 * what makes reserve-id-then-insert possible without breaking the chain.
 */
export function canonicalHashPayload(row: {
  userId: number | null;
  userName: string;
  role: string;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  previousHash: string;
}): string {
  return JSON.stringify({
    userId: row.userId,
    userName: row.userName,
    role: row.role,
    action: row.action,
    module: row.module,
    entityType: row.entityType,
    entityId: row.entityId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    reason: row.reason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    previousHash: row.previousHash,
  });
}

export function computeChainHash(payloadJson: string): string {
  return crypto.createHash("sha256").update(payloadJson).digest("hex");
}

/** The locked critical section, on whatever transaction the caller owns.
 *
 *  Split out of `auditLog` so a signing door can write its audit entry INSIDE its
 *  own transaction. The advisory lock is `pg_advisory_xact_lock` — transaction
 *  scoped — so it serialises correctly either way; what changes is which commit
 *  makes it durable. Called on the caller's tx, an audit failure rolls the business
 *  write back with it, which is the whole point of the signing certificate. */
async function writeAuditChain(
  tx: AuditTx,
  payload: NormalizedAuditPayload,
): Promise<void> {
  await tx.execute(sql`SELECT ${AUDIT_CHAIN_XACT_LOCK}`);

  // Look up the previous audit log to get its chainHash as our previousHash
  const [prev] = await tx
    .select({ chainHash: auditLogsTable.chainHash })
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.id))
    .limit(1);
  const previousHash = prev?.chainHash ?? "";

  const createdAt = new Date().toISOString();
  const canonical = canonicalHashPayload({
    ...payload,
    createdAt,
    previousHash,
  });
  const chainHash = computeChainHash(canonical);

  await tx.insert(auditLogsTable).values({
    ...payload,
    previousHash,
    chainHash,
    createdAt: new Date(createdAt),
  });
}

/**
 * Write an immutable audit log entry with a cryptographic chain hash.
 * Each entry links to the previous entry's hash, making tampering detectable.
 *
 * Without `executor` this is the fire-and-forget helper it has always been:
 * errors are logged but never thrown, so a failed audit write never breaks a
 * business transaction. WITH `executor` the caller's transaction owns the
 * outcome — nothing is caught, because an audit entry that silently failed
 * inside a transaction that then committed would be a lie about what was
 * recorded. Only the signing paths pass one; every other caller is unchanged.
 */
export async function auditLog(payload: Omit<InsertAuditLog, "ipAddress" | "userAgent" | "previousHash" | "chainHash"> & { ipAddress?: string; userAgent?: string }, executor?: AuditTx): Promise<void> {
  // Normalize the persisted values once so the hashed payload and the
  // inserted row are provably identical (same truncation / same defaults).
  const normalized: NormalizedAuditPayload = {
    userId: payload.userId ?? null,
    userName: payload.userName ?? "system",
    role: payload.role ?? "system",
    action: payload.action,
    module: payload.module,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
    oldValue: payload.oldValue ? String(payload.oldValue).slice(0, 65535) : null,
    newValue: payload.newValue ? String(payload.newValue).slice(0, 65535) : null,
    reason: payload.reason ?? null,
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
  };

  if (executor) {
    // Serialize the "read last chainHash → insert new row" critical section.
    // Without this, two concurrent writers read the same previousHash and both
    // insert rows pointing at it, forking the single hash-chain into a tree and
    // voiding its tamper-evidence guarantee (Emergency Ticket E0.2 / risk-review
    // CRIT-2). The transaction-scoped advisory lock makes the whole read+insert
    // atomic against other audit writers; here it is the CALLER's transaction, so
    // the lock is released when that commit or rollback lands.
    await writeAuditChain(executor, normalized);
    return;
  }

  try {
    await db.transaction((tx) => writeAuditChain(tx, normalized));
  } catch (err) {
    logger.error({ err, payload }, "Audit log write failed");
  }
}

/**
 * Convenience helper that extracts IP and UA from an Express request.
 */
export async function auditFromRequest(
  req: Request,
  payload: Omit<InsertAuditLog, "ipAddress" | "userAgent" | "previousHash" | "chainHash">,
): Promise<void> {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : (req.ip ?? req.socket?.remoteAddress ?? "");
  await auditLog({
    ...payload,
    ipAddress: ip,
    userAgent: req.headers["user-agent"] ?? "",
  });
}

/** One row's identity + chain links, as needed to verify chain continuity. */
export type AuditChainRow = { id: number; previousHash: string; chainHash: string };

export interface AuditChainVerification {
  /** true when the rows form a single unbroken chain. */
  ok: boolean;
  /** number of rows verified before the first break (or the total, if ok). */
  checked: number;
  /** id of the first row that breaks the chain, or null when ok. */
  firstBrokenId: number | null;
  /** human-readable reason for the break, or null when ok. */
  reason: string | null;
}

/**
 * Pure verifier: confirm a run of audit rows (already ordered by ascending id)
 * forms one unbroken hash-chain — each row's `previousHash` equals the
 * immediately preceding row's `chainHash`, and the genesis row's `previousHash`
 * is empty. A fork or gap — exactly the corruption the advisory lock in
 * auditLog() prevents — surfaces as the first row whose `previousHash` does not
 * match.
 *
 * This checks chain *linkage* only, so it is independent of how any individual
 * row's hash was computed (app-written rows and the boot-time backfilled rows
 * use different hashing recipes, but both must still link correctly). Pass
 * `{ window: true }` when verifying a tail slice that does not start at the
 * genesis row, so the first row's non-empty `previousHash` is not flagged.
 */
export function verifyChainRows(
  rows: AuditChainRow[],
  opts?: { window?: boolean },
): AuditChainVerification {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedPrev = i === 0 ? (opts?.window ? row.previousHash : "") : rows[i - 1].chainHash;
    if (row.previousHash !== expectedPrev) {
      return {
        ok: false,
        checked: i,
        firstBrokenId: row.id,
        reason:
          i === 0
            ? `genesis audit row ${row.id} has a non-empty previousHash`
            : `audit row ${row.id} previousHash does not match the preceding row's chainHash (chain fork or gap)`,
      };
    }
  }
  return { ok: true, checked: rows.length, firstBrokenId: null, reason: null };
}

/**
 * Read audit rows in id order and verify they form a single unbroken chain.
 * By default verifies the entire chain from genesis. Pass `{ limit }` to verify
 * only the most recent N rows (window mode — the boundary row's previousHash is
 * accepted as-is since its predecessor is outside the window).
 */
export async function verifyAuditChain(opts?: { limit?: number }): Promise<AuditChainVerification> {
  const cols = {
    id: auditLogsTable.id,
    previousHash: auditLogsTable.previousHash,
    chainHash: auditLogsTable.chainHash,
  };
  if (opts?.limit && opts.limit > 0) {
    const recent = await db
      .select(cols)
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.id))
      .limit(opts.limit);
    return verifyChainRows(recent.reverse(), { window: true });
  }
  const rows = await db.select(cols).from(auditLogsTable).orderBy(asc(auditLogsTable.id));
  return verifyChainRows(rows);
}
