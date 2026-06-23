// ── Phase 5: Structured Smart Reporting Engine API Routes ──
// Deterministic, rules-based text generation. NO AI.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  radiologySmartFindingsTable,
  radiologyImpressionRulesTable,
  radiologyFavoriteFindingSetsTable,
  radiologySmartUsageTable,
  radiologySmartFindingsAuditTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth.js";

export const radiologySmartFindingsRouter: IRouter = Router();

function getStaffId(req: StaffAuthRequest): number | undefined {
  return req.staffSession?.subjectId;
}
function getStaffName(req: StaffAuthRequest): string {
  return req.staffSession?.subjectName ?? "";
}
function isAdmin(req: StaffAuthRequest): boolean {
  const r = req.staffSession?.role?.toLowerCase() ?? "";
  return r === "admin" || r === "super_admin";
}

// Helper: log smart feature usage
async function logSmartUsage(
  staffId: number,
  featureType: string,
  action: string,
  builderType?: string,
  worklistId?: number,
  durationMs?: number
) {
  try {
    await db.insert(radiologySmartUsageTable).values({
      staffId, featureType, action, builderType: builderType ?? null,
      worklistId: worklistId ?? null, durationMs: durationMs ?? null,
    });
  } catch {
    // Non-blocking analytics
  }
}

// Helper: audit log
async function logAudit(
  smartFindingId: number,
  staffId: number,
  action: string,
  previousText?: string,
  newText?: string,
  ruleVersion?: string
) {
  try {
    await db.insert(radiologySmartFindingsAuditTable).values({
      smartFindingId, staffId, action,
      previousText: previousText ?? null,
      newText: newText ?? null,
      ruleVersion: ruleVersion ?? null,
    });
  } catch {
    // Non-blocking audit
  }
}

// ── SMART FINDINGS CRUD ──

// GET /api/radiology/smart/findings — list for current worklist or all
radiologySmartFindingsRouter.get("/findings", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const worklistId = req.query.worklistId ? Number(req.query.worklistId) : undefined;
  const conditions = [eq(radiologySmartFindingsTable.staffId, getStaffId(req) as number), eq(radiologySmartFindingsTable.isActive, true)];
  if (worklistId && Number.isFinite(worklistId)) conditions.push(eq(radiologySmartFindingsTable.worklistId, worklistId));
  const rows = await db.select().from(radiologySmartFindingsTable).where(and(...conditions)).orderBy(desc(radiologySmartFindingsTable.createdAt));
  res.json({ findings: rows, count: rows.length });
});

// GET /api/radiology/smart/findings/:id
radiologySmartFindingsRouter.get("/findings/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(radiologySmartFindingsTable).where(and(eq(radiologySmartFindingsTable.id, id), eq(radiologySmartFindingsTable.staffId, getStaffId(req) as number)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// POST /api/radiology/smart/findings — create or update
radiologySmartFindingsRouter.post("/findings", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;
  const staffId = getStaffId(req) as number;

  // Check for existing entry on same worklist + builder
  const [existing] = await db
    .select()
    .from(radiologySmartFindingsTable)
    .where(and(
      eq(radiologySmartFindingsTable.worklistId, body.worklistId),
      eq(radiologySmartFindingsTable.builderType, body.builderType),
      eq(radiologySmartFindingsTable.staffId, staffId)
    ));

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(radiologySmartFindingsTable)
      .set({
        selections: body.selections,
        generatedFindings: body.generatedFindings,
        generatedImpression: body.generatedImpression,
        ruleVersion: body.ruleVersion ?? existing.ruleVersion,
        isEdited: body.isEdited ?? existing.isEdited,
        isActive: true,
      })
      .where(eq(radiologySmartFindingsTable.id, existing.id))
      .returning();

    await logAudit(updated.id, staffId, "edited", existing.generatedFindings ?? undefined, body.generatedFindings ?? undefined, body.ruleVersion ?? undefined);
    await logSmartUsage(staffId, "smart_findings", "edit", body.builderType, body.worklistId);
    res.json(updated);
    return;
  }

  // Create new
  const [inserted] = await db.insert(radiologySmartFindingsTable).values({
    worklistId: body.worklistId,
    staffId,
    studyType: body.studyType,
    builderType: body.builderType,
    selections: body.selections,
    generatedFindings: body.generatedFindings,
    generatedImpression: body.generatedImpression,
    ruleVersion: body.ruleVersion ?? "v1.0",
  }).returning();

  await logAudit(inserted.id, staffId, "generated", undefined, body.generatedFindings ?? undefined, body.ruleVersion ?? undefined);
  await logSmartUsage(staffId, "smart_findings", "generate", body.builderType, body.worklistId);
  res.status(201).json(inserted);
});

