/**
 * radiologyQuickFindings.ts — Radiology Quick Select configuration API.
 *
 * GET  /api/radiology/quick-select            — tabs + boxes in one call
 *                                               (cached 5 min via ttlCache)
 * POST /api/radiology/quick-select/tabs       — create tab            (admin)
 * PATCH/DELETE .../tabs/:id                   — update / delete tab   (admin)
 *
 * ── Quick Select boxes (the strip's buttons) ─────────────────────────────────
 * POST   /findings                            — author a box        (author)
 * PATCH  /findings/:id                        — edit / re-parent / disable
 * DELETE /findings/:id                        — delete, refusing to orphan its
 *                                               sub-boxes unless told what to do
 * POST   /findings/:id/restore-defaults       — back to the shipped wording
 * GET    /usage · POST /usage/:findingId      — per-user click counts
 * GET    /history                             — who changed which wording
 *
 * "author" is requireBoxAuthor: admin, super_admin or doctor. Every box write
 * goes through validateBoxDraft (../lib/quickSelectBoxRules) and is refused with
 * a 422 naming the rule that broke, so a box that would print a hole into a
 * signed report cannot be saved from any client.
 *
 * The rest of the namespace — tabs, measurements, protocols, clinical-history
 * chips — stays on requireAdminRole (admin + super_admin), the same strict gate as
 * the Diagnostics page. Those are configuration; boxes are clinical wording.
 *
 * Mounted behind requireStaffAuth.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyStudyTabsTable,
  radiologyQuickFindingsTable,
  radiologyQuickMeasurementsTable,
  radiologyQuickFavoritesTable,
  radiologyQuickFindingUsageTable,
  radiologyQuickFindingHistoryTable,
  radiologyProtocolsTable,
  radiologyLearnedPatternsTable,
  radiologyClinicalHistoryChipsTable,
} from "@workspace/db/schema";
import { asc, desc, eq, and, ne, isNull, sql } from "drizzle-orm";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";
import { resolveStudyTab, syncChildStudyTypeForTabRename } from "../lib/resolveStudyTab";
import {
  duplicateProtocolErrorPayload,
  findProtocolByScopedName,
  normalizeProtocolName,
} from "../lib/protocolName";
import { CLINICAL_HISTORY_CHIP_DEFAULTS, PROTOCOL_DEFAULTS } from "../lib/radiologyReportingDefaults";
import {
  QUICK_SELECT_AUTHOR_ROLES,
  boxHistoryDiff,
  boxProvenance,
  normalizeBoxField,
  normalizeSonKind,
  validateBoxDraft,
  type BoxAuditedField,
  type BoxDraft,
  type BoxFacts,
  type BoxHistoryAction,
} from "../lib/quickSelectBoxRules";

// Clinical-history quick-select chips are intentionally UNLIMITED per study —
// they are quick-insert workhorses, and a radiologist may want many (the UI
// wraps/scrolls). No active-count cap is enforced.

// v3: `findings` rows gained the authoring columns and a derived `provenance`,
// and stopped carrying the raw factory snapshot.
const CACHE_KEY = "radiology-quick-select:v3";

const router = Router();

// ── Quick Select box authoring ───────────────────────────────────────────────
// Boxes are the clinic's clinical wording, so the gate is wider than
// requireAdminRole (admin + super_admin) and narrower than "any staff": the
// owner asked for the reporting doctor to author their own boxes. Tabs,
// measurements, protocols and clinical-history chips stay on requireAdminRole —
// they are configuration, not boxes.
function requireBoxAuthor(req: StaffAuthRequest, res: Parameters<typeof requireAdminRole>[1], next: () => void): void {
  const session = req.staffSession;
  if (!session) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  if (!QUICK_SELECT_AUTHOR_ROLES.has(session.role)) {
    res.status(403).json({
      error: "Only an administrator or a reporting doctor can change Quick Select boxes",
    });
    return;
  }
  next();
}

/**
 * The columns a client may author. `factory_key` and `factory_definition` are
 * conspicuously absent: they are what decides whether a deploy may overwrite a
 * row, so letting a request write them would let a caller erase the protection
 * or plant a snapshot over a box the clinic wrote.
 */
