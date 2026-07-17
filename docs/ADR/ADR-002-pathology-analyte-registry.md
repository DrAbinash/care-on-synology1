# ADR-002: Universal Pathology Analyte & Panel Registry

## Status
Accepted

## Date
2026-07-17

## Context

The pathology/laboratory module was one of the weakest parts of CARE ERP. Unlike
radiology — which has a full canonical platform (`@workspace/measurements`,
`@workspace/report-quality`, knowledge packs, structured report templates) — a
laboratory result had **no canonical identity**:

- `diagnostic_tests` is a flat catalog (`code, name, category, price,
  department`). A panel such as "CBC" is a single priced row; its component
  analytes (Hemoglobin, WBC, Platelets…) do not exist as data.
- Results are stored either in `order_tests.result` (a single `text` column) or
  in `patient_reports.parameters` — a **stringified JSON** array
  `[{name,value,unit,refRange,flag}]` where `name` is free text, `refRange` is
  hand-typed on every report, and `flag` is chosen manually.
- There is no age/sex-aware reference-interval model, no panic/critical-value
  engine, no LOINC coding, and no concept of an analyte or a panel.

This is the same pre-registry state radiology measurements were in before the
Universal Measurement Registry (see ADR context in
`docs/measurement-platform/README.md`). Every downstream pathology capability —
structured result entry, auto-critical escalation, delta checks, QC, HL7/LIS
integration, quality rules — depends on there first being **one identity per
analyte**.

## Decision

Introduce `lib/pathology` (`@workspace/pathology`) — the **Universal Pathology
Analyte & Panel Registry** — as the canonical, registry-as-code source of truth
for laboratory analytes and panels, modelled directly on `@workspace/measurements`:

- Pure TypeScript, **zero runtime dependencies**, identical on client and server.
- Immutable analyte/panel `id`s; deterministic legacy-label resolution (no fuzzy
  matching); every historical spelling registered as an `alias`.
- Age/sex/condition-aware **reference-interval resolution**, an HL7-flag
  **flagging engine** (`N/L/H/LL/HH/A/AA`), and a **non-destructive bridge** that
  enriches existing `patient_reports.parameters` at read time.
- A seed catalog of 70 analytes and 8 panels (CBC, LFT, KFT, Lipid, Thyroid,
  Electrolytes, Diabetic Profile) with LOINC codes and critical values.
- Exposed via an admin-only, read-only API (`/api/pathology-registry`) mirroring
  the measurement-registry console, including a coverage scan that scores how
  much of the existing report vocabulary already resolves.

The reference intervals shipped in the catalog are **clinical decision-support
defaults**, not a replacement for a laboratory's validated, method-specific
ranges; per-lab overrides are a later PR.

## Trade-offs

- **Registry-as-code vs. a DB table.** Like the measurement and quality-rule
  catalogs, the registry is code, so it is versioned, diff-reviewable, testable
  in CI, and cannot drift from a seed table. The cost is that content changes
  ship as code changes (acceptable — clinical content changes are reviewed).
- **Seed breadth.** 70 analytes cover the common outpatient test menu, not every
  analyte. New analytes are additive; the registry validates itself in CI.
- **Pediatric coverage.** Explicit pediatric/neonatal bands are seeded only where
  age-dependence is clinically load-bearing (Hb, Hct, WBC, ALP, bilirubin,
  creatinine…). For other analytes a child's out-of-band value reports "no
  reference interval" rather than a wrong flag — safe, and a documented roadmap item.
- **Read-time enrichment vs. backfill.** No data is migrated in this PR; results
  become registry-aware at read time. A future PR persists canonical `analyte_id`
  alongside the untouched legacy fields.

## Future Review

Revisit when: DB-backed analyte/panel tables and structured `order_test_results`
land; per-lab reference-range overrides are added; or an HL7/LIS ingestion path
maps analyzer results to canonical analytes. The roadmap is tracked in
`docs/pathology-platform/README.md` §7.

## Notes

- New package: `lib/pathology/*` (+ root `tsconfig.json` project reference).
- API: `artifacts/api-server/src/routes/pathologyRegistry.ts`, mounted admin-only
  in `routes/index.ts`.
- Wiring: `@workspace/pathology` added to `api-server` and `diagnostic-erp`
  dependencies.
- Validation: registry reports **0 issues**; **77 package tests** green; full
  workspace suite green; libs and api-server typecheck clean. No existing route,
  schema, or financial code was modified.
