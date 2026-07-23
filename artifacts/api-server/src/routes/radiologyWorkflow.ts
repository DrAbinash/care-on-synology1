/**
 * Real Radiology Workflow & DICOM Operations — Phase 12
 * Mounted at /api/radiology-workflow (staff-auth required)
 *
 * 1. DICOM Modality Worklist (MWL)
 * 2. Acquisition Gateway
 * 3. AI Orchestration Pipeline
 * 4. Radiologist Productivity Tools
 * 5. Critical Finding Alert Engine
 * 6. PACS Storage Lifecycle
 * 7. Enterprise Security (access logs)
 */

import { Router, type Request } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  mwlEntriesTable, dicomIncomingStudiesTable, aiJobQueueTable,
  radiologistShortcutsTable, radiologistMacrosTable, viewerPresetsTable,
  studyAccessLogTable, pacsStorageTierTable,
  radiologyStudiesTable, dicomStudiesTable, radiologyCriticalFindingsTable,
  radiologyReportDraftsTable, usgReportDraftsTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, asc, gte, lte, isNull, ne, count } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { resolveRadiologyStudyId, ensureCanonicalStudy } from "../lib/canonicalStudy";
import { acknowledgeFinding, notifyClinician } from "../lib/criticalFindingsAlert";
import { auditFromRequest } from "../lib/audit";

const router = Router();

function staffOf(req: Request) {
  return (req as StaffAuthRequest).staffSession!;
}
function requireRole(req: Request, ...roles: string[]) {
  const s = staffOf(req);
  return !!s.role && roles.includes(s.role);
}
const requireRad = (req: Request) => requireRole(req, "radiologist", "admin", "super_admin");
const requireAdmin = (req: Request) => requireRole(req, "admin", "super_admin");
const requireStaff = (req: Request) => !!staffOf(req).subjectId;

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// ── 1. DICOM Modality Worklist ──────────────────────────────────────────────────────────────────────────────────────────────

router.get("/mwl", async (req, res) => {
  const status = req.query.status as string | undefined;
  const modality = req.query.modality as string | undefined;
  const date = req.query.date as string | undefined;
  const priority = req.query.priority as string | undefined;
  const referringDoctor = req.query.referringDoctor as string | undefined;

  const conditions: any[] = [];
  if (status) conditions.push(eq(mwlEntriesTable.status, status));
  if (modality) conditions.push(eq(mwlEntriesTable.modality, modality));
  if (priority) conditions.push(eq(mwlEntriesTable.priority, priority));
  if (referringDoctor) conditions.push(sql`${mwlEntriesTable.referringDoctor} ILIKE ${`%${referringDoctor}%`}`);
  if (date) conditions.push(eq(mwlEntriesTable.scheduledStartDate, date));

  const whereClause = conditions.length > 0 ? and(...conditions) : sql`true`;
  const rows = await db.select().from(mwlEntriesTable)
    .where(whereClause)
    .orderBy(desc(mwlEntriesTable.createdAt))
    .limit(200);

  // Duplicate detection: count same accession numbers
  const accessionGroups = await db.select({
    accessionNumber: mwlEntriesTable.accessionNumber,
    count: sql<number>`count(*)`,
  }).from(mwlEntriesTable).groupBy(mwlEntriesTable.accessionNumber).having(sql`count(*) > 1`);

  res.json({ entries: rows, duplicates: accessionGroups });
});

