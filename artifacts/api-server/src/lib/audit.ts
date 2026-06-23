import { db, auditLogsTable } from "@workspace/db";
import type { InsertAuditLog } from "@workspace/db/schema";
import type { Request } from "express";
import { logger } from "./logger";
import { desc } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Compute the canonical JSON string for chain hashing.
 * Order is fixed to ensure deterministic hashes regardless of object key order.
 */
function canonicalHashPayload(row: {
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

/**
 * Write an immutable audit log entry with a cryptographic chain hash.
 * Each entry links to the previous entry's hash, making tampering detectable.
 * This is a fire-and-forget helper: errors are logged but never thrown,
 * so a failed audit write never breaks a business transaction.
 */
export async function auditLog(payload: Omit<InsertAuditLog, "ipAddress" | "userAgent" | "previousHash" | "chainHash"> & { ipAddress?: string; userAgent?: string }): Promise<void> {
  try {
    // Look up the previous audit log to get its chainHash as our previousHash
    const [prev] = await db
      .select({ chainHash: auditLogsTable.chainHash })
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    const previousHash = prev?.chainHash ?? "";

    const createdAt = new Date().toISOString();
    const canonical = canonicalHashPayload({
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
      createdAt,
      previousHash,
    });
    const chainHash = computeChainHash(canonical);

    await db.insert(auditLogsTable).values({
      userId: payload.userId ?? null,
      userName: payload.userName ?? "system",
      role: payload.role ?? "system",
      action: payload.action,
      module: payload.module,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      oldValue: payload.oldValue ? String(payload.oldValue).slice(0, 65535) : null,
      newValue: payload.newValue ? String(payload.newValue).slice(0, 65535) : null,
      ipAddress: payload.ipAddress ?? null,
      userAgent: payload.userAgent ?? null,
      reason: payload.reason ?? null,
      previousHash,
      chainHash,
      createdAt: new Date(createdAt),
    });
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
