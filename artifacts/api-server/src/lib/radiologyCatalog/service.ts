// ─────────────────────────────────────────────────────────────────────────────
// Radiology Canonical Catalog — service layer (Tickets B1 + B2).
//
// Orchestrates the pure validators + a CatalogStore to provide version-aware,
// soft-delete-only CRUD, reference integrity, search and graph lookup. All
// business rules live here so they are testable against InMemoryCatalogStore.
// Nothing in this module renders reports or touches legacy Quick Select.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CatalogValidationError, assertValidKey, normalizeText, isValidStatus,
  assertStatusTransition, assertExpectedVersion, assertVersionTransition,
  isAliasCollision, type CatalogStatus,
} from "./validation";
import type { CatalogStore, CatalogTableName, StoredRow } from "./store";

export interface Actor { username?: string; }

type Dict = Record<string, unknown>;

export class CatalogService {
  constructor(private store: CatalogStore) {}

  // ── shared helpers ─────────────────────────────────────────────────────────

  private async requireLive(table: CatalogTableName, id: number, label: string): Promise<StoredRow> {
    const row = await this.store.getById(table, id);
    if (!row) throw new CatalogValidationError("NOT_FOUND", `${label} #${id} not found or deleted`);
    return row;
  }

  private async ensureRefExists(table: CatalogTableName, id: number, field: string): Promise<StoredRow> {
    const row = await this.store.getById(table, id);
    if (!row) throw new CatalogValidationError("MISSING_REFERENCE", `Referenced ${field} #${id} does not exist or is deleted`, field);
    return row;
  }

  private async ensureUniqueKey(table: CatalogTableName, where: Dict, field = "key"): Promise<void> {
    const existing = await this.store.findOne(table, where);
    if (existing) throw new CatalogValidationError("DUPLICATE_KEY", `Duplicate ${field}: ${JSON.stringify(where)} already exists`, field);
  }

  private stamp(actor: Actor | undefined, forInsert: boolean): Dict {
    const d: Dict = { updatedBy: actor?.username ?? null };
    if (forInsert) d.createdBy = actor?.username ?? null;
    return d;
  }

  /** Version-aware update of a lifecycle entity (status + version). */
  private async versionedUpdate(
    table: CatalogTableName, id: number, label: string,
    patch: Dict, opts: { expectedVersion?: number; status?: unknown }, actor?: Actor,
  ): Promise<StoredRow> {
    const current = await this.requireLive(table, id, label);
    assertExpectedVersion(current.version as number, opts.expectedVersion);
    if (opts.status !== undefined) {
      if (!isValidStatus(opts.status)) throw new CatalogValidationError("INVALID_FIELD", `Unknown status "${opts.status}"`, "status");
      assertStatusTransition(current.status as CatalogStatus, opts.status);
      patch.status = opts.status;
    }
    const nextVersion = (current.version as number) + 1;
    assertVersionTransition(current.version as number, nextVersion);
    patch.version = nextVersion;
    Object.assign(patch, this.stamp(actor, false));
    const updated = await this.store.update(table, id, patch);
    if (!updated) throw new CatalogValidationError("NOT_FOUND", `${label} #${id} not found`);
    return updated;
  }

  private async blockIfReferenced(
    table: CatalogTableName, refField: string, id: number, label: string,
  ): Promise<void> {
    const refs = await this.store.list(table, { where: { [refField]: id } });
    if (refs.length > 0) {
      throw new CatalogValidationError(
        "ORPHAN_BINDING",
        `Cannot soft-delete ${label} #${id}: ${refs.length} live reference(s) in ${table}.${refField} — remove them first`,
      );
    }
  }

  private async softDelete(table: CatalogTableName, id: number, label: string): Promise<StoredRow> {
    const row = await this.store.getById(table, id, { includeDeleted: true });
    if (!row) throw new CatalogValidationError("NOT_FOUND", `${label} #${id} not found`);
    if (row.deletedAt) throw new CatalogValidationError("ALREADY_DELETED", `${label} #${id} is already deleted`);
    const updated = await this.store.update(table, id, { deletedAt: new Date() });
    return updated!;
  }

