/**
 * radiologyReportFormats — whole-report library API.
 *
 * Persists Z.ai ReportFormat rows in radiology_snippets with type=report_format.
 * Clinical sections only (history/technique/findings/impression/recommendation).
 * No demographics, images, letterhead, or signatures.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { radiologySnippetsTable } from "@workspace/db/schema";
import { eq, and, or, desc, asc, sql, ilike } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { z } from "zod";

export const radiologyReportFormatsRouter: IRouter = Router();

const REPORT_FORMAT_TYPE = "report_format";

const formatBodySchema = z.object({
  name: z.string().min(1).max(200),
  modality: z.string().min(1).max(50),
  bodyPart: z.string().min(1).max(100),
  diagnosisTags: z.array(z.string().max(80)).max(40).optional().default([]),
  clinicalHistory: z.string().max(4000).optional().default(""),
  technique: z.string().max(4000).optional().default(""),
  findings: z.string().max(16000).optional().default(""),
  impression: z.string().max(8000).optional().default(""),
  recommendation: z.string().max(4000).optional().default(""),
  reportTitle: z.string().max(200).optional().default(""),
  protocolScope: z.string().max(200).optional().default(""),
  isCommon: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  isGlobal: z.boolean().optional().default(false),
});

const migrateSchema = z.object({
  formats: z.array(formatBodySchema).max(200),
});

function staffEmail(req: unknown): string {
  const user = (req as { staffUser?: { email?: string; username?: string } }).staffUser;
  return user?.email ?? user?.username ?? "";
}

function rowToFormat(row: typeof radiologySnippetsTable.$inferSelect) {
  return {
    id: String(row.id),
    name: row.label,
    modality: row.modality ?? "",
    bodyPart: row.bodyPart ?? "",
    diagnosisTags: row.tags ?? [],
    clinicalHistory: row.clinicalHistoryText ?? "",
    technique: row.techniqueText ?? "",
    findings: row.findingsText ?? "",
    impression: row.impressionText ?? "",
    recommendation: row.adviceText ?? "",
    reportTitle: row.titleText ?? "",
    protocolScope: row.testKeywords ?? "",
    isCommon: row.isDefault,
    custom: !row.isDefault,
    usageCount: row.usageCount ?? 0,
    isActive: row.isActive,
    isGlobal: row.isGlobal,
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

function formatDedupeKey(name: string, modality: string, bodyPart: string): string {
  return `${name.trim().toLowerCase()}|${modality.trim().toLowerCase()}|${bodyPart.trim().toLowerCase()}`;
}

radiologyReportFormatsRouter.use(requireStaffAuth);

/** GET /api/radiology/report-formats */
radiologyReportFormatsRouter.get("/", async (req, res) => {
  const email = staffEmail(req);
  if (!email) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }
  const modality = typeof req.query.modality === "string" ? req.query.modality : undefined;
  const bodyPart = typeof req.query.bodyPart === "string" ? req.query.bodyPart : undefined;
  const activeOnly = req.query.active !== "0" && req.query.active !== "false";

  const conds = [
    eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE),
    or(
      eq(radiologySnippetsTable.isGlobal, true),
      eq(radiologySnippetsTable.createdByName, email),
    )!,
  ];
  if (activeOnly) conds.push(eq(radiologySnippetsTable.isActive, true));
  if (modality) {
    conds.push(
      or(
        eq(radiologySnippetsTable.modality, modality),
        eq(radiologySnippetsTable.modality, "ALL"),
      )!,
    );
  }
  if (bodyPart) {
    conds.push(
      or(
        eq(radiologySnippetsTable.bodyPart, bodyPart),
        ilike(radiologySnippetsTable.bodyPart, bodyPart),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(radiologySnippetsTable)
    .where(and(...conds))
    .orderBy(desc(radiologySnippetsTable.isDefault), desc(radiologySnippetsTable.usageCount), asc(radiologySnippetsTable.label));

  res.json({ items: rows.map(rowToFormat), total: rows.length });
});

/** POST /api/radiology/report-formats */
radiologyReportFormatsRouter.post("/", async (req, res) => {
  const email = staffEmail(req);
  if (!email) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }
  const parsed = formatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(radiologySnippetsTable)
    .values({
      type: REPORT_FORMAT_TYPE,
      label: d.name,
      modality: d.modality,
      bodyPart: d.bodyPart,
      tags: d.diagnosisTags,
      clinicalHistoryText: d.clinicalHistory,
      techniqueText: d.technique,
      findingsText: d.findings,
      impressionText: d.impression,
      adviceText: d.recommendation,
      titleText: d.reportTitle,
      testKeywords: d.protocolScope,
      isDefault: d.isCommon,
      isActive: d.isActive,
      isGlobal: d.isGlobal,
      isPartialSection: false,
      createdByName: email,
    })
    .returning();
  res.status(201).json(rowToFormat(row));
});

