/**
 * radiologyKnowledgePacks.ts — CARE Knowledge Pack Engine
 * Mounted at: /api/radiology/knowledge-packs (staff-auth; mutations admin-only)
 *
 *   GET    /                     — list installed packs (registry)
 *   GET    /stats                — coverage/health summary (dashboard)
 *   GET    /:packId              — assembled pack: registry + LIVE coverage +
 *                                  validation + content samples (the loader)
 *   GET    /:packId/validate     — validation only
 *   GET    /:packId/export       — export the pack manifest (JSON)
 *   POST   /                     — create a pack        (admin)
 *   POST   /import               — import a pack manifest (admin; guards system packs)
 *   PATCH  /:id                  — update / enable / disable / version (admin)
 *   DELETE /:id                  — delete               (admin; blocked for system packs)
 *
 * A pack is a MANIFEST over existing per-study-type content — the loader
 * assembles the pack live from the tables the Reporting Workspace already reads
 * (quick findings / protocols / history / measurements / impression rules /
 * structured templates / teaching / knowledge). No content is copied. Purely
 * additive; MRI/USG behaviour is unchanged.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  knowledgePacksTable,
  radiologyQuickFindingsTable,
  radiologyProtocolsTable,
  radiologyClinicalHistoryChipsTable,
  radiologyQuickMeasurementsTable,
  radiologyImpressionRulesTable,
  structuredReportTemplatesTable,
  teachingCasesTable,
  radiologyKnowledgeBaseTable,
  type KnowledgePack,
} from "@workspace/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { USG_TEMPLATES } from "../lib/usgReportTemplates";
import {
  parseManifest, validatePack, emptyCoverage, coveredSectionCount,
  type PackCoverage, type PackManifest,
} from "../lib/knowledgePackManifest";

const router = Router();

type ReqWithStaff = Request & { staffSession?: { subjectName?: string; role?: string } };
const FULL_ACCESS_ROLES = new Set(["admin", "super_admin", "owner"]);
function isAdmin(req: Request): boolean {
  const role = (req as ReqWithStaff).staffSession?.role ?? "";
  return FULL_ACCESS_ROLES.has(role.toLowerCase());
}
function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin role required" }); return false; }
  return true;
}

async function count(table: Parameters<typeof db.select>[0] extends never ? never : any, where: unknown): Promise<number> {
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where as never);
    return Number(row?.n ?? 0);
  } catch (err) {
    logger.warn({ err }, "knowledge-pack coverage count failed");
    return 0;
  }
}

function usgTemplateExists(pack: KnowledgePack): boolean {
  const id = (pack.bodyPart ?? "").toUpperCase();
  return USG_TEMPLATES.some((t) => t.id === id);
}

/** Assemble a pack's LIVE coverage from the existing per-study-type tables. */
async function packCoverage(pack: KnowledgePack): Promise<PackCoverage> {
  const cov = emptyCoverage();
  const studyType = pack.studyType;
  if (studyType) {
    cov.quickFindings = await count(radiologyQuickFindingsTable, and(eq(radiologyQuickFindingsTable.studyType, studyType), eq(radiologyQuickFindingsTable.isActive, true)));
    cov.structuredFindings = await count(radiologyQuickFindingsTable, and(eq(radiologyQuickFindingsTable.studyType, studyType), eq(radiologyQuickFindingsTable.isActive, true), sql`${radiologyQuickFindingsTable.questionsJson} NOT IN ('[]', '', '{}')`));
    cov.protocols = await count(radiologyProtocolsTable, and(eq(radiologyProtocolsTable.studyType, studyType), eq(radiologyProtocolsTable.isActive, true)));
    cov.clinicalHistory = await count(radiologyClinicalHistoryChipsTable, and(eq(radiologyClinicalHistoryChipsTable.studyType, studyType), eq(radiologyClinicalHistoryChipsTable.isActive, true)));
    cov.quickMeasurements = await count(radiologyQuickMeasurementsTable, and(eq(radiologyQuickMeasurementsTable.studyType, studyType), eq(radiologyQuickMeasurementsTable.isActive, true)));
    cov.requiredMeasurements = await count(radiologyProtocolsTable, and(eq(radiologyProtocolsTable.studyType, studyType), eq(radiologyProtocolsTable.isActive, true), sql`length(trim(${radiologyProtocolsTable.requiredMeasurements})) > 0`));
    cov.checklistProtocols = await count(radiologyProtocolsTable, and(eq(radiologyProtocolsTable.studyType, studyType), eq(radiologyProtocolsTable.isActive, true), sql`${radiologyProtocolsTable.checklistJson} NOT IN ('[]', '', '{}')`));
  }
  if (pack.builderType) {
    cov.impressionRules = await count(radiologyImpressionRulesTable, and(eq(radiologyImpressionRulesTable.builderType, pack.builderType), eq(radiologyImpressionRulesTable.isActive, true)));
  }
  cov.structuredTemplates = await count(structuredReportTemplatesTable,
    pack.bodyPart
      ? and(eq(structuredReportTemplatesTable.modality, pack.modality), eq(structuredReportTemplatesTable.bodyPart, pack.bodyPart), eq(structuredReportTemplatesTable.isActive, true))
      : and(eq(structuredReportTemplatesTable.modality, pack.modality), eq(structuredReportTemplatesTable.isActive, true)));
  const cat = pack.knowledgeCategory;
  if (cat) {
    cov.teachingCases = await count(teachingCasesTable, eq(teachingCasesTable.category, cat));
    cov.knowledgeArticles = await count(radiologyKnowledgeBaseTable, and(eq(radiologyKnowledgeBaseTable.category, cat), eq(radiologyKnowledgeBaseTable.isActive, true)));
  }
  cov.hasTemplate = pack.modality.toUpperCase() === "USG" ? usgTemplateExists(pack) : cov.structuredTemplates > 0;
  return cov;
}