  // ── Parameter groups ─────────────────────────────────────────────────────────

  async createParameterGroup(input: {
    key: string; label: string; description?: string; dataType?: string; unit?: string; allowMultiple?: boolean; status?: string;
  }, actor?: Actor): Promise<StoredRow> {
    assertValidKey(input.key);
    if (!input.label) throw new CatalogValidationError("INVALID_FIELD", "label is required", "label");
    const dataType = input.dataType ?? "option";
    if (!["option", "numeric", "text", "boolean"].includes(dataType)) {
      throw new CatalogValidationError("INVALID_FIELD", `Invalid dataType "${dataType}"`, "dataType");
    }
    if (input.status !== undefined && !isValidStatus(input.status)) {
      throw new CatalogValidationError("INVALID_FIELD", `Invalid status "${input.status}"`, "status");
    }
    await this.ensureUniqueKey("parameter_groups", { key: input.key });
    return this.store.insert("parameter_groups", {
      key: input.key, label: input.label, description: input.description ?? null,
      dataType, unit: input.unit ?? null, allowMultiple: input.allowMultiple ?? false,
      status: input.status ?? "draft", version: 1, ...this.stamp(actor, true),
    });
  }

  async updateParameterGroup(id: number, patch: { label?: string; description?: string; unit?: string; allowMultiple?: boolean; status?: string; expectedVersion?: number }, actor?: Actor): Promise<StoredRow> {
    const changes: Dict = {};
    for (const f of ["label", "description", "unit", "allowMultiple"] as const) {
      if (patch[f] !== undefined) changes[f] = patch[f];
    }
    return this.versionedUpdate("parameter_groups", id, "Parameter group", changes, { expectedVersion: patch.expectedVersion, status: patch.status }, actor);
  }

  async deleteParameterGroup(id: number): Promise<StoredRow> {
    await this.requireLive("parameter_groups", id, "Parameter group");
    await this.blockIfReferenced("parameter_options", "groupId", id, "Parameter group");
    await this.blockIfReferenced("finding_parameter_bindings", "parameterGroupId", id, "Parameter group");
    return this.softDelete("parameter_groups", id, "Parameter group");
  }

  // ── Parameter options ────────────────────────────────────────────────────────

  async createParameterOption(input: {
    groupId: number; key: string; label: string; sortOrder?: number; codeSystem?: string; codeValue?: string; status?: string;
  }, actor?: Actor): Promise<StoredRow> {
    assertValidKey(input.key);
    if (!input.label) throw new CatalogValidationError("INVALID_FIELD", "label is required", "label");
    await this.ensureRefExists("parameter_groups", input.groupId, "groupId");
    await this.ensureUniqueKey("parameter_options", { groupId: input.groupId, key: input.key });
    return this.store.insert("parameter_options", {
      groupId: input.groupId, key: input.key, label: input.label, sortOrder: input.sortOrder ?? 0,
      codeSystem: input.codeSystem ?? null, codeValue: input.codeValue ?? null,
      status: input.status ?? "draft", version: 1, ...this.stamp(actor, true),
    });
  }

  async updateParameterOption(id: number, patch: { label?: string; sortOrder?: number; codeSystem?: string; codeValue?: string; status?: string; expectedVersion?: number }, actor?: Actor): Promise<StoredRow> {
    const changes: Dict = {};
    for (const f of ["label", "sortOrder", "codeSystem", "codeValue"] as const) {
      if (patch[f] !== undefined) changes[f] = patch[f];
    }
    return this.versionedUpdate("parameter_options", id, "Parameter option", changes, { expectedVersion: patch.expectedVersion, status: patch.status }, actor);
  }

