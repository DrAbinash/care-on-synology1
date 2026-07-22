import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

// ============================================================================
// Inter-organisation integration partners (HOPE → CARE and future partners).
//
// This is the inbound service-to-service credential store. It deliberately
// mirrors the proven ai_caller_credentials design (see
// middleware/requireAiCallerAuth.ts): the raw API key is shown ONCE at
// issuance and only its SHA-256 hash is ever stored, permissions are gated by
// a code-fixed allowlist (never widened from data), and every auth attempt —
// allowed or denied — is written to an append-only audit log.
//
// The OUTBOUND signing secret used to sign CARE→HOPE result callbacks is NOT
// stored here; it is read from an environment variable keyed by partner code
// (INTEGRATION_<CODE>_SIGNING_SECRET), so a DB read never exposes it. Only the
// non-secret callback URL is persisted (and may be overridden by env).
// ============================================================================
export const integrationPartnersTable = pgTable("integration_partners", {
  id: serial("id").primaryKey(),
  // Stable organisation code, e.g. "HOPE". Used as the source/destination org
  // identifier in every referral and event.
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  // "inbound" = this partner sends referrals to CARE (HOPE). Reserved for
  // future "outbound"/"bidirectional" partners.
  direction: text("direction").notNull().default("inbound"),
  // SHA-256 of the issued API key (hashApiKey()). Never the raw key.
  keyHash: text("key_hash"),
  // First few chars of the raw key, stored to help staff identify which key is
  // active without revealing it (e.g. "hoppartner_9f3a").
  keyPrefix: text("key_prefix"),
  // Where CARE POSTs result/status callbacks. The signing secret is env-only.
  callbackUrl: text("callback_url"),
  // Expected organisation codes inside inbound payloads — a defence-in-depth
  // check so a partner key cannot impersonate a different source org.
  sourceOrgCode: text("source_org_code").notNull().default(""),
  destinationOrgCode: text("destination_org_code").notNull().default("CARE"),
  // Granted permission strings. Still intersected with the code-fixed allowlist
  // in requireIntegrationPartnerAuth — data can only ever NARROW, never widen.
  permissions: jsonb("permissions").notNull().default([]),
  // Per-minute inbound rate limit (0 = use the global default).
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(120),
  isActive: boolean("is_active").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Append-only audit of every inbound integration auth attempt. Mirrors
// ai_caller_audit_log: best-effort, never blocks the request.
export const integrationPartnerAuditLogTable = pgTable("integration_partner_audit_log", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id"),
  partnerCode: text("partner_code").notNull().default(""),
  method: text("method").notNull().default(""),
  path: text("path").notNull().default(""),
  allowed: boolean("allowed").notNull().default(false),
  denyReason: text("deny_reason"),
  statusCode: text("status_code").notNull().default(""),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IntegrationPartner = typeof integrationPartnersTable.$inferSelect;
export type InsertIntegrationPartner = typeof integrationPartnersTable.$inferInsert;
export type IntegrationPartnerAuditLog = typeof integrationPartnerAuditLogTable.$inferSelect;
