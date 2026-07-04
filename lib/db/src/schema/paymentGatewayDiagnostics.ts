import { pgTable, serial, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Payment gateway diagnostics log.
 *
 * Purpose: capture EVERY payment-gateway initiation attempt (currently ICICI
 * Orange Pay, structured to extend to other gateways later) with enough
 * detail to reproduce and troubleshoot failures without needing to grep
 * container logs on the NAS.
 *
 * This is diagnostic/observability data only — it does not participate in
 * billing calculations, does not gate payment flow, and is safe to read,
 * export, or (eventually) prune without affecting money movement.
 *
 * Append-only. No update/delete endpoints. A retention job may prune old
 * rows beyond the most recent N (see icici-diagnostics/history route),
 * but nothing in the payment flow depends on this table's contents.
 */
export const paymentGatewayDiagnosticsTable = pgTable(
  "payment_gateway_diagnostics",
  {
    id: serial("id").primaryKey(),

    // ── Identity ────────────────────────────────────────────────────────
    gateway: text("gateway").notNull().default("icici"), // icici | razorpay | payu | phonepe | bharatpe | hdfc
    stage: text("stage").notNull(), // initiate | callback | status_check | refund
    merchantTxnNo: text("merchant_txn_no"),
    bookingRef: text("booking_ref"),

    // ── Outcome ─────────────────────────────────────────────────────────
    success: boolean("success").notNull().default(false),
    httpStatus: integer("http_status"),
    responseCode: text("response_code"),
    responseMessage: text("response_message"),

    // ── Request snapshot (as sent to the gateway) ──────────────────────
    requestUrl: text("request_url"),
    requestPayload: text("request_payload"), // JSON string, secrets masked
    requestHeaders: text("request_headers"), // JSON string

    // ── Response snapshot (as received from the gateway) ───────────────
    responseBody: text("response_body"), // raw text or JSON string
    redirectUri: text("redirect_uri"),
    tranCtx: text("tran_ctx"),
    secureHashMasked: text("secure_hash_masked"),

    // ── Client / caller context ─────────────────────────────────────────
    amount: text("amount"),
    currency: text("currency").default("INR"),
    merchantId: text("merchant_id"),
    aggregatorId: text("aggregator_id"),
    returnUrl: text("return_url"),
    callbackUrl: text("callback_url"),
    publicBaseUrl: text("public_base_url"),
    clientIp: text("client_ip"),
    forwardedFor: text("forwarded_for"),
    userAgent: text("user_agent"),
    referer: text("referer"),
    origin: text("origin"),

    // ── Local build/deploy context at the moment of this attempt ───────
    gitCommit: text("git_commit"),
    dockerImageVersion: text("docker_image_version"),
    buildTimestamp: text("build_timestamp"),
    environment: text("environment"), // production | uat/test

    // ── Timing ───────────────────────────────────────────────────────────
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pg_diag_gateway_idx").on(table.gateway),
    index("pg_diag_stage_idx").on(table.stage),
    index("pg_diag_success_idx").on(table.success),
    index("pg_diag_merchant_txn_idx").on(table.merchantTxnNo),
    index("pg_diag_created_idx").on(table.createdAt),
  ],
);

export const insertPaymentGatewayDiagnosticSchema = createInsertSchema(paymentGatewayDiagnosticsTable).omit({
  id: true,
  createdAt: true,
});
export type PaymentGatewayDiagnostic = typeof paymentGatewayDiagnosticsTable.$inferSelect;
export type InsertPaymentGatewayDiagnostic = z.infer<typeof insertPaymentGatewayDiagnosticSchema>;