const AUTHORED_BOX_COLUMNS = [
  "label",
  "field",
  "sonKind",
  "parentId",
  "mnemonic",
  "concept",
  "scopeModality",
  "category",
  "anatomicalSection",
  "conflictGroup",
  "baselineReplaces",
  "icdCode",
  "tags",
  "suggests",
  "properties",
  "questionsJson",
  "findingText",
  "impressionText",
  "techniqueText",
  "recommendationText",
  "sortOrder",
  "isActive",
] as const;

const optionalText = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/**
 * The shape a box travels in. The badge is derived here, once, so the strip and
 * the editor cannot disagree about whether a box is shipped or the clinic's own;
 * the factory snapshot stays server-side because it is the deploy contract's
 * private half, and `hasFactoryDefault` is all the client needs to know to decide
 * whether "Restore defaults" is a real action.
 */
function toWireBox<T extends { factoryDefinition: string }>(row: T) {
  const { factoryDefinition, ...rest } = row;
  return {
    ...rest,
    provenance: boxProvenance(row),
    hasFactoryDefault: factoryDefinition.trim().length > 0,
  };
}

/** Read the rows validateBoxDraft needs but cannot read itself. */
async function loadBoxFacts(
  draft: BoxDraft,
  selfId: number | null,
): Promise<BoxFacts> {
  const facts: BoxFacts = { parent: null, sons: [], labelClash: null };
  const parentId = draft.parentId == null || draft.parentId === "" ? null : Number(draft.parentId);
  if (parentId != null && Number.isInteger(parentId) && parentId > 0) {
    const [p] = await db
      .select({
        id: radiologyQuickFindingsTable.id,
        label: radiologyQuickFindingsTable.label,
        parentId: radiologyQuickFindingsTable.parentId,
        studyType: radiologyQuickFindingsTable.studyType,
      })
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, parentId));
    facts.parent = p ?? null;
  }
  if (selfId != null) {
    facts.sons = await db
      .select({ id: radiologyQuickFindingsTable.id, label: radiologyQuickFindingsTable.label })
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.parentId, selfId));
  }
  const label = String(draft.label ?? "").trim();
  if (label) {
    const studyType = String(draft.studyType ?? "").trim();
    const clash = await db
      .select({ id: radiologyQuickFindingsTable.id, label: radiologyQuickFindingsTable.label })
      .from(radiologyQuickFindingsTable)
      .where(and(
        sql`lower(trim(${radiologyQuickFindingsTable.label})) = lower(trim(${label}))`,
        studyType
          ? sql`lower(trim(${radiologyQuickFindingsTable.studyType})) = lower(trim(${studyType}))`
          : sql`true`,
        selfId != null ? ne(radiologyQuickFindingsTable.id, selfId) : sql`true`,
      ))
      .limit(1);
    facts.labelClash = clash[0] ?? null;
  }
  return facts;
}

/** One audit row per changed column, so the history view can show the wording. */
async function writeBoxHistory(args: {
  action: BoxHistoryAction;
  row: { id: number; label: string; studyType: string; factoryKey: string };
  session: StaffAuthRequest["staffSession"];
  before: Partial<Record<BoxAuditedField, unknown>> | null;
  after: Partial<Record<BoxAuditedField, unknown>>;
}): Promise<void> {
  const entries = boxHistoryDiff(args.before, args.after);
  if (entries.length === 0 && args.action !== "delete") return;
  const rows = (entries.length > 0 ? entries : [{ fieldName: "", oldValue: null, newValue: null }]).map((e) => ({
    findingId: args.row.id,
    factoryKey: args.row.factoryKey,
    label: args.row.label,
    studyType: args.row.studyType,
    userId: args.session?.subjectId ?? null,
    userName: args.session?.subjectName ?? "",
    action: args.action,
    fieldName: e.fieldName,
    oldValue: e.oldValue,
    newValue: e.newValue,
  }));
  await db.insert(radiologyQuickFindingHistoryTable).values(rows);
}

/** Refuse with the rule that was broken, not a bare 400. */
function sendBlocking(res: Parameters<typeof requireAdminRole>[1], blocking: { code: string; message: string }[]): void {
  res.status(422).json({
    error: blocking[0].message,
    code: blocking[0].code,
    blocking: blocking.map((b) => ({ code: b.code, message: b.message })),
  });
}

