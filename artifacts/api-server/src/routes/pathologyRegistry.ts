// pathologyRegistry.ts — the Pathology Registry Manager API.
//
// A read-only admin console over the Universal Pathology Analyte & Panel
// Registry (@workspace/pathology — registry-as-code, same maintenance model as
// the measurement registry and the quality-rule catalog). Exposes the catalog,
// a live self-validation report, a pure flag-preview endpoint the result-entry
// grid can call, and a coverage scan that resolves the free-text parameter
// names in existing pathology reports against the registry — so a lab can see
// exactly which historical result labels are already canonical and which still
// need an alias, before any data migration.
//
// Mounted admin-only (requireStaffAuth + requireAdminRole) in routes/index.ts,
// exactly like the measurement-registry console.

import { Router, type IRouter } from "express";
import { db, patientReportsTable } from "@workspace/db";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import {
  DEFAULT_PATHOLOGY_REGISTRY as REG,
  PATHOLOGY_CATALOG_VERSION,
  resolveAnalyte,
  flagValue,
  resolveReferenceInterval,
  parseLegacyParameters,
  type PatientContext,
} from "@workspace/pathology";

export const pathologyRegistryRouter: IRouter = Router();

/** How many recent pathology reports the coverage scan inspects (bounded). */
const COVERAGE_SCAN_LIMIT = 3000;

// GET /api/pathology-registry — full catalog + validation health.
pathologyRegistryRouter.get("/", (_req, res) => {
  const issues = REG.validationIssues();
  res.json({
    catalogVersion: PATHOLOGY_CATALOG_VERSION,
    healthy: issues.length === 0,
    analyteCount: REG.listAnalytes().length,
    panelCount: REG.listPanels().length,
    analytes: REG.listAnalytes(),
    panels: REG.listPanels().map((p) => ({
      ...p,
      resolvedAnalytes: REG.panelAnalytes(p.id).map((a) => ({ id: a.id, displayName: a.displayName, defaultUnit: a.defaultUnit })),
    })),
  });
});

// GET /api/pathology-registry/validation — live self-validation report.
pathologyRegistryRouter.get("/validation", (_req, res) => {
  const started = Date.now();
  const issues = REG.validationIssues();
  res.json({
    catalogVersion: PATHOLOGY_CATALOG_VERSION,
    healthy: issues.length === 0,
    issues,
    analyteCount: REG.listAnalytes().length,
    panelCount: REG.listPanels().length,
    checkedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  });
});

// GET /api/pathology-registry/analytes/:id — one analyte definition.
pathologyRegistryRouter.get("/analytes/:id", (req, res) => {
  const hit = resolveAnalyte(String(req.params.id));
  if (!hit) {
    res.status(404).json({ error: "unknown analyte" });
    return;
  }
  res.json({ matchedBy: hit.matchedBy, analyte: hit.definition });
});

// GET /api/pathology-registry/panels/:id — one panel with its component analytes.
pathologyRegistryRouter.get("/panels/:id", (req, res) => {
  const hit = REG.resolvePanel(String(req.params.id));
  if (!hit) {
    res.status(404).json({ error: "unknown panel" });
    return;
  }
  res.json({ matchedBy: hit.matchedBy, panel: hit.definition, analytes: REG.panelAnalytes(hit.definition.id) });
});

// POST /api/pathology-registry/flag — preview the flag + reference range for a
// value in a patient context. Pure computation; no DB read/write. The
// result-entry grid uses this so the flag it shows matches the platform.
// Body: { analyte, value, unit?, sex?, ageYears?, condition? }
pathologyRegistryRouter.post("/flag", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const analyteInput = String(body.analyte ?? body.name ?? "").trim();
  const hit = analyteInput ? resolveAnalyte(analyteInput) : undefined;
  if (!hit) {
    res.status(404).json({ error: `unknown analyte "${analyteInput}"` });
    return;
  }
  const ctx: PatientContext = {
    sex: typeof body.sex === "string" ? body.sex : undefined,
    ageYears: typeof body.ageYears === "number" ? body.ageYears : Number.isFinite(Number(body.ageYears)) ? Number(body.ageYears) : undefined,
    condition: typeof body.condition === "string" ? body.condition : undefined,
  };
  const unit = typeof body.unit === "string" && body.unit ? body.unit : undefined;
  const result = flagValue(hit.definition, body.value, ctx, unit);
  const range = resolveReferenceInterval(hit.definition, ctx);
  res.json({ analyteId: hit.definition.id, displayName: hit.definition.displayName, result, referenceRange: range });
});

// GET /api/pathology-registry/coverage — resolve the free-text parameter names
// used in existing pathology reports against the registry. Answers "how much of
// our historical result vocabulary is already canonical?" and surfaces the
// unresolved labels that need an alias, WITHOUT reading any patient values.
pathologyRegistryRouter.get("/coverage", async (_req, res) => {
  const started = Date.now();
  const rows = await db
    .select({ parameters: patientReportsTable.parameters })
    .from(patientReportsTable)
    .where(and(eq(patientReportsTable.type, "pathology"), isNotNull(patientReportsTable.parameters)))
    .orderBy(desc(patientReportsTable.id))
    .limit(COVERAGE_SCAN_LIMIT);

  // Count distinct parameter labels and whether each resolves. Only the NAME
  // field is inspected — never a patient's value.
  const labelCounts = new Map<string, number>();
  for (const row of rows) {
    for (const p of parseLegacyParameters(row.parameters)) {
      const name = String(p.name ?? p.parameter ?? p.test ?? p.label ?? "").trim();
      if (name) labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
    }
  }

  const resolved: Array<{ label: string; analyteId: string; occurrences: number }> = [];
  const unresolved: Array<{ label: string; occurrences: number }> = [];
  for (const [label, occurrences] of labelCounts) {
    const hit = resolveAnalyte(label);
    if (hit) resolved.push({ label, analyteId: hit.definition.id, occurrences });
    else unresolved.push({ label, occurrences });
  }
  resolved.sort((a, b) => b.occurrences - a.occurrences);
  unresolved.sort((a, b) => b.occurrences - a.occurrences);

  const distinct = labelCounts.size;
  res.json({
    catalogVersion: PATHOLOGY_CATALOG_VERSION,
    reportsScanned: rows.length,
    scanLimit: COVERAGE_SCAN_LIMIT,
    distinctLabels: distinct,
    resolvedLabels: resolved.length,
    unresolvedLabels: unresolved.length,
    coveragePct: distinct === 0 ? null : Math.round((resolved.length / distinct) * 1000) / 10,
    topUnresolved: unresolved.slice(0, 50),
    resolvedSample: resolved.slice(0, 50),
    checkedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  });
});
