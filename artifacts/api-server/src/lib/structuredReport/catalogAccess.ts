// ─────────────────────────────────────────────────────────────────────────────
// Structured-report validator catalog access port.
//
// The D1 validator (./validator.ts) needs read-only, key-based lookups against
// the B1/B2 canonical catalog (lib/db/src/schema/radiologyCatalog.ts) to check
// R1 (finding./param. resolve globally) and R4/R5/R6 (severity/location/
// measurement/parameter bindings resolve for a SPECIFIC finding — §1.4: these
// three namespaces are finding-scoped, not global scales, so a lookup always
// needs the owning finding's definition_ref alongside the bare key).
//
// This is a thin, validator-shaped adapter over the existing CatalogStore
// (artifacts/api-server/src/lib/radiologyCatalog/store.ts) — it does not add a
// new persistence layer or duplicate B1/B2's own service.ts business rules
// (versioning, soft-delete, CRUD). It only answers "does this reference exist,
// and what does it look like" questions the validator needs, in the shape the
// validator needs them.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogStore } from "../radiologyCatalog/store";

export interface ResolvedFinding {
  id: number;
  key: string;
}

export interface ResolvedParameterGroup {
  id: number;
  key: string;
  dataType: "option" | "numeric" | "text" | "boolean";
  allowMultiple: boolean;
}

export interface ResolvedParameterOption {
  id: number;
  key: string;
  groupId: number;
}

export interface ResolvedFindingParameterBinding {
  parameterGroupId: number;
  required: boolean;
}

export interface ResolvedFindingScopedBinding {
  id: number;
  key: string;
}

export interface ResolvedFindingMeasurementBinding extends ResolvedFindingScopedBinding {
  unit: string;
}

/** Read-only catalog resolution port the validator depends on. */
export interface StructuredReportCatalogPort {
  /** finding.<key> — GLOBAL (§1.4, R1). */
  resolveFinding(key: string): Promise<ResolvedFinding | null>;
  /** param.<key> — GLOBAL (§1.4, R1). */
  resolveParameterGroup(key: string): Promise<ResolvedParameterGroup | null>;
  /** parameter_options.key within a resolved group (§1.4, R6). */
  resolveParameterOption(groupId: number, optionKey: string): Promise<ResolvedParameterOption | null>;
  /** finding_parameter_bindings WHERE findingId = the finding behind definition_ref (R4/R6/R8). */
  resolveFindingParameterBinding(findingId: number, parameterGroupId: number): Promise<ResolvedFindingParameterBinding | null>;
  /** All required finding_parameter_bindings for a finding (R8). */
  listRequiredParameterBindings(findingId: number): Promise<Array<{ parameterGroupId: number }>>;
  /** sev.<key> — FINDING-SCOPED, resolved WHERE findingId = the finding's own row (§1.4, R4). */
  resolveFindingSeverity(findingId: number, key: string): Promise<ResolvedFindingScopedBinding | null>;
  /** loc.<key> — FINDING-SCOPED (§1.4, R4). */
  resolveFindingLocation(findingId: number, key: string): Promise<ResolvedFindingScopedBinding | null>;
  /** meas.<key> — FINDING-SCOPED; findingId is NOT NULL in the real schema (§1.4, §4, R5). */
  resolveFindingMeasurement(findingId: number, key: string): Promise<ResolvedFindingMeasurementBinding | null>;
}

/** Production implementation over the existing B1/B2 CatalogStore. */
export class DrizzleStructuredReportCatalogPort implements StructuredReportCatalogPort {
  constructor(private store: CatalogStore) {}

  async resolveFinding(key: string): Promise<ResolvedFinding | null> {
    const row = await this.store.findOne("finding_definitions", { key });
    return row ? { id: row.id, key: row.key as string } : null;
  }

  async resolveParameterGroup(key: string): Promise<ResolvedParameterGroup | null> {
    const row = await this.store.findOne("parameter_groups", { key });
    if (!row) return null;
    return {
      id: row.id,
      key: row.key as string,
      dataType: row.dataType as ResolvedParameterGroup["dataType"],
      allowMultiple: Boolean(row.allowMultiple),
    };
  }

  async resolveParameterOption(groupId: number, optionKey: string): Promise<ResolvedParameterOption | null> {
    const row = await this.store.findOne("parameter_options", { groupId, key: optionKey });
    return row ? { id: row.id, key: row.key as string, groupId: row.groupId as number } : null;
  }

  async resolveFindingParameterBinding(findingId: number, parameterGroupId: number): Promise<ResolvedFindingParameterBinding | null> {
    const row = await this.store.findOne("finding_parameter_bindings", { findingId, parameterGroupId });
    return row ? { parameterGroupId: row.parameterGroupId as number, required: Boolean(row.required) } : null;
  }

  async listRequiredParameterBindings(findingId: number): Promise<Array<{ parameterGroupId: number }>> {
    const rows = await this.store.list("finding_parameter_bindings", { where: { findingId, required: true } });
    return rows.map((r) => ({ parameterGroupId: r.parameterGroupId as number }));
  }

  async resolveFindingSeverity(findingId: number, key: string): Promise<ResolvedFindingScopedBinding | null> {
    const row = await this.store.findOne("finding_severity_bindings", { findingId, key });
    return row ? { id: row.id, key: row.key as string } : null;
  }

  async resolveFindingLocation(findingId: number, key: string): Promise<ResolvedFindingScopedBinding | null> {
    const row = await this.store.findOne("finding_locations", { findingId, key });
    return row ? { id: row.id, key: row.key as string } : null;
  }

  async resolveFindingMeasurement(findingId: number, key: string): Promise<ResolvedFindingMeasurementBinding | null> {
    const row = await this.store.findOne("finding_measurement_bindings", { findingId, key });
    return row ? { id: row.id, key: row.key as string, unit: row.unit as string } : null;
  }
}
