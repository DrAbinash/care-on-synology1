// ─────────────────────────────────────────────────────────────────────────────
// K3 — Production importer. Executes the K2 plan transactionally:
//   • one transaction; rollback on ANY failure
//   • idempotent (unchanged entities are skipped — no writes, no version bumps)
//   • upsert by immutable key ⇒ surrogate IDs preserved across imports
//   • version bumped by 1 only when an entity actually changed
//   • retired content (absent from packs, with prune) is SOFT-deleted, never hard
//   • aliases are preserved (insert-only; never churned)
//   • the graph is re-diffed immediately before commit — a non-empty residual
//     diff aborts the transaction (rollback)
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogStore, StoredRow, CatalogTableName } from "../store";
import { validatePacks } from "./validator";
import { buildNormalizedGraph, type NormalizedGraph, type NormFinding } from "./graph";
import { buildCatalogSnapshot } from "./snapshot";
import { dryRunImport, type ImportPlan, type DryRunOptions } from "./dryRun";
import { normalizeAlias, type LoadedPack, type ValidationResult } from "./types";
import type { CatalogRepository } from "./repository";

export class ImportError extends Error {
  constructor(message: string, public detail?: unknown) { super(message); this.name = "ImportError"; }
}

export interface ImportResult {
  ok: boolean;
  phase: "validate" | "applied" | "verify";
  validation: ValidationResult;
  plan?: ImportPlan;
  error?: string;
}

type Maps = {
  groupIdByKey: Map<string, number>;
  optionIdByGroupKey: Map<string, Map<string, number>>;
  categoryIdByKey: Map<string, number>;
  findingIdByKey: Map<string, number>;
};

async function preloadMaps(store: CatalogStore): Promise<Maps> {
  const m: Maps = { groupIdByKey: new Map(), optionIdByGroupKey: new Map(), categoryIdByKey: new Map(), findingIdByKey: new Map() };
  for (const g of await store.list("parameter_groups")) m.groupIdByKey.set(g.key as string, g.id);
  for (const o of await store.list("parameter_options")) {
    const gk = [...m.groupIdByKey.entries()].find(([, id]) => id === o.groupId)?.[0];
    if (gk) { const bag = m.optionIdByGroupKey.get(gk) ?? new Map(); bag.set(o.key as string, o.id); m.optionIdByGroupKey.set(gk, bag); }
  }
  for (const c of await store.list("finding_categories")) m.categoryIdByKey.set(c.key as string, c.id);
  for (const f of await store.list("finding_definitions")) m.findingIdByKey.set(f.key as string, f.id);
  return m;
}

/** Insert or (version-bumped) update a keyed, versioned top-level row. Returns its id. */
async function upsertVersioned(
  store: CatalogStore, table: CatalogTableName, matchKey: Record<string, unknown>, values: Record<string, unknown>, changed: boolean,
): Promise<number> {
  const existing = await store.findOne(table, matchKey, { includeDeleted: true });
  if (!existing) {
    const row = await store.insert(table, { ...matchKey, ...values, version: 1, status: values.status ?? "draft" });
    return row.id;
  }
  if (existing.deletedAt) {
    // resurrect a previously-retired entry, preserving its immutable id
    await store.update(table, existing.id, { ...values, deletedAt: null, version: (existing.version as number) + 1 });
  } else if (changed) {
    await store.update(table, existing.id, { ...values, version: (existing.version as number) + 1 });
  }
  return existing.id;
}

/** Sync a finding's child binding rows to the desired set (upsert + prune retired). */
async function syncChildren(
  store: CatalogStore, table: CatalogTableName, findingId: number,
  matchFields: string[], desired: Record<string, unknown>[], prune: boolean,
): Promise<void> {
  const existing = await store.list(table, { where: { findingId } });
  const keyOf = (r: Record<string, unknown>) => JSON.stringify(matchFields.map((f) => r[f]));
  const desiredByKey = new Map(desired.map((d) => [keyOf(d), d]));

  for (const [k, d] of desiredByKey) {
    const found = existing.find((e) => keyOf(e) === k);
    if (!found) await store.insert(table, { findingId, ...d });
    else {
      const differs = Object.keys(d).some((f) => found[f] !== d[f]);
      if (differs) await store.update(table, found.id, d);
    }
  }
  if (prune) {
    for (const e of existing) if (!desiredByKey.has(keyOf(e)) && !e.deletedAt) await store.update(table, e.id, { deletedAt: new Date() });
  }
}

async function applyFinding(store: CatalogStore, f: NormFinding, maps: Maps, action: string): Promise<void> {
  if (action === "unchanged") return; // idempotent: nothing to write
  const categoryId = maps.categoryIdByKey.get(f.category);
  if (categoryId == null) throw new ImportError(`Category "${f.category}" not resolved for finding "${f.id_key}"`);

  const findingId = await upsertVersioned(store, "finding_definitions", { key: f.id_key }, {
    categoryId, label: f.display_name, narrative: f.narrative, impression: f.impression, status: f.status,
  }, action === "update");
  maps.findingIdByKey.set(f.id_key, findingId);

  await syncChildren(store, "finding_parameter_bindings", findingId, ["parameterGroupId"],
    f.parameters.map((b) => ({
      parameterGroupId: maps.groupIdByKey.get(b.param_key)!,
      required: b.required,
      defaultOptionId: b.default_option_key != null ? (maps.optionIdByGroupKey.get(b.param_key)?.get(b.default_option_key) ?? null) : null,
      sortOrder: b.sort_order,
    })), true);

  await syncChildren(store, "finding_severity_bindings", findingId, ["key"],
    f.severities.map((s) => ({ key: s.key, label: s.label, rank: s.rank, sortOrder: s.sort_order })), true);

  await syncChildren(store, "finding_locations", findingId, ["key"],
    f.locations.map((l) => ({ key: l.key, label: l.label, laterality: l.laterality, sortOrder: l.sort_order })), true);

  await syncChildren(store, "finding_measurement_bindings", findingId, ["key"],
    f.measurements.map((m) => ({ key: m.key, label: m.label, unit: m.unit, minValue: m.min, maxValue: m.max, sortOrder: m.sort_order })), true);

  await syncChildren(store, "finding_recommendations", findingId, ["recommendationText"],
    f.recommendations.map((r) => ({ recommendationText: r.text, priority: r.priority, sortOrder: r.sort_order })), true);

  // aliases are PRESERVED — insert-only, never pruned (stable external mapping)
  const aliasList = [...f.aliases, ...(f.keyboard_alias ? [f.keyboard_alias] : [])];
  for (const a of aliasList) {
    const normalized = normalizeAlias(a);
    const exists = await store.findOne("finding_aliases", { normalized }, { includeDeleted: true });
    if (!exists) await store.insert("finding_aliases", { findingId, aliasKey: a, normalized, source: `pack:${f.meta.source_pack}` });
  }
}

