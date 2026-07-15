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
  radiologyProtocolsTable,
  radiologyLearnedPatternsTable,
  radiologyClinicalHistoryChipsTable,
} from "@workspace/db/schema";
import { asc, eq, and, ne } from "drizzle-orm";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";
import { CLINICAL_HISTORY_CHIP_DEFAULTS, PROTOCOL_DEFAULTS } from "../lib/radiologyReportingDefaults";

// Max active clinical-history chips per study region (spec: up to 10 chips).
const MAX_ACTIVE_CLINICAL_HISTORY_CHIPS = 10;

const CACHE_KEY = "radiology-quick-select:v2";

const router = Router();

// ── Read (all staff) — tabs + findings + measurements, cached ────────────────
router.get("/", async (_req, res) => {
  const cached = getCached<unknown>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  const [tabs, findings, measurements, protocols, clinicalHistory] = await Promise.all([
    db.select().from(radiologyStudyTabsTable).orderBy(asc(radiologyStudyTabsTable.sortOrder), asc(radiologyStudyTabsTable.name)),
    db.select().from(radiologyQuickFindingsTable).orderBy(asc(radiologyQuickFindingsTable.sortOrder), asc(radiologyQuickFindingsTable.label)),
    db.select().from(radiologyQuickMeasurementsTable).orderBy(asc(radiologyQuickMeasurementsTable.sortOrder), asc(radiologyQuickMeasurementsTable.label)),
    db.select().from(radiologyProtocolsTable).orderBy(asc(radiologyProtocolsTable.sortOrder), asc(radiologyProtocolsTable.name)),
    db.select().from(radiologyClinicalHistoryChipsTable).orderBy(asc(radiologyClinicalHistoryChipsTable.sortOrder), asc(radiologyClinicalHistoryChipsTable.displayLabel)),
  ]);
  const payload = { tabs, findings, measurements, protocols, clinicalHistory };
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
      anatomicalSection: typeof req.body?.anatomicalSection === "string" ? req.body.anatomicalSection : "",
      conflictGroup: typeof req.body?.conflictGroup === "string" ? req.body.conflictGroup : "",
      baselineReplaces: typeof req.body?.baselineReplaces === "string" ? req.body.baselineReplaces : "",
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
  if (typeof req.body?.anatomicalSection === "string") updates.anatomicalSection = req.body.anatomicalSection;
  if (typeof req.body?.conflictGroup === "string") updates.conflictGroup = req.body.conflictGroup;
  if (typeof req.body?.baselineReplaces === "string") updates.baselineReplaces = req.body.baselineReplaces;
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

// ── Clinical History Quick Select chips (admin write, staff read via GET /) ──
// Study-specific chips shown beside the Clinical History heading. The short
// displayLabel appears on the chip; the full insertedText is what lands in the
// Clinical History field. Up to MAX_ACTIVE_CLINICAL_HISTORY_CHIPS active per
// study region — the reporting workspace shows at most 10 chips.

/** Count active chips for a study, optionally excluding one id (for updates). */
async function countActiveClinicalHistoryChips(studyType: string, excludeId?: number): Promise<number> {
  const rows = await db.select({ id: radiologyClinicalHistoryChipsTable.id })
    .from(radiologyClinicalHistoryChipsTable)
    .where(and(
      eq(radiologyClinicalHistoryChipsTable.studyType, studyType),
      eq(radiologyClinicalHistoryChipsTable.isActive, true),
    ));
  return rows.filter((r) => r.id !== excludeId).length;
}

router.post("/clinical-history", requireAdminRole, async (req, res) => {
  const studyType = String(req.body?.studyType ?? "").trim();
  const displayLabel = String(req.body?.displayLabel ?? "").trim();
  if (!studyType || !displayLabel) {
    res.status(400).json({ error: "studyType and displayLabel are required" });
    return;
  }
  const isActive = req.body?.isActive !== false;
  if (isActive && (await countActiveClinicalHistoryChips(studyType)) >= MAX_ACTIVE_CLINICAL_HISTORY_CHIPS) {
    res.status(400).json({ error: `A study can have at most ${MAX_ACTIVE_CLINICAL_HISTORY_CHIPS} active clinical-history chips. Disable one first.` });
    return;
  }
  try {
    const [row] = await db.insert(radiologyClinicalHistoryChipsTable).values({
      studyType,
      displayLabel,
      insertedText: typeof req.body?.insertedText === "string" ? req.body.insertedText : "",
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      isActive,
    }).returning();
    invalidateCached(CACHE_KEY);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A clinical-history chip with that label already exists for this study" });
  }
});

router.patch("/clinical-history/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(radiologyClinicalHistoryChipsTable).where(eq(radiologyClinicalHistoryChipsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Clinical-history chip not found" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) updates.studyType = req.body.studyType.trim();
  if (typeof req.body?.displayLabel === "string" && req.body.displayLabel.trim()) updates.displayLabel = req.body.displayLabel.trim();
  if (typeof req.body?.insertedText === "string") updates.insertedText = req.body.insertedText;
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  // Enabling a chip (or moving it to another study while active) must respect
  // the per-study active cap.
  const willBeActive = updates.isActive === undefined ? existing.isActive : updates.isActive === true;
  const targetStudy = (updates.studyType as string) ?? existing.studyType;
  const enabling = willBeActive && (!existing.isActive || targetStudy !== existing.studyType);
  if (enabling && (await countActiveClinicalHistoryChips(targetStudy, id)) >= MAX_ACTIVE_CLINICAL_HISTORY_CHIPS) {
    res.status(400).json({ error: `A study can have at most ${MAX_ACTIVE_CLINICAL_HISTORY_CHIPS} active clinical-history chips. Disable one first.` });
    return;
  }
  try {
    const [row] = await db.update(radiologyClinicalHistoryChipsTable).set(updates).where(eq(radiologyClinicalHistoryChipsTable.id, id)).returning();
    invalidateCached(CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A clinical-history chip with that label already exists for this study" });
  }
});

router.delete("/clinical-history/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(radiologyClinicalHistoryChipsTable).where(eq(radiologyClinicalHistoryChipsTable.id, id));
  invalidateCached(CACHE_KEY);
  res.json({ ok: true });
});