  async deleteParameterOption(id: number): Promise<StoredRow> {
    await this.requireLive("parameter_options", id, "Parameter option");
    await this.blockIfReferenced("finding_parameter_bindings", "defaultOptionId", id, "Parameter option");
    return this.softDelete("parameter_options", id, "Parameter option");
  }

  async listParameterOptions(groupId: number): Promise<StoredRow[]> {
    return this.store.list("parameter_options", { where: { groupId } });
  }

  // ── Finding categories ───────────────────────────────────────────────────────

  async createFindingCategory(input: {
    key: string; label: string; parentId?: number | null; modality?: string; sortOrder?: number; status?: string;
  }, actor?: Actor): Promise<StoredRow> {
    assertValidKey(input.key);
    if (!input.label) throw new CatalogValidationError("INVALID_FIELD", "label is required", "label");
    await this.ensureUniqueKey("finding_categories", { key: input.key });
    if (input.parentId != null) {
      await this.ensureRefExists("finding_categories", input.parentId, "parentId");
      if (await this.wouldCategoryCycle(null, input.parentId)) {
        throw new CatalogValidationError("CYCLE", "parentId would create a category cycle", "parentId");
      }
    }
    return this.store.insert("finding_categories", {
      key: input.key, label: input.label, parentId: input.parentId ?? null,
      modality: input.modality ?? null, sortOrder: input.sortOrder ?? 0,
      status: input.status ?? "draft", version: 1, ...this.stamp(actor, true),
    });
  }

