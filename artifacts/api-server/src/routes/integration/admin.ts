// ============================================================================
// Integration admin console API. Mounted with requireStaffAuth + requireAdminRole.
//   • Provision inbound partners (issue/rotate hashed API keys — shown once).
//   • Manage the service catalogue mapping layer (unmapped review, retire).
//   • Failed-integrations view (dead/failed outbox) + manual retry + reconcile.
// Additive; touches no frozen surface.
// ============================================================================
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, or, ilike } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  integrationPartnersTable,
  serviceCatalogueMappingsTable,
  serviceCatalogueMappingSynonymsTable,
  integrationOutboxTable,
  integrationDeliveryAttemptsTable,
} from "@workspace/db";
import type { StaffAuthRequest } from "../../middleware/requireStaffAuth";
import { generateIntegrationKey, hashApiKey, ALLOWED_INTEGRATION_PERMISSIONS } from "../../middleware/requireIntegrationPartnerAuth";
import { normalizeTestName } from "../../services/integration/normalize";
import { retryOutboxEvent, dispatchPendingOutbox } from "../../services/integration/outbox";
import { reconcileResults } from "../../services/integration/resultsEmitter";
import { reconcileStatuses } from "../../services/integration/statusReconciler";
import { escalateCriticalResults } from "../../services/integration/criticalEscalation";

export const integrationAdminRouter = Router();
const staffName = (req: StaffAuthRequest) => req.staffSession?.subjectName ?? "admin";

// ── Partners ─────────────────────────────────────────────────────────────────
integrationAdminRouter.get("/partners", async (_req, res) => {
  const rows = await db.select().from(integrationPartnersTable).orderBy(desc(integrationPartnersTable.createdAt));
  res.json({ partners: rows.map((p) => ({ id: p.id, code: p.code, name: p.name, direction: p.direction, keyPrefix: p.keyPrefix, callbackUrl: p.callbackUrl, sourceOrgCode: p.sourceOrgCode, permissions: p.permissions, rateLimitPerMin: p.rateLimitPerMin, isActive: p.isActive, lastUsedAt: p.lastUsedAt }) ) });
});

const CreatePartnerSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2),
  sourceOrgCode: z.string().trim().optional(),
  callbackUrl: z.string().trim().url().optional().nullable(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});
integrationAdminRouter.post("/partners", async (req: StaffAuthRequest, res) => {
  const parsed = CreatePartnerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const perms = (parsed.data.permissions ?? [...ALLOWED_INTEGRATION_PERMISSIONS]).filter((p) => ALLOWED_INTEGRATION_PERMISSIONS.has(p));
  const rawKey = generateIntegrationKey();
  try {
    const [partner] = await db.insert(integrationPartnersTable).values({
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      sourceOrgCode: (parsed.data.sourceOrgCode ?? parsed.data.code).toUpperCase(),
      callbackUrl: parsed.data.callbackUrl ?? null,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 14),
      permissions: perms as never,
      isActive: parsed.data.isActive ?? true,
      createdBy: staffName(req),
    }).returning();
    // The raw key is returned ONCE and never stored in plaintext.
    res.status(201).json({ partner: { id: partner.id, code: partner.code, keyPrefix: partner.keyPrefix }, apiKey: rawKey, note: "Store this key now — it is shown only once." });
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") { res.status(409).json({ error: `Partner code '${parsed.data.code}' already exists.` }); return; }
    throw e;
  }
});

