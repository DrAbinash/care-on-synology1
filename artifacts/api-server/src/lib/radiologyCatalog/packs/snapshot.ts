// ─────────────────────────────────────────────────────────────────────────────
// CatalogSnapshot — the set of keys/ids that already exist in the live catalog.
// References resolve if they point at a pack-declared entry OR a snapshot entry.
// A pure/empty snapshot lets the validator run with no DB (fixtures/tests).
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogStore } from "../store";

export interface CatalogSnapshot {
  parameterKeys: Set<string>;
  parameterOptions: Map<string, Set<string>>;   // group key → option keys
  categoryKeys: Set<string>;
  findingKeys: Set<string>;
  findingIdByKey: Map<string, number>;           // id_key → surrogate id (immutability + upsert)
  severityKeys: Set<string>;
  locationKeys: Set<string>;
  recommendationKeys: Set<string>;
  criticalKeys: Set<string>;
  templateKeys: Set<string>;
  aliasOwner: Map<string, string>;               // normalized alias → owning finding id_key
}

export function emptyCatalogSnapshot(): CatalogSnapshot {
  return {
    parameterKeys: new Set(),
    parameterOptions: new Map(),
    categoryKeys: new Set(),
    findingKeys: new Set(),
    findingIdByKey: new Map(),
    severityKeys: new Set(),
    locationKeys: new Set(),
    recommendationKeys: new Set(),
    criticalKeys: new Set(),
    templateKeys: new Set(),
    aliasOwner: new Map(),
  };
}

/** Build a snapshot from the live catalog (used by K2 dry-run and K3 import). */
export async function buildCatalogSnapshot(store: CatalogStore): Promise<CatalogSnapshot> {
  const snap = emptyCatalogSnapshot();

  for (const g of await store.list("parameter_groups")) snap.parameterKeys.add(g.key as string);
  for (const o of await store.list("parameter_options")) {
    const g = await store.getById("parameter_groups", o.groupId as number);
    if (g) {
      const set = snap.parameterOptions.get(g.key as string) ?? new Set<string>();
      set.add(o.key as string);
      snap.parameterOptions.set(g.key as string, set);
    }
  }
  for (const c of await store.list("finding_categories")) snap.categoryKeys.add(c.key as string);
  // Resolve alias ownership even for soft-deleted findings (aliases are preserved
  // across retire/resurrect), so a re-imported finding's own aliases never read
  // as duplicates against itself.
  const findingKeyById = new Map<number, string>();
  for (const f of await store.list("finding_definitions", { includeDeleted: true })) findingKeyById.set(f.id, f.key as string);
  for (const f of await store.list("finding_definitions")) {
    snap.findingKeys.add(f.key as string);
    snap.findingIdByKey.set(f.key as string, f.id);
  }
  for (const s of await store.list("finding_severity_bindings")) snap.severityKeys.add(s.key as string);
  for (const l of await store.list("finding_locations")) snap.locationKeys.add(l.key as string);
  for (const a of await store.list("finding_aliases")) {
    const owner = findingKeyById.get(a.findingId as number);
    if (owner) snap.aliasOwner.set(a.normalized as string, owner);
  }
  // recommendations/criticals/templates have no shared catalog table yet — pack-declared only.
  return snap;
}