router.post("/mwl", async (req, res) => {
  const parsed = z.object({
    patientId: z.number(),
    accessionNumber: z.string(),
    modality: z.string(),
    scheduledAETitle: z.string().optional(),
    scheduledStationName: z.string().optional(),
    scheduledStartDate: z.string().optional(),
    scheduledStartTime: z.string().optional(),
    referringDoctor: z.string().optional(),
    bodyPart: z.string().optional(),
    studyDescription: z.string().optional(),
    priority: z.string().default("routine"),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  // Duplicate check
  const [existing] = await db.select().from(mwlEntriesTable)
    .where(and(
      eq(mwlEntriesTable.accessionNumber, parsed.data.accessionNumber),
      eq(mwlEntriesTable.status, "scheduled"),
    )).limit(1);

  if (existing) {
    res.status(409).json({ error: "Duplicate accession number", duplicateOf: existing.id });
    return;
  }

  const [row] = await db.insert(mwlEntriesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/mwl/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ status: z.enum(["scheduled", "arrived", "in_progress", "completed", "reported", "cancelled"] as [string, ...string[]]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const updates: any = { status: parsed.data.status, updatedAt: new Date() };
  if (parsed.data.status === "arrived") updates.arrivedAt = new Date();
  if (parsed.data.status === "in_progress") updates.startedAt = new Date();
  if (parsed.data.status === "completed") updates.completedAt = new Date();
  if (parsed.data.status === "reported") updates.reportedAt = new Date();

  const [row] = await db.update(mwlEntriesTable).set(updates).where(eq(mwlEntriesTable.id, id)).returning();
  res.json(row);
});

router.post("/mwl/:id/resend", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(mwlEntriesTable).where(eq(mwlEntriesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.update(mwlEntriesTable).set({
    resentAt: new Date(),
    resentCount: existing.resentCount + 1,
    pollStatus: "pending",
    updatedAt: new Date(),
  }).where(eq(mwlEntriesTable.id, id)).returning();
  res.json(row);
});

// ── 2. Acquisition Gateway ─────────────────────────────────────────────────────────────────────────────────────────────────

router.get("/incoming", async (req, res) => {
  const status = req.query.status as string | undefined;
  const modality = req.query.modality as string | undefined;
  const q = status
    ? db.select().from(dicomIncomingStudiesTable).where(eq(dicomIncomingStudiesTable.transferStatus, status)).orderBy(desc(dicomIncomingStudiesTable.lastImageReceivedAt))
    : modality
      ? db.select().from(dicomIncomingStudiesTable).where(eq(dicomIncomingStudiesTable.modality, modality)).orderBy(desc(dicomIncomingStudiesTable.lastImageReceivedAt))
      : db.select().from(dicomIncomingStudiesTable).orderBy(desc(dicomIncomingStudiesTable.lastImageReceivedAt));
  const rows = await q.limit(200);

  // Live modality cards summary
  const byModality = await db.select({
    modality: dicomIncomingStudiesTable.modality,
    total: sql<number>`count(*)`,
    receiving: sql<number>`count(*) FILTER (WHERE transfer_status = 'receiving')`,
    complete: sql<number>`count(*) FILTER (WHERE transfer_status = 'complete')`,
    failed: sql<number>`count(*) FILTER (WHERE transfer_status = 'failed')`,
    quarantined: sql<number>`count(*) FILTER (WHERE transfer_status = 'quarantined')`,
  }).from(dicomIncomingStudiesTable).groupBy(dicomIncomingStudiesTable.modality);

  res.json({ studies: rows, byModality });
});

router.post("/incoming", async (req, res) => {
  const parsed = z.object({
    studyInstanceUID: z.string(),
    seriesInstanceUID: z.string().optional(),
    accessionNumber: z.string().optional(),
    modality: z.string(),
    aeTitle: z.string().optional(),
    expectedAeTitle: z.string().optional(),
    patientName: z.string().optional(),
    patientId: z.string().optional(),
    studyDescription: z.string().optional(),
    bodyPart: z.string().optional(),
    imageCount: z.number().default(0),
    seriesCount: z.number().default(0),
    ingestSource: z.string().default("conquest"),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const b = parsed.data;
  const aeMismatch = b.aeTitle && b.expectedAeTitle && b.aeTitle !== b.expectedAeTitle;

  // Check for duplicate StudyUID
  const [dup] = await db.select().from(dicomIncomingStudiesTable)
    .where(eq(dicomIncomingStudiesTable.studyInstanceUID, b.studyInstanceUID)).limit(1);

  const [row] = await db.insert(dicomIncomingStudiesTable).values({
    ...b,
    aeMismatch: aeMismatch ?? false,
    duplicateStudy: !!dup,
    transferStatus: "receiving",
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/incoming/:id/quarantine", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin required" }); return; }
  const id = Number(req.params.id);
  const reason = req.body.reason ?? "manual";
  const [row] = await db.update(dicomIncomingStudiesTable).set({
    transferStatus: "quarantined", quarantinedAt: new Date(), quarantineReason: reason, updatedAt: new Date(),
  }).where(eq(dicomIncomingStudiesTable.id, id)).returning();
  res.json(row);
});

router.patch("/incoming/:id/reprocess", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(dicomIncomingStudiesTable).where(eq(dicomIncomingStudiesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.update(dicomIncomingStudiesTable).set({
    transferStatus: "receiving",
    reprocessedAt: new Date(),
    reprocessCount: existing.reprocessCount + 1,
    updatedAt: new Date(),
  }).where(eq(dicomIncomingStudiesTable.id, id)).returning();
  res.json(row);
});

// ── 3. AI Orchestration Pipeline ──────────────────────────────────────────────────────────────────────────────────────────────

router.get("/ai-jobs", async (req, res) => {
  const status = req.query.status as string | undefined;
  const modality = req.query.modality as string | undefined;
  const q = status
    ? db.select().from(aiJobQueueTable).where(eq(aiJobQueueTable.status, status)).orderBy(asc(aiJobQueueTable.priority), desc(aiJobQueueTable.createdAt))
    : modality
      ? db.select().from(aiJobQueueTable).where(eq(aiJobQueueTable.modality, modality)).orderBy(asc(aiJobQueueTable.priority), desc(aiJobQueueTable.createdAt))
      : db.select().from(aiJobQueueTable).orderBy(asc(aiJobQueueTable.priority), desc(aiJobQueueTable.createdAt));
  const rows = await q.limit(200);
  res.json(rows);
});

router.post("/ai-jobs", async (req, res) => {
  const parsed = z.object({
    // Canonical identity is preferred; a raw studyId is accepted for backward
    // compatibility but is validated server-side (never trusted verbatim).
    studyInstanceUid: z.string().min(1).optional(),
    studyId: z.number().int().positive().optional(),
    jobType: z.string(),
    modality: z.string().default("OT"),
    priority: z.number().default(5),
    gpuMode: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { studyInstanceUid, studyId: candidateStudyId, jobType, modality, priority, gpuMode } = parsed.data;
  if (!studyInstanceUid && candidateStudyId == null) {
    res.status(400).json({ error: "studyInstanceUid or studyId is required" }); return;
  }
  // Gate G3: resolve the study SERVER-SIDE. A client-supplied studyId is never
  // inserted verbatim — it must resolve to an existing radiology_studies row,
  // which also satisfies the ai_job_queue.study_id foreign key.
  const studyId = await resolveRadiologyStudyId({ studyInstanceUid, studyId: candidateStudyId });
  if (studyId == null) {
    res.status(404).json({ error: "Study not found for the supplied identity" }); return;
  }
  if (studyInstanceUid) { await ensureCanonicalStudy(studyInstanceUid, studyId); }
  const [row] = await db.insert(aiJobQueueTable).values({
    studyId, jobType, modality, priority, gpuMode,
  }).returning();
  res.status(201).json(row);
});

router.patch("/ai-jobs/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    status: z.string(),
    resultJson: z.string().optional(),
    confidenceScore: z.number().optional(),
    inferenceTimeMs: z.number().optional(),
    errorMessage: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;
  const updates: any = { status: b.status, updatedAt: new Date() };
  if (b.resultJson) updates.resultJson = b.resultJson;
  if (b.confidenceScore != null) updates.confidenceScore = b.confidenceScore;
  if (b.inferenceTimeMs != null) updates.inferenceTimeMs = b.inferenceTimeMs;
  if (b.errorMessage) updates.errorMessage = b.errorMessage;
  if (b.status === "processing") updates.startedAt = new Date();
  if (b.status === "completed") updates.completedAt = new Date();
  const [row] = await db.update(aiJobQueueTable).set(updates).where(eq(aiJobQueueTable.id, id)).returning();
  res.json(row);
});

router.patch("/ai-jobs/:id/override", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(aiJobQueueTable).set({
    humanOverridden: true, overriddenBy: s.subjectName, overriddenAt: new Date(), updatedAt: new Date(),
  }).where(eq(aiJobQueueTable.id, id)).returning();
  res.json(row);
});

// ── 4. Radiologist Productivity Tools ────────────────────────────────────────────────────────────────────────────────────────────

router.get("/shortcuts", async (req, res) => {
  const radId = req.query.radiologistId ? Number(req.query.radiologistId) : undefined;
  const q = radId
    ? db.select().from(radiologistShortcutsTable).where(eq(radiologistShortcutsTable.radiologistId, radId)).orderBy(asc(radiologistShortcutsTable.keyCombo))
    : db.select().from(radiologistShortcutsTable).orderBy(asc(radiologistShortcutsTable.keyCombo));
  const rows = await q;
  res.json(rows);
});

router.post("/shortcuts", async (req, res) => {
  const parsed = z.object({
    radiologistId: z.number(), keyCombo: z.string(), action: z.string(),
    actionParamsJson: z.string().optional(), description: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(radiologistShortcutsTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

router.get("/macros", async (req, res) => {
  const radId = req.query.radiologistId ? Number(req.query.radiologistId) : undefined;
  const q = radId
    ? db.select().from(radiologistMacrosTable).where(eq(radiologistMacrosTable.radiologistId, radId)).orderBy(asc(radiologistMacrosTable.trigger))
    : db.select().from(radiologistMacrosTable).orderBy(asc(radiologistMacrosTable.trigger));
  const rows = await q;
  res.json(rows);
});

router.post("/macros", async (req, res) => {
  const parsed = z.object({
    radiologistId: z.number(), trigger: z.string(), expansion: z.string(),
    category: z.string().optional(), isFavorite: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(radiologistMacrosTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

router.get("/viewer-presets", async (_req, res) => {
  const rows = await db.select().from(viewerPresetsTable).orderBy(asc(viewerPresetsTable.sortOrder));
  res.json(rows);
});

router.post("/viewer-presets", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin required" }); return; }
  const parsed = z.object({
    name: z.string(), modality: z.string(), bodyPart: z.string().optional(),
    windowCenter: z.number(), windowWidth: z.number(),
    description: z.string().optional(), isDefault: z.boolean().default(false),
    sortOrder: z.number().default(0),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(viewerPresetsTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

// ── 5. Critical Finding Alert Engine (expanded) ─────────────────────────────────────────────────────────────────────────────────

const CRITICAL_CATEGORIES = [
  "brain_bleed", "midline_shift", "pneumothorax", "cord_compression",
  "free_air", "stroke", "pulmonary_embolism", "acute_hemorrhage",
];

router.get("/critical-alerts", async (_req, res) => {
  const openFindings = await db.select().from(radiologyCriticalFindingsTable)
    .where(isNull(radiologyCriticalFindingsTable.acknowledgedAt))
    .orderBy(desc(radiologyCriticalFindingsTable.createdAt)).limit(100);

  // Time-to-acknowledge for resolved findings
  const ackMetrics = await db.execute<{
    category: string; avg_seconds: string; count: string;
  }>(sql`
    SELECT category,
      AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at)))::text as avg_seconds,
      COUNT(*)::text as count
    FROM radiology_critical_findings
    WHERE acknowledged_at IS NOT NULL AND category IS NOT NULL
    GROUP BY category
  `);

  res.json({ openFindings, ackMetrics: ackMetrics.rows ?? [] });
});

router.post("/critical-alerts", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist required" }); return; }
  const parsed = z.object({
    studyId: z.number(),
    finding: z.string(),
    severity: z.enum(["critical", "urgent", "significant"] as [string, ...string[]]),
    category: z.enum(CRITICAL_CATEGORIES as [string, ...string[]]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(radiologyCriticalFindingsTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

// PR 3 — the acknowledge endpoint the CriticalAlertsManager UI has always
// PATCHed (it 404'd before this route existed). Identity comes from the
// authenticated session, never the client; acknowledgement is idempotent
// (the engine's first-ack-wins update); both outcomes are audited.
router.patch("/critical-alerts/:id/acknowledge", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid finding id" }); return; }
  const parsed = z.object({ note: z.string().max(2000).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body: note must be a string" }); return; }

  const s = staffOf(req);
  const result = await acknowledgeFinding(id, {
    name: s.subjectName ?? `staff#${s.subjectId}`,
    role: s.role ?? "staff",
    note: parsed.data.note,
  });
  if (result.outcome === "not_found") { res.status(404).json({ error: "Critical finding not found" }); return; }

  if (result.outcome === "acknowledged") {
    await auditFromRequest(req, {
      userId: s.subjectId ?? null,
      userName: s.subjectName ?? "staff",
      role: s.role ?? "staff",
      action: "acknowledge",
      module: "radiology",
      entityType: "critical_finding",
      entityId: String(id),
      newValue: JSON.stringify({ note: parsed.data.note ?? null }),
    });
  }
  res.json({ ok: true, outcome: result.outcome, finding: result.row });
});

// PR 3 — Notify: records a REAL clinician-notification event (who was
// contacted, how, by whom — session identity) instead of the old dead
// button. No external channel is wired for these findings today, so this
// records the internal/manual attempt; notification_delivered stays NULL
// (never pretends delivery). Audited.
router.post("/critical-alerts/:id/notify", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid finding id" }); return; }
  const parsed = z.object({
    clinicianName: z.string().min(1).max(200),
    method: z.enum(["phone", "whatsapp", "email", "in_person", "other"]),
    note: z.string().max(2000).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "clinicianName and a valid method (phone|whatsapp|email|in_person|other) are required" }); return; }

  const s = staffOf(req);
  const row = await notifyClinician(id, {
    clinicianName: parsed.data.clinicianName,
    method: parsed.data.method,
    note: parsed.data.note,
    recordedBy: s.subjectName ?? `staff#${s.subjectId}`,
  });
  if (!row) { res.status(404).json({ error: "Critical finding not found" }); return; }

  await auditFromRequest(req, {
    userId: s.subjectId ?? null,
    userName: s.subjectName ?? "staff",
    role: s.role ?? "staff",
    action: "notify",
    module: "radiology",
    entityType: "critical_finding",
    entityId: String(id),
    newValue: JSON.stringify({ clinician: parsed.data.clinicianName, method: parsed.data.method, note: parsed.data.note ?? null }),
  });
  res.json({ ok: true, finding: row });
});

// ── 6. PACS Storage Lifecycle ────────────────────────────────────────────────────────────────────────────────────────────────────

router.get("/storage-lifecycle", async (_req, res) => {
  const tiers = await db.select().from(pacsStorageTierTable).orderBy(desc(pacsStorageTierTable.updatedAt)).limit(200);

  const summary = await db.select({
    tier: pacsStorageTierTable.currentTier,
    count: sql<number>`count(*)`,
    totalSize: sql<number>`COALESCE(SUM(size_bytes), 0)`,
    orphans: sql<number>`count(*) FILTER (WHERE is_orphan)`,
    duplicates: sql<number>`count(*) FILTER (WHERE is_duplicate)`,
  }).from(pacsStorageTierTable).groupBy(pacsStorageTierTable.currentTier);

  // Modality-wise growth (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const growth = await db.select({
    modality: pacsStorageTierTable.modality,
    studiesAdded: sql<number>`count(*)`,
    sizeAdded: sql<number>`COALESCE(SUM(size_bytes), 0)`,
  }).from(pacsStorageTierTable).where(gte(pacsStorageTierTable.createdAt, thirtyDaysAgo))
    .groupBy(pacsStorageTierTable.modality);

  res.json({ tiers: tiers.slice(0, 50), summary, growth });
});

router.post("/storage-lifecycle", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin required" }); return; }
  const parsed = z.object({
    studyId: z.number(), modality: z.string(), currentTier: z.string(),
    sizeBytes: z.number().optional(), migrateReason: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(pacsStorageTierTable).values(parsed.data as any).returning();
  res.status(201).json(row);
});

// ── 7. Enterprise Security — Study Access Logs ───────────────────────────────────────────────────────────────────────────────────────

router.get("/access-logs", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin required" }); return; }
  const studyId = req.query.studyId ? Number(req.query.studyId) : undefined;
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const limit = Math.min(Number(req.query.limit ?? 500), 2000);

  const conditions: any[] = [];
  if (studyId) conditions.push(eq(studyAccessLogTable.studyId, studyId));
  if (userId) conditions.push(eq(studyAccessLogTable.userId, userId));
  const whereClause = conditions.length > 0 ? and(...conditions) : sql`true`;
  const rows = await db.select().from(studyAccessLogTable)
    .where(whereClause)
    .orderBy(desc(studyAccessLogTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.post("/access-logs", async (req, res) => {
  const s = staffOf(req);
  const parsed = z.object({
    studyId: z.number(), action: z.string(),
    detailsJson: z.string().optional(),
    deviceInfo: z.string().optional(), ipAddress: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.insert(studyAccessLogTable).values({
    ...parsed.data,
    userId: s.subjectId ?? 0,
    userName: s.subjectName ?? "unknown",
    userRole: s.role ?? "unknown",
    sessionId: null,
  } as any).returning();
  res.status(201).json(row);
});

// ── 8. Command Center Aggregator ────────────────────────────────────────────────────────────────────────────────────────────────────

router.get("/command-center", async (_req, res) => {
  const start = todayStart();

  // Live modalities
  const modalities = await db.select({
    modality: dicomIncomingStudiesTable.modality,
    total: sql<number>`count(*)`,
    online: sql<number>`count(*) FILTER (WHERE transfer_status IN ('receiving','complete'))`,
  }).from(dicomIncomingStudiesTable).groupBy(dicomIncomingStudiesTable.modality);

  // Incoming studies today
  const [studiesToday] = await db.select({ count: sql<number>`count(*)` }).from(dicomIncomingStudiesTable).where(gte(dicomIncomingStudiesTable.createdAt, start));

  // Pending reports
  const [pendingReports] = await db.select({ count: sql<number>`count(*)` }).from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.status, "acquired"));

  // Critical alerts
  const [criticalCount] = await db.select({ count: sql<number>`count(*)` }).from(radiologyCriticalFindingsTable).where(isNull(radiologyCriticalFindingsTable.acknowledgedAt));

  // AI queue
  const [aiQueued] = await db.select({ count: sql<number>`count(*)` }).from(aiJobQueueTable).where(eq(aiJobQueueTable.status, "queued"));
  const [aiProcessing] = await db.select({ count: sql<number>`count(*)` }).from(aiJobQueueTable).where(eq(aiJobQueueTable.status, "processing"));

  // Failed transfers
  const [failedTransfers] = await db.select({ count: sql<number>`count(*)` }).from(dicomIncomingStudiesTable).where(eq(dicomIncomingStudiesTable.transferStatus, "failed"));

  // Storage
  const [storageSummary] = await db.select({
    total: sql<number>`count(*)`,
    hot: sql<number>`count(*) FILTER (WHERE current_tier = 'hot')`,
    archive: sql<number>`count(*) FILTER (WHERE current_tier = 'archive')`,
    orphans: sql<number>`count(*) FILTER (WHERE is_orphan)`,
  }).from(pacsStorageTierTable);

  // Report TAT (avg today)
  const [tat] = await db.select({ avg: sql<number | null>`avg(${radiologyStudiesTable.numImages})` }).from(radiologyStudiesTable)
    .where(gte(radiologyStudiesTable.acquiredAt, start));

  res.json({
    modalities,
    studiesToday: studiesToday.count,
    pendingReports: pendingReports.count,
    criticalAlerts: criticalCount.count,
    aiQueue: { queued: aiQueued.count, processing: aiProcessing.count },
    failedTransfers: failedTransfers.count,
    storage: storageSummary,
    avgTatMinutes: tat?.avg ? Math.round(tat.avg) : null,
  });
});

export default router;