/** Small content samples for the pack Preview. */
async function packSamples(pack: KnowledgePack) {
  const out: Record<string, string[]> = { quickFindings: [], protocols: [], clinicalHistory: [], impressionRules: [], teaching: [], knowledge: [] };
  try {
    if (pack.studyType) {
      out.quickFindings = (await db.select({ v: radiologyQuickFindingsTable.label }).from(radiologyQuickFindingsTable)
        .where(and(eq(radiologyQuickFindingsTable.studyType, pack.studyType), eq(radiologyQuickFindingsTable.isActive, true)))
        .orderBy(asc(radiologyQuickFindingsTable.sortOrder)).limit(12)).map((r) => r.v);
      out.protocols = (await db.select({ v: radiologyProtocolsTable.name }).from(radiologyProtocolsTable)
        .where(and(eq(radiologyProtocolsTable.studyType, pack.studyType), eq(radiologyProtocolsTable.isActive, true))).limit(8)).map((r) => r.v);
      out.clinicalHistory = (await db.select({ v: radiologyClinicalHistoryChipsTable.displayLabel }).from(radiologyClinicalHistoryChipsTable)
        .where(and(eq(radiologyClinicalHistoryChipsTable.studyType, pack.studyType), eq(radiologyClinicalHistoryChipsTable.isActive, true))).limit(10)).map((r) => r.v);
    }
    if (pack.builderType) {
      out.impressionRules = (await db.select({ v: radiologyImpressionRulesTable.ruleName }).from(radiologyImpressionRulesTable)
        .where(and(eq(radiologyImpressionRulesTable.builderType, pack.builderType), eq(radiologyImpressionRulesTable.isActive, true))).limit(8)).map((r) => r.v);
    }
    if (pack.knowledgeCategory) {
      out.teaching = (await db.select({ v: teachingCasesTable.title }).from(teachingCasesTable)
        .where(eq(teachingCasesTable.category, pack.knowledgeCategory)).limit(6)).map((r) => r.v);
      out.knowledge = (await db.select({ v: radiologyKnowledgeBaseTable.title }).from(radiologyKnowledgeBaseTable)
        .where(and(eq(radiologyKnowledgeBaseTable.category, pack.knowledgeCategory), eq(radiologyKnowledgeBaseTable.isActive, true))).limit(6)).map((r) => r.v);
    }
  } catch (err) {
    logger.warn({ err, packId: pack.packId }, "knowledge-pack sample query failed");
  }
  return out;
}

function toValidationInput(pack: KnowledgePack, manifest: PackManifest) {
  return {
    packId: pack.packId, status: pack.status, modality: pack.modality,
    dependsOn: safeArr(pack.dependsOnJson), manifest,
  };
}
function safeArr(json: string | null | undefined): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

// ── GET / — list registry ─────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  try {
    const packs = await db.select().from(knowledgePacksTable)
      .orderBy(asc(knowledgePacksTable.modality), asc(knowledgePacksTable.name));
    res.json({ packs });
  } catch (err) {
    logger.warn({ err }, "knowledge-packs list failed (table may be pre-migration)");
    res.json({ packs: [] });
  }
});

