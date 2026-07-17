# Universal Pathology Platform — Foundation

**Status: Platform Foundation (PR 1 of N).** This is the canonical keystone the
CARE ERP pathology/laboratory module was missing. It is additive: it introduces
no new engine that competes with an existing one, changes no existing route's
behavior, and touches no patient data. It establishes the shared *language* of
laboratory results — analytes, panels, reference intervals, critical values,
flags — that every later pathology PR extends, exactly as
`@workspace/measurements` did for radiology.

---

## 1. The keystone gap (why this is PR 1)

Before this package, a laboratory result had **no canonical identity**:

| Concept | How it lived before | Problem |
|---|---|---|
| A test | `diagnostic_tests` row: `code, name, category, price, department` | A "CBC" is one priced row — its ~14 component analytes don't exist as data. |
| A result value | `order_tests.result` (single `text`) **or** `patient_reports.parameters` (a **stringified JSON** array `[{name,value,unit,refRange,flag}]`) | `name` is free text, `refRange` is hand-typed per report, `flag` is whatever the technician chose. |
| A reference range | typed into a template, per analyte, per report | No age/sex awareness — the same Hb 11 g/dL is "normal" on one report and "low" on the next. |
| A critical value | not modelled | No panic-value engine; criticality is a manual checkbox (`patient_reports.isCritical`). |
| An analyte identity | none | "Haemoglobin" / "Hb" / "HGB" / "Hemoglobin (Hb)" are four different strings. |

This is precisely the pre-registry state radiology measurements were in before
`@workspace/measurements` (see `docs/measurement-platform/README.md`). Every
downstream capability — structured result entry, delta checks, QC, HL7/LIS
integration, auto-critical escalation, a coverage dashboard — is blocked on
there being **one identity per analyte** first.

## 2. What this package is

`lib/pathology` (`@workspace/pathology`) — pure TypeScript, **zero runtime
dependencies**, identical on client and server. Same design contract as
`@workspace/measurements` and `@workspace/report-quality`.

```
lib/pathology/src/
  contract.ts          types: AnalyteDefinition, PanelDefinition, ReferenceInterval,
                       FlagResult, PatientContext, RegistryValidationIssue…
  catalog.ts           the seed catalog — 70 analytes + 8 panels (CBC, LFT, KFT,
                       Lipid, Thyroid, Electrolytes, Diabetic Profile), with
                       age/sex reference intervals, critical values, LOINC codes
                       and every legacy spelling as an alias.
  normalize.ts         label normalization (shared with resolution)
  units.ts             the lab unit vocabulary + EXACT-only conversion
  referenceRanges.ts   resolve the interval that applies to THIS patient (sex/age/condition)
  flagging.ts          value -> HL7 flag (N/L/H/LL/HH/A/AA) + reference-range render
  registry.ts          validated, indexed registry; deterministic resolution
  bridge.ts            non-destructive enrichment of legacy `parameters` rows
  index.ts             barrel
  registry.test.ts     77 contract tests (integrity, resolution, ranges, flags, bridge, perf)
```

### Identity rules (mirrors the measurement registry)

- `id` is **stable and immutable** (`HEMOGLOBIN`, `CREATININE`, `TSH`). Display
  text may change; ids never do. Rename ⇒ deprecate + `replacedBy`.
- `canonicalKey` (`analyte.hemoglobin`, `panel.cbc`) is a permanent namespaced alias.
- `aliases` carry every legacy spelling. **Resolution is deterministic**:
  `id → canonicalKey → normalized alias → parenthetical-stripped alias`. No fuzzy matching.

## 3. The three engines

1. **Reference-range resolution** (`resolveReferenceInterval`) — given a patient
   `{sex, ageYears, condition}`, deterministically selects the most specific
   matching interval. Condition (e.g. pregnancy trimester for TSH) beats an
   age band, which beats sex; a child never inherits an adult range. When sex is
   required but unknown, it returns *no range* rather than guessing.
2. **Flagging** (`flagValue`) — turns a raw value into an HL7 Table-0078 flag:
   `N/L/H` against the reference interval, `LL/HH` against critical/panic values
   (checked first, independent of the matched range), `A/AA` for categorical
   results. Accepted alternate units are converted exactly before comparison; a
   non-convertible unit or an implausible value yields `unknown`, never a wrong flag.
3. **Legacy bridge** (`enrichLegacyParameters`) — maps each stored
   `patient_reports.parameters` row onto a canonical analyte and **recomputes**
   the reference range and flag for the patient, **without mutating the stored
   data**. This is the non-destructive migration path.

## 4. Backward compatibility & data safety

- **No schema change, no data migration, no writes.** Existing
  `patient_reports.parameters`, `order_tests.result` and the `samples` lifecycle
  are untouched.
- Enrichment happens at **read time**; originals are always preserved beside the
  canonical fields (`canonicalRefRange`, `canonicalFlag`, `flagChanged`).
- Reference intervals are **decision-support defaults**, not a replacement for a
  lab's validated method-specific ranges. A later PR adds per-lab overrides.

## 5. Consumed by

- **API** — `GET /api/pathology-registry` (admin console: catalog +
  self-validation), `GET …/coverage` (resolves the free-text parameter labels in
  existing pathology reports — a live migration-readiness score, reading only
  label *names*, never values), `POST …/flag` (pure flag preview for the
  result-entry grid). Mounted admin-only, mirroring `/measurement-registry`.
- **Frontend** — `@workspace/pathology` is wired into `diagnostic-erp`'s
  dependencies so the structured result-entry grid (next PR) can render a panel's
  analytes and preview flags directly from the registry.

## 6. Validation & performance

- Registry: **0 validation issues** (no duplicate ids, no clashing aliases, no
  bad units/ranges/ages, no panel referencing an unknown analyte, valid LOINC).
- **77 package tests** — integrity, one fixture per audited legacy spelling,
  sex/age/condition range resolution, flagging incl. panic values, unit
  conversion, categorical/titre handling, and the legacy bridge.
- Resolution ≈ **1.3 µs/lookup** (120k mixed resolves < 200 ms); all maps built
  once at module load. Live self-validation: `GET /api/pathology-registry/validation`.

## 7. Roadmap (subsequent PRs)

This PR is the language. The planned extensions, each its own well-scoped PR:

1. **DB analyte/panel tables + seeding** — persist the registry's analytes and
   panels; link `diagnostic_tests` → panel id; add `order_test_results` (one row
   per analyte per order, with canonical `analyte_id`, value, unit, flag,
   resolved range) so results become structured data, not a JSON string.
2. **Structured result-entry workspace** — a registry-driven grid (panel →
   analytes) replacing free-text `parameters`, with live flagging via `POST /flag`.
3. **Auto-critical escalation** — panic flags feed the existing
   `criticalFindings` / `isCritical` machinery automatically.
4. **Quality rules** — a pathology rule provider on the existing
   `@workspace/report-quality` engine (shadow tier), one rule per analyte range,
   exactly like the measurement Phase-4 provider.
5. **HL7/LIS ingestion** — analyzer results map to canonical analytes via
   `refs.hl7Codes` / LOINC; the sample lifecycle already exists.
6. **Per-lab reference-range overrides**, **delta checks**, and **QC** (Levey-Jennings).
7. **Pediatric/neonatal reference-interval content pack** beyond the seeded analytes.

## 8. Regression risk

**Minimal.** Every change is additive: a new pure-TS package, a new admin-only
read-only route, two `package.json` dependency lines, and one root
`tsconfig.json` project reference. No existing route, schema, or financial code
is touched. Libs build clean (`tsc --build`), api-server typechecks clean, and
the 77 package tests pass.