// ── Read (all staff) — tabs + findings + measurements, cached ────────────────
router.get("/", async (_req, res) => {
  const cached = getCached<unknown>(CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  const [tabs, boxRows, measurements, protocols, clinicalHistory] = await Promise.all([
    db.select().from(radiologyStudyTabsTable).orderBy(asc(radiologyStudyTabsTable.sortOrder), asc(radiologyStudyTabsTable.name)),
    db.select().from(radiologyQuickFindingsTable).orderBy(asc(radiologyQuickFindingsTable.sortOrder), asc(radiologyQuickFindingsTable.label)),
    db.select().from(radiologyQuickMeasurementsTable).orderBy(asc(radiologyQuickMeasurementsTable.sortOrder), asc(radiologyQuickMeasurementsTable.label)),
    db.select().from(radiologyProtocolsTable).orderBy(asc(radiologyProtocolsTable.sortOrder), asc(radiologyProtocolsTable.name)),
    db.select().from(radiologyClinicalHistoryChipsTable).orderBy(asc(radiologyClinicalHistoryChipsTable.sortOrder), asc(radiologyClinicalHistoryChipsTable.displayLabel)),
  ]);
  // The badge is derived here, once, so the strip and the editor cannot disagree
  // about whether a box is shipped or the clinic's own. The snapshot itself stays
  // server-side: it is the deploy contract's private half and the client has no
  // use for the raw JSON.
  const findings = boxRows.map(toWireBox);
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
  const techniqueText = typeof req.body?.techniqueText === "string" ? req.body.techniqueText : "";
  const normalText = typeof req.body?.normalText === "string" ? req.body.normalText : "";
  try {
    const [row] = await db
      .insert(radiologyStudyTabsTable)
      .values({ name, sortOrder, techniqueText, normalText })
      .returning();
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
    if (typeof updates.name === "string") {
      await syncChildStudyTypeForTabRename(id, updates.name);
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

// ── Findings — the Quick Select boxes (admin + reporting doctor) ─────────────
router.post("/findings", requireBoxAuthor, async (req, res) => {
  const label = String(req.body?.label ?? "").trim();
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (!tab) {
    res.status(400).json({ error: "studyTabId or studyType must resolve to a Study Tab" });
    return;
  }
  const draft: BoxDraft = {
    label,
    studyType: tab.name,
    studyTabId: tab.id,
    field: normalizeBoxField(req.body?.field) || "findings",
    sonKind: normalizeSonKind(req.body?.sonKind) ?? "",
    parentId: req.body?.parentId ?? null,
    mnemonic: optionalText(req.body?.mnemonic),
    concept: optionalText(req.body?.concept),
    scopeModality: optionalText(req.body?.scopeModality),
    category: optionalText(req.body?.category),
    anatomicalSection: optionalText(req.body?.anatomicalSection),
    conflictGroup: optionalText(req.body?.conflictGroup),
    questionsJson: optionalText(req.body?.questionsJson, "[]"),
    findingText: optionalText(req.body?.findingText),
    impressionText: optionalText(req.body?.impressionText),
    techniqueText: optionalText(req.body?.techniqueText),
    recommendationText: optionalText(req.body?.recommendationText),
  };
  const validation = validateBoxDraft(draft, await loadBoxFacts(draft, null));
  if (validation.blocking.length > 0) {
    sendBlocking(res, validation.blocking);
    return;
  }
  try {
    const [row] = await db.insert(radiologyQuickFindingsTable).values({
      studyType: tab.name,
      studyTabId: tab.id,
      label,
      findingText: optionalText(req.body?.findingText),
      impressionText: optionalText(req.body?.impressionText),
      techniqueText: optionalText(req.body?.techniqueText),
      recommendationText: optionalText(req.body?.recommendationText),
      icdCode: typeof req.body?.icdCode === "string" && req.body.icdCode.trim() ? req.body.icdCode.trim() : null,
      tags: optionalText(req.body?.tags),
      suggests: optionalText(req.body?.suggests),
      properties: optionalText(req.body?.properties),
      category: typeof req.body?.category === "string" && req.body.category.trim() ? req.body.category.trim() : null,
      anatomicalSection: optionalText(req.body?.anatomicalSection),
      conflictGroup: optionalText(req.body?.conflictGroup),
      baselineReplaces: optionalText(req.body?.baselineReplaces),
      questionsJson: optionalText(req.body?.questionsJson, "[]"),
      field: normalizeBoxField(req.body?.field) || "findings",
      sonKind: normalizeSonKind(req.body?.sonKind) ?? "",
      parentId: draft.parentId == null || draft.parentId === "" ? null : Number(draft.parentId),
      mnemonic: optionalText(req.body?.mnemonic),
      concept: optionalText(req.body?.concept),
      scopeModality: optionalText(req.body?.scopeModality),
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      isActive: req.body?.isActive !== false,
      // A box the clinic authors carries no factory key, so no deploy can ever
      // mistake it for shipped content and overwrite it.
      factoryKey: "",
      factoryDefinition: "",
      customizedAt: null,
    }).returning();
    await writeBoxHistory({
      action: "create",
      row,
      session: (req as StaffAuthRequest).staffSession,
      before: null,
      after: Object.fromEntries(AUTHORED_BOX_COLUMNS.map((c) => [c, row[c as keyof typeof row]])),
    });
    invalidateCached(CACHE_KEY);
    res.status(201).json({ ...toWireBox(row), warnings: validation.warnings });
  } catch {
    res.status(409).json({ error: "A finding with that label already exists for this study type" });
  }
});

router.patch("/findings/:id", requireBoxAuthor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Quick finding not found" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (tab) {
    updates.studyTabId = tab.id;
    updates.studyType = tab.name;
  } else if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) {
    updates.studyType = req.body.studyType.trim();
  }
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
  if (typeof req.body?.questionsJson === "string") updates.questionsJson = req.body.questionsJson;
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  // ── Authoring columns ────────────────────────────────────────────────────
  if (req.body?.field !== undefined) {
    const f = normalizeBoxField(req.body.field);
    if (!f) {
      res.status(422).json({ error: "field must be one of clinicalHistory, technique, findings, impression, recommendation", code: "field-unknown" });
      return;
    }
    updates.field = f;
  }
  if (req.body?.sonKind !== undefined) {
    const k = normalizeSonKind(req.body.sonKind);
    if (k === null) {
      res.status(422).json({ error: "sonKind must be one of grade, include, list, or empty", code: "son-kind-unknown" });
      return;
    }
    updates.sonKind = k;
  }
  let patchParentId: number | null | undefined;
  if (req.body?.parentId !== undefined) {
    patchParentId = req.body.parentId == null || req.body.parentId === "" ? null : Number(req.body.parentId);
    updates.parentId = patchParentId;
  }
  if (typeof req.body?.mnemonic === "string") updates.mnemonic = req.body.mnemonic;
  if (typeof req.body?.concept === "string") updates.concept = req.body.concept;
  if (typeof req.body?.scopeModality === "string") updates.scopeModality = req.body.scopeModality;

  // Validate the row AS IT WILL BE, not the patch — a partial patch that leaves
  // the box writing nothing, or that makes it a third level, has to be refused
  // on the merged result.
  const merged: BoxDraft = {
    id,
    label: typeof updates.label === "string" ? updates.label : existing.label,
    studyType: typeof updates.studyType === "string" ? updates.studyType : existing.studyType,
    field: typeof updates.field === "string" ? updates.field : existing.field,
    sonKind: typeof updates.sonKind === "string" ? updates.sonKind : existing.sonKind,
    parentId: patchParentId !== undefined ? patchParentId : existing.parentId,
    category: "category" in updates ? updates.category : existing.category,
    concept: typeof updates.concept === "string" ? updates.concept : existing.concept,
    conflictGroup: typeof updates.conflictGroup === "string" ? updates.conflictGroup : existing.conflictGroup,
    anatomicalSection: typeof updates.anatomicalSection === "string" ? updates.anatomicalSection : existing.anatomicalSection,
    questionsJson: typeof updates.questionsJson === "string" ? updates.questionsJson : existing.questionsJson,
    findingText: typeof updates.findingText === "string" ? updates.findingText : existing.findingText,
    impressionText: typeof updates.impressionText === "string" ? updates.impressionText : existing.impressionText,
    techniqueText: typeof updates.techniqueText === "string" ? updates.techniqueText : existing.techniqueText,
    recommendationText: typeof updates.recommendationText === "string" ? updates.recommendationText : existing.recommendationText,
  };
  const validation = validateBoxDraft(merged, await loadBoxFacts(merged, id));
  if (validation.blocking.length > 0) {
    sendBlocking(res, validation.blocking);
    return;
  }

  // The deploy contract: the first authored change to a shipped box stamps it,
  // and from then on no factory refresh may overwrite it. Only the columns that
  // carry wording or ownership count — a reorder or a star must not lock the box
  // out of future factory corrections.
  const reParented = patchParentId !== undefined && patchParentId !== existing.parentId;
  const wordingChanged = (["label", "findingText", "impressionText", "techniqueText",
    "recommendationText", "category", "concept", "anatomicalSection", "conflictGroup",
    "baselineReplaces", "field", "sonKind", "questionsJson", "scopeModality", "mnemonic"] as const)
    .some((c) => c in updates && String(updates[c] ?? "") !== String(existing[c] ?? ""));
  if (existing.factoryKey && wordingChanged && !existing.customizedAt) {
    updates.customizedAt = new Date();
  }

  try {
    const [row] = await db.update(radiologyQuickFindingsTable).set(updates).where(eq(radiologyQuickFindingsTable.id, id)).returning();
    if (!row) {
      res.status(404).json({ error: "Quick finding not found" });
      return;
    }
    const before = Object.fromEntries(AUTHORED_BOX_COLUMNS.map((c) => [c, existing[c as keyof typeof existing]]));
    const after = Object.fromEntries(
      AUTHORED_BOX_COLUMNS.filter((c) => c in updates).map((c) => [c, updates[c]]),
    );
    const session = (req as StaffAuthRequest).staffSession;
    if (reParented) {
      await writeBoxHistory({ action: "re-parent", row: existing, session, before, after });
    } else if ("isActive" in updates && updates.isActive !== existing.isActive) {
      await writeBoxHistory({
        action: updates.isActive ? "enable" : "disable",
        row: existing, session, before, after,
      });
    } else {
      await writeBoxHistory({ action: "edit", row: existing, session, before, after });
    }
    invalidateCached(CACHE_KEY);
    res.json({ ...toWireBox(row), warnings: validation.warnings });
  } catch {
    res.status(409).json({ error: "A finding with that label already exists for this study type" });
  }
});

router.delete("/findings/:id", requireBoxAuthor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Quick finding not found" });
    return;
  }
  const sons = await db
    .select({ id: radiologyQuickFindingsTable.id, label: radiologyQuickFindingsTable.label })
    .from(radiologyQuickFindingsTable)
    .where(eq(radiologyQuickFindingsTable.parentId, id));
  // A father with sons cannot simply vanish: `parent_id` is a soft link, so the
  // sons would be left pointing at nothing and disappear from the strip while
  // still counting as boxes. The caller has to say which of the two it wants.
  const sonsDirective = String(req.body?.sons ?? req.query.sons ?? "").trim();
  if (sons.length > 0 && sonsDirective !== "delete" && sonsDirective !== "promote") {
    res.status(409).json({
      error: `"${existing.label}" has ${sons.length} sub-box${sons.length === 1 ? "" : "es"} (${sons.map((s) => s.label).join(", ")}). Send sons=promote to keep them as top-level boxes, or sons=delete to remove them too.`,
      code: "box-has-sons",
      sons,
    });
    return;
  }
  await db.transaction(async (tx) => {
    if (sons.length > 0 && sonsDirective === "promote") {
      await tx.update(radiologyQuickFindingsTable)
        .set({ parentId: null, sonKind: "", updatedAt: new Date() })
        .where(eq(radiologyQuickFindingsTable.parentId, id));
    }
    if (sons.length > 0 && sonsDirective === "delete") {
      for (const s of sons) {
        await tx.insert(radiologyQuickFindingHistoryTable).values({
          findingId: s.id,
          factoryKey: existing.factoryKey,
          label: s.label,
          studyType: existing.studyType,
          userId: (req as StaffAuthRequest).staffSession?.subjectId ?? null,
          userName: (req as StaffAuthRequest).staffSession?.subjectName ?? "",
          action: "delete",
          fieldName: "",
          oldValue: null,
          newValue: `deleted with its parent box "${existing.label}"`,
        });
      }
      await tx.delete(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.parentId, id));
    }
    await tx.delete(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.id, id));
  });
  await writeBoxHistory({
    action: "delete",
    row: existing,
    session: (req as StaffAuthRequest).staffSession,
    before: Object.fromEntries(AUTHORED_BOX_COLUMNS.map((c) => [c, existing[c as keyof typeof existing]])),
    after: {},
  });
  invalidateCached(CACHE_KEY);
  res.json({ ok: true, deletedSons: sonsDirective === "delete" ? sons.length : 0 });
});

