# CARE Clinical Content Validator

**Status: content validation — "the ESLint of the CARE Reporting Platform."**
Read-only analysis that identifies incorrect, duplicate, orphaned or
inconsistent clinical content before every release. It never modifies runtime
behavior; there is no new engine.

## 1. Audit (validators that already existed — reused, not re-implemented)

| Existing validator | Owner | What it already checks |
|---|---|---|
| `validatePack()` | Knowledge Pack engine | Per-pack section presence, dependency existence, empty-enabled errors, health |
| `GET /api/measurement-registry/validation` | Measurement Registry | Registry issues (duplicates/aliases/units), unresolved live labels, unreferenced (unused) measurements |
| Recommendation hygiene tests | `clinicalRecommendations.test.ts` | Duplicates, conflicts, orphans (test-time) |
| Platform contract suite | `platform-contract.test.ts` | Single-engine invariants, pack registry hygiene, route pinning (deploy-time) |
| Pack manifest known-keys test | contract suite | Unknown/typo manifest keys |

**The Content Validator aggregates these** and adds the missing cross-registry
layer ONCE (`lib/clinicalContentValidator.ts`): pack-level issues are *passed
through* from `validatePack` (`source: pack-validator`), measurement findings
are *passed through* from the Measurement Registry endpoint
(`source: measurement-registry`), and only the checks nothing else owned are
implemented here (`source: content-validator`).

## 2. Registry validation (Step 2)

Duplicate ids (packs, recommendations) · duplicate (modality, studyType) study
claims · unknown/broken references (recommendation→pack against the live pack
list; recommendation→quality-rule format Q###/care.*) · conflicting triggers
(same measurement × comparator × modality) · orphan/unused objects
(recommendations anchored to nothing; enabled packs with zero content;
unreferenced measurements via the registry endpoint) · circular references
(registries are reference-by-id, acyclic by construction — enforced by the
platform contract suite's dependency checks).

## 3–7. Per-area validation

- **Knowledge Packs (3):** the pack engine's own 15-section issues (missing
  protocol/template/measurements/findings/history/comparison/teaching/
  references…) pass through per pack; plus enabled-but-empty (error) and
  placeholder-but-rich (info — promote it) cross-checks.
- **Measurements (4):** unknown/conflicting units, duplicate aliases, missing
  registry links → `registryIssues`; broken live mappings → `unresolvedLabels`;
  unused → `unreferencedMeasurements` (all from the Measurement Registry's own
  validation, reused verbatim).
- **Recommendations (5):** broken measurement/quality/pack references,
  conflicting triggers, duplicates, orphans, invalid severity/priority/
  evidence, non-semver versions, incomplete action/rationale.
- **Quality rules (6):** duplicate-id/unknown-executor/invalid-severity checks
  live in the Quality Engine's own test suites (`lib/report-quality`), which
  the deploy runs — referenced, not duplicated; the validator checks the
  recommendation→rule reference format at the content layer.
- **Templates (7):** section presence per pack passes through; placeholder
  linting inside template bodies needs server-side template parsing that does
  not exist yet — documented under limitations.

## 8. Platform validation

No orphan registries / duplicate engines / broken routes: enforced continuously
by the platform contract suite (single-engine invariants, admin-route pinning,
public-API consumer checks at the v1.0 freeze) — the validator page links the
suite rather than re-running source scans in the browser.

## 9. Dashboard

`/settings/radiology/content-validator` (admin-gated), linked from the
Engineering Cockpit next to Clinical Content Coverage: health score (0–100),
error/warn/info totals + severity filter, per-area counts, every finding with
its stable code, subject, message, suggested fix and source.

## 10. Reports

Exportable **JSON** and **Markdown** (validation summary, totals, by-area,
full findings table with fixes) — the release-gate artifact.

## 11. Health score

`100 − Σ penalties`, clamped to 0–100. Penalties are **data**
(`DEFAULT_PENALTIES {error:10, warn:3, info:0.5}`, parameter everywhere) —
never hardcoded.

## 12. Remaining issues (found on the real content at build time)

The shipped registries validate **clean of errors** (proven by test + offline
run against compiled code). Expected standing findings on a live system:
pack-validator warnings on placeholder/partial packs (the coverage backlog) and
`meas.unreferenced` infos for not-yet-consumed measurements.

## 13. Performance

Two GETs (both existing-shape endpoints); pure client analysis is O(packs +
recommendations) — milliseconds at 89 packs / 53 entries; no writes, no
polling.

## 14. Technical debt

None added — one pure lib, one page, two cockpit links. No schema, no engine,
no runtime change.

## 15. Honest limitations

- **DB-level duplicate scans** inside content tables (duplicate protocol rows,
  duplicate quick findings per study) need server queries that do not exist —
  future server addition, stated in the UI footer.
- **Template placeholder linting** ({key} tokens vs known measurements) needs
  template-body parsing server-side — future work.
- **"Unused recommendation"** detection needs acceptance telemetry (same
  future table as the coverage dashboard's override metrics).
- The browser page validates what the endpoints expose; the deploy-time suites
  (contract + quality package tests) remain the authoritative gate for
  code-resident registries.