// Restore the default clinical-history chip set. Upserts the factory chips by
// (study_type, display_label); admin-added custom chips are left untouched.
// Scope to one study via body.studyType, or restore all when omitted.
router.post("/clinical-history/restore-defaults", requireAdminRole, async (req, res) => {
  const studyType = typeof req.body?.studyType === "string" && req.body.studyType.trim() ? req.body.studyType.trim() : null;
  const defaults = studyType ? CLINICAL_HISTORY_CHIP_DEFAULTS.filter((c) => c.studyType === studyType) : CLINICAL_HISTORY_CHIP_DEFAULTS;
  for (const c of defaults) {
    await db.insert(radiologyClinicalHistoryChipsTable)
      .values({ studyType: c.studyType, displayLabel: c.displayLabel, insertedText: c.insertedText, sortOrder: c.sortOrder, isActive: true, isSystem: true })
      .onConflictDoUpdate({
        target: [radiologyClinicalHistoryChipsTable.studyType, radiologyClinicalHistoryChipsTable.displayLabel],
        set: { insertedText: c.insertedText, sortOrder: c.sortOrder, isActive: true, updatedAt: new Date() },
      });
  }
  invalidateCached(CACHE_KEY);
  res.json({ ok: true, restored: defaults.length });
});

export default router;

