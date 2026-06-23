// ── Radiology Knowledge Platform API Routes ──
// Phase 4: Master templates, personal library, knowledge base, profiles, analytics

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  radiologyMasterTemplatesTable,
  radiologyTemplateVersionsTable,
  radiologyPersonalTemplatesTable,
  radiologyTemplatePacksTable,
  radiologyKnowledgeBaseTable,
  radiologistProfilesTable,
  radiologyTemplateUsageTable,
  radiologyTemplateFavoritesTable,
  radiologyTemplateComparisonTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth.js";

export const radiologyKnowledgeRouter: IRouter = Router();

// Auth helper: req.staffSession is the staff info attached by requireStaffAuth
function getStaffId(req: StaffAuthRequest): number | undefined {
  return req.staffSession?.subjectId;
}
function getStaffRole(req: StaffAuthRequest): string | undefined {
  return req.staffSession?.role;
}
function getStaffName(req: StaffAuthRequest): string {
  return req.staffSession?.subjectName ?? "";
}
function isAdmin(req: StaffAuthRequest): boolean {
  const r = getStaffRole(req)?.toLowerCase() ?? "";
  return r === "admin" || r === "super_admin";
}

// Helper: log template usage for analytics
async function logTemplateUsage(
  staffId: number,
  templateId: number,
  source: "master" | "personal",
  name: string,
  action: string,
  modality?: string,
  bodyPart?: string,
  studyId?: number
) {
  try {
    await db.insert(radiologyTemplateUsageTable).values({
      staffId,
      templateId,
      templateSource: source,
      templateName: name,
      modality: modality ?? null,
      bodyPart: bodyPart ?? null,
      action,
      studyId: studyId ?? null,
    });
  } catch {
    // Non-blocking analytics
  }
}

// ── MASTER TEMPLATES ──

// GET /api/radiology/master-templates
// List all master templates. Filter by group, modality, bodyPart.
radiologyKnowledgeRouter.get("/master-templates", async (req: StaffAuthRequest, res) => {
  const { group, modality, bodyPart, studyType, q, active } = req.query;
  const conditions = [eq(radiologyMasterTemplatesTable.isActive, active !== "false")];
  if (group) conditions.push(eq(radiologyMasterTemplatesTable.groupName, group as string));
  if (modality) conditions.push(eq(radiologyMasterTemplatesTable.modality, modality as string));
  if (bodyPart) conditions.push(eq(radiologyMasterTemplatesTable.bodyPart, bodyPart as string));
  if (studyType) conditions.push(eq(radiologyMasterTemplatesTable.studyType, studyType as string));
  if (q) {
    const search = `%${(q as string).toLowerCase()}%`;
    conditions.push(
      or(
        ilike(sql`LOWER(${radiologyMasterTemplatesTable.templateName})`, search),
        ilike(sql`LOWER(${radiologyMasterTemplatesTable.findings})`, search),
        ilike(sql`LOWER(${radiologyMasterTemplatesTable.impression})`, search),
        ilike(sql`LOWER(${radiologyMasterTemplatesTable.bodyPart})`, search),
        ilike(sql`LOWER(${radiologyMasterTemplatesTable.studyType})`, search)
      ) ?? sql`TRUE`
    );
  }

  const rows = await db
    .select()
    .from(radiologyMasterTemplatesTable)
    .where(and(...conditions))
    .orderBy(asc(radiologyMasterTemplatesTable.groupName), asc(radiologyMasterTemplatesTable.templateName));

  res.json({ templates: rows, count: rows.length });
});

// GET /api/radiology/master-templates/:id
radiologyKnowledgeRouter.get("/master-templates/:id", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(radiologyMasterTemplatesTable).where(eq(radiologyMasterTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Log view
  if (getStaffId(req)) {
    await logTemplateUsage(getStaffId(req) as number, id, "master", row.templateName, "view", row.modality, row.bodyPart ?? undefined);
  }

  res.json(row);
});

// POST /api/radiology/master-templates
// Create new master template (super-admin only)
radiologyKnowledgeRouter.post("/master-templates", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can create master templates" });
    return;
  }
  const body = req.body;
  const [inserted] = await db.insert(radiologyMasterTemplatesTable).values({
    groupName: body.groupName,
    templateName: body.templateName,
    modality: body.modality,
    studyType: body.studyType,
    bodyPart: body.bodyPart,
    findings: body.findings,
    impression: body.impression,
    recommendations: body.recommendations,
    tags: body.tags ?? [],
    version: 1,
    isLocked: true,
    createdBy: req.staffSession?.subjectName ?? "",
    modifiedBy: req.staffSession?.subjectName ?? "",
  }).returning();

  // Also create initial version
  await db.insert(radiologyTemplateVersionsTable).values({
    masterTemplateId: inserted.id,
    version: 1,
    findings: body.findings,
    impression: body.impression,
    recommendations: body.recommendations,
    tags: body.tags ?? [],
    changeNotes: "Initial creation",
    changedBy: req.staffSession?.subjectName ?? "",
  });

  res.status(201).json(inserted);
});

// PATCH /api/radiology/master-templates/:id
// Update master template (super-admin only). Creates new version.
radiologyKnowledgeRouter.patch("/master-templates/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can edit master templates" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(radiologyMasterTemplatesTable).where(eq(radiologyMasterTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body;
  const newVersion = (existing.version ?? 1) + 1;
  const modifiedBy = req.staffSession?.subjectName ?? "";

  const [updated] = await db
    .update(radiologyMasterTemplatesTable)
    .set({
      templateName: body.templateName ?? existing.templateName,
      modality: body.modality ?? existing.modality,
      studyType: body.studyType ?? existing.studyType,
      bodyPart: body.bodyPart ?? existing.bodyPart,
      findings: body.findings ?? existing.findings,
      impression: body.impression ?? existing.impression,
      recommendations: body.recommendations ?? existing.recommendations,
      tags: body.tags ?? existing.tags,
      version: newVersion,
      modifiedBy,
    })
    .where(eq(radiologyMasterTemplatesTable.id, id))
    .returning();

  // Create version record
  await db.insert(radiologyTemplateVersionsTable).values({
    masterTemplateId: id,
    version: newVersion,
    findings: body.findings ?? existing.findings,
    impression: body.impression ?? existing.impression,
    recommendations: body.recommendations ?? existing.recommendations,
    tags: body.tags ?? existing.tags,
    changeNotes: body.changeNotes ?? "Updated",
    changedBy: modifiedBy,
  });

  res.json(updated);
});

// DELETE /api/radiology/master-templates/:id
// Soft delete (super-admin only)
radiologyKnowledgeRouter.delete("/master-templates/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can delete master templates" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.update(radiologyMasterTemplatesTable).set({ isActive: false }).where(eq(radiologyMasterTemplatesTable.id, id));
  res.json({ ok: true });
});

// ── TEMPLATE VERSIONS ──

// GET /api/radiology/master-templates/:id/versions
radiologyKnowledgeRouter.get("/master-templates/:id/versions", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select()
    .from(radiologyTemplateVersionsTable)
    .where(eq(radiologyTemplateVersionsTable.masterTemplateId, id))
    .orderBy(desc(radiologyTemplateVersionsTable.version));
  res.json({ versions: rows });
});

// POST /api/radiology/master-templates/:id/restore
// Restore a specific version
radiologyKnowledgeRouter.post("/master-templates/:id/restore", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can restore versions" });
    return;
  }
  const id = Number(req.params.id);
  const version = Number(req.body.version);
  if (!Number.isFinite(id) || !Number.isFinite(version)) { res.status(400).json({ error: "Invalid id or version" }); return; }

  const [versionRow] = await db
    .select()
    .from(radiologyTemplateVersionsTable)
    .where(and(eq(radiologyTemplateVersionsTable.masterTemplateId, id), eq(radiologyTemplateVersionsTable.version, version)));
  if (!versionRow) { res.status(404).json({ error: "Version not found" }); return; }

  const [existing] = await db.select().from(radiologyMasterTemplatesTable).where(eq(radiologyMasterTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const newVersion = (existing.version ?? 1) + 1;
  const modifiedBy = req.staffSession?.subjectName ?? "";

  const [updated] = await db
    .update(radiologyMasterTemplatesTable)
    .set({
      findings: versionRow.findings,
      impression: versionRow.impression,
      recommendations: versionRow.recommendations,
      tags: versionRow.tags,
      version: newVersion,
      modifiedBy,
    })
    .where(eq(radiologyMasterTemplatesTable.id, id))
    .returning();

  await db.insert(radiologyTemplateVersionsTable).values({
    masterTemplateId: id,
    version: newVersion,
    findings: versionRow.findings,
    impression: versionRow.impression,
    recommendations: versionRow.recommendations,
    tags: versionRow.tags,
    changeNotes: `Restored from version ${version}`,
    changedBy: modifiedBy,
  });

  res.json(updated);
});

