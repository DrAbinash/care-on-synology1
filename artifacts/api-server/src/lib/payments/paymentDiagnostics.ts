/**
 * paymentDiagnostics.ts — Reusable payment-gateway diagnostics capture & query.
 *
 * Records every gateway initiate/callback/status/refund attempt into
 * payment_gateway_diagnostics for troubleshooting, independent of whether
 * the attempt succeeded. This module is diagnostic-only: it never throws
 * into the caller (a logging failure must never break a real payment), and
 * it never influences the payment decision.
 *
 * Currently wired up for ICICI Orange Pay; the `gateway` column and generic
 * shape make it reusable for Razorpay/PayU/PhonePe/BharatPe/HDFC later
 * without schema changes.
 */
import type { Request } from "express";
import { db } from "@workspace/db";
import { paymentGatewayDiagnosticsTable } from "@workspace/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { logger } from "../logger";

export type DiagnosticStage = "initiate" | "callback" | "status_check" | "refund";

export interface RecordDiagnosticParams {
  gateway?: string;
  stage: DiagnosticStage;
  merchantTxnNo?: string | null;
  bookingRef?: string | null;
  success: boolean;
  httpStatus?: number | null;
  responseCode?: string | null;
  responseMessage?: string | null;
  requestUrl?: string | null;
  requestPayload?: unknown;
  requestHeaders?: Record<string, unknown> | null;
  responseBody?: unknown;
  redirectUri?: string | null;
  tranCtx?: string | null;
  secureHash?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  merchantId?: string | null;
  aggregatorId?: string | null;
  returnUrl?: string | null;
  callbackUrl?: string | null;
  publicBaseUrl?: string | null;
  req?: Request | null;
  durationMs?: number | null;
}

/** Resolve client IP the same way the rest of the ERP does (LAN/reverse-proxy aware). */
function resolveClientIp(req?: Request | null): string {
  if (!req) return "";
  if (req.ip && req.ip.trim() !== "") return req.ip.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const raw = req.socket?.remoteAddress;
  return raw?.trim() || "";
}

/** Never leak a full secret/hash into logs or diagnostics — show a masked fragment only. */
function maskSecret(value?: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeHeaders(headers?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!headers) return null;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower.includes("secret") || lower.includes("key")) {
      clone[key] = "[redacted]";
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

/**
 * Persist a diagnostic row. Best-effort — a failure here is logged and
 * swallowed so it can never take down a payment attempt.
 */
export async function recordPaymentDiagnostic(params: RecordDiagnosticParams): Promise<void> {
  try {
    const req = params.req;
    await db.insert(paymentGatewayDiagnosticsTable).values({
      gateway: params.gateway || "icici",
      stage: params.stage,
      merchantTxnNo: params.merchantTxnNo || null,
      bookingRef: params.bookingRef || null,

      success: params.success,
      httpStatus: params.httpStatus ?? null,
      responseCode: params.responseCode || null,
      responseMessage: params.responseMessage || null,

      requestUrl: params.requestUrl || null,
      requestPayload: safeStringify(params.requestPayload),
      requestHeaders: safeStringify(sanitizeHeaders(params.requestHeaders)),

      responseBody: safeStringify(params.responseBody),
      redirectUri: params.redirectUri || null,
      tranCtx: params.tranCtx || null,
      secureHashMasked: maskSecret(params.secureHash),

      amount: params.amount !== undefined && params.amount !== null ? String(params.amount) : null,
      currency: params.currency || "INR",
      merchantId: params.merchantId || null,
      aggregatorId: params.aggregatorId || null,
      returnUrl: params.returnUrl || null,
      callbackUrl: params.callbackUrl || null,
      publicBaseUrl: params.publicBaseUrl || null,
      clientIp: resolveClientIp(req) || (params.requestHeaders?.["x-client-ip"] as string) || null,
      forwardedFor: (req?.headers["x-forwarded-for"] as string) || (params.requestHeaders?.["x-forwarded-for"] as string) || null,
      userAgent: (req?.headers["user-agent"] as string) || (params.requestHeaders?.["user-agent"] as string) || null,
      referer: (req?.headers["referer"] as string) || (req?.headers["referrer"] as string) || (params.requestHeaders?.["referer"] as string) || null,
      origin: (req?.headers["origin"] as string) || (params.requestHeaders?.["origin"] as string) || null,

      gitCommit: process.env.GIT_COMMIT || null,
      dockerImageVersion: process.env.BUILD_NUMBER || null,
      buildTimestamp: process.env.BUILD_DATE || null,
      environment: process.env.NODE_ENV === "production" ? "production" : "uat/test",

      durationMs: params.durationMs ?? null,
    });
  } catch (err) {
    logger.error({ err, stage: params.stage, gateway: params.gateway }, "Failed to record payment diagnostic (non-fatal)");
  }
}

/** Last N attempts for a gateway, newest first — summary fields only (for a history list view). */
export async function getRecentDiagnostics(gateway: string, limit = 50) {
  return db
    .select()
    .from(paymentGatewayDiagnosticsTable)
    .where(eq(paymentGatewayDiagnosticsTable.gateway, gateway))
    .orderBy(desc(paymentGatewayDiagnosticsTable.createdAt))
    .limit(limit);
}

/** Full detail for one attempt, for the "view raw request/response" drill-down. */
export async function getDiagnosticById(id: number) {
  const [row] = await db
    .select()
    .from(paymentGatewayDiagnosticsTable)
    .where(eq(paymentGatewayDiagnosticsTable.id, id))
    .limit(1);
  return row || null;
}

/** Timestamp of the most recent successful and most recent failed attempt (for the dashboard header). */
export async function getLastSuccessAndFailure(gateway: string): Promise<{
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}> {
  const [successRow] = await db
    .select({ createdAt: paymentGatewayDiagnosticsTable.createdAt })
    .from(paymentGatewayDiagnosticsTable)
    .where(and(eq(paymentGatewayDiagnosticsTable.gateway, gateway), eq(paymentGatewayDiagnosticsTable.success, true)))
    .orderBy(desc(paymentGatewayDiagnosticsTable.createdAt))
    .limit(1);

  const [failureRow] = await db
    .select({ createdAt: paymentGatewayDiagnosticsTable.createdAt })
    .from(paymentGatewayDiagnosticsTable)
    .where(and(eq(paymentGatewayDiagnosticsTable.gateway, gateway), eq(paymentGatewayDiagnosticsTable.success, false)))
    .orderBy(desc(paymentGatewayDiagnosticsTable.createdAt))
    .limit(1);

  return {
    lastSuccessAt: successRow?.createdAt ? new Date(successRow.createdAt).toISOString() : null,
    lastFailureAt: failureRow?.createdAt ? new Date(failureRow.createdAt).toISOString() : null,
  };
}

/** Keep only the most recent N rows per gateway so this table never grows unbounded. */
export async function pruneOldDiagnostics(gateway: string, keep = 200): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM payment_gateway_diagnostics
      WHERE gateway = ${gateway}
        AND id NOT IN (
          SELECT id FROM payment_gateway_diagnostics
          WHERE gateway = ${gateway}
          ORDER BY created_at DESC
          LIMIT ${keep}
        )
    `);
  } catch (err) {
    logger.error({ err, gateway }, "Failed to prune payment diagnostics (non-fatal)");
  }
}