// PATCH /api/radiology/smart/findings/:id — mark as edited
radiologySmartFindingsRouter.patch("/findings/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const staffId = getStaffId(req) as number;
  const [existing] = await db.select().from(radiologySmartFindingsTable).where(and(eq(radiologySmartFindingsTable.id, id), eq(radiologySmartFindingsTable.staffId, staffId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologySmartFindingsTable)
    .set({
      selections: body.selections ?? existing.selections,
      generatedFindings: body.generatedFindings ?? existing.generatedFindings,
      generatedImpression: body.generatedImpression ?? existing.generatedImpression,
      isEdited: body.isEdited ?? existing.isEdited,
      isActive: body.isActive ?? existing.isActive,
      ruleVersion: body.ruleVersion ?? existing.ruleVersion,
    })
    .where(eq(radiologySmartFindingsTable.id, id))
    .returning();

  if (body.isEdited && !existing.isEdited) {
    await logAudit(id, staffId, "edited", existing.generatedFindings ?? undefined, body.generatedFindings ?? undefined, updated.ruleVersion ?? undefined);
  }
  res.json(updated);
});

// DELETE /api/radiology/smart/findings/:id — soft delete
radiologySmartFindingsRouter.delete("/findings/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const staffId = getStaffId(req) as number;
  const [existing] = await db.select().from(radiologySmartFindingsTable).where(and(eq(radiologySmartFindingsTable.id, id), eq(radiologySmartFindingsTable.staffId, staffId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(radiologySmartFindingsTable).set({ isActive: false }).where(eq(radiologySmartFindingsTable.id, id));
  await logAudit(id, staffId, "deleted", existing.generatedFindings ?? undefined, undefined, existing.ruleVersion ?? undefined);
  res.json({ ok: true });
});

// ── IMPRESSION RULES ──

// GET /api/radiology/smart/impression-rules
radiologySmartFindingsRouter.get("/impression-rules", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const builderType = req.query.builderType as string | undefined;
  const conditions = [eq(radiologyImpressionRulesTable.isActive, true)];
  if (builderType) conditions.push(eq(radiologyImpressionRulesTable.builderType, builderType));
  const rows = await db.select().from(radiologyImpressionRulesTable).where(and(...conditions)).orderBy(asc(radiologyImpressionRulesTable.builderType), asc(radiologyImpressionRulesTable.ruleName));
  res.json({ rules: rows, count: rows.length });
});

// POST /api/radiology/smart/impression-rules (admin only)
radiologySmartFindingsRouter.post("/impression-rules", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  const body = req.body;
  const [inserted] = await db.insert(radiologyImpressionRulesTable).values({
    ruleName: body.ruleName,
    builderType: body.builderType,
    conditions: body.conditions,
    generatedText: body.generatedText,
    priority: body.priority ?? "normal",
    severity: body.severity ?? "moderate",
    version: body.version ?? "v1.0",
    createdBy: getStaffName(req),
  }).returning();
  res.status(201).json(inserted);
});

// PATCH /api/radiology/smart/impression-rules/:id (admin only)
radiologySmartFindingsRouter.patch("/impression-rules/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologyImpressionRulesTable).where(eq(radiologyImpressionRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologyImpressionRulesTable)
    .set({
      ruleName: body.ruleName ?? existing.ruleName,
      conditions: body.conditions ?? existing.conditions,
      generatedText: body.generatedText ?? existing.generatedText,
      priority: body.priority ?? existing.priority,
      severity: body.severity ?? existing.severity,
      version: body.version ?? existing.version,
      isActive: body.isActive ?? existing.isActive,
      updatedBy: getStaffName(req),
    })
    .where(eq(radiologyImpressionRulesTable.id, id))
    .returning();
  res.json(updated);
});

// DELETE /api/radiology/smart/impression-rules/:id (admin only)
radiologySmartFindingsRouter.delete("/impression-rules/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(radiologyImpressionRulesTable).set({ isActive: false }).where(eq(radiologyImpressionRulesTable.id, id));
  res.json({ ok: true });
});

// ── FAVORITE FINDING SETS ──

// GET /api/radiology/smart/favorite-sets
radiologySmartFindingsRouter.get("/favorite-sets", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const builderType = req.query.builderType as string | undefined;
  const conditions = [
    eq(radiologyFavoriteFindingSetsTable.staffId, getStaffId(req) as number),
    eq(radiologyFavoriteFindingSetsTable.isActive, true),
  ];
  if (builderType) conditions.push(eq(radiologyFavoriteFindingSetsTable.builderType, builderType));
  const rows = await db.select().from(radiologyFavoriteFindingSetsTable).where(and(...conditions)).orderBy(asc(radiologyFavoriteFindingSetsTable.builderType), asc(radiologyFavoriteFindingSetsTable.setName));
  res.json({ sets: rows, count: rows.length });
});