integrationAdminRouter.post("/partners/:id/rotate-key", async (req, res) => {
  const id = Number(req.params.id);
  const rawKey = generateIntegrationKey();
  const [updated] = await db.update(integrationPartnersTable).set({ keyHash: hashApiKey(rawKey), keyPrefix: rawKey.slice(0, 14) }).where(eq(integrationPartnersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Partner not found" }); return; }
  res.json({ apiKey: rawKey, keyPrefix: updated.keyPrefix, note: "Store this key now — it is shown only once." });
});

const UpdatePartnerSchema = z.object({ isActive: z.boolean().optional(), callbackUrl: z.string().url().nullable().optional(), permissions: z.array(z.string()).optional(), rateLimitPerMin: z.number().int().positive().optional() });
integrationAdminRouter.put("/partners/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdatePartnerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const set: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) set.isActive = parsed.data.isActive;
  if (parsed.data.callbackUrl !== undefined) set.callbackUrl = parsed.data.callbackUrl;
  if (parsed.data.rateLimitPerMin !== undefined) set.rateLimitPerMin = parsed.data.rateLimitPerMin;
  if (parsed.data.permissions) set.permissions = parsed.data.permissions.filter((p) => ALLOWED_INTEGRATION_PERMISSIONS.has(p)) as never;
  const [updated] = await db.update(integrationPartnersTable).set(set).where(eq(integrationPartnersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Partner not found" }); return; }
  res.json({ ok: true });
});

// ── Catalogue mappings ───────────────────────────────────────────────────────
integrationAdminRouter.get("/mappings", async (req, res) => {
  const status = String(req.query.status ?? "");
  const search = String(req.query.search ?? "").trim();
  const conds: ReturnType<typeof eq>[] = [];
  if (status) conds.push(eq(serviceCatalogueMappingsTable.mappingStatus, status));
  if (search) conds.push(or(ilike(serviceCatalogueMappingsTable.sourceName, `%${search}%`), ilike(serviceCatalogueMappingsTable.sourceCode, `%${search}%`)) as ReturnType<typeof eq>);
  const rows = await db.select().from(serviceCatalogueMappingsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(serviceCatalogueMappingsTable.createdAt)).limit(500);
  res.json({ mappings: rows });
});

const CreateMappingSchema = z.object({
  sourceSystem: z.string().trim().default("HOPE"),
  sourceCode: z.string().trim().optional().nullable(),
  sourceName: z.string().trim().min(1),
  sourceModality: z.string().trim().optional().nullable(),
  careTestId: z.number().int().positive().optional().nullable(),
  carePackageId: z.number().int().positive().optional().nullable(),
  careDisplayName: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  modality: z.string().trim().optional().nullable(),
  specimenType: z.string().trim().optional().nullable(),
  mappingType: z.string().trim().optional(),
  mappingStatus: z.enum(["active", "pending_review", "retired"]).optional(),
  synonyms: z.array(z.string()).optional(),
});
integrationAdminRouter.post("/mappings", async (req: StaffAuthRequest, res) => {
  const parsed = CreateMappingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  if (!parsed.data.careTestId && !parsed.data.carePackageId && (parsed.data.mappingStatus ?? "pending_review") === "active") {
    res.status(400).json({ error: "An active mapping must target a CARE test or package." }); return;
  }
  const created = await db.transaction(async (tx) => {
    const [m] = await tx.insert(serviceCatalogueMappingsTable).values({
      sourceSystem: parsed.data.sourceSystem.toUpperCase(),
      sourceCode: parsed.data.sourceCode ?? null,
      sourceName: parsed.data.sourceName,
      sourceNameNormalized: normalizeTestName(parsed.data.sourceName),
      sourceModality: parsed.data.sourceModality ?? null,
      careTestId: parsed.data.careTestId ?? null,
      carePackageId: parsed.data.carePackageId ?? null,
      careDisplayName: parsed.data.careDisplayName ?? null,
      department: parsed.data.department ?? null,
      modality: parsed.data.modality ?? null,
      specimenType: parsed.data.specimenType ?? null,
      mappingType: parsed.data.mappingType ?? (parsed.data.carePackageId ? "one_to_package" : "one_to_one"),
      mappingStatus: parsed.data.mappingStatus ?? "pending_review",
      confidence: "100",
      createdBy: staffName(req),
    }).returning();
    for (const syn of parsed.data.synonyms ?? []) {
      if (syn.trim()) await tx.insert(serviceCatalogueMappingSynonymsTable).values({ mappingId: m.id, synonym: syn.trim(), synonymNormalized: normalizeTestName(syn) }).catch(() => {});
    }
    return m;
  });
  res.status(201).json({ mapping: created });
});

integrationAdminRouter.put("/mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ mappingStatus: z.enum(["active", "pending_review", "retired"]).optional(), careTestId: z.number().int().positive().nullable().optional(), carePackageId: z.number().int().positive().nullable().optional(), isActive: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const set: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.mappingStatus === "retired") set.effectiveTo = new Date();
  const [updated] = await db.update(serviceCatalogueMappingsTable).set(set).where(eq(serviceCatalogueMappingsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Mapping not found" }); return; }
  res.json({ mapping: updated });
});

// ── Failed integrations (outbox) ─────────────────────────────────────────────
integrationAdminRouter.get("/outbox", async (req, res) => {
  const status = String(req.query.status ?? "");
  const conds: ReturnType<typeof eq>[] = [];
  if (status) conds.push(inArray(integrationOutboxTable.status, status.split(",")) as ReturnType<typeof eq>);
  const rows = await db.select().from(integrationOutboxTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(integrationOutboxTable.createdAt)).limit(200);
  res.json({ events: rows });
});

integrationAdminRouter.get("/outbox/:id/attempts", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(integrationDeliveryAttemptsTable).where(eq(integrationDeliveryAttemptsTable.outboxId, id)).orderBy(desc(integrationDeliveryAttemptsTable.createdAt));
  res.json({ attempts: rows });
});

integrationAdminRouter.post("/outbox/:id/retry", async (req, res) => {
  await retryOutboxEvent(Number(req.params.id));
  res.json({ ok: true });
});

// Manual dispatch / reconcile triggers (also driven by cron).
integrationAdminRouter.post("/dispatch-outbox", async (_req, res) => {
  const r = await dispatchPendingOutbox({ limit: 50 });
  res.json(r);
});
integrationAdminRouter.post("/reconcile-results", async (_req, res) => {
  const statuses = await reconcileStatuses({ limit: 100 });
  const results = await reconcileResults({ limit: 100 });
  const escalations = await escalateCriticalResults({ limit: 50 });
  res.json({ statuses, results, escalations });
});