// ── Protocols (admin write, staff read via the cached GET / above) ──────────
router.post("/protocols", requireAdminRole, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const studyType = String(req.body?.studyType ?? "").trim();
  if (!name || !studyType) {
    res.status(400).json({ error: "name and studyType are required" });
    return;
  }
  const isDefault = req.body?.isDefault === true;
  try {
    const row = await db.transaction(async (tx) => {
      // Only one default protocol per study region — clear any existing
      // default in this study before marking the new one.
      if (isDefault) {
        await tx.update(radiologyProtocolsTable)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(radiologyProtocolsTable.studyType, studyType));
      }
      const [r] = await tx.insert(radiologyProtocolsTable).values({
        name,
        studyType,
        modality: typeof req.body?.modality === "string" ? req.body.modality : "",
        checklistJson: typeof req.body?.checklistJson === "string" ? req.body.checklistJson : "[]",
        techniqueText: typeof req.body?.techniqueText === "string" ? req.body.techniqueText : "",
        normalText: typeof req.body?.normalText === "string" ? req.body.normalText : "",
        recommendationText: typeof req.body?.recommendationText === "string" ? req.body.recommendationText : "",
        requiredMeasurements: typeof req.body?.requiredMeasurements === "string" ? req.body.requiredMeasurements : "",
        isGoldStandard: req.body?.isGoldStandard === true,
        isDefault,
        sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
        isActive: req.body?.isActive !== false,
      }).returning();
      return r;
    });
    invalidateCached(CACHE_KEY);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A protocol with that name already exists" });
  }
});

router.patch("/protocols/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
  if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) updates.studyType = req.body.studyType.trim();
  if (typeof req.body?.modality === "string") updates.modality = req.body.modality;
  if (typeof req.body?.checklistJson === "string") updates.checklistJson = req.body.checklistJson;
  if (typeof req.body?.techniqueText === "string") updates.techniqueText = req.body.techniqueText;
  if (typeof req.body?.normalText === "string") updates.normalText = req.body.normalText;
  if (typeof req.body?.recommendationText === "string") updates.recommendationText = req.body.recommendationText;
  if (typeof req.body?.requiredMeasurements === "string") updates.requiredMeasurements = req.body.requiredMeasurements;
  if (typeof req.body?.isGoldStandard === "boolean") updates.isGoldStandard = req.body.isGoldStandard;
  if (typeof req.body?.isDefault === "boolean") updates.isDefault = req.body.isDefault;
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  try {
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(radiologyProtocolsTable).where(eq(radiologyProtocolsTable.id, id));
      if (!existing) return null;
      // Enforce a single default per study region: if this update marks the
      // protocol default, clear the flag on every other protocol in the same
      // study (using the new study_type if it's being changed too).
      if (updates.isDefault === true) {
        const studyType = typeof updates.studyType === "string" ? updates.studyType : existing.studyType;
        await tx.update(radiologyProtocolsTable)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(radiologyProtocolsTable.studyType, studyType), ne(radiologyProtocolsTable.id, id)));
      }
      const [r] = await tx.update(radiologyProtocolsTable).set(updates).where(eq(radiologyProtocolsTable.id, id)).returning();
      return r;
    });
    if (!row) {
      res.status(404).json({ error: "Protocol not found" });
      return;
    }
    invalidateCached(CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A protocol with that name already exists" });
  }
});

router.delete("/protocols/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(radiologyProtocolsTable).where(eq(radiologyProtocolsTable.id, id));
  invalidateCached(CACHE_KEY);
  res.json({ ok: true });
});

// Duplicate a protocol — copies every field under a new "(copy)" name, never
// carrying over the default/gold-standard flags so the copy starts neutral.
router.post("/protocols/:id/duplicate", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [src] = await db.select().from(radiologyProtocolsTable).where(eq(radiologyProtocolsTable.id, id));
  if (!src) {
    res.status(404).json({ error: "Protocol not found" });
    return;
  }
  const existingNames = new Set(
    (await db.select({ name: radiologyProtocolsTable.name }).from(radiologyProtocolsTable)).map((r) => r.name),
  );
  let name = `${src.name} (copy)`;
  for (let n = 2; existingNames.has(name); n++) name = `${src.name} (copy ${n})`;
  const [row] = await db.insert(radiologyProtocolsTable).values({
    name,
    studyType: src.studyType,
    modality: src.modality,
    checklistJson: src.checklistJson,
    techniqueText: src.techniqueText,
    normalText: src.normalText,
    recommendationText: src.recommendationText,
    requiredMeasurements: src.requiredMeasurements,
    isGoldStandard: false,
    isDefault: false,
    sortOrder: src.sortOrder + 1,
    isActive: src.isActive,
  }).returning();
  invalidateCached(CACHE_KEY);
  res.status(201).json(row);
});