// POST /api/radiology/smart/favorite-sets
radiologySmartFindingsRouter.post("/favorite-sets", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;
  const staffId = getStaffId(req) as number;

  // Check duplicate
  const [dup] = await db
    .select()
    .from(radiologyFavoriteFindingSetsTable)
    .where(and(
      eq(radiologyFavoriteFindingSetsTable.staffId, staffId),
      eq(radiologyFavoriteFindingSetsTable.setName, body.setName),
      eq(radiologyFavoriteFindingSetsTable.builderType, body.builderType)
    ));
  if (dup) { res.status(409).json({ error: "Favorite set with this name already exists", existingId: dup.id }); return; }

  const [inserted] = await db.insert(radiologyFavoriteFindingSetsTable).values({
    staffId, setName: body.setName, builderType: body.builderType, selections: body.selections,
  }).returning();

  await logSmartUsage(staffId, "favorite_set", "save", body.builderType);
  res.status(201).json(inserted);
});

// PATCH /api/radiology/smart/favorite-sets/:id
radiologySmartFindingsRouter.patch("/favorite-sets/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const staffId = getStaffId(req) as number;
  const [existing] = await db.select().from(radiologyFavoriteFindingSetsTable).where(and(eq(radiologyFavoriteFindingSetsTable.id, id), eq(radiologyFavoriteFindingSetsTable.staffId, staffId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologyFavoriteFindingSetsTable)
    .set({
      setName: body.setName ?? existing.setName,
      selections: body.selections ?? existing.selections,
      isActive: body.isActive ?? existing.isActive,
    })
    .where(eq(radiologyFavoriteFindingSetsTable.id, id))
    .returning();
  res.json(updated);
});

// DELETE /api/radiology/smart/favorite-sets/:id
radiologySmartFindingsRouter.delete("/favorite-sets/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const staffId = getStaffId(req) as number;
  const [existing] = await db.select().from(radiologyFavoriteFindingSetsTable).where(and(eq(radiologyFavoriteFindingSetsTable.id, id), eq(radiologyFavoriteFindingSetsTable.staffId, staffId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(radiologyFavoriteFindingSetsTable).where(eq(radiologyFavoriteFindingSetsTable.id, id));
  res.json({ ok: true });
});

// ── GENERATE ENDPOINT ──
// POST /api/radiology/smart/generate
// Body: { builderType, selections }
// Returns: { findings, impression, recommendations, severity, priority, matchedRules }
radiologySmartFindingsRouter.post("/generate", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const { builderType, selections } = req.body;
  if (!builderType || !selections) { res.status(400).json({ error: "builderType and selections required" }); return; }

  // Fetch active rules for this builder
  const rules = await db
    .select()
    .from(radiologyImpressionRulesTable)
    .where(and(eq(radiologyImpressionRulesTable.builderType, builderType), eq(radiologyImpressionRulesTable.isActive, true)));

  // Evaluate rules
  const matchedRules: { id: number; text: string; severity: string; priority: string }[] = [];
  for (const rule of rules) {
    const allMatch = (rule.conditions as { field: string; operator: string; value: string | string[] }[]).every((cond) => {
      const val = selections[cond.field];
      if (cond.operator === "equals") return val === cond.value;
      if (cond.operator === "not_equals") return val !== cond.value;
      if (cond.operator === "includes") {
        if (Array.isArray(val)) return (cond.value as string[]).some((v) => val.includes(v));
        return String(val).includes(cond.value as string);
      }
      if (cond.operator === "not_includes") {
        if (Array.isArray(val)) return !(cond.value as string[]).some((v) => val.includes(v));
        return !String(val).includes(cond.value as string);
      }
      if (cond.operator === "greater_than") return Number(val) > Number(cond.value);
      if (cond.operator === "less_than") return Number(val) < Number(cond.value);
      return false;
    });
    if (allMatch) {
      matchedRules.push({ id: rule.id, text: rule.generatedText, severity: rule.severity ?? "moderate", priority: rule.priority ?? "normal" });
    }
  }

  await logSmartUsage(getStaffId(req) as number, "generate_impression", "generate", builderType);
  res.json({ builderType, selections, matchedRules, ruleCount: rules.length });
});

// ── USAGE ANALYTICS ──

// GET /api/radiology/smart/usage
radiologySmartFindingsRouter.get("/usage", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const staffId = getStaffId(req) as number;
  const days = Math.min(Number(req.query.days || 30), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select()
    .from(radiologySmartUsageTable)
    .where(and(eq(radiologySmartUsageTable.staffId, staffId), gte(radiologySmartUsageTable.generatedAt, since)))
    .orderBy(desc(radiologySmartUsageTable.generatedAt));

  // Stats
  const featureStats = await db
    .select({
      featureType: radiologySmartUsageTable.featureType,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologySmartUsageTable)
    .where(and(eq(radiologySmartUsageTable.staffId, staffId), gte(radiologySmartUsageTable.generatedAt, since)))
    .groupBy(radiologySmartUsageTable.featureType)
    .orderBy(desc(sql`count`));

  const builderStats = await db
    .select({
      builderType: radiologySmartUsageTable.builderType,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologySmartUsageTable)
    .where(and(eq(radiologySmartUsageTable.staffId, staffId), gte(radiologySmartUsageTable.generatedAt, since)))
    .groupBy(radiologySmartUsageTable.builderType)
    .orderBy(desc(sql`count`));

  res.json({ usage: rows, featureStats, builderStats, days });
});

// ── AUDIT LOG ──

// GET /api/radiology/smart/audit
radiologySmartFindingsRouter.get("/audit", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const smartFindingId = req.query.smartFindingId ? Number(req.query.smartFindingId) : undefined;
  const conditions = [eq(radiologySmartFindingsAuditTable.staffId, getStaffId(req) as number)];
  if (smartFindingId && Number.isFinite(smartFindingId)) conditions.push(eq(radiologySmartFindingsAuditTable.smartFindingId, smartFindingId));
  const rows = await db
    .select()
    .from(radiologySmartFindingsAuditTable)
    .where(and(...conditions))
    .orderBy(desc(radiologySmartFindingsAuditTable.createdAt))
    .limit(100);
  res.json({ audit: rows, count: rows.length });
});

// ── SEED DEFAULT RULES ──
// POST /api/radiology/smart/seed-rules (admin only)
radiologySmartFindingsRouter.post("/seed-rules", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }

  const defaultRules = [
    {
      ruleName: "Acute Infarct MCA",
      builderType: "mri_brain",
      conditions: [{ field: "infarctType", operator: "equals", value: "Acute" }, { field: "infarctLocation", operator: "equals", value: "MCA Territory" }],
      generatedText: "Acute infarct involving the MCA territory.", priority: "critical", severity: "critical",
    },
    {
      ruleName: "EDH",
      builderType: "mri_brain",
      conditions: [{ field: "hemorrhageType", operator: "equals", value: "EDH" }],
      generatedText: "Extradural hematoma with associated mass effect.", priority: "critical", severity: "critical",
    },
    {
      ruleName: "Grade 3 Fatty Liver",
      builderType: "usg_abdomen",
      conditions: [{ field: "fattyLiver", operator: "equals", value: "Grade 3" }],
      generatedText: "Severe fatty infiltration of liver.", priority: "urgent", severity: "severe",
    },
    {
      ruleName: "Diffuse Bulge + Nerve Root Compression",
      builderType: "mri_lumbar_spine",
      conditions: [{ field: "findings", operator: "includes", value: ["Diffuse Bulge", "Nerve Root Compression"] }],
      generatedText: "Diffuse disc bulge causing compression upon bilateral exiting nerve roots.", priority: "urgent", severity: "moderate",
    },
    {
      ruleName: "Severe Canal Stenosis",
      builderType: "mri_cervical_spine",
      conditions: [{ field: "canalDiameter", operator: "less_than", value: "5" }],
      generatedText: "Severe spinal canal stenosis.", priority: "critical", severity: "critical",
    },
    {
      ruleName: "Cord Compression",
      builderType: "mri_cervical_spine",
      conditions: [{ field: "findings", operator: "includes", value: "Cord Compression" }],
      generatedText: "Spinal cord compression — urgent neurosurgical evaluation.", priority: "critical", severity: "critical",
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const r of defaultRules) {
    const [existing] = await db
      .select()
      .from(radiologyImpressionRulesTable)
      .where(and(eq(radiologyImpressionRulesTable.ruleName, r.ruleName), eq(radiologyImpressionRulesTable.builderType, r.builderType)));
    if (existing) { skipped++; continue; }
    await db.insert(radiologyImpressionRulesTable).values({ ...r, version: "v1.0", isActive: true, createdBy: getStaffName(req) });
    created++;
  }

  res.json({ created, skipped, total: defaultRules.length });
});

export default radiologySmartFindingsRouter;
