// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog API (Tickets B1 + B2) — FOUNDATION ONLY.
//
// Mounted at /api/radiology/catalog behind requireStaffAuth +
// requireStaffPermission("/radiology"). The whole router is additionally gated
// by requireRadiologyCatalogFlag (ff_radiology_catalog, default OFF) so it is
// invisible (404) until explicitly enabled. Reads: any radiology staff.
// Mutations: admin/super_admin only. This router renders no reports and does
// not touch legacy Quick Select.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { requireRadiologyCatalogFlag } from "../lib/radiologyCatalog/featureFlag";
import { CatalogService, type Actor } from "../lib/radiologyCatalog/service";
import { DrizzleCatalogStore } from "../lib/radiologyCatalog/drizzleStore";
import { CatalogValidationError } from "../lib/radiologyCatalog/validation";
import type { CatalogTableName } from "../lib/radiologyCatalog/store";

const router = Router();
router.use(requireRadiologyCatalogFlag);

const service = new CatalogService(new DrizzleCatalogStore());

// ── helpers ──────────────────────────────────────────────────────────────────

function actorOf(req: Request): Actor {
  return { username: (req as StaffAuthRequest).staffSession?.subjectName };
}

/** Run a service call and translate CatalogValidationError → HTTP status. */
async function run(res: Response, fn: () => Promise<unknown>, okStatus = 200): Promise<void> {
  try {
    const result = await fn();
    res.status(okStatus).json(result);
  } catch (err) {
    if (err instanceof CatalogValidationError) {
      res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
      return;
    }
    throw err; // unexpected → bubble to the global error handler
  }
}

function parseId(raw: string | string[]): number {
  // Route params are strings at runtime; normalize the string[] the Express
  // types admit (repeated segments) to its first element before parsing.
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new CatalogValidationError("INVALID_FIELD", `Invalid id "${value}"`, "id");
  return id;
}

function body<T>(req: Request, res: Response, schema: z.ZodType<T>): T | undefined {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return undefined;
  }
  return parsed.data;
}

const statusEnum = z.enum(["draft", "active", "deprecated"]);

// ── Parameter groups ─────────────────────────────────────────────────────────

const CreateGroup = z.object({
  key: z.string(), label: z.string(), description: z.string().optional(),
  dataType: z.enum(["option", "numeric", "text", "boolean"]).optional(),
  unit: z.string().optional(), allowMultiple: z.boolean().optional(), status: statusEnum.optional(),
});
const UpdateGroup = z.object({
  label: z.string().optional(), description: z.string().optional(), unit: z.string().optional(),
  allowMultiple: z.boolean().optional(), status: statusEnum.optional(), expectedVersion: z.number().int().optional(),
});

router.get("/parameter-groups", (req, res) => run(res, async () => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  return q ? service.searchGroups(q, limit) : service.listGroups({ limit });
}));
router.post("/parameter-groups", requireAdminRole, (req, res) => {
  const data = body(req, res, CreateGroup); if (!data) return;
  return run(res, () => service.createParameterGroup(data, actorOf(req)), 201);
});
router.get("/parameter-groups/:id", (req, res) => run(res, async () => {
  const id = parseId(req.params.id);
  const group = await service.getGroup(id);
  if (!group) throw new CatalogValidationError("NOT_FOUND", `Parameter group #${id} not found`);
  return { ...group, options: await service.listParameterOptions(id) };
}));
router.patch("/parameter-groups/:id", requireAdminRole, (req, res) => {
  const data = body(req, res, UpdateGroup); if (!data) return;
  return run(res, () => service.updateParameterGroup(parseId(req.params.id), data, actorOf(req)));
});
router.delete("/parameter-groups/:id", requireAdminRole, (req, res) =>
  run(res, () => service.deleteParameterGroup(parseId(req.params.id))));

// ── Parameter options ────────────────────────────────────────────────────────

const CreateOption = z.object({
  groupId: z.number().int(), key: z.string(), label: z.string(), sortOrder: z.number().int().optional(),
  codeSystem: z.string().optional(), codeValue: z.string().optional(), status: statusEnum.optional(),
});
const UpdateOption = z.object({
  label: z.string().optional(), sortOrder: z.number().int().optional(), codeSystem: z.string().optional(),
  codeValue: z.string().optional(), status: statusEnum.optional(), expectedVersion: z.number().int().optional(),
});

router.get("/parameter-groups/:id/options", (req, res) =>
  run(res, () => service.listParameterOptions(parseId(req.params.id))));
router.post("/parameter-options", requireAdminRole, (req, res) => {
  const data = body(req, res, CreateOption); if (!data) return;
  return run(res, () => service.createParameterOption(data, actorOf(req)), 201);
});
router.patch("/parameter-options/:id", requireAdminRole, (req, res) => {
  const data = body(req, res, UpdateOption); if (!data) return;
  return run(res, () => service.updateParameterOption(parseId(req.params.id), data, actorOf(req)));
});
router.delete("/parameter-options/:id", requireAdminRole, (req, res) =>
  run(res, () => service.deleteParameterOption(parseId(req.params.id))));

// ── Finding categories ───────────────────────────────────────────────────────

const CreateCategory = z.object({
  key: z.string(), label: z.string(), parentId: z.number().int().nullable().optional(),
  modality: z.string().optional(), sortOrder: z.number().int().optional(), status: statusEnum.optional(),
});
const UpdateCategory = z.object({
  label: z.string().optional(), parentId: z.number().int().nullable().optional(), modality: z.string().optional(),
  sortOrder: z.number().int().optional(), status: statusEnum.optional(), expectedVersion: z.number().int().optional(),
});