// POST /api/radiology/master-templates/:id/clone
// Clone a master template to the user's personal library
radiologyKnowledgeRouter.post("/master-templates/:id/clone", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [master] = await db.select().from(radiologyMasterTemplatesTable).where(eq(radiologyMasterTemplatesTable.id, id));
  if (!master) { res.status(404).json({ error: "Master template not found" }); return; }

  // Check if already cloned (avoid duplicate key error)
  const [existing] = await db
    .select()
    .from(radiologyPersonalTemplatesTable)
    .where(and(
      eq(radiologyPersonalTemplatesTable.staffId, getStaffId(req) as number),
      eq(radiologyPersonalTemplatesTable.templateName, master.templateName),
      eq(radiologyPersonalTemplatesTable.isActive, true)
    ));
  if (existing) {
    res.status(409).json({ error: "Already cloned to your personal library", existingId: existing.id });
    return;
  }

  const [created] = await db.insert(radiologyPersonalTemplatesTable).values({
    staffId: getStaffId(req) as number,
    folder: master.bodyPart || "General",
    templateName: master.templateName,
    modality: master.modality,
    studyType: master.studyType,
    bodyPart: master.bodyPart,
    findings: master.findings,
    impression: master.impression,
    recommendations: master.recommendations,
    tags: master.tags,
    sourceMasterId: master.id,
  }).returning();

  await logTemplateUsage(getStaffId(req) as number, master.id, "master", master.templateName, "clone", master.modality, master.bodyPart ?? undefined);
  res.json(created);
});

// ── PERSONAL TEMPLATES ──

// GET /api/radiology/personal-templates
radiologyKnowledgeRouter.get("/personal-templates", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const { folder, modality, bodyPart, q } = req.query;
  const conditions = [
    eq(radiologyPersonalTemplatesTable.staffId, getStaffId(req) as number),
    eq(radiologyPersonalTemplatesTable.isActive, true),
  ];
  if (folder) conditions.push(eq(radiologyPersonalTemplatesTable.folder, folder as string));
  if (modality) conditions.push(eq(radiologyPersonalTemplatesTable.modality, modality as string));
  if (bodyPart) conditions.push(eq(radiologyPersonalTemplatesTable.bodyPart, bodyPart as string));
  if (q) {
    const search = `%${(q as string).toLowerCase()}%`;
    conditions.push(
      or(
        ilike(sql`LOWER(${radiologyPersonalTemplatesTable.templateName})`, search),
        ilike(sql`LOWER(${radiologyPersonalTemplatesTable.findings})`, search),
        ilike(sql`LOWER(${radiologyPersonalTemplatesTable.impression})`, search)
      ) ?? sql`TRUE`
    );
  }

  const rows = await db
    .select()
    .from(radiologyPersonalTemplatesTable)
    .where(and(...conditions))
    .orderBy(asc(radiologyPersonalTemplatesTable.folder), asc(radiologyPersonalTemplatesTable.templateName));

  res.json({ templates: rows, count: rows.length });
});

// POST /api/radiology/personal-templates
// Create new personal template (from scratch or clone from master)
radiologyKnowledgeRouter.post("/personal-templates", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;
  const [inserted] = await db.insert(radiologyPersonalTemplatesTable).values({
    staffId: getStaffId(req) as number,
    folder: body.folder ?? "General",
    templateName: body.templateName,
    modality: body.modality,
    studyType: body.studyType,
    bodyPart: body.bodyPart,
    findings: body.findings,
    impression: body.impression,
    recommendations: body.recommendations,
    measurements: body.measurements ?? [],
    macros: body.macros ?? [],
    tags: body.tags ?? [],
    sourceMasterId: body.sourceMasterId ?? null,
  }).returning();

  // Log usage
  await logTemplateUsage(getStaffId(req) as number, inserted.id, "personal", body.templateName, "create", body.modality, body.bodyPart);

  res.status(201).json(inserted);
});

// PATCH /api/radiology/personal-templates/:id
radiologyKnowledgeRouter.patch("/personal-templates/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(radiologyPersonalTemplatesTable)
    .where(and(eq(radiologyPersonalTemplatesTable.id, id), eq(radiologyPersonalTemplatesTable.staffId, getStaffId(req) as number)));
  if (!existing) { res.status(404).json({ error: "Not found or not owned" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologyPersonalTemplatesTable)
    .set({
      folder: body.folder ?? existing.folder,
      templateName: body.templateName ?? existing.templateName,
      modality: body.modality ?? existing.modality,
      studyType: body.studyType ?? existing.studyType,
      bodyPart: body.bodyPart ?? existing.bodyPart,
      findings: body.findings ?? existing.findings,
      impression: body.impression ?? existing.impression,
      recommendations: body.recommendations ?? existing.recommendations,
      measurements: body.measurements ?? existing.measurements,
      macros: body.macros ?? existing.macros,
      tags: body.tags ?? existing.tags,
    })
    .where(eq(radiologyPersonalTemplatesTable.id, id))
    .returning();

  res.json(updated);
});

// DELETE /api/radiology/personal-templates/:id
radiologyKnowledgeRouter.delete("/personal-templates/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(radiologyPersonalTemplatesTable)
    .where(and(eq(radiologyPersonalTemplatesTable.id, id), eq(radiologyPersonalTemplatesTable.staffId, getStaffId(req) as number)));
  if (!existing) { res.status(404).json({ error: "Not found or not owned" }); return; }

  await db.update(radiologyPersonalTemplatesTable).set({ isActive: false }).where(eq(radiologyPersonalTemplatesTable.id, id));
  res.json({ ok: true });
});

// ── TEMPLATE PACKS ──

// GET /api/radiology/template-packs
radiologyKnowledgeRouter.get("/template-packs", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const rows = await db
    .select()
    .from(radiologyTemplatePacksTable)
    .where(and(eq(radiologyTemplatePacksTable.staffId, getStaffId(req) as number), eq(radiologyTemplatePacksTable.isActive, true)))
    .orderBy(asc(radiologyTemplatePacksTable.packName));
  res.json({ packs: rows });
});

// POST /api/radiology/template-packs
radiologyKnowledgeRouter.post("/template-packs", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;
  const [inserted] = await db.insert(radiologyTemplatePacksTable).values({
    staffId: getStaffId(req) as number,
    packName: body.packName,
    description: body.description,
    modality: body.modality,
    templateIds: body.templateIds ?? [],
    templateSources: body.templateSources ?? [],
  }).returning();
  res.status(201).json(inserted);
});

// PATCH /api/radiology/template-packs/:id
radiologyKnowledgeRouter.patch("/template-packs/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(radiologyTemplatePacksTable)
    .where(and(eq(radiologyTemplatePacksTable.id, id), eq(radiologyTemplatePacksTable.staffId, getStaffId(req) as number)));
  if (!existing) { res.status(404).json({ error: "Not found or not owned" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologyTemplatePacksTable)
    .set({
      packName: body.packName ?? existing.packName,
      description: body.description ?? existing.description,
      modality: body.modality ?? existing.modality,
      templateIds: body.templateIds ?? existing.templateIds,
      templateSources: body.templateSources ?? existing.templateSources,
    })
    .where(eq(radiologyTemplatePacksTable.id, id))
    .returning();

  res.json(updated);
});

// DELETE /api/radiology/template-packs/:id
radiologyKnowledgeRouter.delete("/template-packs/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(radiologyTemplatePacksTable)
    .where(and(eq(radiologyTemplatePacksTable.id, id), eq(radiologyTemplatePacksTable.staffId, getStaffId(req) as number)));
  if (!existing) { res.status(404).json({ error: "Not found or not owned" }); return; }

  await db.update(radiologyTemplatePacksTable).set({ isActive: false }).where(eq(radiologyTemplatePacksTable.id, id));
  res.json({ ok: true });
});