/**
 * Restore one box to its shipped wording. Only offered where a snapshot exists —
 * a box the clinic wrote itself has no defaults to go back to, and a button that
 * could not do anything is worse than no button.
 */
router.post("/findings/:id/restore-defaults", requireBoxAuthor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(radiologyQuickFindingsTable).where(eq(radiologyQuickFindingsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Quick finding not found" });
    return;
  }
  if (!existing.factoryDefinition.trim()) {
    res.status(409).json({
      error: `"${existing.label}" is a box your clinic wrote — there is no shipped version of it to go back to. Disable it instead if you no longer want it.`,
      code: "no-factory-defaults",
    });
    return;
  }
  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(existing.factoryDefinition);
  } catch {
    res.status(500).json({
      error: `The shipped wording stored for "${existing.label}" cannot be read. This needs a developer — the box itself is untouched.`,
      code: "corrupt-factory-snapshot",
    });
    return;
  }
  const restored: Record<string, unknown> = { updatedAt: new Date(), customizedAt: null };
  for (const column of AUTHORED_BOX_COLUMNS) {
    // `isActive` and `sortOrder` are the clinic's own decisions, not shipped
    // wording: a doctor who retired a box or moved it to the front must not have
    // that undone by a button labelled "restore the default wording".
    if (column === "isActive" || column === "sortOrder") continue;
    if (column in snapshot) restored[column] = snapshot[column];
  }
  const [row] = await db.update(radiologyQuickFindingsTable).set(restored)
    .where(eq(radiologyQuickFindingsTable.id, id)).returning();
  await writeBoxHistory({
    action: "restore-defaults",
    row: existing,
    session: (req as StaffAuthRequest).staffSession,
    before: Object.fromEntries(AUTHORED_BOX_COLUMNS.map((c) => [c, existing[c as keyof typeof existing]])),
    after: Object.fromEntries(AUTHORED_BOX_COLUMNS.filter((c) => c in restored).map((c) => [c, restored[c]])),
  });
  invalidateCached(CACHE_KEY);
  res.json(toWireBox(row));
});