// ── GET /stats — dashboard coverage/health ────────────────────────────────────
router.get("/stats", async (_req, res) => {
  try {
    const packs = await db.select().from(knowledgePacksTable);
    const known = new Set(packs.map((p) => p.packId));
    const byModality: Record<string, number> = {};
    const readinessByModality: Record<string, { sum: number; count: number }> = {};
    let enabled = 0, placeholder = 0, planned = 0, disabled = 0, healthy = 0, warnCount = 0, broken = 0;
    let readinessSum = 0, readinessCount = 0;
    // Health only needs coverage for enabled packs — keep it bounded.
    for (const p of packs) {
      byModality[p.modality] = (byModality[p.modality] ?? 0) + 1;
      if (p.status === "enabled") enabled++;
      else if (p.status === "placeholder") { placeholder++; continue; }
      else if (p.status === "planned") { planned++; continue; }
      else if (p.status === "disabled") { disabled++; continue; }
      const cov = await packCoverage(p);
      const v = validatePack(toValidationInput(p, parseManifest(p.manifestJson)), cov, known);
      if (v.health === "ok") healthy++;
      else if (v.health === "warn") warnCount++;
      else if (v.health === "error") broken++;
      readinessSum += v.readinessPercent; readinessCount++;
      const rm = (readinessByModality[p.modality] ??= { sum: 0, count: 0 });
      rm.sum += v.readinessPercent; rm.count++;
    }
    const modalityReadiness: Record<string, number> = {};
    for (const [m, r] of Object.entries(readinessByModality)) modalityReadiness[m] = r.count ? Math.round(r.sum / r.count) : 0;
    res.json({
      total: packs.length, enabled, placeholder, planned, disabled,
      healthy, warnings: warnCount, broken, byModality,
      goldStandardCompletion: readinessCount ? Math.round(readinessSum / readinessCount) : 0,
      modalityReadiness,
    });
  } catch (err) {
    logger.warn({ err }, "knowledge-packs stats failed");
    res.json({ total: 0, enabled: 0, placeholder: 0, planned: 0, disabled: 0, healthy: 0, warnings: 0, broken: 0, byModality: {}, goldStandardCompletion: 0, modalityReadiness: {} });
  }
});

// ── GET /coverage — per-pack clinical-content coverage rows ──────────────────
// The Clinical Content Coverage Dashboard / Content Validator feed. This is
// EXACTLY the loop /stats already runs (packCoverage + validatePack per pack),
// returned per-pack instead of summed — a thin aggregation over the existing
// helpers, not a new engine. Read-only; never affects runtime reporting.
router.get("/coverage", async (_req, res) => {
  try {
    const packs = await db.select().from(knowledgePacksTable);
    const known = new Set(packs.map((p) => p.packId));
    const rows = [];
    for (const p of packs) {
      const manifest = parseManifest(p.manifestJson);
      const coverage = await packCoverage(p);
      const validation = validatePack(toValidationInput(p, manifest), coverage, known);
      rows.push({
        packId: p.packId, modality: p.modality, name: p.name, status: p.status,
        studyType: p.studyType, category: p.category, bodyPart: p.bodyPart,
        knowledgeCategory: p.knowledgeCategory, version: p.version, isSystem: p.isSystem,
        sections: validation.sections, issues: validation.issues,
        readinessPercent: validation.readinessPercent, health: validation.health,
        coverage,
        manifestCounts: {
          companionRules: manifest.companionRules.length,
          comparisonMeasurements: manifest.comparisonMeasurements.length,
          criticalFindings: manifest.criticalFindings.length,
          recommendations: manifest.recommendations.length,
          references: manifest.references.length,
        },
      });
    }
    res.json({ rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    logger.warn({ err }, "knowledge-packs coverage failed");
    res.json({ rows: [], generatedAt: new Date().toISOString() });
  }
});

// ── GET /:packId — assembled pack (loader) ────────────────────────────────────
router.get("/:packId", async (req, res) => {
  const [pack] = await db.select().from(knowledgePacksTable).where(eq(knowledgePacksTable.packId, req.params.packId)).limit(1);
  if (!pack) { res.status(404).json({ error: "Pack not found" }); return; }
  const manifest = parseManifest(pack.manifestJson);
  const coverage = await packCoverage(pack);
  const known = new Set((await db.select({ id: knowledgePacksTable.packId }).from(knowledgePacksTable)).map((r) => r.id));
  const validation = validatePack(toValidationInput(pack, manifest), coverage, known);
  const samples = await packSamples(pack);
  res.json({ pack, manifest, coverage, validation, samples });
});

// ── GET /:packId/validate ─────────────────────────────────────────────────────
router.get("/:packId/validate", async (req, res) => {
  const [pack] = await db.select().from(knowledgePacksTable).where(eq(knowledgePacksTable.packId, req.params.packId)).limit(1);
  if (!pack) { res.status(404).json({ error: "Pack not found" }); return; }
  const coverage = await packCoverage(pack);
  const known = new Set((await db.select({ id: knowledgePacksTable.packId }).from(knowledgePacksTable)).map((r) => r.id));
  res.json(validatePack(toValidationInput(pack, parseManifest(pack.manifestJson)), coverage, known));
});

// ── GET /:packId/export ───────────────────────────────────────────────────────
router.get("/:packId/export", async (req, res) => {
  const [pack] = await db.select().from(knowledgePacksTable).where(eq(knowledgePacksTable.packId, req.params.packId)).limit(1);
  if (!pack) { res.status(404).json({ error: "Pack not found" }); return; }
  res.json({
    packId: pack.packId, modality: pack.modality, name: pack.name, description: pack.description,
    category: pack.category, studyType: pack.studyType, builderType: pack.builderType,
    bodyPart: pack.bodyPart, knowledgeCategory: pack.knowledgeCategory, version: pack.version,
    author: pack.author, status: pack.status, dependsOn: safeArr(pack.dependsOnJson),
    manifest: parseManifest(pack.manifestJson), exportedAt: new Date().toISOString(),
  });
});

// ── POST / — create (admin) ───────────────────────────────────────────────────
function packValuesFromBody(b: Record<string, unknown>) {
  const s = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
  const sn = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    packId: s(b.packId),
    modality: s(b.modality, "OT"),
    name: s(b.name, s(b.packId)),
    description: s(b.description),
    category: s(b.category),
    studyType: sn(b.studyType),
    builderType: sn(b.builderType),
    bodyPart: sn(b.bodyPart),
    knowledgeCategory: sn(b.knowledgeCategory),
    version: s(b.version, "1.0.0"),
    author: s(b.author, "CARE Radiology"),
    status: s(b.status, "enabled"),
    dependsOnJson: JSON.stringify(Array.isArray(b.dependsOn) ? b.dependsOn.map(String) : []),
    manifestJson: JSON.stringify(b.manifest && typeof b.manifest === "object" ? b.manifest : {}),
  };
}

router.post("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const values = packValuesFromBody((req.body ?? {}) as Record<string, unknown>);
  if (!values.packId) { res.status(400).json({ error: "packId required" }); return; }
  try {
    const [row] = await db.insert(knowledgePacksTable).values(values).returning();
    res.json({ ok: true, pack: row });
  } catch (err) {
    logger.warn({ err }, "knowledge-pack create failed");
    res.status(409).json({ error: "Pack id already exists or invalid" });
  }
});