/**
 * POST /api/radiology/report-formats/migrate
 * One-time import from browser localStorage. Skips duplicates by name+modality+bodyPart.
 * Does not delete browser data — client keeps cache until confirmed.
 */
radiologyReportFormatsRouter.post("/migrate", async (req, res) => {
  const email = staffEmail(req);
  if (!email) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }
  const parsed = migrateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const existing = await db
    .select()
    .from(radiologySnippetsTable)
    .where(
      and(
        eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE),
        or(
          eq(radiologySnippetsTable.isGlobal, true),
          eq(radiologySnippetsTable.createdByName, email),
        )!,
      ),
    );
  const seen = new Set(existing.map((r) => formatDedupeKey(r.label, r.modality ?? "", r.bodyPart ?? "")));

  let imported = 0;
  let skipped = 0;
  const created: ReturnType<typeof rowToFormat>[] = [];

  for (const f of parsed.data.formats) {
    const key = formatDedupeKey(f.name, f.modality, f.bodyPart);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    const [row] = await db
      .insert(radiologySnippetsTable)
      .values({
        type: REPORT_FORMAT_TYPE,
        label: f.name,
        modality: f.modality,
        bodyPart: f.bodyPart,
        tags: f.diagnosisTags,
        clinicalHistoryText: f.clinicalHistory,
        techniqueText: f.technique,
        findingsText: f.findings,
        impressionText: f.impression,
        adviceText: f.recommendation,
        titleText: f.reportTitle,
        testKeywords: f.protocolScope,
        isDefault: f.isCommon,
        isActive: true,
        isGlobal: false,
        isPartialSection: false,
        createdByName: email,
      })
      .returning();
    seen.add(key);
    imported += 1;
    created.push(rowToFormat(row));
  }

  const all = await db
    .select()
    .from(radiologySnippetsTable)
    .where(
      and(
        eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE),
        eq(radiologySnippetsTable.isActive, true),
        or(
          eq(radiologySnippetsTable.isGlobal, true),
          eq(radiologySnippetsTable.createdByName, email),
        )!,
      ),
    );

  res.json({
    imported,
    skipped,
    created,
    items: all.map(rowToFormat),
    authoritative: true,
  });
});

/** PUT /api/radiology/report-formats/:id */
radiologyReportFormatsRouter.put("/:id", async (req, res) => {
  const email = staffEmail(req);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = formatBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const [existing] = await db
    .select()
    .from(radiologySnippetsTable)
    .where(and(eq(radiologySnippetsTable.id, id), eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE)));
  if (!existing) {
    res.status(404).json({ error: "Format not found" });
    return;
  }
  if (!(existing.isGlobal || existing.createdByName === email)) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .update(radiologySnippetsTable)
    .set({
      ...(d.name !== undefined ? { label: d.name } : {}),
      ...(d.modality !== undefined ? { modality: d.modality } : {}),
      ...(d.bodyPart !== undefined ? { bodyPart: d.bodyPart } : {}),
      ...(d.diagnosisTags !== undefined ? { tags: d.diagnosisTags } : {}),
      ...(d.clinicalHistory !== undefined ? { clinicalHistoryText: d.clinicalHistory } : {}),
      ...(d.technique !== undefined ? { techniqueText: d.technique } : {}),
      ...(d.findings !== undefined ? { findingsText: d.findings } : {}),
      ...(d.impression !== undefined ? { impressionText: d.impression } : {}),
      ...(d.recommendation !== undefined ? { adviceText: d.recommendation } : {}),
      ...(d.reportTitle !== undefined ? { titleText: d.reportTitle } : {}),
      ...(d.protocolScope !== undefined ? { testKeywords: d.protocolScope } : {}),
      ...(d.isCommon !== undefined ? { isDefault: d.isCommon } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.isGlobal !== undefined ? { isGlobal: d.isGlobal } : {}),
      updatedAt: new Date(),
    })
    .where(eq(radiologySnippetsTable.id, id))
    .returning();
  res.json(rowToFormat(row));
});

/** DELETE /api/radiology/report-formats/:id — soft deactivate */
radiologyReportFormatsRouter.delete("/:id", async (req, res) => {
  const email = staffEmail(req);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(radiologySnippetsTable)
    .where(and(eq(radiologySnippetsTable.id, id), eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE)));
  if (!existing) {
    res.status(404).json({ error: "Format not found" });
    return;
  }
  if (!(existing.isGlobal || existing.createdByName === email)) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  await db
    .update(radiologySnippetsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(radiologySnippetsTable.id, id));
  res.json({ ok: true, id });
});

/** POST /api/radiology/report-formats/:id/use — bump usage */
radiologyReportFormatsRouter.post("/:id/use", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .update(radiologySnippetsTable)
    .set({
      usageCount: sql`${radiologySnippetsTable.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(radiologySnippetsTable.id, id), eq(radiologySnippetsTable.type, REPORT_FORMAT_TYPE)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Format not found" });
    return;
  }
  res.json(rowToFormat(row));
});
