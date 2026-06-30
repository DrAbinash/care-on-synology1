// ── AI Caller Service Credentials ──
// Epic 2, Feature 2.1 of AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md —
// "stand up the ai_caller credential/permission-matrix entry."
//
// Why this is its OWN table, not a third scope value on portal_sessions
// or a tenth role on role_permissions:
//
//   portal_sessions (see portalSessions.ts) is shaped entirely around
//   human sessions: a token that expires, an idle-timeout that logs
//   someone out after inactivity (read from clinic_settings, see
//   requireStaffAuth.ts), and a subjectId that requireStaffAuth.ts
//   resolves against usersTable — a real human's account row. An AI
//   caller (the WhatsApp bot engine, calling the Knowledge Base API on
//   every patient message) is not a human session: it should not be
//   logged out for "inactivity" between messages, and it has no
//   corresponding usersTable row to load.
//
//   role_permissions (see rolePermissions.ts) is a fully *editable*
//   matrix — any admin can flip any boolean for any role at any time.
//   That flexibility is exactly wrong for ai_caller: 03_'s entire
//   design intent (§8.2) was that this permission set must be
//   structurally incapable of accidentally widening — no refund, no
//   delete, no radiologist-audience report links, ever, not as a
//   default that could be toggled off, but as a fact the permission
//   CHECK function enforces unconditionally (see
//   requireAiCallerAuth.ts's ALLOWED_AI_CALLER_PERMISSIONS constant,
//   which is not stored in this table and is not editable via any API).
//
// What IS configurable, and lives in this table: which named credential
// (e.g. "whatsapp-bot", "future-website-assistant") is currently active,
// and the ability to revoke/rotate one without code deployment — the
// same operational need API keys serve everywhere else, just scoped
// down to the one, fixed, narrow permission set this credential class
// is allowed to have at all.

import {
  pgTable, serial, text, boolean, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiCallerCredentialsTable = pgTable(
  "ai_caller_credentials",
  {
    id: serial("id").primaryKey(),
    // Human-readable label, e.g. "whatsapp-bot" — not a secret, used in
    // audit logs and the admin UI so a revoked/rotated credential is
    // identifiable without needing to know its key.
    name: text("name").notNull(),
    // One-way SHA-256 hash of the actual API key, never the key itself.
    // Unlike WhatsApp access tokens (which must be sent back out to
    // Meta, and therefore must be reversibly encrypted — see
    // cryptoUtils.ts), this system only ever needs to verify "does the
    // presented key match what was issued," never read the key back —
    // so a one-way hash is strictly safer: even a full database
    // compromise cannot recover a live, usable key from this table.
    keyHash: text("key_hash").notNull(),
    // Which channel/integration this credential authenticates as — per
    // 03_ §3.2.10's design that each Channel Gateway should have its own
    // sub-credential, scoped to only its own channel, so a compromised
    // WhatsApp webhook secret cannot impersonate a future Voice Gateway.
    // Free text, not an enum, matching the same reasoning
    // knowledgeBase.ts's "channel" column already uses — new channels
    // shouldn't need a migration to be representable here.
    channel: text("channel").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().default(""),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyHashIdx: index("ai_caller_credentials_key_hash_idx").on(t.keyHash),
    channelIdx: index("ai_caller_credentials_channel_idx").on(t.channel),
  }),
);

// Audit log — every AI-caller-authenticated API call, per 03_ §3.3 rule 4:
// "every endpoint in this section logs to Audit Logger by caller identity
// ai_receptionist, never under a patient or staff identity — so existing
// audit/compliance tooling can immediately distinguish AI-originated
// actions from human-originated ones without new tooling." This table is
// that distinguishable log, separate from waAuditLogsTable (which logs
// WhatsApp-specific send/receive events) and separate from any future
// staff-action audit log — this one specifically answers "what did an AI
// credential do, when, to what."
export const aiCallerAuditLogTable = pgTable(
  "ai_caller_audit_log",
  {
    id: serial("id").primaryKey(),
    credentialId: text("credential_id"), // nullable: logged even if credential lookup failed, for security review of rejected attempts
    credentialName: text("credential_name").notNull().default(""),
    channel: text("channel").notNull().default(""),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: text("status_code").notNull().default(""),
    allowed: boolean("allowed").notNull(),
    denyReason: text("deny_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("ai_caller_audit_log_created_at_idx").on(t.createdAt),
    allowedIdx: index("ai_caller_audit_log_allowed_idx").on(t.allowed),
  }),
);

export const insertAiCallerCredentialSchema = createInsertSchema(aiCallerCredentialsTable).omit({
  id: true, keyHash: true, lastUsedAt: true, revokedAt: true, revokedBy: true, createdAt: true,
});
export type InsertAiCallerCredential = z.infer<typeof insertAiCallerCredentialSchema>;
export type AiCallerCredential = typeof aiCallerCredentialsTable.$inferSelect;
export type AiCallerAuditLog = typeof aiCallerAuditLogTable.$inferSelect;