// ── POST /import — import manifest (admin; never overwrites system packs) ──────
router.post("/import", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const force = b.force === true;
  const values = packValuesFromBody(b);
  if (!values.packId) { res.status(400).json({ error: "packId required" }); return; }
  const [existing] = await db.select().from(knowledgePacksTable).where(eq(knowledgePacksTable.packId, values.packId)).limit(1);
  if (existing) {
    if (existing.isSystem && !force) {
      res.status(409).json({ error: "Refusing to overwrite a system pack without force", isSystem: true });
      return;
    }
    // Never flip a pack's system flag via import.
    await db.update(knowledgePacksTable).set(values).where(eq(knowledgePacksTable.id, existing.id));
    res.json({ ok: true, updated: true, packId: values.packId });
  } else {
    const [row] = await db.insert(knowledgePacksTable).values(values).returning();
    res.json({ ok: true, updated: false, pack: row });
  }
});

// ── PATCH /:id — update / enable / disable (admin) ────────────────────────────
router.patch("/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof b.status === "string") patch.status = b.status;
  if (typeof b.version === "string") patch.version = b.version;
  if (typeof b.name === "string") patch.name = b.name;
  if (typeof b.description === "string") patch.description = b.description;
  if (typeof b.author === "string") patch.author = b.author;
  if (b.manifest && typeof b.manifest === "object") patch.manifestJson = JSON.stringify(b.manifest);
  if (Array.isArray(b.dependsOn)) patch.dependsOnJson = JSON.stringify(b.dependsOn.map(String));
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No updatable fields" }); return; }
  await db.update(knowledgePacksTable).set(patch).where(eq(knowledgePacksTable.id, id));
  res.json({ ok: true });
});

// ── DELETE /:id — delete (admin; blocked for system packs) ────────────────────
router.delete("/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  const [pack] = await db.select().from(knowledgePacksTable).where(eq(knowledgePacksTable.id, id)).limit(1);
  if (!pack) { res.status(404).json({ error: "Pack not found" }); return; }
  if (pack.isSystem) { res.status(409).json({ error: "System packs cannot be deleted — disable it instead" }); return; }
  await db.delete(knowledgePacksTable).where(eq(knowledgePacksTable.id, id));
  res.json({ ok: true });
});

export const radiologyKnowledgePacksRouter = router;
export default router;
