// measurementRegistry.ts — the Measurement Registry Manager API (Steps 12-13).
//
// NOT another engine: a read-only admin console over the Universal Measurement
// Registry (@workspace/measurements — registry-as-code, same maintenance model
// as the quality-rule catalog) enriched with LIVE impact analysis: for every
// measurement, who uses it today — quick measurements, protocol requirements,
// knowledge-pack manifests, Phase-4 quality rules, companion checklists, and
// stored measurement rows. Also surfaces what does NOT resolve (orphan labels)
// so a rename/deprecation can be impact-checked before it breaks anything.
//
// Mounted admin-only (requireStaffAuth + requireAdminRole) in routes/index.ts,
// exactly like the request-diagnostics dashboard.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  radiologyQuickMeasurementsTable,
  radiologyProtocolsTable,
  knowledgePacksTable,
  radiologyMeasurementsTable,
  viewerMeasurementsTable,
} from "@workspace/db/schema";
import { sql, isNotNull } from "drizzle-orm";
import {
  DEFAULT_MEASUREMENT_REGISTRY,
  MEASUREMENT_CATALOG_VERSION,
  resolveMeasurement,
} from "@workspace/measurements";
import {
  MEASUREMENT_RULE_DEFINITIONS,
  measurementRangeRuleId,
} from "@workspace/report-quality";
import { parseManifest, resolvePackMeasurements } from "../lib/knowledgePackManifest";

export const measurementRegistryRouter: IRouter = Router();

interface UsageRef { source: string; label: string; context: string }

interface ImpactIndex {
  bySourceLabel: Map<string, UsageRef[]>; // measurementId -> refs
  unresolved: UsageRef[];
}

/** Scan live content tables and resolve every measurement string they carry. */
async function buildImpactIndex(): Promise<ImpactIndex> {
  const byId = new Map<string, UsageRef[]>();
  const unresolved: UsageRef[] = [];
  const add = (label: string, source: string, context: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const ref: UsageRef = { source, label: trimmed, context };
    const hit = resolveMeasurement(trimmed);
    if (hit) {
      const list = byId.get(hit.definition.id) ?? [];
      list.push(ref);
      byId.set(hit.definition.id, list);
    } else {
      unresolved.push(ref);
    }
  };

  const [quick, protocols, packs, storedCounts, viewerCounts] = await Promise.all([
    db.select({ studyType: radiologyQuickMeasurementsTable.studyType, label: radiologyQuickMeasurementsTable.label })
      .from(radiologyQuickMeasurementsTable),
    db.select({ studyType: radiologyProtocolsTable.studyType, required: radiologyProtocolsTable.requiredMeasurements })
      .from(radiologyProtocolsTable),
    db.select({ studyType: knowledgePacksTable.studyType, manifestJson: knowledgePacksTable.manifestJson })
      .from(knowledgePacksTable),
    db.select({ measurementId: radiologyMeasurementsTable.measurementId, n: sql<number>`count(*)` })
      .from(radiologyMeasurementsTable)
      .where(isNotNull(radiologyMeasurementsTable.measurementId))
      .groupBy(radiologyMeasurementsTable.measurementId),
    db.select({ measurementId: viewerMeasurementsTable.measurementId, n: sql<number>`count(*)` })
      .from(viewerMeasurementsTable)
      .where(isNotNull(viewerMeasurementsTable.measurementId))
      .groupBy(viewerMeasurementsTable.measurementId),
  ]);

  for (const q of quick) add(q.label, "quick-measurement", q.studyType);
  for (const p of protocols) {
    for (const token of String(p.required ?? "").split(",")) add(token, "protocol-required", p.studyType);
  }
  for (const pk of packs) {
    const manifest = parseManifest(pk.manifestJson ?? null);
    for (const r of resolvePackMeasurements(manifest)) {
      add(r.label, "knowledge-pack", pk.studyType ?? "unknown study type");
    }
  }
  for (const row of storedCounts) {
    if (row.measurementId) add(row.measurementId, "stored-measurement", `${row.n} rows (radiology_measurements)`);
  }
  for (const row of viewerCounts) {
    if (row.measurementId) add(row.measurementId, "viewer-measurement", `${row.n} rows (viewer_measurements)`);
  }

  return { bySourceLabel: byId, unresolved };
}

// GET /api/measurement-registry — full registry + live impact analysis.
measurementRegistryRouter.get("/", async (_req, res) => {
  const impact = await buildImpactIndex();
  const ruleIds = new Set(MEASUREMENT_RULE_DEFINITIONS.map((d) => d.id));

  const measurements = DEFAULT_MEASUREMENT_REGISTRY.list().map((def) => {
    const usage = impact.bySourceLabel.get(def.id) ?? [];
    const phase4RuleId = measurementRangeRuleId(def.id);
    return {
      ...def,
      usage,
      usageCount: usage.length,
      phase4Rule: ruleIds.has(phase4RuleId) ? phase4RuleId : null,
    };
  });

  res.json({
    catalogVersion: MEASUREMENT_CATALOG_VERSION,
    count: measurements.length,
    measurements,
    unresolvedLabels: impact.unresolved,
  });
});

// GET /api/measurement-registry/validation — Step-14 live validation report.
measurementRegistryRouter.get("/validation", async (_req, res) => {
  const started = Date.now();
  const impact = await buildImpactIndex();
  const issues = DEFAULT_MEASUREMENT_REGISTRY.validationIssues();
  const defs = DEFAULT_MEASUREMENT_REGISTRY.list();

  // Orphans: registry entries no live content references (informational).
  const orphans = defs
    .filter((d) => !d.deprecated && !(impact.bySourceLabel.get(d.id)?.length))
    .map((d) => d.id);

  res.json({
    catalogVersion: MEASUREMENT_CATALOG_VERSION,
    healthy: issues.length === 0,
    registryIssues: issues,
    unresolvedLabels: impact.unresolved,
    unreferencedMeasurements: orphans,
    checkedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  });
});