// ── Usage counts (per signed-in radiologist — NEVER cached, user-specific) ────
// The second key of the strip's ordering: starred first, then most used. Written
// on every box click, so it is a plain upsert and must never be able to fail the
// click that triggered it.
router.get("/usage", async (req, res) => {
  const userId = (req as StaffAuthRequest).staffSession?.subjectId;
  if (!userId) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  const rows = await db
    .select()
    .from(radiologyQuickFindingUsageTable)
    .where(eq(radiologyQuickFindingUsageTable.userId, userId));
  res.json(rows);
});

router.post("/usage/:findingId", async (req, res) => {
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
  const [row] = await db
    .insert(radiologyQuickFindingUsageTable)
    .values({ userId, findingId, useCount: 1, lastUsedAt: new Date() })
    .onConflictDoUpdate({
      target: [radiologyQuickFindingUsageTable.userId, radiologyQuickFindingUsageTable.findingId],
      set: {
        useCount: sql`${radiologyQuickFindingUsageTable.useCount} + 1`,
        lastUsedAt: new Date(),
      },
    })
    .returning();
  res.json(row);
});

// ── Authoring history (admin + doctor) ───────────────────────────────────────
// ?findingId= scopes to one box; without it, the most recent acts across the
// catalogue. The limit is capped because this is an audit view, not a report.
router.get("/history", requireBoxAuthor, async (req, res) => {
  const findingId = Number(req.query.findingId);
  const requested = Number(req.query.limit);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;
  const rows = await db
    .select()
    .from(radiologyQuickFindingHistoryTable)
    .where(Number.isInteger(findingId) && findingId > 0
      ? eq(radiologyQuickFindingHistoryTable.findingId, findingId)
      : sql`true`)
    .orderBy(desc(radiologyQuickFindingHistoryTable.changedAt), desc(radiologyQuickFindingHistoryTable.id))
    .limit(limit);
  res.json(rows);
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
// Clinical History field. Unlimited per study — a radiologist may configure as
// many quick-insert chips as they like; the workspace strip wraps/scrolls.

router.post("/clinical-history", requireAdminRole, async (req, res) => {
  const displayLabel = String(req.body?.displayLabel ?? "").trim();
  if (!displayLabel) {
    res.status(400).json({ error: "displayLabel is required" });
    return;
  }
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (!tab) {
    res.status(400).json({ error: "studyTabId or studyType must resolve to a Study Tab" });
    return;
  }
  const isActive = req.body?.isActive !== false;
  try {
    const [row] = await db.insert(radiologyClinicalHistoryChipsTable).values({
      studyType: tab.name,
      studyTabId: tab.id,
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
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (tab) {
    updates.studyTabId = tab.id;
    updates.studyType = tab.name;
  } else if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) {
    // Legacy unresolved: keep text, clear broken id only if explicitly unmatched
    updates.studyType = req.body.studyType.trim();
  }
  if (typeof req.body?.displayLabel === "string" && req.body.displayLabel.trim()) updates.displayLabel = req.body.displayLabel.trim();
  if (typeof req.body?.insertedText === "string") updates.insertedText = req.body.insertedText;
  if (req.body?.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder) || 0;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
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
    const tab = await resolveStudyTab({ studyType: c.studyType });
    await db.insert(radiologyClinicalHistoryChipsTable)
      .values({
        studyType: tab?.name ?? c.studyType,
        studyTabId: tab?.id ?? null,
        displayLabel: c.displayLabel,
        insertedText: c.insertedText,
        sortOrder: c.sortOrder,
        isActive: true,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: [radiologyClinicalHistoryChipsTable.studyType, radiologyClinicalHistoryChipsTable.displayLabel],
        set: {
          insertedText: c.insertedText,
          sortOrder: c.sortOrder,
          isActive: true,
          studyTabId: tab?.id ?? null,
          updatedAt: new Date(),
        },
      });
  }
  invalidateCached(CACHE_KEY);
  res.json({ ok: true, restored: defaults.length });
});

// ── Protocols (admin write, staff read via the cached GET / above) ──────────
router.post("/protocols", requireAdminRole, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (!tab) {
    res.status(400).json({ error: "studyTabId or studyType must resolve to a Study Tab" });
    return;
  }
  const studyType = tab.name;
  const isDefault = req.body?.isDefault === true;
  const duplicate = await findProtocolByScopedName({ name, studyTabId: tab.id, studyType });
  if (duplicate) {
    res.status(409).json(duplicateProtocolErrorPayload({
      name,
      studyTabId: tab.id,
      studyType,
      existingId: duplicate.id,
    }));
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      if (isDefault) {
        await tx.update(radiologyProtocolsTable)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(radiologyProtocolsTable.studyTabId, tab.id));
      }
      const [r] = await tx.insert(radiologyProtocolsTable).values({
        name,
        studyType,
        studyTabId: tab.id,
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
  } catch (err) {
    console.error("[quick-select] protocol create failed:", err);
    res.status(500).json({ error: "Could not create protocol" });
  }
});

router.patch("/protocols/:id", requireAdminRole, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existingRow] = await db.select().from(radiologyProtocolsTable).where(eq(radiologyProtocolsTable.id, id));
  if (!existingRow) {
    res.status(404).json({ error: "Protocol not found" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
  const tab = await resolveStudyTab({
    studyTabId: req.body?.studyTabId ?? req.body?.study_tab_id,
    studyType: req.body?.studyType,
  });
  if (tab) {
    updates.studyTabId = tab.id;
    updates.studyType = tab.name;
  } else if (typeof req.body?.studyType === "string" && req.body.studyType.trim()) {
    updates.studyType = req.body.studyType.trim();
  }
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

  const nextName = typeof updates.name === "string" ? updates.name : existingRow.name;
  const nextTabId = typeof updates.studyTabId === "number" ? updates.studyTabId : existingRow.studyTabId;
  const nextStudyType = typeof updates.studyType === "string" ? updates.studyType : existingRow.studyType;
  const duplicate = await findProtocolByScopedName({
    name: nextName,
    studyTabId: nextTabId,
    studyType: nextStudyType,
    excludeId: id,
  });
  if (duplicate) {
    res.status(409).json(duplicateProtocolErrorPayload({
      name: nextName,
      studyTabId: nextTabId,
      studyType: nextStudyType,
      existingId: duplicate.id,
    }));
    return;
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(radiologyProtocolsTable).where(eq(radiologyProtocolsTable.id, id));
      if (!existing) return null;
      if (updates.isDefault === true) {
        const studyTabId = typeof updates.studyTabId === "number" ? updates.studyTabId : existing.studyTabId;
        if (studyTabId != null) {
          await tx.update(radiologyProtocolsTable)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(radiologyProtocolsTable.studyTabId, studyTabId), ne(radiologyProtocolsTable.id, id)));
        } else {
          const studyType = typeof updates.studyType === "string" ? updates.studyType : existing.studyType;
          await tx.update(radiologyProtocolsTable)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(radiologyProtocolsTable.studyType, studyType), ne(radiologyProtocolsTable.id, id)));
        }
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
  } catch (err) {
    console.error("[quick-select] protocol patch failed:", err);
    res.status(500).json({ error: "Could not update protocol" });
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
    (await db
      .select({ name: radiologyProtocolsTable.name, studyTabId: radiologyProtocolsTable.studyTabId })
      .from(radiologyProtocolsTable))
      .filter((r) => r.studyTabId === src.studyTabId)
      .map((r) => normalizeProtocolName(r.name)),
  );
  let name = `${src.name} (copy)`;
  for (let n = 2; existingNames.has(normalizeProtocolName(name)); n++) {
    name = `${src.name} (copy ${n})`;
  }
  const [row] = await db.insert(radiologyProtocolsTable).values({
    name,
    studyType: src.studyType,
    studyTabId: src.studyTabId,
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
      const tab = await resolveStudyTab({ studyType: p.studyType });
      const studyTabId = tab?.id ?? null;
      const studyTypeName = tab?.name ?? p.studyType;
      if (p.isDefault) {
        if (studyTabId != null) {
          await tx.update(radiologyProtocolsTable)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(radiologyProtocolsTable.studyTabId, studyTabId));
        } else {
          await tx.update(radiologyProtocolsTable)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(radiologyProtocolsTable.studyType, studyTypeName), isNull(radiologyProtocolsTable.studyTabId)));
        }
      }
      const existing = await findProtocolByScopedName({
        name: p.name,
        studyTabId,
        studyType: studyTypeName,
      });
      if (existing) {
        await tx.update(radiologyProtocolsTable)
          .set({
            studyType: studyTypeName,
            studyTabId,
            modality: p.modality,
            checklistJson: p.checklistJson,
            techniqueText: p.techniqueText,
            normalText: p.normalText,
            isGoldStandard: p.isGoldStandard,
            isDefault: p.isDefault,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(radiologyProtocolsTable.id, existing.id));
      } else {
        await tx.insert(radiologyProtocolsTable)
          .values({
            name: p.name,
            studyType: studyTypeName,
            studyTabId,
            modality: p.modality,
            checklistJson: p.checklistJson,
            techniqueText: p.techniqueText,
            normalText: p.normalText,
            recommendationText: "",
            requiredMeasurements: "",
            isGoldStandard: p.isGoldStandard,
            isDefault: p.isDefault,
            sortOrder: p.sortOrder,
            isActive: true,
          });
      }
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

export default router;
