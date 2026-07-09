// ─────────────────────────────────────────────────────────────────────────────
// K2 — Dry-run importer. Diffs a NormalizedGraph against the live catalog and
// returns insert / update / delete / unchanged / conflicts / warnings /
// statistics. NO DATABASE WRITES. The K3 importer executes exactly this plan.
//
// Change detection is fingerprint-based so a re-import of identical packs
// classifies everything as `unchanged` (⇒ idempotency: no version bumps, no
// writes). `delete` = live catalog entries no longer present in the packs
// (retired content), which K3 soft-deletes when prune is enabled.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogStore, StoredRow } from "../store";
import type { NormalizedGraph, NormFinding, NormParam } from "./graph";
import type { PackIssue } from "./types";

export type PlanAction = "insert" | "update" | "delete" | "unchanged";
export interface PlanItem { entity: string; key: string; action: PlanAction; reason?: string; }

export interface ImportStatistics {
  insert: number; update: number; delete: number; unchanged: number;
  byEntity: Record<string, { insert: number; update: number; delete: number; unchanged: number }>;
}
export interface ImportPlan {
  items: PlanItem[];
  insert: PlanItem[]; update: PlanItem[]; delete: PlanItem[]; unchanged: PlanItem[];
  conflicts: PackIssue[]; warnings: PackIssue[];
  statistics: ImportStatistics;
}

const stable = (v: unknown): string => JSON.stringify(v);

function paramFingerprint(p: NormParam): string {
  return stable({ label: p.label, data_type: p.data_type, unit: p.unit, allow_multiple: p.allow_multiple,
    options: [...p.options].sort((a, b) => a.key.localeCompare(b.key)).map((o) => [o.key, o.label, o.code_system, o.code_value]) });
}

function findingFingerprint(f: NormFinding): string {
  const sortByKey = <T extends { key: string }>(a: T[]) => [...a].sort((x, y) => x.key.localeCompare(y.key));
  const allAliases = [...f.aliases, ...(f.keyboard_alias ? [f.keyboard_alias] : [])];
  return stable({
    display_name: f.display_name, category: f.category, narrative: f.narrative, impression: f.impression, status: f.status,
    aliases: allAliases.map((a) => a.toLowerCase().trim()).sort(),
    parameters: [...f.parameters].sort((a, b) => a.param_key.localeCompare(b.param_key)).map((b) => [b.param_key, b.required, b.default_option_key]),
    severities: sortByKey(f.severities).map((s) => [s.key, s.label, s.rank]),
    locations: sortByKey(f.locations).map((l) => [l.key, l.label, l.laterality]),
    measurements: sortByKey(f.measurements).map((m) => [m.key, m.label, m.unit, m.min, m.max]),
    recommendations: [...f.recommendations].sort((a, b) => a.text.localeCompare(b.text)).map((r) => [r.text, r.priority]),
  });
}

/** Pre-loaded id↔key maps so binding resolution doesn't issue N queries per finding. */
interface ResolveIndex {
  groupKeyById: Map<number, string>;
  optionKeyById: Map<number, string>;
}
async function buildResolveIndex(store: CatalogStore): Promise<ResolveIndex> {
  const idx: ResolveIndex = { groupKeyById: new Map(), optionKeyById: new Map() };
  for (const g of await store.list("parameter_groups", { includeDeleted: true })) idx.groupKeyById.set(g.id, g.key as string);
  for (const o of await store.list("parameter_options", { includeDeleted: true })) idx.optionKeyById.set(o.id, o.key as string);
  return idx;
}