router.get("/finding-categories", (req, res) => run(res, async () => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  return q ? service.searchCategories(q) : service.listCategories({ limit: 1000 });
}));
router.post("/finding-categories", requireAdminRole, (req, res) => {
  const data = body(req, res, CreateCategory); if (!data) return;
  return run(res, () => service.createFindingCategory(data, actorOf(req)), 201);
});
router.get("/finding-categories/:id", (req, res) => run(res, async () => {
  const id = parseId(req.params.id);
  const cat = await service.getCategory(id);
  if (!cat) throw new CatalogValidationError("NOT_FOUND", `Finding category #${id} not found`);
  return cat;
}));
router.patch("/finding-categories/:id", requireAdminRole, (req, res) => {
  const data = body(req, res, UpdateCategory); if (!data) return;
  return run(res, () => service.updateFindingCategory(parseId(req.params.id), data, actorOf(req)));
});
router.delete("/finding-categories/:id", requireAdminRole, (req, res) =>
  run(res, () => service.deleteFindingCategory(parseId(req.params.id))));

// ── Findings ─────────────────────────────────────────────────────────────────

const CreateFinding = z.object({
  key: z.string(), categoryId: z.number().int(), label: z.string(), description: z.string().optional(),
  narrative: z.string().optional(), impression: z.string().optional(),
  codeSystem: z.string().optional(), codeValue: z.string().optional(), status: statusEnum.optional(),
});
const UpdateFinding = z.object({
  label: z.string().optional(), description: z.string().optional(), narrative: z.string().optional(),
  impression: z.string().optional(), categoryId: z.number().int().optional(), codeSystem: z.string().optional(),
  codeValue: z.string().optional(), status: statusEnum.optional(), expectedVersion: z.number().int().optional(),
});

router.get("/findings", (req, res) => run(res, async () => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  return q ? service.searchFindings(q, limit) : service.listFindings({ limit });
}));
router.post("/findings", requireAdminRole, (req, res) => {
  const data = body(req, res, CreateFinding); if (!data) return;
  return run(res, () => service.createFinding(data, actorOf(req)), 201);
});
router.get("/findings/:id", (req, res) =>
  run(res, () => service.getFindingGraph(parseId(req.params.id))));
router.patch("/findings/:id", requireAdminRole, (req, res) => {
  const data = body(req, res, UpdateFinding); if (!data) return;
  return run(res, () => service.updateFinding(parseId(req.params.id), data, actorOf(req)));
});
router.delete("/findings/:id", requireAdminRole, (req, res) =>
  run(res, () => service.deleteFinding(parseId(req.params.id))));

// ── Finding edges (mutations admin-only) ─────────────────────────────────────

router.post("/findings/:id/parameters", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ parameterGroupId: z.number().int(), required: z.boolean().optional(), defaultOptionId: z.number().int().optional(), sortOrder: z.number().int().optional() })); if (!data) return;
  return run(res, () => service.addParameterBinding({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/synonyms", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ synonym: z.string() })); if (!data) return;
  return run(res, () => service.addSynonym({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/aliases", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ aliasKey: z.string(), source: z.string().optional() })); if (!data) return;
  return run(res, () => service.addAlias({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/locations", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ key: z.string(), label: z.string(), laterality: z.string().optional(), sortOrder: z.number().int().optional() })); if (!data) return;
  return run(res, () => service.addLocation({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/recommendations", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ recommendationText: z.string(), priority: z.string().optional(), sortOrder: z.number().int().optional() })); if (!data) return;
  return run(res, () => service.addRecommendation({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/severities", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ key: z.string(), label: z.string(), rank: z.number().int().optional(), sortOrder: z.number().int().optional() })); if (!data) return;
  return run(res, () => service.addSeverity({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});
router.post("/findings/:id/measurements", requireAdminRole, (req, res) => {
  const data = body(req, res, z.object({ key: z.string(), label: z.string(), unit: z.string().optional(), valueType: z.string().optional(), minValue: z.number().optional(), maxValue: z.number().optional(), sortOrder: z.number().int().optional() })); if (!data) return;
  return run(res, () => service.addMeasurement({ findingId: parseId(req.params.id), ...data }, actorOf(req)), 201);
});

const EDGE_TABLES = new Set<CatalogTableName>([
  "finding_parameter_bindings", "finding_synonyms", "finding_aliases", "finding_locations",
  "finding_recommendations", "finding_severity_bindings", "finding_measurement_bindings",
]);
router.delete("/edges/:table/:id", requireAdminRole, (req, res) => {
  const table = req.params.table as CatalogTableName;
  if (!EDGE_TABLES.has(table)) {
    res.status(400).json({ error: `Not an edge table: ${table}` });
    return;
  }
  return run(res, () => service.removeEdge(table, parseId(req.params.id)));
});

// ── Search & lookup ──────────────────────────────────────────────────────────

router.get("/search/findings", (req, res) => run(res, async () => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  return service.searchFindings(q, limit);
}));
router.get("/lookup/alias/:aliasKey", (req, res) => run(res, async () => {
  const finding = await service.lookupByAlias(req.params.aliasKey);
  if (!finding) throw new CatalogValidationError("NOT_FOUND", `No finding for alias "${req.params.aliasKey}"`);
  return finding;
}));

export default router;