// ── KNOWLEDGE BASE ──

// GET /api/radiology/knowledge-base
radiologyKnowledgeRouter.get("/knowledge-base", async (req, res) => {
  const { category, classification, q } = req.query;
  const conditions = [eq(radiologyKnowledgeBaseTable.isActive, true)];
  if (category) conditions.push(eq(radiologyKnowledgeBaseTable.category, category as string));
  if (classification) conditions.push(eq(radiologyKnowledgeBaseTable.classificationSystem, classification as string));
  if (q) {
    const search = `%${(q as string).toLowerCase()}%`;
    conditions.push(
      or(
        ilike(sql`LOWER(${radiologyKnowledgeBaseTable.title})`, search),
        ilike(sql`LOWER(${radiologyKnowledgeBaseTable.content})`, search),
        ilike(sql`LOWER(${radiologyKnowledgeBaseTable.category})`, search)
      ) ?? sql`TRUE`
    );
  }

  const rows = await db
    .select()
    .from(radiologyKnowledgeBaseTable)
    .where(and(...conditions))
    .orderBy(asc(radiologyKnowledgeBaseTable.category), asc(radiologyKnowledgeBaseTable.title));

  res.json({ articles: rows, count: rows.length });
});

// GET /api/radiology/knowledge-base/:id
radiologyKnowledgeRouter.get("/knowledge-base/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(radiologyKnowledgeBaseTable).where(eq(radiologyKnowledgeBaseTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// POST /api/radiology/knowledge-base (admin only)
radiologyKnowledgeRouter.post("/knowledge-base", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can add knowledge articles" });
    return;
  }
  const body = req.body;
  const [inserted] = await db.insert(radiologyKnowledgeBaseTable).values({
    category: body.category,
    title: body.title,
    content: body.content,
    classificationSystem: body.classificationSystem,
    classificationGrades: body.classificationGrades ?? [],
    measurementReferences: body.measurementReferences ?? [],
    reportingTips: body.reportingTips ?? [],
    tags: body.tags ?? [],
  }).returning();
  res.status(201).json(inserted);
});

// PATCH /api/radiology/knowledge-base/:id (admin only)
radiologyKnowledgeRouter.patch("/knowledge-base/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can edit knowledge articles" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologyKnowledgeBaseTable).where(eq(radiologyKnowledgeBaseTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const body = req.body;
  const [updated] = await db
    .update(radiologyKnowledgeBaseTable)
    .set({
      category: body.category ?? existing.category,
      title: body.title ?? existing.title,
      content: body.content ?? existing.content,
      classificationSystem: body.classificationSystem ?? existing.classificationSystem,
      classificationGrades: body.classificationGrades ?? existing.classificationGrades,
      measurementReferences: body.measurementReferences ?? existing.measurementReferences,
      reportingTips: body.reportingTips ?? existing.reportingTips,
      tags: body.tags ?? existing.tags,
    })
    .where(eq(radiologyKnowledgeBaseTable.id, id))
    .returning();
  res.json(updated);
});

// DELETE /api/radiology/knowledge-base/:id (admin only)
radiologyKnowledgeRouter.delete("/knowledge-base/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can delete knowledge articles" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(radiologyKnowledgeBaseTable).where(eq(radiologyKnowledgeBaseTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(radiologyKnowledgeBaseTable).set({ isActive: false }).where(eq(radiologyKnowledgeBaseTable.id, id));
  res.json({ ok: true });
});

// ── RADIOLOGIST PROFILES ──

// GET /api/radiology/profiles
radiologyKnowledgeRouter.get("/profiles", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const [row] = await db
    .select()
    .from(radiologistProfilesTable)
    .where(eq(radiologistProfilesTable.staffId, getStaffId(req) as number));
  if (!row) {
    // Auto-create default profile
    const [created] = await db.insert(radiologistProfilesTable).values({
      staffId: getStaffId(req) as number,
      profileName: "Default",
    }).returning();
    res.json(created);
    return;
  }
  res.json(row);
  return;
});

// PUT /api/radiology/profiles
radiologyKnowledgeRouter.put("/profiles", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;

  const [existing] = await db
    .select()
    .from(radiologistProfilesTable)
    .where(eq(radiologistProfilesTable.staffId, getStaffId(req) as number));

  if (existing) {
    const [updated] = await db
      .update(radiologistProfilesTable)
      .set({
        profileName: body.profileName ?? existing.profileName,
        defaultMasterGroup: body.defaultMasterGroup ?? existing.defaultMasterGroup,
        defaultModality: body.defaultModality ?? existing.defaultModality,
        defaultBodyPart: body.defaultBodyPart ?? existing.defaultBodyPart,
        defaultTemplateIds: body.defaultTemplateIds ?? existing.defaultTemplateIds,
        autoImpression: body.autoImpression ?? existing.autoImpression,
        autoPriority: body.autoPriority ?? existing.autoPriority,
        showKnowledgeBase: body.showKnowledgeBase ?? existing.showKnowledgeBase,
        showTemplatePacks: body.showTemplatePacks ?? existing.showTemplatePacks,
        aiDraftEnabled: body.aiDraftEnabled ?? existing.aiDraftEnabled,
        aiComparisonEnabled: body.aiComparisonEnabled ?? existing.aiComparisonEnabled,
        aiVoiceEnabled: body.aiVoiceEnabled ?? existing.aiVoiceEnabled,
      })
      .where(eq(radiologistProfilesTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [created] = await db.insert(radiologistProfilesTable).values({
    staffId: getStaffId(req) as number,
    profileName: body.profileName ?? "Default",
    defaultMasterGroup: body.defaultMasterGroup,
    defaultModality: body.defaultModality,
    defaultBodyPart: body.defaultBodyPart,
    defaultTemplateIds: body.defaultTemplateIds ?? [],
    autoImpression: body.autoImpression ?? false,
    autoPriority: body.autoPriority ?? false,
    showKnowledgeBase: body.showKnowledgeBase ?? true,
    showTemplatePacks: body.showTemplatePacks ?? true,
    aiDraftEnabled: body.aiDraftEnabled ?? false,
    aiComparisonEnabled: body.aiComparisonEnabled ?? false,
    aiVoiceEnabled: body.aiVoiceEnabled ?? false,
  }).returning();
  res.json(created);
});

// ── TEMPLATE FAVORITES ──

// GET /api/radiology/favorites
radiologyKnowledgeRouter.get("/favorites", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const rows = await db
    .select()
    .from(radiologyTemplateFavoritesTable)
    .where(eq(radiologyTemplateFavoritesTable.staffId, getStaffId(req) as number));
  res.json({ favorites: rows });
});

// POST /api/radiology/favorites
radiologyKnowledgeRouter.post("/favorites", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const body = req.body;
  const [inserted] = await db.insert(radiologyTemplateFavoritesTable).values({
    staffId: getStaffId(req) as number,
    templateId: body.templateId,
    templateSource: body.templateSource,
    folder: body.folder ?? "Favorites",
  }).returning();
  res.status(201).json(inserted);
});

