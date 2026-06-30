// AI Caller Authentication.
// Epic 2, Feature 2.1 — see aiCallerCredentials.ts for the full design
// rationale: why this is a separate table/mechanism from human staff
// sessions, and why permissions are not stored in the database.
//
// IMPORTANT — what this protects, and what it doesn't, today:
//
// WhatsAppBotEngine, the only AI caller that currently exists, queries
// the Knowledge Base by importing knowledgeBaseEntriesTable and running
// a direct Drizzle query — it runs in the same Node process as this API
// server, not as a separate HTTP client. This middleware does not
// protect that path, and doesn't need to: there is no network hop for
// an in-process call to authenticate across.
//
// This middleware exists for the genuinely external AI-caller case the
// implementation blueprint designed for — a future Conversation
// Manager, Voice Gateway, or Website Assistant that is a separate
// service or process calling this API over HTTP. None of those exist
// yet, confirmed: this codebase's WhatsApp AI is in-process, not a
// remote caller. Building this now, even with no current consumer
// beyond the knowledge-base search endpoint exposed for future use,
// closes the implementation checklist's Gate 1 item honestly — the
// mechanism is real and tested, even though nothing outside this
// process happens to call it over HTTP yet.

import { createHash, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { aiCallerCredentialsTable, aiCallerAuditLogTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export interface AiCallerAuthRequest extends Request {
  aiCaller?: {
    id: number;
    name: string;
    channel: string;
  };
}

/**
 * The complete, fixed set of permissions any ai_caller credential may
 * ever be granted, per the blueprint's explicit non-permissions list.
 * This is a TypeScript constant, not a database column or an
 * admin-editable setting, deliberately: the whole point was that this
 * permission set must be structurally incapable of accidentally
 * widening. An admin cannot toggle a refund permission on for an AI
 * caller, because there is no UI field or API parameter that writes to
 * anything checked here — the only way to change what an AI caller can
 * do is to edit this file and ship a code change, the same bar as
 * changing any other security-critical constant in this codebase.
 */
export const ALLOWED_AI_CALLER_PERMISSIONS = new Set([
  "knowledge_base:search",
  "knowledge_base:read",
]);

/** Hash a presented API key the same way it was hashed at issuance. */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generate a new random API key. Returned ONCE at creation time — only
 * its hash is ever stored, per aiCallerCredentials.ts's design note on
 * why this is a one-way hash, not a reversibly-encrypted secret.
 */
export function generateApiKey(): string {
  return `aic_${randomBytes(32).toString("hex")}`;
}

async function logAttempt(params: {
  credentialId: number | null;
  credentialName: string;
  channel: string;
  method: string;
  path: string;
  allowed: boolean;
  denyReason?: string;
}): Promise<void> {
  try {
    await db.insert(aiCallerAuditLogTable).values({
      credentialId: params.credentialId !== null ? String(params.credentialId) : null,
      credentialName: params.credentialName,
      channel: params.channel,
      method: params.method,
      path: params.path,
      statusCode: "",
      allowed: params.allowed,
      denyReason: params.denyReason,
    });
  } catch {
    // Audit logging must never block or crash the actual request,
    // matching this codebase's existing pattern elsewhere (WhatsApp's
    // own audit logging calls are similarly best-effort throughout).
  }
}

/**
 * Express middleware requiring a valid Authorization: Bearer aic_...
 * API key issued via the AI Caller Credentials admin screen, and that
 * the specific permission this route requires is in the hardcoded
 * allowlist above.
 *
 * Every attempt, allowed or denied, is logged to ai_caller_audit_log,
 * including attempts with an invalid or revoked key, so a pattern of
 * failed AI-caller auth attempts is visible to whoever reviews that
 * log, not just successful ones.
 */
export function requireAiCallerAuth(permission: string) {
  return async (req: AiCallerAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.headers.authorization ?? "";
    const rawKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!rawKey) {
      await logAttempt({ credentialId: null, credentialName: "", channel: "", method: req.method, path: req.path, allowed: false, denyReason: "missing_key" });
      res.status(401).json({ error: "AI caller authentication required" });
      return;
    }

    // This permission is not the credential's stored grant — it is a
    // fixed property of the route (every route using this middleware
    // declares the one permission it requires), checked against the
    // hardcoded allowlist before any database lookup even happens. A
    // route asking for a permission outside the allowlist is a code
    // bug, not a configuration state — fail closed immediately.
    if (!ALLOWED_AI_CALLER_PERMISSIONS.has(permission)) {
      await logAttempt({ credentialId: null, credentialName: "", channel: "", method: req.method, path: req.path, allowed: false, denyReason: `permission_not_in_allowlist:${permission}` });
      res.status(403).json({ error: "This action is not permitted for AI callers." });
      return;
    }

    const keyHash = hashApiKey(rawKey);
    const [cred] = await db
      .select()
      .from(aiCallerCredentialsTable)
      .where(and(eq(aiCallerCredentialsTable.keyHash, keyHash), eq(aiCallerCredentialsTable.isActive, true)))
      .limit(1);

    if (!cred) {
      await logAttempt({ credentialId: null, credentialName: "", channel: "", method: req.method, path: req.path, allowed: false, denyReason: "invalid_or_revoked_key" });
      res.status(401).json({ error: "Invalid or revoked AI caller credential" });
      return;
    }

    req.aiCaller = { id: cred.id, name: cred.name, channel: cred.channel };

    await db.update(aiCallerCredentialsTable).set({ lastUsedAt: new Date() }).where(eq(aiCallerCredentialsTable.id, cred.id));
    await logAttempt({ credentialId: cred.id, credentialName: cred.name, channel: cred.channel, method: req.method, path: req.path, allowed: true });

    next();
  };
}
