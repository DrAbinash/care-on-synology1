// ============================================================================
// Inbound inter-org partner authentication (HOPE → CARE). Deliberately mirrors
// requireAiCallerAuth.ts: the raw key is shown once and only its SHA-256 hash
// is stored; the permission a route requires is checked against a CODE-FIXED
// allowlist before any DB lookup (data can narrow a partner's grants but can
// never widen beyond this set); every attempt — allowed or denied — is written
// to integration_partner_audit_log. Least-privilege + full audit by construction.
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { integrationPartnersTable, integrationPartnerAuditLogTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface IntegrationPartnerAuthRequest extends Request {
  integrationPartner?: {
    id: number;
    code: string;
    sourceOrgCode: string;
    destinationOrgCode: string;
    permissions: string[];
  };
}

// The complete set of permissions any integration partner credential may ever
// hold. Adding a capability is a code change reviewed like any other security
// constant — never a data toggle.
export const ALLOWED_INTEGRATION_PERMISSIONS = new Set([
  "diagnostic_referral:create",
  "diagnostic_referral:update",
  "diagnostic_referral:cancel",
  "diagnostic_referral:read",
  "diagnostic_result:acknowledge",
  "whatsapp:enqueue",
]);

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Mint a new partner key. Returned ONCE at issuance; only its hash is stored. */
export function generateIntegrationKey(): string {
  return `intgk_${randomBytes(32).toString("hex")}`;
}

function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch { return []; }
  }
  return [];
}

async function logAttempt(params: {
  partnerId: number | null; partnerCode: string; method: string; path: string;
  allowed: boolean; denyReason?: string; ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(integrationPartnerAuditLogTable).values({
      partnerId: params.partnerId,
      partnerCode: params.partnerCode,
      method: params.method,
      path: params.path,
      allowed: params.allowed,
      denyReason: params.denyReason,
      statusCode: "",
      ipAddress: params.ipAddress,
    });
  } catch {
    // Audit logging must never block or crash the request.
  }
}

/**
 * Require a valid `Authorization: Bearer intgk_...` partner key AND that the
 * route's declared permission is in the code-fixed allowlist and granted to the
 * partner. Attaches req.integrationPartner.
 */
export function requireIntegrationPartnerAuth(permission: string) {
  return async (req: IntegrationPartnerAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
    const auth = req.headers.authorization ?? "";
    const rawKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!rawKey) {
      await logAttempt({ partnerId: null, partnerCode: "", method: req.method, path: req.path, allowed: false, denyReason: "missing_key", ipAddress: ip });
      res.status(401).json({ error: "Integration partner authentication required" });
      return;
    }

    // Route asks for a permission outside the allowlist → code bug, fail closed.
    if (!ALLOWED_INTEGRATION_PERMISSIONS.has(permission)) {
      await logAttempt({ partnerId: null, partnerCode: "", method: req.method, path: req.path, allowed: false, denyReason: `permission_not_in_allowlist:${permission}`, ipAddress: ip });
      res.status(403).json({ error: "This action is not permitted for integration partners." });
      return;
    }

    const [partner] = await db
      .select()
      .from(integrationPartnersTable)
      .where(and(eq(integrationPartnersTable.keyHash, hashApiKey(rawKey)), eq(integrationPartnersTable.isActive, true)))
      .limit(1);

    if (!partner) {
      await logAttempt({ partnerId: null, partnerCode: "", method: req.method, path: req.path, allowed: false, denyReason: "invalid_or_revoked_key", ipAddress: ip });
      res.status(401).json({ error: "Invalid or revoked integration partner credential" });
      return;
    }

    const granted = parsePermissions(partner.permissions);
    if (!granted.includes(permission)) {
      await logAttempt({ partnerId: partner.id, partnerCode: partner.code, method: req.method, path: req.path, allowed: false, denyReason: `permission_not_granted:${permission}`, ipAddress: ip });
      res.status(403).json({ error: `Your integration credential is not authorised for '${permission}'.` });
      return;
    }

    req.integrationPartner = {
      id: partner.id,
      code: partner.code,
      sourceOrgCode: partner.sourceOrgCode || partner.code,
      destinationOrgCode: partner.destinationOrgCode || "CARE",
      permissions: granted,
    };

    await db.update(integrationPartnersTable).set({ lastUsedAt: new Date() }).where(eq(integrationPartnersTable.id, partner.id));
    await logAttempt({ partnerId: partner.id, partnerCode: partner.code, method: req.method, path: req.path, allowed: true, ipAddress: ip });

    next();
  };
}
