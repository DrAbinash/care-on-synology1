# Radiology YAML Content-Pack Pipeline (Tickets K1 / K2 / K3)

Infrastructure that turns radiology **YAML content packs** into the production
**B1/B2 canonical catalog** (`lib/db/src/schema/radiologyCatalog.ts`).

> The **canonical YAML packs live in another branch** and are the source of
> truth. This module ships the complete validator + importer against **developer
> fixtures** (`__fixtures__/`) and is designed to run **unchanged** the moment
> the real packs are merged. **No clinical content is invented here.**

Everything that mutates the system is gated behind the **`ff_radiology_catalog`**
feature flag (env `FF_RADIOLOGY_CATALOG=true`, default **off**). Nothing consumes
these tables yet — no UI, no API.

## Pipeline

| Stage | File | What it does |
|-------|------|--------------|
| **K1 Validate** | `validator.ts` | Validates a *set* of packs (ids/aliases are unique across packs). Checks YAML syntax, required fields, duplicate id_keys, duplicate aliases, alias-prefix collisions, unknown shared-library refs (param/sev/loc/rec/crit/tpl), unknown categories, parameter/measurement/recommendation bindings, combo refs, extends refs, **circular extends**, AI-rule shape, enums, immutable-id_key violations, schema-version compatibility. **No partial success** — any error ⇒ `ok:false`. |
| **K2 Dry-run** | `dryRun.ts` | Diffs the normalized graph vs the live catalog → `insert / update / delete / unchanged / conflicts / warnings / statistics`. **No DB writes.** |
| **K3 Import** | `importer.ts` | Executes the plan in **one transaction**: idempotent, rollback on failure, soft-delete retired content, preserve immutable IDs, bump versions only on change, preserve aliases, and **re-diff immediately before commit**. |
| Graph | `graph.ts` | Resolves `extends` inheritance, expands combos, resolves refs to full rows. |
| Repository | `repository.ts` (in-memory) / `drizzleRepository.ts` (Postgres) | Transaction boundary for K3. |
| Loader | `loader.ts` | Parses YAML files/strings; captures syntax errors without throwing. |
| Entry points | `index.ts` | `validateContentPacks` / `dryRunContentImport` / `importContentPacks` — all **gated** by `ff_radiology_catalog`. |

## How to validate packs before committing new content

Validation is a **read-only lint** (no DB, no writes) — safe to run anytime,
and the right pre-commit / CI gate:

```bash
# from the repo root (defaults to seeds/radiology/content-packs/v1)
pnpm validate:radiology-content
# or point at a directory
pnpm validate:radiology-content path/to/packs
```

Exit code `1` on any validation error (with a detailed per-issue report); `0`
when all packs are valid, or when the packs directory does not exist yet.

Recommended: wire it into CI and/or a pre-commit hook so a broken pack can never
land.

## How to import (once the real packs are merged)

Import **mutates the catalog** and is therefore flag-gated. From runtime code:

```ts
import { importContentPacks, loadPacksFromDir } from ".../radiologyCatalog/packs";
import { DrizzleCatalogRepository } from ".../radiologyCatalog/packs/drizzleRepository";

// requires FF_RADIOLOGY_CATALOG=true
const packs = loadPacksFromDir("seeds/radiology/content-packs/v1");
const result = await importContentPacks(packs, new DrizzleCatalogRepository(), { prune: true });
// result.ok, result.plan.statistics, ...  (transactional; rolls back on any failure)
```

`prune: true` soft-deletes catalog entries that are **absent** from the packs
(treats the pack-set as the full canonical catalog). Use `prune: false` for a
partial/additive import.

## Pack format (authoring surface)

See `types.ts` for the full typed schema. A pack declares optional shared
libraries (`parameters`, `severities`, `locations`, `recommendations`,
`criticals`, `templates`), `categories`, and `findings`. A finding carries
`id_key` (immutable identity), `display_name`, `category`, `default_sentence`,
`impression_fragment`, optional `keyboard_alias`/`aliases`, `extends`,
`included_findings_ref` (combos), and bindings (`parameters` → `param.*`,
`severities` → `sev.*`, `locations` → `loc.*`, `measurements`,
`recommendations` → `rec.*`, `criticals` → `crit.*`, `template` → `tpl.*`), plus
`ai_contradiction_rules` / `ai_completeness_rules`.

`__fixtures__/valid.yaml` and `__fixtures__/packs.ts` are runnable examples.

## Mapping to the B1/B2 catalog

`parameters/options/categories/findings` and the finding bindings
(`finding_parameter_bindings`, `finding_severity_bindings`, `finding_locations`,
`finding_measurement_bindings`, `finding_recommendations`, `finding_aliases`) map
directly onto existing B1/B2 tables. `crit.*` and `tpl.*` are **validated as
references** but have no catalog table yet, so they are carried as validation-only
metadata (a future ticket may add registry tables) — **the catalog is not
redesigned here.**