// Restore system default protocols. Upserts the factory set by name; admin-added
// protocols are left untouched. Scope to one study via ?studyType=... or restore
// all when omitted. Never deletes anything.
router.post("/protocols/restore-defaults", requireAdminRole, async (req, res) => {
  const studyType = typeof req.body?.studyType === "string" && req.body.studyType.trim() ? req.body.studyType.trim() : null;
  const defaults = studyType ? PROTOCOL_DEFAULTS.filter((p) => p.studyType === studyType) : PROTOCOL_DEFAULTS;
  await db.transaction(async (tx) => {
    for (const p of defaults) {
      if (p.isDefault) {
        await tx.update(radiologyProtocolsTable)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(radiologyProtocolsTable.studyType, p.studyType));
      }
      await tx.insert(radiologyProtocolsTable)
        .values({
          name: p.name, studyType: p.studyType, modality: p.modality, checklistJson: p.checklistJson,
          techniqueText: p.techniqueText, normalText: p.normalText, recommendationText: "",
          requiredMeasurements: "", isGoldStandard: p.isGoldStandard, isDefault: p.isDefault,
          sortOrder: p.sortOrder, isActive: true,
        })
        .onConflictDoUpdate({
          target: radiologyProtocolsTable.name,
          set: {
            studyType: p.studyType, modality: p.modality, checklistJson: p.checklistJson,
            techniqueText: p.techniqueText, normalText: p.normalText, isGoldStandard: p.isGoldStandard,
            isDefault: p.isDefault, isActive: true, updatedAt: new Date(),
          },
        });
    }
  });
  invalidateCached(CACHE_KEY);
  res.json({ ok: true, restored: defaults.length });
});

// ── Learning Engine (per radiologist — never cached, user-specific) ─────────
// GET returns this radiologist's learned patterns for one trigger label so
// the workspace can rank+display suggestions client-side (lib/learningEngine.ts).
router.get("/learned-patterns", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  const trigger = typeof req.query.trigger === "string" ? req.query.trigger : undefined;
  const conds = [eq(radiologyLearnedPatternsTable.userId, userId)];
  if (trigger) conds.push(eq(radiologyLearnedPatternsTable.triggerLabel, trigger));
  const rows = await db.select().from(radiologyLearnedPatternsTable).where(and(...conds));
  res.json(rows);
});

// POST records/increments one observed (trigger -> addition) pair for this
// radiologist. Suggestion-only downstream — recording never auto-inserts
// anything into anyone's report.
router.post("/learned-patterns", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  const triggerLabel = String(req.body?.triggerLabel ?? "").trim();
  const suggestedText = String(req.body?.suggestedText ?? "").trim();
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  if (!triggerLabel || !suggestedText) {
    res.status(400).json({ error: "triggerLabel and suggestedText are required" });
    return;
  }
  const [existing] = await db
    .select()
    .from(radiologyLearnedPatternsTable)
    .where(and(
      eq(radiologyLearnedPatternsTable.userId, userId),
      eq(radiologyLearnedPatternsTable.triggerLabel, triggerLabel),
      eq(radiologyLearnedPatternsTable.suggestedText, suggestedText),
    ));
  if (existing) {
    const [row] = await db
      .update(radiologyLearnedPatternsTable)
      .set({ occurrenceCount: existing.occurrenceCount + 1, lastUsedAt: new Date() })
      .where(eq(radiologyLearnedPatternsTable.id, existing.id))
      .returning();
    res.json(row);
    return;
  }
  const [row] = await db
    .insert(radiologyLearnedPatternsTable)
    .values({ userId, triggerLabel, suggestedText })
    .returning();
  res.status(201).json(row);
});