async function existingParamFingerprint(store: CatalogStore, group: StoredRow): Promise<string> {
  const options = await store.list("parameter_options", { where: { groupId: group.id } });
  return stable({ label: group.label, data_type: group.dataType, unit: group.unit ?? null, allow_multiple: group.allowMultiple ?? false,
    options: options.map((o) => [o.key, o.label, o.codeSystem ?? null, o.codeValue ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
}

async function existingFindingFingerprint(store: CatalogStore, f: StoredRow, idx: ResolveIndex): Promise<string> {
  const params = await store.list("finding_parameter_bindings", { where: { findingId: f.id } });
  const sev = await store.list("finding_severity_bindings", { where: { findingId: f.id } });
  const loc = await store.list("finding_locations", { where: { findingId: f.id } });
  const meas = await store.list("finding_measurement_bindings", { where: { findingId: f.id } });
  const rec = await store.list("finding_recommendations", { where: { findingId: f.id } });
  const aliases = await store.list("finding_aliases", { where: { findingId: f.id } });
  const catRow = await store.getById("finding_categories", f.categoryId as number, { includeDeleted: true });
  return stable({
    display_name: f.label, category: catRow?.key ?? null, narrative: f.narrative ?? null, impression: f.impression ?? null, status: f.status,
    aliases: aliases.map((a) => String(a.aliasKey).toLowerCase().trim()).sort(),
    parameters: params.map((b) => [idx.groupKeyById.get(b.parameterGroupId as number) ?? "?", b.required, b.defaultOptionId != null ? (idx.optionKeyById.get(b.defaultOptionId as number) ?? null) : null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    severities: sev.map((s) => [s.key, s.label, s.rank]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    locations: loc.map((l) => [l.key, l.label, l.laterality ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    measurements: meas.map((m) => [m.key, m.label, m.unit, m.minValue != null ? Number(m.minValue) : null, m.maxValue != null ? Number(m.maxValue) : null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    recommendations: rec.map((r) => [r.recommendationText, r.priority ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

export interface DryRunOptions { prune?: boolean; } // prune ⇒ retire catalog entries absent from packs

export async function dryRunImport(graph: NormalizedGraph, store: CatalogStore, opts: DryRunOptions = {}): Promise<ImportPlan> {
  const items: PlanItem[] = [];
  const conflicts: PackIssue[] = [];
  const warnings: PackIssue[] = [];
  const idx = await buildResolveIndex(store);

  const push = (entity: string, key: string, action: PlanAction, reason?: string) => items.push({ entity, key, action, reason });

  // ── parameter groups ──
  const graphParamKeys = new Set(graph.parameters.map((p) => p.key));
  for (const p of graph.parameters) {
    const existing = await store.findOne("parameter_groups", { key: p.key });
    if (!existing) push("parameter_group", p.key, "insert");
    else if ((await existingParamFingerprint(store, existing)) === paramFingerprint(p)) push("parameter_group", p.key, "unchanged");
    else push("parameter_group", p.key, "update");
  }

  // ── categories ──
  const graphCatKeys = new Set(graph.categories.map((c) => c.key));
  for (const c of graph.categories) {
    const existing = await store.findOne("finding_categories", { key: c.key });
    if (!existing) push("finding_category", c.key, "insert");
    else {
      const parentRow = c.parent != null ? await store.findOne("finding_categories", { key: c.parent }, { includeDeleted: true }) : null;
      const same = existing.label === c.display_name && (existing.parentId ?? null) === (parentRow?.id ?? null) && (existing.modality ?? null) === c.modality;
      push("finding_category", c.key, same ? "unchanged" : "update");
    }
  }

  // ── findings ──
  const graphFindingKeys = new Set(graph.findings.map((f) => f.id_key));
  for (const f of graph.findings) {
    const existing = await store.findOne("finding_definitions", { key: f.id_key });
    if (!existing) push("finding", f.id_key, "insert");
    else if ((await existingFindingFingerprint(store, existing, idx)) === findingFingerprint(f)) push("finding", f.id_key, "unchanged");
    else push("finding", f.id_key, "update");
  }

  // ── retirements (prune) ──
  if (opts.prune) {
    for (const g of await store.list("parameter_groups")) if (!graphParamKeys.has(g.key as string)) push("parameter_group", g.key as string, "delete", "absent from packs");
    for (const c of await store.list("finding_categories")) if (!graphCatKeys.has(c.key as string)) push("finding_category", c.key as string, "delete", "absent from packs");
    for (const f of await store.list("finding_definitions")) if (!graphFindingKeys.has(f.key as string)) push("finding", f.key as string, "delete", "absent from packs");
  }

  const insert = items.filter((i) => i.action === "insert");
  const update = items.filter((i) => i.action === "update");
  const del = items.filter((i) => i.action === "delete");
  const unchanged = items.filter((i) => i.action === "unchanged");

  const byEntity: ImportStatistics["byEntity"] = {};
  for (const it of items) {
    byEntity[it.entity] ??= { insert: 0, update: 0, delete: 0, unchanged: 0 };
    byEntity[it.entity][it.action]++;
  }

  return {
    items, insert, update, delete: del, unchanged, conflicts, warnings,
    statistics: { insert: insert.length, update: update.length, delete: del.length, unchanged: unchanged.length, byEntity },
  };
}
