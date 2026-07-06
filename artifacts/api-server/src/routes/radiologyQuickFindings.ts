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
import { radiologyStudyTabsTable, radiologyQuickFindingsTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAdminRole } from "../middleware/requireStaffAuth";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";

const CACHE_KEY = "radiology-quick-select:v1";

const router = Router();

// ── Read (all staff) ──────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const cached = getCached<unknown>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  const [tabs, findings] = await Promise.all([
    db.select().from(radiologyStudyTabsTable).orderBy(asc(radiologyStudyTabsTable.sortOrder), asc(radiologyStudyTabsTable.name)),
    db.select().from(radiologyQuickFindingsTable).orderBy(asc(radiologyQuickFindingsTable.sortOrder), asc(radiologyQuickFindingsTable.label)),
  ]);
  const payload = { tabs, findings };
  setCached(CACHE_KEY, payload, TTL.SHORT);
  res.json(payload);
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

export default router;
