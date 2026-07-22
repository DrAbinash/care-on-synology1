// ============================================================================
// Canonical catalogue mapping resolver: HOPE test code/name → CARE test(s) or
// package. DETERMINISTIC ONLY (brief §6): exact source_code, then exact
// normalized source_name, then exact normalized synonym. No fuzzy/free-text
// fallback — an unresolved item becomes `unmapped` and lands in the admin
// review queue, it is never silently guessed.
// ============================================================================
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  serviceCatalogueMappingsTable,
  serviceCatalogueMappingSynonymsTable,
  testsTable,
  packagesTable,
} from "@workspace/db";
import type { Executor } from "./db";
import { normalizeTestName } from "./normalize";

export interface MapInput {
  sourceSystem: string; // "HOPE"
  sourceCode?: string | null;
  sourceName: string;
  sourceModality?: string | null; // lab | radiology hint
}

export interface MappedTarget {
  mappingId: number;
  careTestId: number | null;
  carePackageId: number | null;
  careDisplayName: string | null;
  department: string | null;
  modality: string | null;
  mappingType: string;
}

export interface MapResult {
  status: "mapped" | "unmapped";
  matchedBy: "code" | "name" | "synonym" | "none";
  targets: MappedTarget[];
}

function toTargets(rows: (typeof serviceCatalogueMappingsTable.$inferSelect)[]): MappedTarget[] {
  return rows.map((m) => ({
    mappingId: m.id,
    careTestId: m.careTestId ?? null,
    carePackageId: m.carePackageId ?? null,
    careDisplayName: m.careDisplayName ?? null,
    department: m.department ?? null,
    modality: m.modality ?? null,
    mappingType: m.mappingType,
  }));
}

const ACTIVE = (sourceSystem: string) =>
  and(
    eq(serviceCatalogueMappingsTable.sourceSystem, sourceSystem),
    eq(serviceCatalogueMappingsTable.mappingStatus, "active"),
    eq(serviceCatalogueMappingsTable.isActive, true),
  );

export async function resolveTest(exec: Executor, input: MapInput): Promise<MapResult> {
  // 1) Exact source_code (strongest).
  const code = (input.sourceCode ?? "").trim();
  if (code) {
    const rows = await exec
      .select()
      .from(serviceCatalogueMappingsTable)
      .where(and(ACTIVE(input.sourceSystem), eq(serviceCatalogueMappingsTable.sourceCode, code)));
    if (rows.length > 0) return { status: "mapped", matchedBy: "code", targets: toTargets(rows) };
  }

  // 2) Exact normalized name.
  const norm = normalizeTestName(input.sourceName);
  if (norm) {
    const rows = await exec
      .select()
      .from(serviceCatalogueMappingsTable)
      .where(and(ACTIVE(input.sourceSystem), eq(serviceCatalogueMappingsTable.sourceNameNormalized, norm)));
    if (rows.length > 0) return { status: "mapped", matchedBy: "name", targets: toTargets(rows) };

    // 3) Synonym / abbreviation match.
    const synRows = await exec
      .select({ mappingId: serviceCatalogueMappingSynonymsTable.mappingId })
      .from(serviceCatalogueMappingSynonymsTable)
      .where(eq(serviceCatalogueMappingSynonymsTable.synonymNormalized, norm));
    const ids = [...new Set(synRows.map((r) => r.mappingId))];
    if (ids.length > 0) {
      const rows2 = await exec
        .select()
        .from(serviceCatalogueMappingsTable)
        .where(and(ACTIVE(input.sourceSystem), inArray(serviceCatalogueMappingsTable.id, ids)));
      if (rows2.length > 0) return { status: "mapped", matchedBy: "synonym", targets: toTargets(rows2) };
    }
  }

  return { status: "unmapped", matchedBy: "none", targets: [] };
}

/**
 * Expand a mapped target into concrete CARE test ids for order creation. A test
 * target yields [testId]; a package target expands to its member tests via
 * package_tests. Returns active test ids only.
 */
export async function expandTargetToTestIds(exec: Executor, target: MappedTarget): Promise<number[]> {
  if (target.careTestId) {
    const [t] = await exec.select({ id: testsTable.id, active: testsTable.isActive }).from(testsTable).where(eq(testsTable.id, target.careTestId)).limit(1);
    return t && t.active ? [t.id] : [];
  }
  if (target.carePackageId) {
    // package_tests join table maps package → member tests.
    const rows = await exec.execute(
      sql`SELECT pt.test_id AS test_id FROM package_tests pt JOIN diagnostic_tests dt ON dt.id = pt.test_id WHERE pt.package_id = ${target.carePackageId} AND dt.is_active = true`,
    );
    // drizzle node-postgres returns { rows }
    const list = (rows as unknown as { rows?: Array<{ test_id: number }> }).rows ?? (rows as unknown as Array<{ test_id: number }>);
    return (list as Array<{ test_id: number }>).map((r) => Number(r.test_id)).filter((n) => Number.isFinite(n));
  }
  return [];
}

/** Classify a resolved item as pathology vs radiology from its department/modality. */
export function classifyModality(department?: string | null, modality?: string | null): "pathology" | "radiology" {
  const d = `${department ?? ""} ${modality ?? ""}`.toLowerCase();
  if (/x-?ray|usg|ultra|sono|ct|mri|mammo|dexa|bmd|radiolog|imaging|doppler|scan/.test(d)) return "radiology";
  return "pathology";
}
