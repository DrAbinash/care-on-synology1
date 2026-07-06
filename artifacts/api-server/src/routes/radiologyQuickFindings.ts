/**
 * radiologyQuickFindings.ts — Radiology Quick Select configuration API.
 *
 * GET  /api/radiology/quick-select            — tabs + findings in one call
 *                                               (cached 5 min via ttlCache)
 * POST /api/radiology/quick-select/tabs       — create tab            (admin)
 * PATCH/DELETE .../tabs/:id                   — update / delete tab   (admin)
 * POST /api/radiology/quick-select/findings   — create finding        (admin)
 * PATCH/DELETE .../findings/:id               — update / delete       (admin)
 *
 * Mounted behind requireStaffAuth; mutations additionally behind
 * requireAdminRole (same strict gate as the Diagnostics page) so button
 * configuration is owner/admin-only without touching the per-user
 * permission system.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyStudyTabsTable,
  radiologyQuickFindingsTable,
  radiologyQuickMeasurementsTable,
  radiologyQuickFavoritesTable,
} from "@workspace/db/schema";
import { asc, eq, and } from "drizzle-orm";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";

const CACHE_KEY = "radiology-quick-select:v2";

const router = Router();

// ── Read (all staff) — tabs + findings + measurements, cached ────────────────
router.get("/", async (_req, res) => {
  const cached = getCached<unknown>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  const [tabs, findings, measurements] = await Promise.all([
    db.select().from(radiologyStudyTabsTable).orderBy(asc(radiologyStudyTabsTable.sortOrder), asc(radiologyStudyTabsTable.name)),
    db.select().from(radiologyQuickFindingsTable).orderBy(asc(radiologyQuickFindingsTable.sortOrder), asc(radiologyQuickFindingsTable.label)),
    db.select().from(radiologyQuickMeasurementsTable).orderBy(asc(radiologyQuickMeasurementsTable.sortOrder), asc(radiologyQuickMeasurementsTable.label)),
  ]);
  const payload = { tabs, findings, measurements };
  setCached(CACHE_KEY, payload, TTL.SHORT);
  res.json(payload);
});

// ── Favorites (per signed-in radiologist — NEVER cached, user-specific) ──────
router.get("/favorites", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  const rows = await db
    .select()
    .from(radiologyQuickFavoritesTable)
    .where(eq(radiologyQuickFavoritesTable.userId, userId))
    .orderBy(asc(radiologyQuickFavoritesTable.sortOrder), asc(radiologyQuickFavoritesTable.id));
  res.json(rows);
});

router.post("/favorites/:findingId", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  const findingId = Number(req.params.findingId);
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  if (!Number.isInteger(findingId) || findingId <= 0) {
    res.status(400).json({ error: "Invalid finding id" });
    return;
  }
  await db
    .insert(radiologyQuickFavoritesTable)
    .values({ userId, findingId, sortOrder: Number(req.body?.sortOrder) || 0 })
    .onConflictDoNothing();
  res.status(201).json({ ok: true });
});

router.delete("/favorites/:findingId", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  const findingId = Number(req.params.findingId);
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  await db
    .delete(radiologyQuickFavoritesTable)
    .where(and(eq(radiologyQuickFavoritesTable.userId, userId), eq(radiologyQuickFavoritesTable.findingId, findingId)));
  res.json({ ok: true });
});

// ── Tabs (admin) ──────────────────────────────────────────────────────────────
router.post("/tabs", requireAdminRole, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0;
  try {
    const [row] = await db.insert(radiologyStudyTabsTable).values({ name, sortOrder }).returning();
    invalidateCached(CACHE_KEY);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A study tab with that name already exists" });
  }
});

router.patch("/tabs/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  if (typeof req.body?.techniqueText === "string") updates.techniqueText = req.body.techniqueText;
  if (typeof req.body?.normalText === "string") updates.normalText = req.body.normalText;
  try {
    const [row] = await db.update(radiologyStudyTabsTable).set(updates).where(eq(radiologyStudyTabsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Study tab not found" });
      return;
    }
    invalidateCached(CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A study tab with that name already exists" });
  }
});

router.delete("/tabs/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(radiologyStudyTabsTable).where(eq(radiologyStudyTabsTable.id, id));
  invalidateCached(CACHE_KEY);
  res.json({ ok: true });
});

// ── Findings (admin) ─────────────────────────────────────────────────────────
router.post("/findings", requireAdminRole, async (req, res) => {
  const studyType = String(req.body?.studyType ?? "").trim();
  const label = String(req.body?.label ?? "").trim();
  if (!studyType || !label) {
    res.status(400).json({ error: "studyType and label are required" });
    return;
  }
  try {
    const [row] = await db.insert(radiologyQuickFindingsTable).values({
      studyType,
      label,
      findingText: typeof req.body?.findingText === "string" ? req.body.findingText : "",
      impressionText: typeof req.body?.impressionText === "string" ? req.body.impressionText : "",
      techniqueText: typeof req.body?.techniqueText === "string" ? req.body.techniqueText : "",
      recommendationText: typeof req.body?.recommendationText === "string" ? req.body.recommendationText : "",
      icdCode: typeof req.body?.icdCode === "string" && req.body.icdCode.trim() ? req.body.icdCode.trim() : null,
      tags: typeof req.body?.tags === "string" ? req.body.tags : "",
      suggests: typeof req.body?.suggests === "string" ? req.body.suggests : "",
      properties: typeof req.body?.properties === "string" ? req.body.properties : "",
      category: typeof req.body?.category === "string" && req.body.category.trim() ? req.body.category.trim() : null,
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      isActive: req.body?.isActive !== false,
    }).returning();
    invalidateCached(CACHE_KEY);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A finding with that label already exists for this study type" });
  }
});

router.patch("/findings/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) updates.studyType = req.body.studyType.trim();
  if (typeof req.body?.label === "string" && req.body.label.trim()) updates.label = req.body.label.trim();
  if (typeof req.body?.findingText === "string") updates.findingText = req.body.findingText;
  if (typeof req.body?.impressionText === "string") updates.impressionText = req.body.impressionText;
  if (typeof req.body?.techniqueText === "string") updates.techniqueText = req.body.techniqueText;
  if (typeof req.body?.recommendationText === "string") updates.recommendationText = req.body.recommendationText;
  if (req.body?.icdCode !== undefined) updates.icdCode = typeof req.body.icdCode === "string" && req.body.icdCode.trim() ? req.body.icdCode.trim() : null;
  if (typeof req.body?.tags === "string") updates.tags = req.body.tags;
  if (typeof req.body?.suggests === "string") updates.suggests = req.body.suggests;
  if (typeof req.body?.properties === "string") updates.properties = req.body.properties;
  if (req.body?.category !== undefined) updates.category = typeof req.body.category === "string" && req.body.category.trim() ? req.body.category.trim() : null;
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  try {
    const [row] = await db.update(radiologyQuickFindingsTable).set(updates).where(eq(radiologyQuickFindingsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Quick finding not found" });
      return;
    }
    invalidateCached(CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A finding with that label already exists for this study type" });
  }
});

router.delete("/findings/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.id, id));
  invalidateCached(CACHE_KEY);
  res.json({ ok: true });
});

// ── Measurements (admin) ─────────────────────────────────────────────────────
router.post("/measurements", requireAdminRole, async (req, res) => {
  const studyType = String(req.body?.studyType ?? "").trim();
  const label = String(req.body?.label ?? "").trim();
  const templateText = String(req.body?.templateText ?? "").trim();
  if (!studyType || !label || !templateText) {
    res.status(400).json({ error: "studyType, label, and templateText are required" });
    return;
  }
  try {
    const [row] = await db.insert(radiologyQuickMeasurementsTable).values({
      studyType,
      label,
      templateText,
      unit: typeof req.body?.unit === "string" && req.body.unit.trim() ? req.body.unit.trim() : "mm",
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      isActive: req.body?.isActive !== false,
    }).returning();
    invalidateCached(CACHE_KEY);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A measurement with that label already exists for this study type" });
  }
});

router.patch("/measurements/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) updates.studyType = req.body.studyType.trim();
  if (typeof req.body?.label === "string" && req.body.label.trim()) updates.label = req.body.label.trim();
  if (typeof req.body?.templateText === "string" && req.body.templateText.trim()) updates.templateText = req.body.templateText.trim();
  if (typeof req.body?.unit === "string" && req.body.unit.trim()) updates.unit = req.body.unit.trim();
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  try {
    const [row] = await db.update(radiologyQuickMeasurementsTable).set(updates).where(eq(radiologyQuickMeasurementsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Measurement not found" });
      return;
    }
    invalidateCached(CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A measurement with that label already exists for this study type" });
  }
});

router.delete("/measurements/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(radiologyQuickMeasurementsTable).where(eq(radiologyQuickMeasurementsTable.id, id));
  invalidateCached(CACHE_KEY);
  res.json({ ok: true });
});

export default router;
