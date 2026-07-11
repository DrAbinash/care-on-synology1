// ─────────────────────────────────────────────────────────────────────────────
// Radiology content-pack pipeline — public, feature-flag-gated entry points.
//
// NOTHING here executes unless ff_radiology_catalog == true. The pure internal
// functions (validatePacks / buildNormalizedGraph / dryRunImport / runImport)
// remain importable for tests; these wrappers are the guarded surface any future
// CLI/API/job must call.
// ─────────────────────────────────────────────────────────────────────────────

import { isRadiologyCatalogEnabled, FF_RADIOLOGY_CATALOG } from "../featureFlag";
import { loadPacksFromDir, loadPackFromString } from "./loader";
import { validatePacks } from "./validator";
import { buildNormalizedGraph, type NormalizedGraph } from "./graph";
import { buildCatalogSnapshot, emptyCatalogSnapshot, type CatalogSnapshot } from "./snapshot";
import { dryRunImport, type ImportPlan, type DryRunOptions } from "./dryRun";
import { runImport, type ImportResult } from "./importer";
import type { CatalogRepository } from "./repository";
import type { LoadedPack, ValidationResult } from "./types";

export class FeatureDisabledError extends Error {
  constructor() { super(`${FF_RADIOLOGY_CATALOG} is disabled — set FF_RADIOLOGY_CATALOG=true to enable content-pack operations`); this.name = "FeatureDisabledError"; }
}
function gate(): void { if (!isRadiologyCatalogEnabled()) throw new FeatureDisabledError(); }

/** K1 — validate a set of packs (against the live catalog, if a repo is given). */
export async function validateContentPacks(loaded: LoadedPack[], repo?: CatalogRepository): Promise<ValidationResult> {
  gate();
  const snapshot: CatalogSnapshot = repo ? await buildCatalogSnapshot(repo.readStore()) : emptyCatalogSnapshot();
  return validatePacks(loaded, snapshot);
}

/** K2 — dry-run: validate, normalize, and diff against the live catalog. No writes. */
export async function dryRunContentImport(
  loaded: LoadedPack[], repo: CatalogRepository, opts?: DryRunOptions,
): Promise<{ validation: ValidationResult; graph?: NormalizedGraph; plan?: ImportPlan }> {
  gate();
  const snapshot = await buildCatalogSnapshot(repo.readStore());
  const validation = validatePacks(loaded, snapshot);
  if (!validation.ok) return { validation };
  const graph = buildNormalizedGraph(loaded);
  const plan = await dryRunImport(graph, repo.readStore(), opts);
  return { validation, graph, plan };
}

/** K3 — transactional production import. */
export async function importContentPacks(loaded: LoadedPack[], repo: CatalogRepository, opts?: DryRunOptions): Promise<ImportResult> {
  gate();
  return runImport(loaded, repo, opts);
}

export { loadPacksFromDir, loadPackFromString };
export type { LoadedPack, ValidationResult, ImportPlan, ImportResult, NormalizedGraph, DryRunOptions, CatalogRepository };
