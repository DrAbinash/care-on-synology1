// AI Caller Credentials — admin management API.
// Lets a Super Admin issue, list, and revoke the machine credentials an
// external AI caller (a future Conversation Manager, Voice Gateway, etc.)
// would present to authenticate against routes protected by
// requireAiCallerAuth. See requireAiCallerAuth.ts and
// aiCallerCredentials.ts for the full design rationale.
//
// Restricted to super_admin specifically, not the general /settings
// permission every other admin screen in this codebase uses — issuing a
// credential that can call AI-facing endpoints is closer in sensitivity
// to issuing a payment-gateway API key than to editing a clinic-hours
// setting, and this codebase's existing FULL_ACCESS_ROLES concept
// already treats super_admin as the tier for exactly this kind of
// action.

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { aiCallerCredentialsTable, aiCallerAuditLogTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { generateApiKey, hashApiKey, ALLOWED_AI_CALLER_PERMISSIONS } from "../middleware/requireAiCallerAuth";

export const aiCallerCredentialsRouter = Router();

aiCallerCredentialsRouter.use(requireStaffAuth);

function requireSuperAdmin(req: StaffAuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (req.staffSession?.role !== "super_admin") {
    res.status(403).json({ error: "Only Super Admin can manage AI caller credentials." });
    return false;
  }
  return true;
}

const CreateBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  channel: z.string().trim().min(1, "channel is required"),
});

// List, key hash never returned.
aiCallerCredentialsRouter.get("/", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req as StaffAuthRequest, res)) return;
  const rows = await db.select().from(aiCallerCredentialsTable).orderBy(desc(aiCallerCredentialsTable.createdAt));
  res.json(rows.map((r) => ({ ...r, keyHash: undefined })));
});

// The fixed, hardcoded allowlist, surfaced read-only so the admin UI can
// display what an AI caller is capable of without that list living in
// two places.
aiCallerCredentialsRouter.get("/permissions", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req as StaffAuthRequest, res)) return;
  res.json(Array.from(ALLOWED_AI_CALLER_PERMISSIONS));
});

// Create. The raw key is returned exactly once, in this response, and
// never again — matches this codebase's existing masked-secret display
// pattern, except here there is no decrypt path at all, so "never shown
// again" is structural, not just a UI convention.
aiCallerCredentialsRouter.post("/", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req as StaffAuthRequest, res)) return;
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const rawKey = generateApiKey();
  const [created] = await db.insert(aiCallerCredentialsTable).values({
    name: parsed.data.name,
    channel: parsed.data.channel,
    keyHash: hashApiKey(rawKey),
    createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? "",
  }).returning();

  res.status(201).json({ ...created, keyHash: undefined, apiKey: rawKey });
});

// Revoke, never hard-delete, matching the Knowledge Base's archive-
// don't-delete lifecycle pattern — a revoked credential's audit trail
// remains meaningful after revocation, rather than pointing at a
// vanished row.
aiCallerCredentialsRouter.post("/:id/revoke", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req as StaffAuthRequest, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(aiCallerCredentialsTable).where(eq(aiCallerCredentialsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db.update(aiCallerCredentialsTable).set({
    isActive: false,
    revokedAt: new Date(),
    revokedBy: (req as StaffAuthRequest).staffSession?.subjectName ?? "",
  }).where(eq(aiCallerCredentialsTable.id, id)).returning();

  res.json({ ...updated, keyHash: undefined });
});

// Recent attempts, allowed and denied — the screen that makes a pattern
// of failed AI-caller auth attempts actually visible to a human, not
// just recorded.
aiCallerCredentialsRouter.get("/audit-log", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req as StaffAuthRequest, res)) return;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const rows = await db.select().from(aiCallerAuditLogTable).orderBy(desc(aiCallerAuditLogTable.createdAt)).limit(limit);
  res.json(rows);
});