async function applyGraph(store: CatalogStore, graph: NormalizedGraph, plan: ImportPlan, opts: DryRunOptions): Promise<void> {
  const maps = await preloadMaps(store);
  const actionOf = new Map(plan.items.map((i) => [`${i.entity}:${i.key}`, i.action]));

  // 1. parameter groups + options
  for (const p of graph.parameters) {
    const action = actionOf.get(`parameter_group:${p.key}`) ?? "insert";
    const groupId = await upsertVersioned(store, "parameter_groups", { key: p.key }, {
      label: p.label, dataType: p.data_type, unit: p.unit, allowMultiple: p.allow_multiple, status: "active",
    }, action === "update");
    maps.groupIdByKey.set(p.key, groupId);
    const optMap = maps.optionIdByGroupKey.get(p.key) ?? new Map<string, number>();
    const existingOpts = await store.list("parameter_options", { where: { groupId } });
    const desiredKeys = new Set(p.options.map((o) => o.key));
    for (const o of p.options) {
      const found = existingOpts.find((e) => e.key === o.key && !e.deletedAt);
      if (!found) {
        const row = await store.insert("parameter_options", { groupId, key: o.key, label: o.label, codeSystem: o.code_system, codeValue: o.code_value, version: 1, status: "active", sortOrder: 0 });
        optMap.set(o.key, row.id);
      } else {
        if (found.label !== o.label || (found.codeSystem ?? null) !== o.code_system) await store.update("parameter_options", found.id, { label: o.label, codeSystem: o.code_system, codeValue: o.code_value, version: (found.version as number) + 1 });
        optMap.set(o.key, found.id);
      }
    }
    if (opts.prune) for (const e of existingOpts) if (!desiredKeys.has(e.key as string) && !e.deletedAt) await store.update("parameter_options", e.id, { deletedAt: new Date() });
    maps.optionIdByGroupKey.set(p.key, optMap);
  }

  // 2. categories — pass 1 (upsert, no parent), pass 2 (resolve parent)
  for (const c of graph.categories) {
    const action = actionOf.get(`finding_category:${c.key}`) ?? "insert";
    const id = await upsertVersioned(store, "finding_categories", { key: c.key }, { label: c.display_name, modality: c.modality, status: "active" }, action === "update");
    maps.categoryIdByKey.set(c.key, id);
  }
  for (const c of graph.categories) {
    if (c.parent == null) continue;
    const id = maps.categoryIdByKey.get(c.key)!;
    const parentId = maps.categoryIdByKey.get(c.parent) ?? null;
    const row = await store.getById("finding_categories", id, { includeDeleted: true });
    if (row && (row.parentId ?? null) !== parentId) await store.update("finding_categories", id, { parentId });
  }

  // 3. findings + bindings
  for (const f of graph.findings) {
    await applyFinding(store, f, maps, actionOf.get(`finding:${f.id_key}`) ?? "insert");
  }

  // 4. retirements (soft delete)
  if (opts.prune) {
    for (const d of plan.delete) {
      const table: CatalogTableName = d.entity === "parameter_group" ? "parameter_groups" : d.entity === "finding_category" ? "finding_categories" : "finding_definitions";
      const row = await store.findOne(table, { key: d.key });
      if (row) await store.update(table, row.id, { deletedAt: new Date() });
    }
  }
}

/**
 * K3 entry point. Validate → normalize → (transaction: recompute plan, apply,
 * re-diff-and-verify, commit). Returns the pre-transaction plan for reporting.
 * On any failure the transaction rolls back and ok:false is returned.
 */
export async function runImport(loaded: LoadedPack[], repo: CatalogRepository, opts: DryRunOptions = { prune: true }): Promise<ImportResult> {
  const readStore = repo.readStore();
  const snapshot = await buildCatalogSnapshot(readStore);
  const validation = validatePacks(loaded, snapshot);
  if (!validation.ok) return { ok: false, phase: "validate", validation };

  const graph = buildNormalizedGraph(loaded);
  const plan = await dryRunImport(graph, readStore, opts);

  try {
    await repo.runInTransaction(async (store) => {
      const txPlan = await dryRunImport(graph, store, opts); // recompute in-tx (race-safe)
      await applyGraph(store, graph, txPlan, opts);
      // validate graph again immediately before commit: a re-diff must be empty
      const verify = await dryRunImport(graph, store, opts);
      if (verify.insert.length || verify.update.length || verify.delete.length) {
        throw new ImportError("post-import verification found residual diff — rolling back", verify.statistics);
      }
    });
  } catch (err) {
    return { ok: false, phase: "applied", validation, plan, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, phase: "applied", validation, plan };
}