// DELETE /api/radiology/favorites/:id
radiologyKnowledgeRouter.delete("/favorites/:id", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(radiologyTemplateFavoritesTable)
    .where(and(eq(radiologyTemplateFavoritesTable.id, id), eq(radiologyTemplateFavoritesTable.staffId, getStaffId(req) as number)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(radiologyTemplateFavoritesTable).where(eq(radiologyTemplateFavoritesTable.id, id));
  res.json({ ok: true });
});

// ── TEMPLATE COMPARISON ──

// POST /api/radiology/compare
// Compare personal template with master template
radiologyKnowledgeRouter.post("/compare", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const { personalTemplateId, masterTemplateId } = req.body;
  if (!Number.isFinite(personalTemplateId) || !Number.isFinite(masterTemplateId)) {
    res.status(400).json({ error: "Invalid template IDs" });
    return;
  }

  const [personal] = await db
    .select()
    .from(radiologyPersonalTemplatesTable)
    .where(and(
      eq(radiologyPersonalTemplatesTable.id, personalTemplateId),
      eq(radiologyPersonalTemplatesTable.staffId, getStaffId(req) as number)
    ));
  if (!personal) { res.status(404).json({ error: "Personal template not found" }); return; }

  const [master] = await db
    .select()
    .from(radiologyMasterTemplatesTable)
    .where(eq(radiologyMasterTemplatesTable.id, masterTemplateId));
  if (!master) { res.status(404).json({ error: "Master template not found" }); return; }

  // Compute differences
  const differences: { field: string; personal: string; master: string }[] = [];
  const fields = [
    { key: "findings", label: "Findings" },
    { key: "impression", label: "Impression" },
    { key: "recommendations", label: "Recommendations" },
    { key: "modality", label: "Modality" },
    { key: "bodyPart", label: "Body Part" },
    { key: "studyType", label: "Study Type" },
  ];
  for (const f of fields) {
    const p = (personal as any)[f.key] ?? "";
    const m = (master as any)[f.key] ?? "";
    if (p !== m) {
      differences.push({ field: f.label, personal: p, master: m });
    }
  }

  const [inserted] = await db.insert(radiologyTemplateComparisonTable).values({
    staffId: getStaffId(req) as number,
    personalTemplateId,
    masterTemplateId,
    personalSnapshot: JSON.stringify(personal),
    masterSnapshot: JSON.stringify(master),
    differences,
  }).returning();

  res.json({ comparison: inserted, differences });
});

// ── TEMPLATE ANALYTICS ──