  async updateFindingCategory(id: number, patch: { label?: string; parentId?: number | null; modality?: string; sortOrder?: number; status?: string; expectedVersion?: number }, actor?: Actor): Promise<StoredRow> {
    const changes: Dict = {};
    for (const f of ["label", "modality", "sortOrder"] as const) {
      if (patch[f] !== undefined) changes[f] = patch[f];
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId != null) {
        await this.ensureRefExists("finding_categories", patch.parentId, "parentId");
        if (await this.wouldCategoryCycle(id, patch.parentId)) {
          throw new CatalogValidationError("CYCLE", "parentId would create a category cycle", "parentId");
        }
      }
      changes.parentId = patch.parentId;
    }
    return this.versionedUpdate("finding_categories", id, "Finding category", changes, { expectedVersion: patch.expectedVersion, status: patch.status }, actor);
  }

  async deleteFindingCategory(id: number): Promise<StoredRow> {
    await this.requireLive("finding_categories", id, "Finding category");
    await this.blockIfReferenced("finding_categories", "parentId", id, "Finding category");
    await this.blockIfReferenced("finding_definitions", "categoryId", id, "Finding category");
    return this.softDelete("finding_categories", id, "Finding category");
  }

  /**
   * Async twin of the pure `wouldCreateCycle` (which is unit-tested directly):
   * walk the ancestor chain of `newParentId` against live rows; a cycle exists
   * if we reach `nodeId` or revisit any ancestor. O(depth).
   */
  private async wouldCategoryCycle(nodeId: number | null, newParentId: number): Promise<boolean> {
    let cur: number | null = newParentId;
    const seen = new Set<number>();
    while (cur != null) {
      if (cur === nodeId) return true;
      if (seen.has(cur)) return true;
      seen.add(cur);
      const row = await this.store.getById("finding_categories", cur);
      cur = (row?.parentId as number | null) ?? null;
    }
    return false;
  }

  // ── Finding definitions ──────────────────────────────────────────────────────

  async createFinding(input: {
    key: string; categoryId: number; label: string; description?: string; narrative?: string; impression?: string; codeSystem?: string; codeValue?: string; status?: string;
  }, actor?: Actor): Promise<StoredRow> {
    assertValidKey(input.key);
    if (!input.label) throw new CatalogValidationError("INVALID_FIELD", "label is required", "label");
    await this.ensureRefExists("finding_categories", input.categoryId, "categoryId");
    await this.ensureUniqueKey("finding_definitions", { key: input.key });
    return this.store.insert("finding_definitions", {
      key: input.key, categoryId: input.categoryId, label: input.label,
      description: input.description ?? null, narrative: input.narrative ?? null, impression: input.impression ?? null,
      codeSystem: input.codeSystem ?? null, codeValue: input.codeValue ?? null,
      status: input.status ?? "draft", version: 1, ...this.stamp(actor, true),
    });
  }

  async updateFinding(id: number, patch: { label?: string; description?: string; narrative?: string; impression?: string; categoryId?: number; codeSystem?: string; codeValue?: string; status?: string; expectedVersion?: number }, actor?: Actor): Promise<StoredRow> {
    const changes: Dict = {};
    for (const f of ["label", "description", "narrative", "impression", "codeSystem", "codeValue"] as const) {
      if (patch[f] !== undefined) changes[f] = patch[f];
    }
    if (patch.categoryId !== undefined) {
      await this.ensureRefExists("finding_categories", patch.categoryId, "categoryId");
      changes.categoryId = patch.categoryId;
    }
    return this.versionedUpdate("finding_definitions", id, "Finding", changes, { expectedVersion: patch.expectedVersion, status: patch.status }, actor);
  }

  async deleteFinding(id: number): Promise<StoredRow> {
    await this.requireLive("finding_definitions", id, "Finding");
    for (const t of ["finding_parameter_bindings", "finding_synonyms", "finding_aliases", "finding_locations", "finding_recommendations", "finding_severity_bindings", "finding_measurement_bindings"] as CatalogTableName[]) {
      await this.blockIfReferenced(t, "findingId", id, "Finding");
    }
    return this.softDelete("finding_definitions", id, "Finding");
  }

  // ── Edges / bindings ─────────────────────────────────────────────────────────

  async addParameterBinding(input: { findingId: number; parameterGroupId: number; required?: boolean; defaultOptionId?: number; sortOrder?: number }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    await this.ensureRefExists("parameter_groups", input.parameterGroupId, "parameterGroupId");
    if (input.defaultOptionId != null) {
      const opt = await this.ensureRefExists("parameter_options", input.defaultOptionId, "defaultOptionId");
      if ((opt.groupId as number) !== input.parameterGroupId) {
        throw new CatalogValidationError("MISSING_REFERENCE", "defaultOptionId does not belong to parameterGroupId", "defaultOptionId");
      }
    }
    const dup = await this.store.findOne("finding_parameter_bindings", { findingId: input.findingId, parameterGroupId: input.parameterGroupId });
    if (dup) throw new CatalogValidationError("DUPLICATE_KEY", "This parameter is already bound to the finding", "parameterGroupId");
    return this.store.insert("finding_parameter_bindings", {
      findingId: input.findingId, parameterGroupId: input.parameterGroupId, required: input.required ?? false,
      defaultOptionId: input.defaultOptionId ?? null, sortOrder: input.sortOrder ?? 0, ...this.stamp(actor, true),
    });
  }

  async addSynonym(input: { findingId: number; synonym: string }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    const synonym = input.synonym?.trim();
    if (!synonym) throw new CatalogValidationError("INVALID_FIELD", "synonym is required", "synonym");
    const normalized = normalizeText(synonym);
    const dup = await this.store.findOne("finding_synonyms", { findingId: input.findingId, normalized });
    if (dup) throw new CatalogValidationError("DUPLICATE_KEY", "Synonym already exists for this finding", "synonym");
    return this.store.insert("finding_synonyms", { findingId: input.findingId, synonym, normalized, ...this.stamp(actor, true) });
  }

  async addAlias(input: { findingId: number; aliasKey: string; source?: string }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    const aliasKey = input.aliasKey?.trim();
    if (!aliasKey) throw new CatalogValidationError("INVALID_FIELD", "aliasKey is required", "aliasKey");
    const normalized = normalizeText(aliasKey);
    // Aliases are GLOBALLY unique among live rows — no duplicate aliases.
    const live = await this.store.list("finding_aliases", {});
    if (isAliasCollision(new Set(live.map((r) => r.normalized as string)), normalized)) {
      throw new CatalogValidationError("DUPLICATE_ALIAS", `Alias "${aliasKey}" already maps to a finding`, "aliasKey");
    }
    return this.store.insert("finding_aliases", { findingId: input.findingId, aliasKey, normalized, source: input.source ?? null, ...this.stamp(actor, true) });
  }

  async addLocation(input: { findingId: number; key: string; label: string; laterality?: string; sortOrder?: number }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    assertValidKey(input.key);
    if (input.laterality != null && !["left", "right", "bilateral", "midline"].includes(input.laterality)) {
      throw new CatalogValidationError("INVALID_FIELD", `Invalid laterality "${input.laterality}"`, "laterality");
    }
    const dup = await this.store.findOne("finding_locations", { findingId: input.findingId, key: input.key });
    if (dup) throw new CatalogValidationError("DUPLICATE_KEY", "Location key already exists for this finding", "key");
    return this.store.insert("finding_locations", { findingId: input.findingId, key: input.key, label: input.label, laterality: input.laterality ?? null, sortOrder: input.sortOrder ?? 0, ...this.stamp(actor, true) });
  }

  async addRecommendation(input: { findingId: number; recommendationText: string; priority?: string; sortOrder?: number }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    if (!input.recommendationText?.trim()) throw new CatalogValidationError("INVALID_FIELD", "recommendationText is required", "recommendationText");
    if (input.priority != null && !["routine", "urgent", "critical"].includes(input.priority)) {
      throw new CatalogValidationError("INVALID_FIELD", `Invalid priority "${input.priority}"`, "priority");
    }
    return this.store.insert("finding_recommendations", { findingId: input.findingId, recommendationText: input.recommendationText.trim(), priority: input.priority ?? null, sortOrder: input.sortOrder ?? 0, ...this.stamp(actor, true) });
  }

  async addSeverity(input: { findingId: number; key: string; label: string; rank?: number; sortOrder?: number }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    assertValidKey(input.key);
    const dup = await this.store.findOne("finding_severity_bindings", { findingId: input.findingId, key: input.key });
    if (dup) throw new CatalogValidationError("DUPLICATE_KEY", "Severity key already exists for this finding", "key");
    return this.store.insert("finding_severity_bindings", { findingId: input.findingId, key: input.key, label: input.label, rank: input.rank ?? 0, sortOrder: input.sortOrder ?? 0, ...this.stamp(actor, true) });
  }

  async addMeasurement(input: { findingId: number; key: string; label: string; unit?: string; valueType?: string; minValue?: number; maxValue?: number; sortOrder?: number }, actor?: Actor): Promise<StoredRow> {
    await this.ensureRefExists("finding_definitions", input.findingId, "findingId");
    assertValidKey(input.key);
    if (input.minValue != null && input.maxValue != null && input.minValue > input.maxValue) {
      throw new CatalogValidationError("INVALID_FIELD", "minValue must be ≤ maxValue", "minValue");
    }
    const dup = await this.store.findOne("finding_measurement_bindings", { findingId: input.findingId, key: input.key });
    if (dup) throw new CatalogValidationError("DUPLICATE_KEY", "Measurement key already exists for this finding", "key");
    return this.store.insert("finding_measurement_bindings", {
      findingId: input.findingId, key: input.key, label: input.label, unit: input.unit ?? "mm",
      valueType: input.valueType ?? "numeric", minValue: input.minValue ?? null, maxValue: input.maxValue ?? null,
      sortOrder: input.sortOrder ?? 0, ...this.stamp(actor, true),
    });
  }

  /** Soft-delete any edge row by table + id. */
  async removeEdge(table: CatalogTableName, id: number): Promise<StoredRow> {
    return this.softDelete(table, id, table);
  }

  // ── Generic reads (used by the API layer) ─────────────────────────────────────

  listGroups(opts?: { limit?: number }): Promise<StoredRow[]> { return this.store.list("parameter_groups", opts); }
  searchGroups(q: string, limit = 100): Promise<StoredRow[]> { return this.store.search("parameter_groups", ["key", "label", "description"], q, { limit }); }
  getGroup(id: number): Promise<StoredRow | null> { return this.store.getById("parameter_groups", id); }

  listCategories(opts?: { limit?: number }): Promise<StoredRow[]> { return this.store.list("finding_categories", opts); }
  searchCategories(q: string, limit = 200): Promise<StoredRow[]> { return this.store.search("finding_categories", ["key", "label"], q, { limit }); }
  getCategory(id: number): Promise<StoredRow | null> { return this.store.getById("finding_categories", id); }

  listFindings(opts?: { limit?: number }): Promise<StoredRow[]> { return this.store.list("finding_definitions", opts); }
  getFinding(id: number): Promise<StoredRow | null> { return this.store.getById("finding_definitions", id); }

  // ── Search & lookup ──────────────────────────────────────────────────────────

  async searchFindings(q: string, limit = 50): Promise<StoredRow[]> {
    const needle = q.trim();
    if (!needle) return [];
    const byDef = await this.store.search("finding_definitions", ["label", "key", "description"], needle, { limit });
    const bySyn = await this.store.search("finding_synonyms", ["synonym", "normalized"], needle, { limit });
    const byAlias = await this.store.search("finding_aliases", ["aliasKey", "normalized"], needle, { limit });
    const ids = new Set<number>(byDef.map((r) => r.id));
    for (const s of [...bySyn, ...byAlias]) ids.add(s.findingId as number);
    const out: StoredRow[] = [];
    for (const id of ids) {
      const f = await this.store.getById("finding_definitions", id);
      if (f) out.push(f);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.id - b.id);
  }

  async lookupByAlias(aliasKey: string): Promise<StoredRow | null> {
    const normalized = normalizeText(aliasKey);
    const alias = await this.store.findOne("finding_aliases", { normalized });
    if (!alias) return null;
    return this.store.getById("finding_definitions", alias.findingId as number);
  }

  /** Assemble the full canonical graph for one finding (read-only). */
  async getFindingGraph(id: number): Promise<{
    finding: StoredRow; category: StoredRow | null;
    parameters: Array<StoredRow & { group: StoredRow | null; options: StoredRow[] }>;
    synonyms: StoredRow[]; aliases: StoredRow[]; locations: StoredRow[];
    recommendations: StoredRow[]; severities: StoredRow[]; measurements: StoredRow[];
  }> {
    const finding = await this.requireLive("finding_definitions", id, "Finding");
    const category = await this.store.getById("finding_categories", finding.categoryId as number);
    const bindings = await this.store.list("finding_parameter_bindings", { where: { findingId: id } });
    const parameters = [] as Array<StoredRow & { group: StoredRow | null; options: StoredRow[] }>;
    for (const b of bindings) {
      const group = await this.store.getById("parameter_groups", b.parameterGroupId as number);
      const options = group ? await this.store.list("parameter_options", { where: { groupId: group.id } }) : [];
      parameters.push({ ...b, group, options });
    }
    return {
      finding, category, parameters,
      synonyms: await this.store.list("finding_synonyms", { where: { findingId: id } }),
      aliases: await this.store.list("finding_aliases", { where: { findingId: id } }),
      locations: await this.store.list("finding_locations", { where: { findingId: id } }),
      recommendations: await this.store.list("finding_recommendations", { where: { findingId: id } }),
      severities: await this.store.list("finding_severity_bindings", { where: { findingId: id } }),
      measurements: await this.store.list("finding_measurement_bindings", { where: { findingId: id } }),
    };
  }
}