// GET /api/radiology/analytics/usage
radiologyKnowledgeRouter.get("/analytics/usage", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req)) { res.status(401).json({ error: "Auth required" }); return; }
  const rangeStr = String(req.query.range || "");
  const days = rangeStr === "7d" ? 7 : rangeStr === "90d" ? 90 : Math.min(Number(req.query.days || 30), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Most used templates
  const mostUsed = await db
    .select({
      templateId: radiologyTemplateUsageTable.templateId,
      templateSource: radiologyTemplateUsageTable.templateSource,
      templateName: radiologyTemplateUsageTable.templateName,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologyTemplateUsageTable)
    .where(and(
      eq(radiologyTemplateUsageTable.staffId, getStaffId(req) as number),
      gte(radiologyTemplateUsageTable.createdAt, since)
    ))
    .groupBy(radiologyTemplateUsageTable.templateId, radiologyTemplateUsageTable.templateSource, radiologyTemplateUsageTable.templateName)
    .orderBy(desc(sql`count`))
    .limit(20);

  // Most used modalities
  const modalityStats = await db
    .select({
      modality: radiologyTemplateUsageTable.modality,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologyTemplateUsageTable)
    .where(and(
      eq(radiologyTemplateUsageTable.staffId, getStaffId(req) as number),
      gte(radiologyTemplateUsageTable.createdAt, since)
    ))
    .groupBy(radiologyTemplateUsageTable.modality)
    .orderBy(desc(sql`count`));

  // Action breakdown
  const actionStats = await db
    .select({
      action: radiologyTemplateUsageTable.action,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologyTemplateUsageTable)
    .where(and(
      eq(radiologyTemplateUsageTable.staffId, getStaffId(req) as number),
      gte(radiologyTemplateUsageTable.createdAt, since)
    ))
    .groupBy(radiologyTemplateUsageTable.action)
    .orderBy(desc(sql`count`));

  res.json({ mostUsed, modalityStats, actionStats, days });
});

// GET /api/radiology/analytics/global
// Global analytics (admin only)
radiologyKnowledgeRouter.get("/analytics/global", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const rangeStr = String(req.query.range || "");
  const days = rangeStr === "7d" ? 7 : rangeStr === "90d" ? 90 : Math.min(Number(req.query.days || 30), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const topTemplates = await db
    .select({
      templateId: radiologyTemplateUsageTable.templateId,
      templateSource: radiologyTemplateUsageTable.templateSource,
      templateName: radiologyTemplateUsageTable.templateName,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologyTemplateUsageTable)
    .where(gte(radiologyTemplateUsageTable.createdAt, since))
    .groupBy(radiologyTemplateUsageTable.templateId, radiologyTemplateUsageTable.templateSource, radiologyTemplateUsageTable.templateName)
    .orderBy(desc(sql`count`))
    .limit(20);

  const topRadiologists = await db
    .select({
      staffId: radiologyTemplateUsageTable.staffId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(radiologyTemplateUsageTable)
    .where(gte(radiologyTemplateUsageTable.createdAt, since))
    .groupBy(radiologyTemplateUsageTable.staffId)
    .orderBy(desc(sql`count`))
    .limit(10);

  res.json({ topTemplates, topRadiologists, days });
});

// ── SEED DATA ──

// POST /api/radiology/seed-master-templates
// Seed initial master templates (admin only, idempotent)
radiologyKnowledgeRouter.post("/seed-master-templates", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can seed templates" });
    return;
  }

  const seedTemplates = [
    // ──────────────────────────────────────────────────────────
    // DR SUGANDHA MASTER TEMPLATES (20 templates)
    // ──────────────────────────────────────────────────────────
    // MRI Brain
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain Normal",
      modality: "MR",
      studyType: "MRI Brain",
      bodyPart: "BRAIN",
      findings: "BRAIN PARENCHYMA: Normal signal intensity on all sequences.\nVENTRICLES: Normal size and configuration.\nMIDLINE: No shift.\nNo focal lesion, hemorrhage, or infarct.",
      impression: "Normal MRI brain study.",
      recommendations: "No follow-up required.",
      tags: ["normal", "brain", "mri"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain Senile Changes",
      modality: "MR",
      studyType: "MRI Brain",
      bodyPart: "BRAIN",
      findings: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles.\nPERIVENTRICULAR: Multiple punctate hyperintense foci on FLAIR — Fazekas Grade I.\nNo mass lesion, hemorrhage, or acute infarct.",
      impression: "Senile cerebral atrophy with mild periventricular ischemic changes (Fazekas Grade I).",
      recommendations: "Routine follow-up as clinically indicated.",
      tags: ["senile", "brain", "mri", "fazekas"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain Acute Infarct",
      modality: "MR",
      studyType: "MRI Brain",
      bodyPart: "BRAIN",
      findings: "HYPERINTENSE area on T2/FLAIR with restricted diffusion on DWI and low ADC in the ___ territory, suggestive of acute infarct.\nNo hemorrhagic transformation.\nMASS EFFECT: Mild.",
      impression: "Acute infarct in the ___ territory.",
      recommendations: "URGENT: Clinical correlation and immediate management required.",
      tags: ["acute", "infarct", "brain", "mri", "critical"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain Hemorrhage",
      modality: "MR",
      studyType: "MRI Brain",
      bodyPart: "BRAIN",
      findings: "HYPERINTENSE on T1 and T2/FLAIR with blooming on SWI in the ___ region, suggestive of intraparenchymal hemorrhage.\nMass effect: Present.\nMidline shift: ___ mm.",
      impression: "Intracranial hemorrhage in the ___ region with mass effect.",
      recommendations: "URGENT: Immediate neurosurgical evaluation required.",
      tags: ["hemorrhage", "brain", "mri", "critical"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain Hydrocephalus",
      modality: "MR",
      studyType: "MRI Brain",
      bodyPart: "BRAIN",
      findings: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles.\nTemporal horns prominent.\nTransependymal CSF seepage noted on FLAIR.\nFourth ventricle: Normal.\nNo obstructing lesion.",
      impression: "Hydrocephalus.",
      recommendations: "Clinical correlation and neurosurgical evaluation recommended.",
      tags: ["hydrocephalus", "brain", "mri"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Pituitary / Empty Sella",
      modality: "MR",
      studyType: "MRI Pituitary",
      bodyPart: "PITUITARY",
      findings: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal.\nPITUITARY: Flattened along the floor.\nOPTIC CHIASMA: Normal.\nNo suprasellar mass.",
      impression: "Empty sella turcica.",
      recommendations: "Routine follow-up. Endocrine evaluation if clinically indicated.",
      tags: ["empty sella", "pituitary", "mri"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain + MRA",
      modality: "MR",
      studyType: "MRI Brain + MRA",
      bodyPart: "BRAIN",
      findings: "BRAIN PARENCHYMA: Normal signal.\nNo acute infarct or hemorrhage.\nMRA: No significant stenosis or aneurysm in the circle of Willis.\nFlow voids: Normal.",
      impression: "Normal MRI brain and MRA. No significant intracranial vascular abnormality.",
      recommendations: "No follow-up required.",
      tags: ["normal", "brain", "mri", "mra", "vascular"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Brain + Cervical Screening",
      modality: "MR",
      studyType: "MRI Brain + Cervical Spine",
      bodyPart: "BRAIN",
      findings: "BRAIN: Normal signal. No focal lesion.\nCERVICAL SPINE: No disc bulge. No canal stenosis. Cord normal.\nNo cord compression.",
      impression: "Normal MRI brain and cervical spine.",
      recommendations: "No follow-up required.",
      tags: ["normal", "brain", "cervical", "mri", "screening"],
    },
    // Cervical Spine
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Cervical Spine Normal",
      modality: "MR",
      studyType: "MRI Cervical Spine",
      bodyPart: "CERVICAL SPINE",
      findings: "CERVICAL SPINE: Normal alignment and curvature.\nDiscs: Normal height and signal. No herniation.\nCORD: Normal signal. No compression.\nNo soft tissue abnormality.",
      impression: "Normal MRI cervical spine.",
      recommendations: "No follow-up required.",
      tags: ["normal", "cervical", "mri"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Cervical Spondylosis",
      modality: "MR",
      studyType: "MRI Cervical Spine",
      bodyPart: "CERVICAL SPINE",
      findings: "CERVICAL SPINE: Degenerative changes.\nC4-C5: Disc desiccation with posterior disc bulge.\nC5-C6: Disc bulge with mild canal narrowing (AP diameter ___ mm).\nCORD: Normal signal.\nNo cord compression.",
      impression: "Cervical spondylosis with disc bulges at C4-C5 and C5-C6. No cord compression.",
      recommendations: "Conservative management. Clinical correlation.",
      tags: ["spondylosis", "cervical", "mri", "disc"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI Cervical Trauma",
      modality: "MR",
      studyType: "MRI Cervical Spine",
      bodyPart: "CERVICAL SPINE",
      findings: "CERVICAL SPINE: Loss of normal lordosis.\nC___: Vertebral body fracture with retropulsion.\nSPINAL CANAL: Narrowed.\nCORD: T2 hyperintense signal at C___ level, suggestive of cord contusion/edema.\nPREVERTEBRAL SOFT TISSUE: Swelling.",
      impression: "Cervical spine fracture at C___ with spinal cord contusion/edema.",
      recommendations: "URGENT: Immediate neurosurgical evaluation and immobilization.",
      tags: ["trauma", "cervical", "mri", "critical", "fracture"],
    },
    // LS Spine
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI LS Spine Normal",
      modality: "MR",
      studyType: "MRI LS Spine",
      bodyPart: "LS SPINE",
      findings: "LS SPINE: Normal alignment.\nDiscs: Normal height and signal.\nNo disc herniation.\nSpinal canal: Normal.\nNeural foramina: Patent.\nCONUS: Normal.",
      impression: "Normal MRI LS spine.",
      recommendations: "No follow-up required.",
      tags: ["normal", "lumbar", "mri"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI LS Disc Bulge",
      modality: "MR",
      studyType: "MRI LS Spine",
      bodyPart: "LS SPINE",
      findings: "LS SPINE: L4-L5 and L5-S1: Disc desiccation with posterior bulge.\nSPINAL CANAL: Mildly narrowed at L4-L5.\nNEURAL FORAMINA: Mildly narrowed at L5-S1 bilaterally.\nCONUS: Normal.",
      impression: "Degenerative lumbar spondylotic changes with disc bulges at L4-L5 and L5-S1, mild canal and foraminal narrowing.",
      recommendations: "Conservative management. Physiotherapy.",
      tags: ["disc bulge", "lumbar", "mri", "spondylosis"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "MRI LS Canal Stenosis",
      modality: "MR",
      studyType: "MRI LS Spine",
      bodyPart: "LS SPINE",
      findings: "LS SPINE: L4-L5: Severe canal stenosis (AP diameter ___ mm).\nL5-S1: Disc bulge with facet hypertrophy.\nNEURAL FORAMINA: Severely narrowed at L4-L5 bilaterally.\nCONUS: Normal.",
      impression: "Severe lumbar canal stenosis at L4-L5 with bilateral foraminal narrowing. Surgical evaluation recommended.",
      recommendations: "Surgical evaluation recommended. Clinical correlation.",
      tags: ["stenosis", "lumbar", "mri", "severe"],
    },
    // Whole Spine
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "Whole Spine Screening",
      modality: "MR",
      studyType: "MRI Whole Spine",
      bodyPart: "SPINE",
      findings: "CERVICAL SPINE: Normal alignment. No disc herniation.\nTHORACIC SPINE: Normal.\nLUMBAR SPINE: No disc bulge. No canal stenosis.\nCONUS: Normal.\nNo syrinx.",
      impression: "Normal MRI whole spine screening.",
      recommendations: "No follow-up required.",
      tags: ["normal", "spine", "mri", "screening"],
    },
    // USG Abdomen
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "USG Abdomen Normal",
      modality: "US",
      studyType: "USG Abdomen",
      bodyPart: "ABDOMEN",
      findings: "LIVER: Normal in size, shape, and echotexture. No focal lesion.\nGALLBLADDER: Normal wall thickness. No calculus.\nPANCREAS: Normal size and echotexture.\nSPLEEN: Normal size.\nKIDNEYS: Both normal size. No hydronephrosis.\nBLADDER: Normal wall.\nNo free fluid.",
      impression: "Normal USG abdomen.",
      recommendations: "No follow-up required.",
      tags: ["normal", "abdomen", "usg"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "USG Fatty Liver",
      modality: "US",
      studyType: "USG Abdomen",
      bodyPart: "ABDOMEN",
      findings: "LIVER: Normal size. Diffuse increased echotexture with slightly impaired intrahepatic vessel definition — Grade I fatty liver.",
      impression: "Grade I fatty liver.",
      recommendations: "Lifestyle modification. Repeat ultrasound in 6 months.",
      tags: ["fatty liver", "abdomen", "usg", "grade i"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "USG GB Calculus",
      modality: "US",
      studyType: "USG Abdomen",
      bodyPart: "ABDOMEN",
      findings: "GALLBLADDER: Well distended. Single/multiple echogenic foci with posterior acoustic shadowing in the GB lumen, largest measuring ___ mm.\nGB WALL: Normal thickness.\nNo pericholecystic fluid.",
      impression: "Gallbladder calculus.",
      recommendations: "Clinical correlation. Surgical evaluation if symptomatic.",
      tags: ["gb calculus", "abdomen", "usg", "gallbladder"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "USG KUB Calculus",
      modality: "US",
      studyType: "USG KUB",
      bodyPart: "ABDOMEN",
      findings: "KIDNEYS: Echogenic focus with posterior acoustic shadowing in the ___ kidney, measuring ___ mm. No hydronephrosis.\nURETER: No dilatation.\nBLADDER: Normal. No calculus.",
      impression: "Renal calculus in the ___ kidney.",
      recommendations: "Clinical correlation. Hydration. Repeat ultrasound if symptomatic.",
      tags: ["renal calculus", "kub", "usg", "kidney"],
    },
    {
      groupName: "DR_SUGANDHA_MASTER",
      templateName: "USG Prostatomegaly",
      modality: "US",
      studyType: "USG KUB/Prostate",
      bodyPart: "PELVIS",
      findings: "PROSTATE: Enlarged, size ___ cc (vol = L x W x H x 0.52). Homogeneous echotexture.\nNo focal hypoechoic lesion.\nNo calcification.\nPOST-VOID RESIDUAL: ___ ml.",
      impression: "Prostatomegaly. Post-void residual urine ___ ml.",
      recommendations: "Clinical correlation. Urology evaluation if symptomatic.",
      tags: ["prostate", "usg", "prostatomegaly", "kub"],
    },
    // ──────────────────────────────────────────────────────────
    // DR ABINASH MASTER TEMPLATES (15 templates)
    // ──────────────────────────────────────────────────────────
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "CT/MRI Head Injury",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: No acute intracranial hemorrhage. No skull fracture. No midline shift.\nVentricular system: Normal.\nCerebral parenchyma: Normal.\nNo mass lesion.",
      impression: "Normal CT brain. No acute intracranial abnormality.",
      recommendations: "Clinical correlation. Observation if indicated.",
      tags: ["normal", "head injury", "brain", "ct", "trauma"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "EDH",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Extra-axial biconvex hyperdense collection in the ___ region, consistent with epidural hematoma.\nMass effect: Present.\nMidline shift: ___ mm.\nSkull fracture: Present.",
      impression: "Epidural hematoma in the ___ region with mass effect. Skull fracture present.",
      recommendations: "URGENT: Immediate neurosurgical evaluation. Possible evacuation.",
      tags: ["edh", "trauma", "brain", "ct", "critical", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "SDH",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Extra-axial crescent-shaped hyperdense collection along the ___ cerebral convexity, consistent with subdural hematoma.\nThickness: ___ mm.\nMass effect: Present.\nMidline shift: ___ mm.",
      impression: "Subdural hematoma along the ___ convexity. Mass effect present.",
      recommendations: "URGENT: Neurosurgical evaluation. Possible evacuation if thickness > 10mm or midline shift > 5mm.",
      tags: ["sdh", "trauma", "brain", "ct", "critical", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "SAH",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Hyperdense material in the subarachnoid spaces, most prominent in the ___ cisterns and sulci.\nNo intraparenchymal hematoma.\nHydrocephalus: Present/Absent.",
      impression: "Subarachnoid hemorrhage. Clinical correlation for aneurysm evaluation.",
      recommendations: "URGENT: CT angiography / DSA for aneurysm evaluation. Neurosurgical consultation.",
      tags: ["sah", "trauma", "brain", "ct", "critical", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Cerebral Contusion",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Heterogeneous hyperdense area in the ___ lobe, suggestive of cerebral contusion.\nSurrounding edema: Present.\nNo significant mass effect.\nNo midline shift.",
      impression: "Cerebral contusion in the ___ lobe.",
      recommendations: "Neurosurgical evaluation. Observation and follow-up CT.",
      tags: ["contusion", "brain", "ct", "trauma", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Acute Infarct",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Hypodense area in the ___ territory, suggestive of acute infarct.\nNo hemorrhagic transformation.\nSulcal effacement: Present.",
      impression: "Acute infarct in the ___ territory.",
      recommendations: "URGENT: Immediate medical management. Neurology referral.",
      tags: ["acute", "infarct", "brain", "ct", "critical"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Intracranial Hemorrhage",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Hyperdense area in the ___ region, consistent with intraparenchymal hemorrhage.\nVolume: ___ ml.\nMass effect: Present.\nMidline shift: ___ mm.",
      impression: "Intracranial hemorrhage in the ___ region. Volume ___ ml.",
      recommendations: "URGENT: Neurosurgical evaluation. BP control.",
      tags: ["hemorrhage", "brain", "ct", "critical", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Hydrocephalus",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Dilated lateral and third ventricles.\nTemporal horns prominent.\nTransependymal CSF seepage: Present.\nNo acute hemorrhage.\nNo mass lesion.",
      impression: "Hydrocephalus.",
      recommendations: "Neurosurgical evaluation for shunt consideration.",
      tags: ["hydrocephalus", "brain", "ct", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Brain Tumor / SOL",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Hypodense / hyperdense / mixed density lesion in the ___ region, size ___ x ___ mm.\nMass effect: Present.\nEdema: Present.\nMidline shift: ___ mm.\nContrast enhancement: Homogeneous / Heterogeneous / Ring.",
      impression: "Space-occupying lesion in the ___ region. Differential: glioma / metastasis / abscess.",
      recommendations: "MRI with contrast. Neurosurgical evaluation. Biopsy.",
      tags: ["tumor", "brain", "ct", "sol", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Post-operative Brain",
      modality: "CT",
      studyType: "CT Brain",
      bodyPart: "BRAIN",
      findings: "CT BRAIN: Post-operative changes following craniotomy.\nCraniotomy defect in the ___ region.\nSurgical changes: Present.\nResidual lesion: Present/Absent.\nNo acute hemorrhage.\nNo significant edema.",
      impression: "Post-operative changes following craniotomy. No acute complications.",
      recommendations: "Routine post-operative follow-up. Clinical correlation.",
      tags: ["post-op", "brain", "ct", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Cervical Trauma",
      modality: "CT",
      studyType: "CT Cervical Spine",
      bodyPart: "CERVICAL SPINE",
      findings: "CT CERVICAL SPINE: Fracture of C___ vertebral body.\nRetropulsion: Present/Absent.\nPosterior elements: Intact/Fractured.\nSpinal canal: Compromised/Normal.",
      impression: "Cervical spine fracture at C___.",
      recommendations: "Orthopedic/neurosurgical evaluation. Immobilization.",
      tags: ["trauma", "cervical", "ct", "fracture", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Cord Compression",
      modality: "MR",
      studyType: "MRI Spine",
      bodyPart: "SPINE",
      findings: "SPINE: ___ level — disc herniation/extrusion with severe canal stenosis.\nSPINAL CORD: T2 hyperintense signal at ___ level.\nCORD: Compressed.\nPRE/POST contrast: Enhancement pattern.",
      impression: "Spinal cord compression at ___ level with signal changes. Surgical decompression recommended.",
      recommendations: "URGENT: Surgical decompression recommended.",
      tags: ["cord compression", "spine", "mri", "critical", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Spine Fracture",
      modality: "CT",
      studyType: "CT Spine",
      bodyPart: "SPINE",
      findings: "CT SPINE: Compression fracture of ___ vertebral body with ___% loss of anterior height.\nRetropulsion: Present/Absent.\nPosterior elements: Intact/Fractured.\nSPINAL CANAL: Compromised/Normal.",
      impression: "Compression fracture of ___ vertebral body.",
      recommendations: "Orthopedic/neurosurgical evaluation.",
      tags: ["fracture", "spine", "ct", "trauma", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Lumbar Canal Stenosis",
      modality: "CT",
      studyType: "CT LS Spine",
      bodyPart: "LS SPINE",
      findings: "CT LS SPINE: L___: Severe canal stenosis (AP diameter ___ mm).\nDisc bulge with facet hypertrophy.\nNeural foramina: Severely narrowed.\nLigamentum flavum: Thickened.",
      impression: "Severe lumbar canal stenosis at L___.",
      recommendations: "Surgical evaluation recommended.",
      tags: ["stenosis", "lumbar", "ct", "neurosurgery"],
    },
    {
      groupName: "DR_ABINASH_MASTER",
      templateName: "Whole Spine Trauma Screening",
      modality: "CT",
      studyType: "CT Whole Spine",
      bodyPart: "SPINE",
      findings: "CERVICAL SPINE: No fracture. No dislocation.\nTHORACIC SPINE: No fracture.\nLUMBAR SPINE: No fracture. No subluxation.\nSPINAL CANAL: Normal.\nNo cord compression.",
      impression: "Whole spine trauma screening: No acute fracture or dislocation.",
      recommendations: "Clinical correlation. Repeat if symptomatic.",
      tags: ["trauma", "spine", "ct", "screening", "neurosurgery"],
    },
    // ──────────────────────────────────────────────────────────
    // CARE DIAGNOSTICS MASTER (2 templates)
    // ──────────────────────────────────────────────────────────
    {
      groupName: "CARE_DIAGNOSTICS_MASTER",
      templateName: "General Reporting Normal",
      modality: "OT",
      studyType: "General",
      bodyPart: "GENERAL",
      findings: "Normal study. No abnormality detected.",
      impression: "Normal study.",
      recommendations: "No follow-up required.",
      tags: ["normal", "general"],
    },
    {
      groupName: "CARE_DIAGNOSTICS_MASTER",
      templateName: "Clinical Correlation",
      modality: "OT",
      studyType: "General",
      bodyPart: "GENERAL",
      findings: "Clinical correlation recommended for further evaluation.",
      impression: "Clinical correlation recommended.",
      recommendations: "Clinical correlation and further investigation as indicated.",
      tags: ["clinical correlation", "general"],
    },
    // ──────────────────────────────────────────────────────────
    // HOPE HOSPITAL MASTER (2 templates)
    // ──────────────────────────────────────────────────────────
    {
      groupName: "HOPE_HOSPITAL_MASTER",
      templateName: "Trauma Screening",
      modality: "CT",
      studyType: "Trauma Screening",
      bodyPart: "MULTIPLE",
      findings: "Trauma screening: No acute intracranial hemorrhage. No skull fracture. C-spine: No fracture. No dislocation. Chest: No pneumothorax. No hemothorax. Abdomen: No free fluid. No solid organ injury.",
      impression: "Trauma screening: No acute findings. No evidence of significant injury.",
      recommendations: "Clinical correlation. Repeat imaging if clinically indicated.",
      tags: ["trauma", "screening", "ct", "multiple", "hope hospital"],
    },
    {
      groupName: "HOPE_HOSPITAL_MASTER",
      templateName: "Obstetric Normal First Trimester",
      modality: "US",
      studyType: "USG Obstetric",
      bodyPart: "PELVIS",
      findings: "UTERUS: Single intrauterine gestational sac.\nCRL: ___ mm (corresponds to ___ weeks).\nFETAL HEART: Normal cardiac activity.\nYOLK SAC: Present.\nNo subchorionic hemorrhage.\nNo adnexal mass.",
      impression: "Single live intrauterine pregnancy of ___ weeks.",
      recommendations: "Routine antenatal care. Follow-up scan at 18-20 weeks.",
      tags: ["obstetric", "first trimester", "usg", "normal", "hope hospital"],
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const t of seedTemplates) {
    const existing = await db
      .select()
      .from(radiologyMasterTemplatesTable)
      .where(and(
        eq(radiologyMasterTemplatesTable.groupName, t.groupName),
        eq(radiologyMasterTemplatesTable.templateName, t.templateName)
      ));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(radiologyMasterTemplatesTable).values(t);
    created++;
  }

  res.json({ created, skipped, total: seedTemplates.length });
});

// ── KNOWLEDGE BASE SEED ──

// POST /api/radiology/seed-knowledge-base
radiologyKnowledgeRouter.post("/seed-knowledge-base", async (req: StaffAuthRequest, res) => {
  if (!getStaffId(req) || !isAdmin(req)) {
    res.status(403).json({ error: "Only admin/super-admin can seed knowledge base" });
    return;
  }

  const seedArticles = [
    // ──────────────────────────────────────────────────────────
    // KNOWLEDGE BASE ARTICLES (11 articles)
    // ──────────────────────────────────────────────────────────
    {
      category: "Brain",
      title: "Fazekas grading",
      content: "Fazekas scale for white matter hyperintensities on MRI.\n\nGrade 0: No lesions.\nGrade 1: Single punctate or ≤5 punctate lesions in the deep white matter\nGrade 2: Beginning confluence of lesions (punctate and early confluent)\nGrade 3: Large confluent lesions\n\nGrades 1-2 are common with aging. Grade 3 suggests significant small vessel disease.",
      classificationSystem: "Fazekas",
      classificationGrades: ["Grade 0", "Grade 1", "Grade 2", "Grade 3"],
      measurementReferences: [],
      reportingTips: ["Always mention the grade in the impression", "Correlate with patient age and clinical history"],
      tags: ["brain", "white matter", "classification", "fazekas"],
    },
    {
      category: "Prostate",
      title: "PI-RADS v2.1 Assessment",
      content: "PI-RADS (Prostate Imaging Reporting and Data System) standardizes MRI reporting for prostate cancer suspicion.\n\nScore 1: Very low (clinically significant cancer is highly unlikely)\nScore 2: Low (clinically significant cancer is unlikely)\nScore 3: Intermediate (clinically significant cancer is equivocal)\nScore 4: High (clinically significant cancer is likely)\nScore 5: Very high (clinically significant cancer is highly likely)\n\nFor peripheral zone: DWI is the dominant parameter.\nFor transition zone: T2W is the dominant parameter.",
      classificationSystem: "PI-RADS",
      classificationGrades: ["Score 1", "Score 2", "Score 3", "Score 4", "Score 5"],
      measurementReferences: ["Lesion size > 1.5 cm in any plane = Score 4 or 5"],
      reportingTips: ["Always specify zone (peripheral vs transition)", "Include lesion size and location", "Recommend biopsy if score ≥4"],
      tags: ["prostate", "mri", "classification", "pi-rads", "cancer"],
    },
    {
      category: "Breast",
      title: "BI-RADS Classification",
      content: "BI-RADS (Breast Imaging Reporting and Data System) standardizes mammography and ultrasound reporting.\n\nCategory 0: Incomplete — needs additional imaging\nCategory 1: Negative\nCategory 2: Benign\nCategory 3: Probably benign — short-interval follow-up (6 months)\nCategory 4: Suspicious — biopsy should be considered (4A, 4B, 4C)\nCategory 5: Highly suggestive of malignancy — appropriate action should be taken\nCategory 6: Known biopsy-proven malignancy",
      classificationSystem: "BI-RADS",
      classificationGrades: ["Category 0", "Category 1", "Category 2", "Category 3", "Category 4", "Category 5", "Category 6"],
      measurementReferences: [],
      reportingTips: ["Always assign a BI-RADS category in the impression", "For Category 3: recommend 6-month follow-up", "For Category 4-5: recommend biopsy"],
      tags: ["breast", "mammography", "classification", "bi-rads", "cancer"],
    },
    {
      category: "Liver",
      title: "LI-RADS Classification",
      content: "LI-RADS (Liver Imaging Reporting and Data System) standardizes CT/MRI reporting for hepatocellular carcinoma (HCC) in at-risk patients.\n\nLR-1: Definitely benign\nLR-2: Probably benign\nLR-3: Intermediate probability for malignancy\nLR-4: Probably HCC\nLR-5: Definitely HCC\nLR-5V: Definitely HCC with tumor in vein\nLR-M: Probably or definitely malignant, not specific for HCC\nLR-TIV: Tumor in vein (undetermined, but suspicious)\n\nKey imaging features: arterial hyperenhancement, washout, capsule appearance, growth, size.",
      classificationSystem: "LI-RADS",
      classificationGrades: ["LR-1", "LR-2", "LR-3", "LR-4", "LR-5", "LR-5V", "LR-M", "LR-TIV"],
      measurementReferences: ["Observations < 1 cm: LR-3 or lower", "Observations ≥ 1 cm with major features: LR-4 or higher"],
      reportingTips: ["Only apply in at-risk patients (cirrhosis, chronic hepatitis B)", "Do not use in non-at-risk patients"],
      tags: ["liver", "hcc", "classification", "li-rads", "ct", "mri"],
    },
    {
      category: "Thyroid",
      title: "TI-RADS Classification",
      content: "TI-RADS (Thyroid Imaging Reporting and Data System) standardizes ultrasound reporting for thyroid nodules.\n\nTR1: Benign (no FNA needed)\nTR2: Not suspicious (no FNA needed)\nTR3: Low suspicion (FNA if > 2.5 cm, follow-up if > 1.5 cm)\nTR4: Moderate suspicion (FNA if > 1.5 cm, follow-up if > 1.0 cm)\nTR5: High suspicion (FNA if > 1.0 cm, follow-up if > 0.5 cm)\n\nFeatures assessed: composition, echogenicity, shape, margin, echogenic foci.",
      classificationSystem: "TI-RADS",
      classificationGrades: ["TR1", "TR2", "TR3", "TR4", "TR5"],
      measurementReferences: ["TR3: FNA > 2.5 cm", "TR4: FNA > 1.5 cm", "TR5: FNA > 1.0 cm"],
      reportingTips: ["Always mention size and TI-RADS category", "Recommend FNA based on size thresholds", "Include nodule location (right lobe, left lobe, isthmus)"],
      tags: ["thyroid", "usg", "classification", "ti-rads", "cancer"],
    },
    {
      category: "Spine",
      title: "Spine Grading Systems",
      content: "Common grading systems for spine imaging:\n\n1. Pfirrmann Grading (Disc Degeneration)\nGrade I: Homogeneous structure, hyperintense signal, normal height\nGrade II: Inhomogeneous structure, hyperintense signal, normal height\nGrade III: Inhomogeneous structure, intermediate signal, normal to slightly reduced height\nGrade IV: Inhomogeneous structure, hypointense signal, normal to moderately reduced height\nGrade V: Inhomogeneous structure, hypointense signal, collapsed disc space\n\n2. Meyerding Classification (Spondylolisthesis)\nGrade I: 0-25% slip\nGrade II: 25-50% slip\nGrade III: 50-75% slip\nGrade IV: 75-100% slip\nGrade V: >100% slip (spondyloptosis)",
      classificationSystem: "Pfirrmann / Meyerding",
      classificationGrades: ["Pfirrmann I-V", "Meyerding I-V"],
      measurementReferences: ["Pfirrmann: Assess signal intensity on T2W", "Meyerding: Measure slip percentage on lateral X-ray"],
      reportingTips: ["Always mention grade in the impression", "Meyerding: measure from posterior vertebral line"],
      tags: ["spine", "classification", "pfirrmann", "meyerding", "disc degeneration", "spondylolisthesis"],
    },
    {
      category: "Spine",
      title: "Cervical canal stenosis grading",
      content: "Cervical canal stenosis grading on MRI/CT.\n\nMild: AP diameter > 10 mm.\nModerate: AP diameter 7-10 mm.\nSevere: AP diameter < 7 mm.\n\nNormal AP diameter: 15-20 mm.\nPavlov ratio < 0.8 suggests stenosis.\n\nAlways report the AP diameter and the most stenotic level.",
      classificationSystem: "Canal Stenosis",
      classificationGrades: ["Mild > 10 mm", "Moderate 7-10 mm", "Severe < 7 mm"],
      measurementReferences: ["Normal AP diameter: 15-20 mm", "Pavlov ratio < 0.8 = stenosis"],
      reportingTips: ["Report AP diameter at each level", "Report the most stenotic level", "Mention cord signal if present"],
      tags: ["spine", "cervical", "stenosis", "canal", "mri", "ct"],
    },
    {
      category: "Spine",
      title: "Lumbar canal stenosis grading",
      content: "Lumbar canal stenosis grading on MRI/CT.\n\nMild: AP diameter > 12 mm.\nModerate: AP diameter 10-12 mm.\nSevere: AP diameter < 10 mm.\n\nNormal AP diameter: > 15 mm.\nLateral recess stenosis: < 3 mm.\nForaminal stenosis: obliteration of perineural fat.\n\nAlways report the AP diameter and neural foramina status.",
      classificationSystem: "Canal Stenosis",
      classificationGrades: ["Mild > 12 mm", "Moderate 10-12 mm", "Severe < 10 mm"],
      measurementReferences: ["Normal AP diameter: > 15 mm", "Lateral recess stenosis: < 3 mm"],
      reportingTips: ["Report AP diameter at each level", "Report foraminal and lateral recess status", "Mention conus and cauda equina"],
      tags: ["spine", "lumbar", "stenosis", "canal", "mri", "ct"],
    },
    {
      category: "Obstetric",
      title: "Obstetric biometry reference",
      content: "Obstetric biometry reference ranges for ultrasound reporting.\n\nCRL: 45-84 mm (11-14 weeks) for NT scan.\nBPD: 31 mm at 14 weeks, 92 mm at 40 weeks.\nHC: 110 mm at 14 weeks, 330 mm at 40 weeks.\nAC: 80 mm at 14 weeks, 350 mm at 40 weeks.\nFL: 15 mm at 14 weeks, 78 mm at 40 weeks.\nAFI: 8-18 cm (normal), < 5 cm (oligohydramnios), > 24 cm (polyhydramnios).\nPlacental thickness: 2-4 cm.",
      classificationSystem: "Biometry",
      classificationGrades: [],
      measurementReferences: ["CRL: 45-84 mm (11-14 weeks)", "BPD: 31 mm at 14 weeks, 92 mm at 40 weeks", "AFI: 8-18 cm normal"],
      reportingTips: ["Compare with gestational age", "Report all standard measurements", "Note any discordance"],
      tags: ["obstetric", "usg", "biometry", "reference"],
    },
    {
      category: "Prostate",
      title: "Prostate volume formula",
      content: "Prostate volume calculation and reporting.\n\nFormula: Volume = L x W x H x 0.52 (ellipsoid formula).\n\nNormal: < 20 cc.\nMild enlargement: 20-30 cc.\nModerate: 30-40 cc.\nSevere: > 40 cc.\n\nPost-void residual: < 50 ml normal.\nPSA density: PSA / volume.\n\nAlways report the calculated volume and post-void residual.",
      classificationSystem: "Volume",
      classificationGrades: ["Normal < 20 cc", "Mild 20-30 cc", "Moderate 30-40 cc", "Severe > 40 cc"],
      measurementReferences: ["Volume = L x W x H x 0.52", "Post-void residual: < 50 ml normal"],
      reportingTips: ["Report calculated volume", "Report post-void residual", "Note homogeneous vs heterogeneous"],
      tags: ["prostate", "usg", "volume", "formula"],
    },
    {
      category: "Abdomen",
      title: "GB calculus reporting phrases",
      content: "Gallbladder calculus reporting phrases.\n\nGB: Well distended / Contracted.\nCalculus: Single / Multiple echogenic foci with posterior acoustic shadowing.\nLargest: ___ mm.\nWall: Normal thickness (< 3 mm) / Thickened.\nPericholecystic fluid: Present / Absent.\nMurphy sign: Positive / Negative (clinical).\n\nImpression: Gallbladder calculus. / Cholelithiasis.",
      classificationSystem: "GB",
      classificationGrades: [],
      measurementReferences: ["Normal wall < 3 mm", "Largest calculus size"],
      reportingTips: ["Always report wall thickness", "Report largest calculus size", "Note pericholecystic fluid"],
      tags: ["gallbladder", "usg", "calculus", "reporting"],
    },
    {
      category: "Abdomen",
      title: "Fatty liver grading phrases",
      content: "Fatty liver (hepatic steatosis) grading on ultrasound.\n\nGrade 0: Normal echotexture.\nGrade 1: Mild diffuse increase in echotexture with slightly impaired intrahepatic vessel definition.\nGrade 2: Moderate diffuse increase in echotexture with impaired intrahepatic vessel definition and slightly increased attenuation.\nGrade 3: Marked diffuse increase in echotexture with poor visualization of intrahepatic vessels and marked attenuation.\n\nImpression: Grade I/II/III fatty liver.",
      classificationSystem: "Fatty Liver",
      classificationGrades: ["Grade 0 (Normal)", "Grade 1 (Mild)", "Grade 2 (Moderate)", "Grade 3 (Severe)"],
      measurementReferences: [],
      reportingTips: ["Always grade the fatty liver", "Compare with spleen echotexture", "Note if focal fatty sparing"],
      tags: ["liver", "usg", "fatty liver", "steatosis", "grading"],
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const a of seedArticles) {
    const existing = await db
      .select()
      .from(radiologyKnowledgeBaseTable)
      .where(and(
        eq(radiologyKnowledgeBaseTable.category, a.category),
        eq(radiologyKnowledgeBaseTable.title, a.title)
      ));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(radiologyKnowledgeBaseTable).values(a);
    created++;
  }

  res.json({ created, skipped, total: seedArticles.length });
});

export default radiologyKnowledgeRouter;
