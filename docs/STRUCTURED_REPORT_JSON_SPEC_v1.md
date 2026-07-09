# Canonical Structured Report JSON — Specification v1

**Ticket:** D1 (design only — no application code)
**Status:** Implementation specification for the engineering phase **after C1**
**Document revision:** 2 — corrected after an adversarial 9-lens review against the real B1/B2 catalog, K1 pipeline, and repo (see §20 for the full list of corrections). `schema_version` inside the document format itself remains `1.0.0` — nothing has shipped or been signed against revision 1, so this is a same-version correction, not a breaking change.
**Columns this document governs:** `radiology_report_drafts.structured_json`, `patient_reports.structured_json` (both to be added as `jsonb`, nullable — see §13)
**Depends on:** B1/B2 canonical catalog (`finding_definitions`, `parameter_groups`/`parameter_options`, `finding_*_bindings`, `finding_aliases`), K1/K2/K3 content-pack validator/importer, C1 (finding/measurement domain model)
**Non-goals of D1:** no runtime code, no migrations, no API endpoints, no DB import, no rendering changes. This document defines *what the JSON is*; later phases build the writer/reader/validator/renderer against it.

---

## 0. Design principles

1. **The JSON is the source of truth for structure; prose is a projection.** `structured_json` holds the machine-readable clinical content. The existing prose columns (`radiology_report_drafts.findingsSections`/`impression`, `patient_reports.body`) remain the rendered form and stay authoritative for legacy rows. New reports write **both**; the renderer is not changed by this ticket (coexistence — see §13).
2. **Everything clinical resolves to a shared library — but not every library lives in a B1/B2 table yet.** Findings and parameters/options resolve to real, globally-keyed B1/B2 catalog rows. Severities/locations/measurements are catalog-backed but **scoped to the owning finding** (see §1.4) — they are not global scales. Recommendations/criticals/templates resolve to the **content-pack-level registries the K1 validator already enforces**, not a dedicated B1/B2 table (none exists yet — see §1.4 and §11.3). This precision is itself a fix: the original draft of this spec claimed uniform global catalog resolution for all nine reference kinds, which does not hold against the real schema.
3. **Every clinical atom carries provenance and (if AI-derived) a reproducible AI pin.** This closes the medico-legal traceability gaps identified in the pre-implementation risk review (AI text indistinguishable from radiologist text; no prompt/model/input pinning; no anti-laundering check that an AI-produced atom cannot masquerade as human-authored).
4. **A finalized document is byte-verifiable against its own stamped rules; it is not a live promise that the catalog never changes underneath it.** A finalized report freezes a `content_sha256` over a precisely-canonicalized serialization (§10), so tampering with the stored bytes is always detectable. What is **not** guaranteed: that re-running referential validation (R1/R4/R5/R6/R8) against the *live* catalog years later still passes — the catalog is mutated in place (B1/B2 rows are updated, not versioned as immutable history) and `catalog_snapshot` pins *labels*, not a *frozen data snapshot*. The reproducibility guarantee that **is** real: the pinned `sentence`/`impression_fragment`/`display` strings (§2.2) render identically forever, because they are stored verbatim, not re-derived from a live lookup. This downgrade from the original draft's "validates identically for its full 10-year retention" is deliberate and explained fully in §2.4.
5. **Open for extension, closed for corruption.** Core objects reject unknown keys via `additionalProperties: false`, **except** for the `^x_` pattern, which every core object explicitly allows via `patternProperties` (so the extension channel in principle 6 is not self-contradictory — see §1.5 and §11).
6. **Additive and dormant.** The columns are nullable; nothing consumes them until a later phase; legacy rows stay null and keep using prose.

---

## 1. Versioned JSON schema

### 1.1 Envelope

The column stores a single JSON object with this top-level shape:

```json
{
  "schema_version": "1.0.0",
  "kind": "radiology.structured_report",
  "document_id": "01J9Z6Q2K7X8Y0AB3C4D5E6F7G",
  "catalog_snapshot": {
    "content_pack_versions": { "abdomen.usg": "1.4.0", "neuro.mri": "2.1.0" },
    "catalog_schema_version": "1.0.0",
    "ai_rules_version": { "neuro.mri": "2.1.0" }
  },
  "study_context": { "...": "§3.1" },
  "sections": [ "...ordered display sections, §7.4 — OPTIONAL, derivable" ],
  "findings": [ "...§3" ],
  "measurements": [ "...§4" ],
  "impression": { "...": "§7" },
  "recommendations": [ "...§6" ],
  "critical_flags": [ "...§3.6" ],
  "provenance": { "...document-level, §8" },
  "ai": { "...§9" },
  "audit": { "...§10" },
  "extensions": { "...§11" }
}
```

`catalog_snapshot` and `ai.guarding` are now **required** top-level members (see §1.5) — the resolution model (R1/R4) and the AI-never-auto-signs invariant (R13) both depend on them being present, not merely conventionally populated.

### 1.2 `schema_version` semantics (semver)

| Component | Bumped when | Reader obligation |
|---|---|---|
| **major** (`X`.0.0) | A field is removed/renamed/retyped, or a required field is added — an old reader can no longer safely parse. | Must run the registered up-migration `from→to` (§2.3) before reading. |
| **minor** (1.`X`.0) | A new **optional** field or a new enum value is added. | See §2.1 — structural validation runs only against the document's own stamped `schema_version`; readers on an older schema fall back to the rendered-prose net rather than attempting (and failing) strict validation against a newer document. |
| **patch** (1.0.`X`) | Documentation/constraint clarification, no structural change. | None. |

`schema_version` is **write-stamped** by the producer and **never** silently rewritten on a finalized document.

> **Clarifying note (corrects an internal contradiction in the original draft):** `additionalProperties:false` on core objects means a *strict validator* holding only the v1.0 schema will reject a v1.1 document that adds a new optional field, because that field is "additional" from the v1.0 schema's point of view. This is expected and correct — it is not a forward-compat violation, because **structural (tier A) validation is always performed against the schema matching the document's own stamped `schema_version`**, never against a different version. "Ignore unknown fields/enum values gracefully" (§2.1) is a **rendering/read-path** behavior for a reader that does not have the newer schema available at all (e.g., an old renderer opening a doc from a newer app version) — that reader does not run strict JSON-Schema validation; it walks the object defensively and falls back to `sentence`/`rendered` strings for anything it does not recognize. A conformant *validator* must always possess (or fetch) the schema for the version it is validating.

### 1.3 Identifiers

- `document_id` — a **ULID**, minted once when the structured document is first created; stable for the life of the report; distinct from the row `id`. Canonical form: Crockford Base32, **exactly 26 characters**, pattern `^[0-9A-HJKMNP-TV-Z]{26}$` (excludes `I`, `L`, `O`, `U` to avoid visual ambiguity — the example IDs in §17 are regenerated to conform to this exact pattern, unlike the earlier draft's 25-character, `I`/`O`-containing placeholders). ULID (not UUIDv7) chosen for a case-insensitive-safe, sortable, offline-mintable, collision-free identifier — aligns with risk-review C1's identity-strategy recommendation.
- **`lid` (local id)** — every finding / measurement / impression fragment / recommendation / critical flag / section instance carries a short `lid` (e.g. `"f1"`, `"m1"`, `"imp1"`) that is **unique within the document** (enforced document-wide, across all arrays — R3) and **immutable for the life of the document**. Cross-references inside the document use `lid`; references into shared libraries use the namespaced `*_ref` syntax (§1.4).

### 1.4 Reference syntax (into shared libraries) — corrected grammar

A reference is the string `"<namespace>.<key>"`, parsed by splitting on the **first** `.` only. Everything after that first dot is `<key>`, taken **verbatim** and never further parsed — this matters because B1/B2 catalog keys are themselves allowed to contain dots (e.g. `finding_definitions.key = "liver.simple_cyst"`, matching the K1 `id_key` convention), so `<key>` is opaque, not a nested path.

| Namespace | Resolves to | Scope | Example |
|---|---|---|---|
| `finding.` | `finding_definitions.key` | **Global** (unique across the whole catalog) | `finding.liver.simple_cyst` |
| `param.` | `parameter_groups.key` | **Global** | `param.echogenicity` |
| `sev.` | `finding_severity_bindings.key` | **Finding-scoped** — resolved WHERE `findingId` = the finding's own `definition_ref` row, not a global scale registry | `sev.fazekas_2` (bare key, resolved only within the finding that declares it) |
| `loc.` | `finding_locations.key` | **Finding-scoped**, same as `sev.` | `loc.periventricular` |
| `meas.` | `finding_measurement_bindings.key` | **Finding-scoped**, same as `sev.`/`loc.` — and because `finding_measurement_bindings.findingId` is `NOT NULL` in the real schema, **every** measurement that uses a `meas.` ref **must** carry a non-null `finding_ref` (§4; there is no finding-independent measurement registry) | `meas.canal_ap_diameter` |
| `lat.` | **Not a catalog table** — a fixed closed vocabulary owned by this spec (§18): `left \| right \| bilateral \| midline \| na \| none` | Structural (tier A) enum, not a catalog lookup | `lat.right` |
| `rec.` | The **content-pack-level recommendations registry** validated by K1 (`recommendations: [{code, text, priority}]` in a pack) — **not** a dedicated B1/B2 table (`finding_recommendations` has no `code`/global-key column today) | Resolved against packs at **import time** (K1/K3); the structured-report validator treats a well-formed `rec.<code>` as valid without re-querying a live table, since none exists (see §11.3) | `rec.followup_usg_6mo` |
| `crit.` | The **content-pack-level criticals registry** validated by K1 — no dedicated B1/B2 table exists yet | Same as `rec.` | `crit.acute_infarct` |
| `tpl.` | The **content-pack-level templates registry** validated by K1 — no dedicated B1/B2 table exists yet | Same as `rec.` | `tpl.mri_brain_plain` |
| `combo.` | The **content-pack-level combo/macro registry** (a finding materialized via `included_findings_ref`) | Same as `rec.` | `combo.brain.normal_baseline` |
| `aiprompt.` | `ai_prompt_templates.key` (**mutable version pointer** — see §9.1's `prompt_digest` for the actual reproducibility guarantee) | Global | `aiprompt.impression.neuro` |

**Parameter option values are never written as a three-segment dotted string** (`param.<group>.<option>` was ambiguous — a `parameter_options.key` may itself contain dots, so "where does the group end and the option begin" is undecidable from the string alone). Instead, a parameter-value entry is always the explicit two-field form:
```json
{ "param": "param.echogenicity", "option": "anechoic", "label": "Anechoic" }
```
where `option` is `parameter_options.key` **verbatim** (opaque, unparsed), scoped unambiguously by the sibling `param` field.

> **Resolution rule:** `finding.`/`param.` refs resolve against the live catalog at write time; `sev.`/`loc.`/`meas.` resolve against the specific finding's own bindings (folded into R4, not a separate global R1 lookup); `rec.`/`crit.`/`tpl.`/`combo.` are validated by the K1 pipeline at catalog-import time and are **not** re-verified per document (no live table backs them — see §11.3 for the honest state of coding/interop hooks). `lat.` is a structural enum. See §2.4 for what "resolves deterministically" does and does not guarantee over the document's 10-year life.

### 1.5 JSON Schema (normative skeleton, Draft 2020-12)

The full JSON Schema ships as `schemas/structured-report-v1.schema.json` in the C1-successor phase. Skeleton:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://care.local/schemas/structured-report/v1.json",
  "type": "object",
  "required": ["schema_version", "kind", "document_id", "catalog_snapshot", "study_context", "findings", "provenance", "audit"],
  "patternProperties": { "^x_": true },
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "kind": { "const": "radiology.structured_report" },
    "document_id": { "type": "string", "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$" },
    "catalog_snapshot": { "$ref": "#/$defs/catalogSnapshot" },
    "study_context": { "$ref": "#/$defs/studyContext" },
    "sections": { "type": "array", "items": { "$ref": "#/$defs/section" } },
    "findings": { "type": "array", "items": { "$ref": "#/$defs/finding" } },
    "measurements": { "type": "array", "items": { "$ref": "#/$defs/measurement" } },
    "impression": { "$ref": "#/$defs/impression" },
    "recommendations": { "type": "array", "items": { "$ref": "#/$defs/recommendation" } },
    "critical_flags": { "type": "array", "items": { "$ref": "#/$defs/criticalFlag" } },
    "provenance": { "$ref": "#/$defs/documentProvenance" },
    "ai": { "$ref": "#/$defs/aiBlock" },
    "audit": { "$ref": "#/$defs/auditBlock" },
    "extensions": { "$ref": "#/$defs/extensions" }
  },
  "$defs": {
    "...": "each object §3–§11; every core $def sets \"patternProperties\":{\"^x_\":true} ALONGSIDE \"additionalProperties\":false — in Draft 2020-12, patternProperties is evaluated before additionalProperties rejects a key, so x_* fields pass while any other unknown key still fails. This is what makes design principle 5 actually implementable."
  }
}
```

`ai.guarding.auto_sign` is a **required boolean** inside the (required) `ai` object — see §9.1. If a document genuinely has no AI involvement, `ai = { "runs": [], "guarding": { "auto_sign": false } }` is still written (not omitted), so R13 is always structurally evaluable.

---

## 2. Backward compatibility strategy

### 2.1 Forward-compatible reads (minor changes)
A **rendering/read path** without the newer schema **must ignore** unknown optional fields and unknown enum values it does not recognize, degrading gracefully (e.g., render the stored `sentence` even if a new parameter kind is unknown). A minor bump never requires a migration. This is distinct from **structural validation**, which always runs against the document's own stamped `schema_version` (§1.2) — the two are not in tension once separated this way.

### 2.2 The `sentence`/`impression_fragment` safety net
Every finding stores its **rendered** `sentence` and `impression_fragment` (§3.4) alongside its structured refs. If a future reader cannot interpret a structured atom (unknown param, retired catalog key, or a catalog row whose label has since changed), it **always** has faithful, frozen-at-authoring-time prose to display. No report is ever unreadable due to schema drift **or catalog drift**. This is the core backward-compat *and* long-term-reproducibility guarantee (see §2.4 for why it is the guarantee that matters, not live re-resolution).

### 2.3 Up-migration registry (major changes)
Breaking changes ship with a pure, deterministic converter registered `from_version → to_version`:
```
migrate("1.x", "2.0", doc) -> doc'    // total function, no IO, unit-tested with golden fixtures
```
Rules:
- **Drafts** (`radiology_report_drafts`) may be migrated **in place** (rewrite the column).
- **Finalized** (`patient_reports`) documents are **never** mutated in place. Migration is applied **on read** (lazy, in-memory) so the stored, hashed, signed bytes remain the legal record. An optional batch job may write a *new revision* that preserves the original + records the migration in `audit.revisions` (§10) with `provenance.origin = "schema_migration"`.
- Converters are chained (1.0→1.1→2.0) so only adjacent steps are maintained.
- **Ordering rule (fixes an original-draft gap):** signature/hash verification (R14) **always** runs against the document's **original stored serialization**, at its **own stamped `schema_version`**, **before** any up-migration is applied for display. A migrated in-memory copy is never what gets hash-verified — verifying a migrated copy against a hash computed pre-migration would always fail, and verifying it against a hash *recomputed post-migration* would prove nothing about the original signed bytes.

### 2.4 Catalog evolution vs. document stability — what is and is not guaranteed

The catalog (B1/B2) is versioned per-row (`status`, `version` columns) and soft-delete-only, but rows are **mutated in place** — there is no immutable historical snapshot of a finding's label, a measurement binding's unit, or an option's code value at any past point in time. `catalog_snapshot.content_pack_versions` pins the **content-pack version labels** that were active at authoring time; it is **not** a frozen copy of the catalog's data.

Consequences, stated honestly (correcting the original draft's overclaim):
- **Guaranteed for the life of the document:** the pinned rendered strings (`sentence`, `impression_fragment`, `display`, `rendered`) are stored verbatim and never change. A finalized report reads identically forever regardless of what happens to the live catalog afterward.
- **Guaranteed at authoring/finalize time only, not re-verified later:** referential resolution (R1/R4/R5/R6/R8) is validated **once**, at write/finalize time, against the catalog as it existed at that moment. **It is never re-run against a finalized document on a later read.** If `finding_measurement_bindings.unit` for some catalog row is edited from `mm` to `cm` next year, an old document's `unit:"mm"` value does not retroactively become "wrong" — it was correct when written, and the document is not asked to re-prove that against a catalog that has since changed.
- **Not guaranteed:** that a live re-import of the same finding/measurement, or any tooling that re-resolves `*_ref`s against the *current* catalog, will reconstruct byte-identical results to what was true at authoring time. Analytics/export tooling that needs point-in-time fidelity should read the pinned rendered values and the pinned scalar `value`/`unit` on each atom (which are self-contained, not re-derived), not re-join against live catalog tables for historical reports.
- A future ticket **may** introduce an immutable, append-only catalog-snapshot store (freezing binding/option/label rows per content-pack version) to make live re-resolution safe for old documents; that is out of scope for D1 and is not assumed by any rule in §12.

### 2.5 Compatibility matrix (what is / isn't a breaking change)

| Change | Semver | Migration? |
|---|---|---|
| Add optional field to a finding | minor | no |
| Add new `provenance.origin` value not yet in the documented list | minor | no — R10 only requires a non-empty string + valid timestamp (§12), not closed-set membership; an unrecognized-but-valid value is a **warning**, never a reject |
| Add a new namespace (e.g. `bodysite.`) | minor | no |
| Make an optional field required | **major** | yes |
| Rename `sentence` → `rendered_text` | **major** | yes |
| Change `measurement.value` from number to object | **major** | yes |
| Retire a catalog key | none (catalog concern) | no — pinned rendered strings are unaffected (§2.4) |

---

## 3. Canonical finding representation

A **finding instance** is one asserted (or explicitly-normal/absent) clinical observation in this report, bound to a catalog `finding_definitions` row.

### 3.1 `study_context`
```json
{
  "modality": "MRI",
  "body_region": "brain",
  "study_type": "plain",
  "template_ref": "tpl.mri_brain_plain",
  "laterality_default": "lat.na",
  "comparison": { "has_prior": true, "prior_study_ref": "ACC-20260512-MR-014", "interval_note": "3 months since prior" },
  "identifiers": {
    "study_instance_uid": "1.2.840.113619.2.55.3.604688.1",
    "accession_number": "ACC-20260709-MR-014",
    "patient_ref": { "system": "care.patient_id", "value": "PAT-000481" },
    "study_datetime": "2026-07-09T09:55:00Z",
    "referring_physician_ref": { "system": "care.staff", "value": "dr_mehta" },
    "performing_physician_ref": { "system": "care.staff", "value": "tech_priya" }
  }
}
```
`identifiers` is the subject/study binding a signed report needs to be tamper-evident *as belonging to this patient and study* — without it, `content_sha256` (§10) protects the report's clinical content but not the report↔patient↔study linkage, and DICOM-SR/FHIR export (§11) has no subject to attach to. `identifiers` is included in the hashed content (§10).

### 3.2 Finding object
```jsonc
{
  "lid": "f1",
  "definition_ref": "finding.brain.small_vessel_ischemia",
  "presence": "present",              // present | absent | normal | indeterminate
  "certainty": "definite",            // definite | probable | possible | cannot_exclude
  "laterality": "lat.bilateral",      // optional; lat.* (structural enum) or null
  "locations": ["loc.periventricular", "loc.deep_white_matter"],  // finding-scoped, bare keys (§1.4)
  "severity": "sev.fazekas_2",        // optional; finding-scoped severity key (§1.4)
  "interval_change": null,            // optional; new | stable | increased | decreased | resolved | null — see §3.7
  "parameters": [ "...§5" ],
  "measurement_refs": ["m1"],         // lids of measurements in the top-level measurements[] OWNED by this finding (§12-R2b: exact match, not shared)
  "sentence": "Scattered T2/FLAIR hyperintensities in the periventricular and deep white matter, Fazekas grade 2.",
  "impression_fragment": "Moderate chronic small vessel ischemic changes.",
  "sentence_source": "content_pack_default",  // content_pack_default | rule | edited | manual
  "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false },
  "included_from": null,              // §3.5 combos / included_findings_ref — null for directly-authored findings
  "provenance": { "...§8.2" },
  "ai": { "...§9.2" },
  "order": 10
}
```

Rules:
- `definition_ref` **must** resolve against `finding_definitions.key` (§12-R1).
- `severity`, `locations[]`, each `parameters[].param` must be a binding that actually exists **for this specific `definition_ref`** — resolved by looking up `finding_severity_bindings`/`finding_locations`/`finding_parameter_bindings` `WHERE findingId = <the row behind definition_ref>` (§12-R4). `laterality` is validated against the fixed `lat.*` enum (§18), not a catalog lookup.
- `sentence` and `impression_fragment` are **always present and rendered** (backward-compat + reproducibility net, §2.2), even for `presence:"normal"`.
- A `presence:"absent"` or `"normal"` finding **must not** carry a positive severity and no measurement it owns may be `abnormal:true` (§12-R7 clinical consistency).

### 3.3 Presence semantics
| `presence` | Meaning | Renders in |
|---|---|---|
| `present` | Abnormality asserted | Findings + (if significant) Impression |
| `normal` | Structure explicitly reported normal | Findings (normal statement) |
| `absent` | Pertinent negative explicitly excluded | Findings (negative statement) |
| `indeterminate` | Seen but not characterizable | Findings + Impression (recommend further work-up) |

### 3.4 Rendered text pinning
`sentence` is the finding's `default_sentence` (K1) with its parameter values interpolated at author time and then optionally edited. `sentence_source = "edited"` marks radiologist departure from the catalog default; `impression_fragment` mirrors the catalog `impression_fragment`. Storing the rendered strings is mandatory (immutability + backward-compat, §2.2/§2.4).

### 3.5 Composition: `included_from`, combos, `extends`
- A **directly quick-selected or manually authored** finding always has `included_from: null`. (Corrects an inconsistency in the original draft's examples, where a normal-survey finding's `included_from.ref` pointed at its *own* `definition_ref` — meaningless self-reference. `included_from` is only ever populated when a *different* parent macro materialized this finding as a side effect.)
- **`included_findings_ref`** (content-pack macro): when a finding is materialized because a parent finding's `included_findings_ref` list named it, the materialized finding carries `included_from = { "kind": "included_findings_ref", "ref": "finding.<parent_key>" }` — `ref` names the **parent**, never the finding's own key.
- **Combo tile**: a single Quick Select tile that emits several findings — each emitted finding carries `included_from = { "kind": "combo", "ref": "combo.brain.normal_baseline", "tile_lid": "..." }`. `combo.` is a registered namespace (§1.4), resolved at K1/K3 import time.
- **`extends`** is resolved at the **catalog/content-pack** layer (K1/K2), not here; by the time a finding reaches `structured_json` it is fully expanded (inherited bindings already merged in, per the K1 pipeline's `buildNormalizedGraph`). The document records the provenance of the *expansion outcome*, not the unresolved `extends` chain.

### 3.6 Critical flags
```json
{
  "lid": "crit1",
  "critical_ref": "crit.acute_infarct",
  "finding_ref": "f1",
  "status": "raised",                 // raised | acknowledged | communicated
  "raised_at": "2026-07-09T10:12:03Z",
  "raised_by": "dr_abinash",
  "provenance": { "...§8.2" }
}
```
Acknowledgement/communication workflow state also lives in the DB (`patient_reports.critical_*`); the structured document records that a critical was raised, by whom, and against which finding. `critical_ref` is validated against the content-pack criticals registry (§1.4, §12-R1) — not a live B1/B2 table.

### 3.7 Interval change (optional; schema capability only — not exercised in §17's five examples)
A finding may optionally carry `interval_change ∈ {new, stable, increased, decreased, resolved}` when `study_context.comparison.has_prior = true`, and a measurement may carry `prior_value`/`prior_measurement_ref`/`change_pct` (§4) for quantitative trending. This closes a capability gap relative to the existing `radiology_lesion_timeline.changeStatus`/`changePercent` columns. **None of the five worked examples in §17 exercises this** (all set `has_prior:false`); a follow-up worked example with a real prior study is recommended before this capability is considered validated end-to-end (see §20).

---

## 4. Measurement representation

Measurements are **first-class** objects in the top-level `measurements[]`. Because `finding_measurement_bindings.findingId` is `NOT NULL` in the real B1/B2 schema, **every measurement whose `measurement_ref` uses the `meas.` namespace must carry a non-null `finding_ref`** — there is no finding-independent measurement registry today (correcting the original draft's "belongs to no abnormality" framing). Study-level biometry (e.g. organ measurements taken during a normal survey) attaches to the relevant normal/survey finding for its body region, exactly as the worked examples in §17 already do.

```jsonc
{
  "lid": "m1",
  "measurement_ref": "meas.kidney_length",    // finding-scoped key (§1.4) — resolved within finding_ref's own bindings
  "finding_ref": "f1",                        // REQUIRED (non-null) for any meas.*-backed measurement
  "site": "loc.kidney_right",                 // optional; finding-scoped loc.* anatomical site
  "laterality": "lat.right",
  "value": 102.0,                              // canonical NUMERIC value (never a display string)
  "unit": "mm",                                // UCUM-compatible; must match the catalog binding's unit (§12-R5)
  "value_kind": "scalar",                      // scalar | ratio | range | derived | index | date
  "value_iso": null,                           // ISO-8601 date/datetime, used only when value_kind="date" (e.g. EDD)
  "range": null,                               // {"low":x,"high":y} when value_kind=range
  "components": null,                          // for derived, e.g. EFW inputs; array of {measurement_ref,value,unit}
  "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" },
  "abnormal": false,
  "prior_value": null,                          // optional; prior study's value for the same measurement_ref+site
  "prior_measurement_ref_document": null,       // optional; document_id of the prior report this prior_value came from
  "change_pct": null,                           // optional; ((value - prior_value) / prior_value) * 100
  "provenance": {
    "origin": "measurement_import",            // see §18 for the full canonical origin list (now includes "calculated" and "ocr")
    "source": "dicom_sr",                      // manual | dicom_sr | ocr | ai | calculated — the RAW-DATA source, a narrower/different question than origin (see note below)
    "confidence": 0.98,                         // 0..1 (preferred) — legacy low/med/high maps to 0.3/0.6/0.9
    "sop_instance_uid": "1.2.840...",          // frame/image traceability when source=dicom_sr
    "frame_number": 12,
    "captured_at": "2026-07-09T10:05:11Z",
    "actor": "OHIF",
    "edited": false
  },
  "display": "Right kidney: 102 mm (normal)"
}
```

**`origin` vs `source` (previously conflated — now explicit):** `provenance.origin` (§8.2, §18) answers *how this atom entered the document* (manual entry, quick-select, AI suggestion, import, in-app calculation, …) and is the field validated by R10/R11. `provenance.source` is a **measurement-only**, narrower field answering *what kind of raw data backed the value* (a DICOM-SR object, an OCR read, a manual keystroke, an AI extraction, or an in-app calculation). The two vocabularies legitimately overlap (`calculated` and `ocr` are valid values for both) because they answer related-but-different questions; only `origin` is subject to R10/R11's presence and AI-linkage rules.

Rules:
- `value` is **always numeric** (or `null` if only qualitative, or an ISO-8601 string in `value_iso` when `value_kind="date"`). Display strings live in `display`, never in `value` (fixes the `usg_measurements.bpd = text` anti-pattern).
- `unit` **must** be UCUM-expressible and **must** equal the catalog binding's unit for `measurement_ref` scoped to `finding_ref` (§12-R5), unless an explicit `x_unit_conversion` extension is present.
- `value_kind = "derived"` requires `components[]` (auditability of calculated values like EFW, RI). `value_kind = "date"` requires `value_iso` and is how obstetric EDD is represented (see §11.4 for the fuller obstetric note).
- `measurement.source` enum aligns with existing `usg_measurements.source` (`dicom_sr | ocr | manual`) plus `ai | calculated`.
- Every measurement carries independent `provenance` (image-level traceability for medico-legal defense).
- **(New rule, §12-R2b)** For every finding `F` and every `lid` in `F.measurement_refs`, the referenced measurement `m` **must** have `m.finding_ref === F.lid` exactly (not merely "F or null" — a measurement belongs to exactly one finding once `finding_ref` is mandatory).

**Ratio/index example (Doppler RI):**
```json
{ "lid": "m5", "measurement_ref": "meas.doppler_ri", "finding_ref": "f2",
  "value": 0.78, "unit": "1", "value_kind": "index",
  "components": [
    {"measurement_ref": "meas.doppler_psv", "value": 82, "unit": "cm/s"},
    {"measurement_ref": "meas.doppler_edv", "value": 18, "unit": "cm/s"}
  ],
  "normal_range": {"low": 0.55, "high": 0.70, "unit": "1", "source": "catalog"}, "abnormal": true,
  "provenance": {"origin":"calculated","source":"calculated","confidence":0.9,"edited":false},
  "display": "RI 0.78 (elevated)" }
```

---

## 5. Parameter representation

Parameters are the **structured attributes** of a finding (echogenicity, margin, signal, disc-level, etc.). They live **inside** the finding (`parameters[]`) because a parameter value is only meaningful in a finding's context. Each entry names its `param` group and, for option-typed parameters, its `option` **as a separate field** — never as a re-dotted path (§1.4).

```jsonc
"parameters": [
  { "param": "param.echogenicity",     "kind": "option",  "option": "anechoic",     "label": "Anechoic" },
  { "param": "param.margin",           "kind": "option",  "option": "well_defined", "label": "Well-defined" },
  { "param": "param.size_category",    "kind": "option",  "option": "small",        "label": "Small" },
  { "param": "param.wall",             "kind": "boolean", "value": false,           "label": "Wall: thin" },
  { "param": "param.count",            "kind": "numeric", "value": 2, "unit": "count" }
]
```

Rules:
- `kind ∈ {option, numeric, boolean, text}` and **must** match the catalog `parameter_groups.data_type` for `param` (§12-R6).
- `option` (when `kind=option`) **must** be a `parameter_options.key` of that group (§12-R6) — resolved as the bare `option` string within the named `param` group, never parsed out of a combined path.
- `label` is the rendered display value, pinned for backward-compat.
- A finding's **required** parameters (per `finding_parameter_bindings.required`) **should** be present before finalization but **may be absent on a draft** (§12-R8 is warn-on-save, block-finalize — an in-progress draft is allowed to have unfilled required parameters).
- `allow_multiple` parameters (per catalog) may appear more than once for the same `param`; otherwise a `param` appears at most once per finding (§12-R6).

---

## 6. Recommendation representation

```jsonc
"recommendations": [
  {
    "lid": "rec1",
    "recommendation_ref": "rec.followup_usg_6mo",   // rec.* content-pack registry code (§1.4); or null for free-text
    "finding_refs": ["f3"],                          // findings this recommendation follows from
    "text": "Suggest follow-up ultrasound in 6 months to confirm stability.",
    "priority": "routine",                           // routine | urgent | critical
    "provenance": { "...§8.2" },
    "ai": { "...§9.2" }
  }
]
```

Rules:
- `recommendation_ref` is validated against the content-pack `rec.*` registry (§1.4) when non-null; **no duplicate recommendation codes** — no two recommendations in the document share the same non-null `recommendation_ref` unless they attach to disjoint `finding_refs` (§12-R9, mirrors K1's "no duplicate recommendation codes" check at import time).
- `finding_refs[]` must be valid `lid`s of findings present in the document (§12-R2).
- A `priority:"critical"` recommendation should correspond to a `critical_flags[]` entry.

---

## 7. Impression fragments

The impression is assembled from **fragments**, each traceable to its source finding, plus the final ordered rendered lines.

```jsonc
"impression": {
  "fragments": [
    { "lid": "imp1", "finding_ref": "f1", "text": "No acute intracranial abnormality.",
      "source": "finding_fragment", "rank": 1, "provenance": {"...":"§8.2"}, "ai": null },
    { "lid": "imp2", "finding_ref": "f2", "text": "Moderate chronic small vessel ischemic changes (Fazekas 2).",
      "source": "ai_suggestion", "rank": 2, "provenance": {"...":"§8.2"}, "ai": {"...":"§9.2 — REQUIRED whenever source=ai_suggestion, see R11"} }
  ],
  "items": [
    { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. No acute intracranial abnormality." },
    { "lid": "impi2", "fragment_refs": ["imp2"], "text": "2. Moderate chronic small vessel ischemic changes (Fazekas 2)." }
  ],
  "rendered": "IMPRESSION:\n1. No acute intracranial abnormality.\n2. Moderate chronic small vessel ischemic changes (Fazekas 2)."
}
```

Rules:
- Each `fragments[].finding_ref` (when non-null) must be a valid finding `lid` (§12-R2). `source ∈ {finding_fragment, rule, manual, ai_suggestion}`.
- `items[]` is the ordered impression the radiologist approved; `rendered` is the exact prose (backward-compat + immutability).
- `impression_fragment` on a finding (§3.2) is the *candidate*; an `impression.fragments[]` entry is the *accepted* fragment (may be edited; `source:"finding_fragment"` + edited flag in provenance).
- **Any fragment with `source="ai_suggestion"` must carry a non-null `ai` block satisfying R11** (§9.2) — this was a gap in the original worked example (§17.1's `imp2`), now fixed.

### 7.4 `sections[]` (display ordering) — optional and derivable
`sections[]` is an **optional**, renderer-facing list binding structured content to display layout:
```json
{ "lid": "s3", "kind": "findings", "title": "FINDINGS",
  "finding_refs": ["f1","f2"], "measurement_refs": ["m1"], "rendered": "…prose…" }
```
`kind ∈ {clinical_history, technique, comparison, findings, impression, recommendation, advice}`. **`sections[]` is not required, including for finalized documents** — a renderer without a stored `sections[]` array MAY reconstruct display order from `findings[].order`, `impression`, and `recommendations[]` directly. R16 (completeness) evaluates required-section coverage against the **template's declared section list**, independent of whether `sections[]` happens to be materialized in this document. (The original draft's five examples were inconsistent about whether `sections[]` was present, including in a *finalized* example with none at all — §17.3 now includes a minimal `sections[]` for consistency, though it remains optional by rule.)

---

## 8. Provenance

Provenance answers **"where did this atom come from and who last touched it"** for every finding, measurement, parameter-bearing finding, impression fragment, recommendation, and critical flag.

### 8.1 Document-level provenance
```json
"provenance": {
  "created_by": "dr_abinash",
  "created_at": "2026-07-09T10:00:00Z",
  "authoring_app": "care-radiology-report-generator",
  "authoring_app_version": "2.3.1",
  "input_methods": ["quick_select", "voice", "measurement_import", "ai_suggestion"],
  "content_pack_versions": { "neuro.mri": "2.1.0" },
  "template_ref": "tpl.mri_brain_plain",
  "revision": 4
}
```
`provenance.revision` and `audit.revision` (§10) are **the same monotonic counter**, exposed in two places for convenience; a writer keeps them equal on every save (§12-R10b). `audit.revisions[]` (§10) is a **sparse milestone log** (created / finalized / amended / migrated), not required to carry an entry for every increment of this counter — the two are not required to be otherwise reconciled beyond the equality above.

### 8.2 Instance-level provenance (attached to each atom)
```json
{
  "origin": "quick_select",            // see §18 for the full canonical list — presence + valid timestamp are the only HARD requirements (R10); an unrecognized value is a warning, not a reject (§2.5)
  "actor": "dr_abinash",               // human username or system/agent id
  "source_ref": "qs.brain.svd_fazekas2",
  "created_at": "2026-07-09T10:03:12Z",
  "edited": false,                     // true once a human modifies the emitted value
  "edited_by": null,
  "edited_at": null
}
```

Rules:
- **Every** finding/measurement/impression-fragment/recommendation/critical-flag **must** carry `provenance` with a **non-empty `origin` string and a valid ISO-8601 `created_at`** (§12-R10 — hard/structural). Whether `origin` matches one of the documented values (§18) is checked but only produces a **warning** if not, preserving forward-compat for new origin values (§2.5).
- `origin = "ai_suggestion"` **requires** a sibling `ai` block satisfying R11 (§9, §12-R11) — every field, not merely "some AI metadata".
- `edited=true` marks radiologist departure from an automated suggestion — the audit/medico-legal signal that a human owned the final content.

---

## 9. AI metadata

Closes the risk-review findings: *AI text indistinguishable from radiologist text*, *no (prompt-version + model-version + input) pin → non-reproducible*, and (new in this revision) *no anti-laundering check that an atom's claimed origin actually matches what a run produced*.

### 9.1 Document-level `ai` block — immutable run registry (REQUIRED, even when empty)
```json
"ai": {
  "runs": [
    {
      "run_id": "airun_01J9Z6RUN0000000000000001",
      "purpose": "impression_suggestion",     // finding_suggestion | impression_suggestion | measurement_extraction | qc | completeness | contradiction
      "provider": "ollama",
      "model_ref": "llama3.1:8b-instruct-q4",  // exact model identifier/tag
      "model_digest": "sha256:aa...",          // immutable model fingerprint when available
      "prompt_ref": "aiprompt.impression.neuro", // ai_prompt_templates key — a MUTABLE pointer (aiPromptTemplates.ts has no version-history table), so...
      "prompt_version": 7,                      // ...pinned version, NOT "latest"...
      "prompt_digest": "sha256:bb...",           // ...AND a hash of the EXACT prompt text sent, since prompt_version alone points at a row that can still be edited in place after the fact
      "params": { "temperature": 0.2, "top_p": 0.9, "seed": 42 },
      "input_digest": "sha256:cc...",            // hash of the exact input (text/measurements/image refs)
      "input_refs": { "image_sop_uids": ["1.2.840…"], "finding_lids": ["f1"] },
      "output_lids": ["imp2"],                   // EVERY lid this run produced — the anti-laundering link (R11b)
      "started_at": "2026-07-09T10:07:00Z",
      "latency_ms": 1840,
      "output_digest": "sha256:dd...",
      "human_review": "accepted_edited"          // accepted_verbatim | accepted_edited | rejected | pending
    }
  ],
  "guarding": { "auto_sign": false }             // REQUIRED boolean; invariant: AI NEVER auto-signs (risk-review), enforced by R13
}
```

### 9.2 Instance-level `ai` block (on any AI-derived atom)
```json
{
  "suggested": true,
  "run_id": "airun_01J9Z6RUN0000000000000001",       // MUST be present in ai.runs[] AND that run's output_lids MUST include this atom's own lid (R11b)
  "accepted_verbatim": false,        // false ⇒ radiologist edited the suggestion
  "confidence": 0.71,
  "model_ref": "llama3.1:8b-instruct-q4",   // MUST equal the referenced run's model_ref (R11c)
  "prompt_ref": "aiprompt.impression.neuro", // MUST equal the referenced run's prompt_ref (R11c)
  "prompt_version": 7                        // MUST equal the referenced run's prompt_version (R11c)
}
```

Rules:
- Any atom with `provenance.origin = "ai_suggestion"` **must** carry `ai.suggested = true`, a `run_id` present in `ai.runs[]`, and `model_ref` + `prompt_ref` + `prompt_version` (§12-R11).
- **(New, R11b — anti-laundering, bidirectional)** Every `lid` listed in any `ai.runs[].output_lids` **must** belong to an atom whose `provenance.origin = "ai_suggestion"` and whose `ai.run_id` equals that run's `run_id`. Conversely, every atom with `origin="ai_suggestion"` must appear in exactly one run's `output_lids`. This closes the gap where a run could exist without any atom ever being traced to it (silent AI content laundered as `origin="manual"`), or an atom could falsely claim AI provenance with no run to back it.
- **(New, R11c)** An instance `ai` block's `model_ref`/`prompt_ref`/`prompt_version` must equal the values on the run it references — they are denormalized onto the atom for convenient reading, not an independent second source of truth.
- No AI `model_ref`/`prompt_ref` may be an unpinned alias (`"latest"`, `"prod"`) — R12 — and `prompt_digest` (not merely `prompt_version`) is what R12 actually verifies for prompt reproducibility, since the prompt template row is mutable.
- `human_review` and `accepted_verbatim` make **AI-vs-human authorship explicit at the atom level** — the medico-legal record can prove what the radiologist wrote vs accepted.
- `ai.guarding.auto_sign` must be `false` for any document that reaches finalization (§12-R13), and — because a self-attested constant is weak on its own — R13 additionally requires that `audit.signature.signed_by` (§10) resolve to a human staff identity **distinct from every `ai.runs[].actor`/`provider`** at finalize time.

---

## 10. Audit metadata

Makes the structured document **self-verifying and tamper-evident once signed**, complementing (and linked to) the append-only `audit_logs` hash chain (Ticket E0.2).

```json
"audit": {
  "schema_version": "1.0.0",
  "hash_algorithm": "jcs-sha256/1",
  "created_at": "2026-07-09T10:00:00Z",
  "last_modified_at": "2026-07-09T10:20:00Z",
  "revision": 4,
  "revisions": [
    { "revision": 1, "at": "2026-07-09T10:00:00Z", "by": "dr_abinash", "action": "created" },
    { "revision": 4, "at": "2026-07-09T10:20:00Z", "by": "dr_abinash", "action": "finalized" }
  ],
  "content_sha256": "…",
  "audit_log_ref": 480231,
  "signature": {
    "state": "final",                 // draft | preliminary | final | addendum | amended
    "signed_by": "dr_abinash",
    "signed_role": "radiologist",
    "signed_at": "2026-07-09T10:20:30Z",
    "signed_content_sha256": "…",     // frozen at signing; equals content_sha256 at that instant
    "amends_document_id": null        // set for addendum/amended docs → the exact prior document_id being amended
  }
}
```

**Hash canonicalization (fully specified — the original draft's cross-reference to `audit.ts::canonicalHashPayload` does not work for this shape, since that function hand-enumerates flat scalar fields and does not sort keys, recurse into nested objects, or normalize numbers):**
- `content_sha256 = SHA-256( JCS(document_root_with_exclusions) )`, where **JCS** is [RFC 8785 JSON Canonicalization Scheme](https://datatracker.ietf.org/doc/html/rfc8785) applied to the **entire top-level document object**, after removing exactly two members by JSON Pointer: `/audit/content_sha256` and `/audit/signature/signed_content_sha256`. **Every other field — including `signature.signed_by`, `signed_role`, `signed_at`, `state`, and `amends_document_id` — IS part of the hashed content**, so authorship and signing metadata cannot be forged without invalidating the hash. (The original draft left this exclusion set ambiguous between two different statements and never named what "the report" object was; both are now pinned.)
- `audit.hash_algorithm` (e.g. `"jcs-sha256/1"`) is recorded in every document, so a future change to the canonicalization scheme ships as a new algorithm identifier rather than silently breaking every prior signature; a verifier always recomputes using the algorithm **named in the document being verified**.
- Because JCS is round-trip-stable (canonical form is a pure function of the parsed JSON value, independent of source whitespace/key order), verification is safe to run over the *value* stored in the `jsonb` column — no separate sidecar byte store is required, unlike a naive "compare stored bytes" scheme which the `jsonb` column type would break (Postgres does not preserve source key order/whitespace/number spelling in `jsonb`).
- Golden, byte-for-byte fixtures for JCS + this exclusion set ship with the implementation phase (§19), not with this design document.

Rules:
- For a **finalized** document: `signature.state = "final"`, `signed_content_sha256` present, and it **must** equal the recomputed `content_sha256` using `audit.hash_algorithm` (§12-R14). Any later change requires an **addendum/amended** *new document* (`amends_document_id` set to the exact prior `document_id`), never an in-place edit.
- **(Strengthened, R14b)** `audit_log_ref` **must be non-null** for a finalized document and **must** resolve to an `audit_logs` row with `action='finalize'` whose payload records this `document_id` **and** `signed_content_sha256` — this is what actually links the structured document's signature into the E0.2 tamper-evident chain; a null `audit_log_ref` on a finalized document is a validation failure, not merely a missed opportunity.
- **(New, R14c)** Every non-null `amends_document_id` must resolve to exactly one prior document whose `signature.state = "final"`, and no two documents may name the same `amends_document_id` (an amendment chain is linear, never forked).

---

## 11. Future extensibility

### 11.1 Extension channel
`extensions` (document-level) and the `^x_` pattern (any core object, via `patternProperties` — §1.5) are the namespaced open channels. Validators **ignore** unknown `x_*`/`extensions.*` keys for compatibility purposes but they are still schema-legal (not silently swallowed by `additionalProperties:false`, which was a self-contradiction in the original draft). Example:
```json
"extensions": { "x_biRADS": { "category": 3 } }
```

### 11.2 New namespaces
New namespaces (e.g. `bodysite.` for SNOMED body-site, `code.` for LOINC/RadLex) can be added minor-version without touching existing docs — the reference grammar `<ns>.<key>` (§1.4) is open, provided the namespace is added to the table in §1.4 and to R1's scope.

### 11.3 Coding hooks — honest current state (corrects the original draft's overclaim)
Only **`finding_definitions`** and **`parameter_options`** carry `code_system`/`code_value` columns in the real B1/B2 schema today. `finding_locations`, `finding_measurement_bindings`, `finding_severity_bindings`, and `parameter_groups` do **not**. This means:
- **Today:** `finding.*` and `param.*` (group-and-option) references can carry a real coded concept (LOINC/SNOMED/RadLex) end-to-end.
- **Not yet possible:** a conformant DICOM-SR `Observation.code`, FHIR `bodySite`, or a coded severity concept for `sev.*`/`loc.*`/`meas.*` references, because their backing tables have no coding columns.
- **Required before any DICOM-SR/FHIR/HL7 export ships:** add `code_system`/`code_value` to `finding_locations`, `finding_measurement_bindings`, `finding_severity_bindings`, and `parameter_groups` (a B1/B2 schema addition, out of scope for D1, and explicitly **not** assumed by any rule in §12). Until then, export tooling can only emit coded output for the finding and parameter-option layers and must fall back to free-text/display strings for severity, location, and measurement concepts.

### 11.4 Modality growth, including obstetric ultrasound
A new modality/body-region needs new *content-pack* entries (K1) and *catalog* rows (B1/B2), **not** a JSON-schema change. The five worked examples in §17 (MRI Brain, LS Spine, Cervical Spine, USG Abdomen, Doppler) demonstrate this for those five modalities specifically — this is **not** a blanket proof that every modality is covered without gaps (a correction to the original draft's "proven by the five examples" phrasing).

**Obstetric ultrasound** — high-volume and first-class elsewhere in the repo (`usg_measurements.bpd/hc/ac/fl/crl/efw/ga/edd`, `usg_report_drafts.templateType` enumerating `OB_EARLY/OB_GROWTH/OB_ANOMALY`) — is representable in this model using existing mechanisms, not the ignored `extensions` channel the original draft resorted to (`x_fetal:{ga_weeks,percentile}`):
- **EDD** (a date, not a number): `measurement.value_kind = "date"`, `value_iso` holds the ISO-8601 date (§4).
- **Gestational age**: a decimal-weeks numeric measurement (`value_kind:"scalar"`, `unit:"wk"`), or a `components[]`-backed derived measurement if computed from weeks+days.
- **Growth percentile**: a numeric measurement (`value_kind:"scalar"`, `unit:"%"`, 0–100), distinct from `normal_range`.
- **Twin/triplet attribution**: an optional `subject` string on findings/measurements (e.g. `"fetus_a"`/`"fetus_b"`) plus an optional document-level `subjects[]` roster — laterality cannot stand in for fetal identity.

**This revision adds the schema capability but does not ship a sixth worked obstetric example** — doing so was judged to exceed this ticket's explicit five-modality scope. A dedicated OB-growth worked example (exercising GA/EDD/percentile end-to-end through the catalog) is the recommended next addition before OB support is considered validated (§20).

### 11.5 Deprecation without breakage
Retire catalog keys via soft-delete; pinned rendered strings (§2.2/§2.4) keep old docs valid and readable regardless of catalog changes.

---

## 12. Validation rules

Validation runs in **two tiers**: (A) **structural** (JSON Schema Draft 2020-12) and (B) **semantic/referential** (a rule engine that needs the pinned catalog / content-pack registries). A document is *valid* only if both pass at the enforcement point defined by the **When** column below — this table replaces the original draft's two separately-worded, contradictory paragraphs about what runs at draft-save time.

| # | Rule | Tier | When enforced | On failure |
|---|---|---|---|---|
| R0 | Parses as JSON; matches the JSON Schema for its own stamped `schema_version`; core objects reject unknown keys except `^x_` | A | Always (draft save + finalize) | reject |
| R1 | Every `finding.`/`param.` ref resolves in the live catalog at write time; `rec./crit./tpl./combo.` are well-formed per the content-pack registries (§1.4) | B | Always | reject |
| R2 | Every intra-doc reference (`finding_ref`, `measurement_refs`, `fragment_refs`, `finding_refs`, `tile_lid`, `amends_document_id`) targets an existing `lid`/document | B | Always | reject |
| R2b | For every finding `F` and `lid` in `F.measurement_refs`, the referenced measurement's `finding_ref` equals `F.lid` exactly | B | Always | reject |
| R3 | All `lid`s are unique within the document, across every array | A | Always | reject |
| R4 | `severity`/`locations[]`/`parameters[].param` are bindings that exist **for this specific finding's `definition_ref`** (finding-scoped lookup, §1.4); `laterality` is a valid `lat.*` enum value | B | Always | reject |
| R5 | `measurement.unit` is UCUM-valid and equals the finding-scoped catalog binding's unit for `measurement_ref` (unless `x_unit_conversion` present); `meas.`-backed measurements have non-null `finding_ref` | B | Always | reject |
| R6 | `parameters[].kind` matches `parameter_groups.data_type`; `option` ∈ that group's options; single-valued unless `allow_multiple` | B | Always | reject |
| R7 | Clinical consistency: `presence ∈ {absent, normal}` ⇒ no positive severity and no `abnormal:true` owned measurement | B | Always | reject |
| R8 | Required parameters (per `finding_parameter_bindings.required`) present on the finding | B | **Draft save: warn. Finalize: reject.** | warn / reject |
| R9 | No duplicate `recommendation_ref` across recommendations that share a `finding_ref` | B | Always | reject |
| R10 | Every finding/measurement/impression-fragment/recommendation/critical-flag has `provenance.origin` (non-empty string) + `created_at` (valid ISO-8601) | A | Always | reject |
| R10w | `provenance.origin` matches one of the documented values (§18) | B | Always | **warn only** (unrecognized-but-present origin is forward-compatible, §2.5) |
| R10b | `provenance.revision` (§8.1) equals `audit.revision` (§10) | B | Always | reject |
| R11 | `provenance.origin="ai_suggestion"` ⇒ `ai.suggested=true` + `run_id` ∈ `ai.runs` + `model_ref`+`prompt_ref`+`prompt_version` present | B | Always | reject |
| R11b | Bidirectional: every `ai.runs[].output_lids` entry is an atom with `origin="ai_suggestion"` and matching `run_id`; every `origin="ai_suggestion"` atom appears in exactly one run's `output_lids` | B | Always | reject |
| R11c | Instance `ai.model_ref`/`prompt_ref`/`prompt_version` equal the referenced run's values | B | Always | reject |
| R12 | No AI `model_ref`/`prompt_ref` is an unpinned alias (`"latest"`, `"prod"`); `prompt_digest` is present on every run | B | Always | reject |
| R13 | `ai.guarding.auto_sign === false`; at finalize, `signature.signed_by` resolves to a human staff identity distinct from every `ai.runs[].actor` | A / B | `auto_sign` check: always. `signed_by` distinctness: finalize only | reject |
| R14 | Finalized doc: `signature.state="final"`, `signed_content_sha256` present and equals `content_sha256` recomputed with `audit.hash_algorithm` | B | Finalize only | reject |
| R14b | Finalized doc: `audit_log_ref` non-null, resolving to an `audit_logs` row (`action='finalize'`) recording this `document_id` + `signed_content_sha256` | B | Finalize only | reject |
| R14c | Every `amends_document_id` resolves to exactly one prior `state="final"` document; no document is amended twice | B | Finalize only | reject |
| R15 | `ai_contradiction_rules` (from the content pack, versioned via `catalog_snapshot.ai_rules_version`) fire clean: no two findings/measurements violate a declared contradiction | B | **Draft save: warn. Finalize: reject.** | warn / reject |
| R16 | `ai_completeness_rules` satisfied: template-required sections/findings present (independent of whether `sections[]` is materialized, §7.4) | B | **Draft save: warn. Finalize: reject.** | warn / reject |
| R17 | `critical_flags[].critical_ref` is well-formed per the content-pack criticals registry; no duplicate critical registry keys per finding | B | Always | reject |
| R18 | `document_id` matches `^[0-9A-HJKMNP-TV-Z]{26}$`; `schema_version` matches a known schema | A | Always | reject |

**Severity summary:** every rule marked "Always" (including R0–R7, R9–R14 baseline shape, R17–R18) is enforced on **every write**, including an in-progress draft save — these are pure well-formedness/referential-integrity checks that should never be writable in a broken state. Only the **completeness-oriented** rules (R8, R15, R16) and the **finalize-specific** signature rules (R14, R14b, R14c, and the `signed_by`-distinctness half of R13) are deferred past draft-save time, because a draft is by definition allowed to be incomplete.

**Where validation runs:** on every write to `structured_json` (draft save = all "Always" rules, hard; finalize = all rules, hard). Validation is **pure** given `(document, catalog_snapshot, content_pack_registries)` — no other IO — so it is exhaustively unit-testable (same pattern as the B1/B2 and K1 validation layers).

---

## 13. Migration strategy (design only — no migration written in D1)

**Schema/DDL (later phase) — genuinely zero-rewrite:**
1. `ALTER TABLE radiology_report_drafts ADD COLUMN IF NOT EXISTS structured_json jsonb;` (nullable — metadata-only change in Postgres, no table rewrite)
2. `ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS structured_json jsonb;` (nullable, same)
3. Cheap scalar filtering is added via **expression B-tree indexes** on the jsonb path (§15.2), **not** `GENERATED ... STORED` columns — the latter forces a full-table rewrite under `ACCESS EXCLUSIVE` (corrected from the original draft, which claimed generated columns were part of the "no rewrite" step; see §15.2 for why expression indexes are the actual zero-rewrite tool here).

Steps 1–3 as revised are genuinely **additive, nullable, dormant — no backfill, no table rewrite of existing rows**, consistent with the program's coexistence rule and the repo's idempotent-migration convention (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX ... IF NOT EXISTS`).

**If `GENERATED ... STORED` columns are ever wanted later** (e.g., for simpler ad-hoc SQL against scalar fields without an expression index), that is its own explicit, separately-scheduled migration step — it rewrites the whole table under an exclusive lock and must be communicated as such, never folded into an "additive, no-impact" release.

**Data lifecycle:**
- **Legacy rows** keep `structured_json = NULL`; the prose columns remain authoritative. Readers branch on `structured_json IS NULL`.
- **New reports** (post-enablement) write `structured_json` **and** the rendered prose columns. The renderer is unchanged initially (it reads prose); a later phase switches rendering to derive from `structured_json`.
- **Draft → final promotion:** when a `radiology_report_drafts` row is promoted to `patient_reports`, the `structured_json` is copied and `audit.signature` is set to `final` (freeze + hash per §10). The draft's `structured_json` remains for history.
- **Amendment:** an amendment to a finalized report is a **new** `document_id` with `amends_document_id` set to the prior one (§10, R14c) — never an in-place edit of a signed document's `structured_json`.
- **Optional backfill (future, not D1):** NLP re-extraction of legacy prose into `structured_json` with `provenance.origin="backfill"`, low confidence, never overwriting a human-signed prose record — explicitly out of scope here.

**Rollout ordering** (later phase): (1) add columns; (2) ship writer behind `ff_radiology_catalog`/a `ff_structured_report` flag (default off) so nothing consumes it; (3) enable dual-write; (4) switch renderer; (5) enable analytics projections (§15.4).

**Rollback — scoped by rollout stage (corrects the original draft's blanket claim):**
- **Before stage (3) (dual-write not yet enabled):** the columns are empty/unused. Disabling the flag and/or `DROP COLUMN` is safe and loses no data.
- **After stage (3):** once any `patient_reports.structured_json` has been **signed** (`audit.signature.state="final"`), it **is the authoritative structured legal record** for that report (design principle 4). From this point on, **`DROP COLUMN` on `patient_reports.structured_json` is prohibited** — it would destroy a signed record and violate the immutability guarantee. "Rollback" past this point means: disable the flag, stop writing new `structured_json` (the renderer falls back to prose for new reports), and leave existing signed documents in place untouched. Reverting further than that requires an explicit, separately-approved data-retention decision, not a routine flag flip.

---

## 14. Performance considerations

- **Column type is `jsonb`, not `text`** — parsed once, binary-stored, GIN-indexable, and TOAST-compressed above ~2 KB. (The current `patient_reports.parameters`/`radiology_report_drafts.findingsSections` are `text` — this spec deliberately does not repeat that anti-pattern.)
- **Document size budget:** typical structured report **< 50 KB**; **soft cap 256 KB**, **hard cap 1 MB**. Image pixel data, full DICOM tag dumps, and large AI transcripts are **never** embedded — only references (SOP UIDs, `input_digest`). Voice transcripts stay in `radiology_voice_logs`; AI raw outputs in the AI tables.
- **Hot path is single-document read by PK** (open a report) — O(1), no jsonb scanning. Never make the reporting workspace depend on a GIN scan.
- **Write path** validates in-process against the pinned catalog (cached in memory) — no extra round-trips beyond the catalog cache.
- **Analytics/search path** does **not** scan `structured_json` across 100M rows. It reads the **derived normalized projection** `report_finding_index` (§15.4), which is btree-indexed. A whole-table GIN index over `structured_json` is **not** the default recommendation at this scale (§15.3) — expression indexes and the projection table cover the realistic query set.
- **Canonicalization for hashing** (§10, JCS) is O(document size) and only runs on write/finalize, not on read.
- **At 100M reports** the dominant cost is table size; `patient_reports` itself is **not** partitioned by this spec (§15.5 explains why), so the projection table and targeted expression indexes are what keep query cost bounded.

---

## 15. Storage & indexing recommendations

### 15.1 Base column
Store the document in `jsonb` on both tables (nullable). This alone is a metadata-only `ALTER TABLE ... ADD COLUMN`, no rewrite.

### 15.2 Cheap scalar filtering — expression indexes, not generated columns (corrected)
The original draft recommended `GENERATED ALWAYS AS (...) STORED` columns as part of an "additive, no-rewrite" migration step. That is wrong: Postgres 16 only supports `STORED` generated columns (no virtual/non-stored form until PG18), and adding one to an existing table **always rewrites the entire table under `ACCESS EXCLUSIVE`** — the opposite of the promised zero-impact step, and pointless for existing rows besides (every legacy row has `structured_json IS NULL`, so the generated value is `NULL` there regardless).

The genuinely zero-rewrite alternative is a plain **expression B-tree index**, which only reads existing rows to build the index — it does not touch the table's storage:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS patient_reports_sr_modality_idx
  ON patient_reports ((structured_json #>> '{study_context,modality}'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS patient_reports_sr_finalized_idx
  ON patient_reports (((structured_json #>> '{audit,signature,state}') = 'final'))
  WHERE structured_json IS NOT NULL;
```
`CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block** and has no built-in `IF NOT EXISTS`-safe retry story if it aborts mid-build (it leaves an `INVALID` index) — so it must run as its **own migration step, outside the transaction-wrapped runner**, with an explicit pre-check that drops any leftover `INVALID` index of the same name before retrying. If path-renaming ever happens in a future major schema version, an expression index tied to `study_context.modality` would return `NULL` for the new shape — version-guard the expression (e.g. `COALESCE` across the old and new JSON paths) or compute the scalar in the writer instead if that risk matters more than index simplicity.

### 15.3 GIN index — not a default; partitioning is a prerequisite if ever added
A whole-table `CREATE INDEX ... USING gin (structured_json jsonb_path_ops)` over an unpartitioned, eventually-100M-row `patient_reports` is exactly the "scan `structured_json` at scale" pattern §14 says to avoid — it is expensive to build and maintain and is **not** recommended by default. If ad-hoc jsonb containment queries ("reports containing finding X") are genuinely needed beyond what `report_finding_index` (§15.4) answers, restrict any GIN index to a **static, explicitly-refreshed cutoff** (e.g. a periodically-updated partial index `WHERE created_at > '2026-01-01'`) — note that `now()`/`current_date` are **not `IMMUTABLE`** and cannot appear in an index predicate, so a genuinely "rolling recent window" partial index is not mechanically possible; the cutoff must be a literal, refreshed by a scheduled job. Absent a concrete need, rely on `report_finding_index` alone.

### 15.4 Derived normalized projection table — the real cross-report query answer
```sql
CREATE TABLE report_finding_index (
  id                       bigserial PRIMARY KEY,
  document_id              text    NOT NULL,      -- structured_json.document_id (globally unique, ULID)
  finding_lid               text    NOT NULL,       -- the finding's lid within that document
  patient_report_id        integer,                -- advisory pointer to patient_reports.id, NOT a DB-level FK (matches the repo's existing "advisory, not FK" convention, e.g. mriProtocolSpecs.ts)
  finding_key               text    NOT NULL,       -- finding_definitions.key
  presence                  text    NOT NULL,
  severity_key              text,
  modality                  text,
  body_region                text,
  is_critical                boolean NOT NULL DEFAULT false,
  superseded_by_document_id text,                  -- set when an amendment (§10, R14c) replaces this document; excluded from "current" queries
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON report_finding_index (document_id, finding_lid);
CREATE INDEX ON report_finding_index (finding_key, created_at) WHERE superseded_by_document_id IS NULL;
CREATE INDEX ON report_finding_index (patient_report_id);
```
This corrects three defects in the original draft's version of this table:
1. **No supersede/dedup key** — the original had no `document_id`/`finding_lid` columns and no uniqueness constraint, so every draft re-save or amendment would insert fresh rows while old ones lingered, double-counting in analytics. The `UNIQUE(document_id, finding_lid)` key plus `superseded_by_document_id` (set on the *old* document's rows when an amendment supersedes it, via R14c's amendment chain) fixes this: "current" queries filter `WHERE superseded_by_document_id IS NULL`.
2. **Type mismatch** — the original typed `report_id` as `bigint → patient_reports.id`, but `patient_reports.id` is `serial` (int4) in the real schema, and a draft's row lives in a different table (`radiology_report_drafts`) entirely. Keying the projection by `document_id` (the one identifier that exists on both draft and final documents) instead of a per-table numeric FK removes the type mismatch and the table-ambiguity problem in one move; `patient_report_id` becomes a purely advisory, nullable convenience pointer.
3. **Draft rows mixed with finalized rows** — the original's `report_kind IN ('draft','final')` contradicted §15.6's "index only finalized reports." This table indexes **finalized documents only**; drafts are never projected here (drafts churn too fast to be a useful analytics substrate, and are not the medico-legal record).

Cross-report questions ("how many Fazekas-2 studies this quarter", "all reports with acute infarct") hit a btree here — never a GIN scan over 100M jsonb blobs. **Partitioning this table** (e.g. by `created_at`) is a reasonable future step once volume demands it, but is **not prescribed here** with concrete DDL: any partition scheme must include the partition key in every unique constraint (the same rule that makes partitioning `patient_reports` itself unsafe — see §15.5), so the `UNIQUE(document_id, finding_lid)` constraint above would need to become `UNIQUE(document_id, finding_lid, created_at)` or similar at that time, which is a real design decision to make when the need is concrete, not now.

### 15.5 Do **not** partition `patient_reports` (corrected — the original recommendation was unsafe)
The original draft recommended partitioning `patient_reports` by `created_at` "as `structured_json` rides along." This is **incompatible with the table's existing keys**: Postgres requires the partition key to be part of every unique constraint on a partitioned table, and `patient_reports` has `PRIMARY KEY(id)` plus **two independent global unique indexes** — `report_number` (the human-facing `RPT-YYYYMMDD-NNN` identifier) and `public_token` (the patient-facing download-link secret). Partitioning by `created_at` would force `created_at` into both, making the human report number and the security download token **unique only within a partition** — i.e., the same report number or the same public token could legally exist twice across different months. That is an identity/security regression, not a performance tweak, and this spec does **not** recommend it. If `patient_reports` scale genuinely demands partitioning later, it requires an explicit keying redesign (e.g., a composite natural key that already includes a time component) — out of scope for D1 and not assumed by any rule here.

### 15.6 Do not index the draft table for analytics
Drafts churn; index only `report_finding_index`, populated from **finalized** reports, for surveillance (§15.4).

---

## 16. Object relationships (diagram)

```
structured_json (document)
│
├─ schema_version, kind, document_id
├─ catalog_snapshot ──────────────► pins content-pack version LABELS (not a frozen data snapshot, §2.4)
├─ study_context ─ identifiers ───► hashed subject/study binding (§3.1)
│               └ template_ref ──► tpl.*   (content-pack registry, §1.4 — not a live B1/B2 table)
│
├─ findings[]  (lid f*)
│    ├─ definition_ref ───────────► finding.*   (finding_definitions — GLOBAL)
│    ├─ severity ─────────────────► sev.*       (finding_severity_bindings — FINDING-SCOPED)
│    ├─ laterality ───────────────► lat.*       (fixed enum, not a table)
│    ├─ locations[] ──────────────► loc.*       (finding_locations — FINDING-SCOPED)
│    ├─ parameters[]
│    │     ├─ param ──────────────► param.*     (parameter_groups — GLOBAL)
│    │     └─ option (bare, sibling field, never re-dotted)
│    ├─ measurement_refs[] ──┐        (R2b: each owned measurement's finding_ref MUST equal this finding's lid)
│    ├─ provenance (§8.2)    │
│    └─ ai (§9.2) ──────────┼──► ai.runs[] (run_id, bidirectional via output_lids — R11b)
│                           │
├─ measurements[] (lid m*) ◄┘
│    ├─ measurement_ref ──────────► meas.*      (finding_measurement_bindings — FINDING-SCOPED, finding_ref REQUIRED)
│    ├─ finding_ref ──────────────► findings[].lid  (never null for meas.*-backed measurements)
│    └─ provenance (source: dicom_sr/ocr/manual/ai/calculated)
│
├─ impression
│    ├─ fragments[] ─ finding_ref ► findings[].lid ; ai_suggestion fragments require ai block (R11)
│    └─ items[] ─ fragment_refs ──► impression.fragments[].lid
│
├─ recommendations[] ─ finding_refs ► findings[].lid ; recommendation_ref ► rec.* (content-pack registry)
├─ critical_flags[] ─ finding_ref ► findings[].lid ; critical_ref ► crit.* (content-pack registry)
│
├─ sections[] (OPTIONAL, derivable) ─ finding_refs/measurement_refs ► lids
├─ provenance (document, §8.1 — .revision === audit.revision, R10b)
├─ ai.runs[]  (immutable model/prompt/input pins + output_lids anti-laundering link, §9.1)
├─ audit (JCS content_sha256 + hash_algorithm; signature.signed_by ≠ any ai actor at finalize, §10)
└─ extensions / x_* (open channel — schema-legal via patternProperties, §11)
```

**Cardinalities:** document 1—* findings; finding 1—* parameters; finding 1—* measurements (via `measurement_refs`, and every such measurement's `finding_ref` points back — exact 1:1 ownership, not 0..1); finding 0..1 impression-fragment→0..1 impression-item; finding 0..* recommendations; finding 0..* critical-flags; every atom 1—1 provenance; AI-atom *—1 `ai.runs[]` entry (bidirectionally linked via `output_lids`).

---

## 17. Complete modality examples

All five use the **identical schema** — only catalog references differ, per the corrected reference grammar (§1.4): `sev.`/`loc.`/`meas.` refs are now single opaque finding-scoped keys (no embedded dots implying a nested path), and parameter options use the two-field `{"param":..,"option":..}` form. `document_id`s are regenerated to the exact 26-character ULID pattern (§1.3). (Abbreviated `audit`/`provenance` where repetitive; a real document carries them on every atom per §8, §10.)

### 17.1 MRI Brain (plain) — normal survey + small-vessel ischemia (AI-assisted impression)
```json
{
  "schema_version": "1.0.0",
  "kind": "radiology.structured_report",
  "document_id": "01J9Z6BRA1N0STDY000000A100",
  "catalog_snapshot": { "content_pack_versions": { "neuro.mri": "2.1.0" }, "catalog_schema_version": "1.0.0", "ai_rules_version": { "neuro.mri": "2.1.0" } },
  "study_context": { "modality": "MRI", "body_region": "brain", "study_type": "plain",
    "template_ref": "tpl.mri_brain_plain", "laterality_default": "lat.na",
    "comparison": { "has_prior": false, "prior_study_ref": null, "interval_note": null },
    "identifiers": { "study_instance_uid": "1.2.840.113619.2.55.3.1", "accession_number": "ACC-20260709-MR-001",
      "patient_ref": { "system": "care.patient_id", "value": "PAT-000112" }, "study_datetime": "2026-07-09T09:55:00Z",
      "referring_physician_ref": { "system": "care.staff", "value": "dr_mehta" }, "performing_physician_ref": { "system": "care.staff", "value": "tech_priya" } } },
  "sections": [
    { "lid": "s1", "kind": "technique", "rendered": "Multiplanar multisequence MRI of the brain without contrast." },
    { "lid": "s2", "kind": "findings", "finding_refs": ["f1","f2"], "measurement_refs": [], "rendered": "…" },
    { "lid": "s3", "kind": "impression", "rendered": "…" }
  ],
  "findings": [
    { "lid": "f1", "definition_ref": "finding.brain.normal_survey", "presence": "normal",
      "certainty": "definite", "laterality": null, "locations": [], "severity": null, "interval_change": null,
      "parameters": [], "measurement_refs": [],
      "sentence": "Ventricles, sulci and basal cisterns are normal. No diffusion restriction. No abnormal enhancement territory.",
      "impression_fragment": "No acute intracranial abnormality.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false },
      "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.brain.normal", "created_at": "2026-07-09T10:03:00Z", "edited": false },
      "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.brain.small_vessel_ischemia", "presence": "present",
      "certainty": "definite", "laterality": "lat.bilateral",
      "locations": ["loc.periventricular","loc.deep_white_matter"], "severity": "sev.fazekas_2", "interval_change": null,
      "parameters": [ { "param": "param.signal", "kind": "option", "option": "t2_flair_hyper", "label": "T2/FLAIR hyperintense" } ],
      "measurement_refs": [],
      "sentence": "Scattered T2/FLAIR hyperintensities in the periventricular and deep white matter, Fazekas grade 2.",
      "impression_fragment": "Moderate chronic small vessel ischemic changes.", "sentence_source": "edited",
      "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false },
      "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.brain.svd_fazekas2", "created_at": "2026-07-09T10:05:00Z", "edited": true, "edited_by": "dr_abinash", "edited_at": "2026-07-09T10:06:10Z" },
      "ai": null, "order": 20 }
  ],
  "measurements": [],
  "impression": {
    "fragments": [
      { "lid": "imp1", "finding_ref": "f1", "text": "No acute intracranial abnormality.", "source": "finding_fragment", "rank": 1,
        "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T10:07:00Z", "edited": false }, "ai": null },
      { "lid": "imp2", "finding_ref": "f2", "text": "Moderate chronic small vessel ischemic changes (Fazekas 2).", "source": "ai_suggestion", "rank": 2,
        "provenance": { "origin": "ai_suggestion", "actor": "system", "created_at": "2026-07-09T10:07:05Z", "edited": true, "edited_by": "dr_abinash", "edited_at": "2026-07-09T10:07:40Z" },
        "ai": { "suggested": true, "run_id": "airun_01J9Z6RUNBRA1N0000000A1", "accepted_verbatim": false, "confidence": 0.74,
          "model_ref": "llama3.1:8b-instruct-q4", "prompt_ref": "aiprompt.impression.neuro", "prompt_version": 7 } }
    ],
    "items": [
      { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. No acute intracranial abnormality." },
      { "lid": "impi2", "fragment_refs": ["imp2"], "text": "2. Moderate chronic small vessel ischemic changes (Fazekas 2)." }
    ],
    "rendered": "IMPRESSION:\n1. No acute intracranial abnormality.\n2. Moderate chronic small vessel ischemic changes (Fazekas 2)."
  },
  "recommendations": [],
  "critical_flags": [],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T10:00:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["quick_select","ai_suggestion"], "content_pack_versions": { "neuro.mri": "2.1.0" }, "template_ref": "tpl.mri_brain_plain", "revision": 3 },
  "ai": { "runs": [ { "run_id": "airun_01J9Z6RUNBRA1N0000000A1", "purpose": "impression_suggestion", "provider": "ollama", "model_ref": "llama3.1:8b-instruct-q4", "model_digest": "sha256:aa11", "prompt_ref": "aiprompt.impression.neuro", "prompt_version": 7, "prompt_digest": "sha256:bb22", "params": { "temperature": 0.2, "seed": 42 }, "input_digest": "sha256:cc33", "input_refs": { "finding_lids": ["f2"], "image_sop_uids": [] }, "output_lids": ["imp2"], "started_at": "2026-07-09T10:07:00Z", "latency_ms": 1610, "output_digest": "sha256:dd44", "human_review": "accepted_edited" } ], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "hash_algorithm": "jcs-sha256/1", "created_at": "2026-07-09T10:00:00Z", "last_modified_at": "2026-07-09T10:07:40Z", "revision": 3, "revisions": [ { "revision": 1, "at": "2026-07-09T10:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:ee55", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_role": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

### 17.2 MRI LS Spine — L4–L5 disc herniation with canal measurement + follow-up recommendation
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9Z6SP1NEAB0STDY0000A100",
  "catalog_snapshot": { "content_pack_versions": { "spine.mri": "1.3.0" }, "catalog_schema_version": "1.0.0", "ai_rules_version": { "spine.mri": "1.3.0" } },
  "study_context": { "modality": "MRI", "body_region": "ls_spine", "study_type": "plain", "template_ref": "tpl.mri_ls_spine_plain", "laterality_default": "lat.na",
    "comparison": { "has_prior": false, "prior_study_ref": null, "interval_note": null },
    "identifiers": { "study_instance_uid": "1.2.840.113619.2.55.3.2", "accession_number": "ACC-20260709-MR-002",
      "patient_ref": { "system": "care.patient_id", "value": "PAT-000221" }, "study_datetime": "2026-07-09T11:00:00Z",
      "referring_physician_ref": { "system": "care.staff", "value": "dr_khan" }, "performing_physician_ref": { "system": "care.staff", "value": "tech_ravi" } } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.spine.disc_herniation", "presence": "present", "certainty": "definite",
      "laterality": "lat.left", "locations": ["loc.l4_l5"], "severity": "sev.extrusion", "interval_change": null,
      "parameters": [
        { "param": "param.disc_level", "kind": "option", "option": "l4_l5", "label": "L4–L5" },
        { "param": "param.herniation_type", "kind": "option", "option": "paracentral_left", "label": "Left paracentral" },
        { "param": "param.nerve_root_contact", "kind": "boolean", "value": true, "label": "Contacts traversing nerve root" }
      ],
      "measurement_refs": [],
      "sentence": "Left paracentral disc extrusion at L4–L5 indenting the thecal sac and contacting the traversing left L5 nerve root.",
      "impression_fragment": "L4–L5 left paracentral disc extrusion with left L5 nerve root contact.",
      "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.spine.l4l5_extrusion", "created_at": "2026-07-09T11:00:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.spine.canal_stenosis", "presence": "present", "certainty": "probable",
      "laterality": null, "locations": ["loc.l4_l5"], "severity": "sev.moderate", "interval_change": null,
      "parameters": [], "measurement_refs": ["m1"],
      "sentence": "Moderate central canal narrowing at L4–L5.", "impression_fragment": "Moderate L4–L5 central canal stenosis.",
      "sentence_source": "content_pack_default", "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T11:02:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.canal_ap_diameter", "finding_ref": "f2", "site": "loc.l4_l5", "laterality": null,
      "value": 8.5, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null,
      "normal_range": { "low": 12, "high": 20, "unit": "mm", "source": "catalog" }, "abnormal": true,
      "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null,
      "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "AP canal diameter L4–L5: 8.5 mm (reduced)" }
  ],
  "impression": {
    "fragments": [
      { "lid": "imp1", "finding_ref": "f1", "text": "L4–L5 left paracentral disc extrusion with left L5 nerve root contact.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T11:05:00Z", "edited": false }, "ai": null },
      { "lid": "imp2", "finding_ref": "f2", "text": "Moderate L4–L5 central canal stenosis.", "source": "finding_fragment", "rank": 2, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T11:05:02Z", "edited": false }, "ai": null }
    ],
    "items": [ { "lid": "impi1", "fragment_refs": ["imp1","imp2"], "text": "1. L4–L5 left paracentral disc extrusion with left L5 nerve root contact and moderate central canal stenosis." } ],
    "rendered": "IMPRESSION:\n1. L4–L5 left paracentral disc extrusion with left L5 nerve root contact and moderate central canal stenosis."
  },
  "recommendations": [
    { "lid": "rec1", "recommendation_ref": "rec.clinical_correlation", "finding_refs": ["f1"], "text": "Clinical correlation with left L5 radiculopathy is advised.", "priority": "routine",
      "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T11:06:00Z", "edited": false }, "ai": null }
  ],
  "critical_flags": [],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T11:00:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["quick_select","manual"], "content_pack_versions": { "spine.mri": "1.3.0" }, "template_ref": "tpl.mri_ls_spine_plain", "revision": 2 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "hash_algorithm": "jcs-sha256/1", "created_at": "2026-07-09T11:00:00Z", "last_modified_at": "2026-07-09T11:06:00Z", "revision": 2, "revisions": [ { "revision": 1, "at": "2026-07-09T11:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:ff66", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_role": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```
*(Corrects the original draft's example, where `m1` appeared in both `f1.measurement_refs` and `f2.measurement_refs` while `m1.finding_ref="f2"` — violating R2b. `m1` now belongs only to `f2`, which is the finding it actually measures.)*

### 17.3 MRI Cervical Spine — C5–C6 cord compression (critical) + finalized signature
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9Z6SP1NECB0STDY0000A100",
  "catalog_snapshot": { "content_pack_versions": { "spine.mri": "1.3.0" }, "catalog_schema_version": "1.0.0", "ai_rules_version": { "spine.mri": "1.3.0" } },
  "study_context": { "modality": "MRI", "body_region": "cervical_spine", "study_type": "plain", "template_ref": "tpl.mri_cervical_spine_plain", "laterality_default": "lat.na",
    "comparison": { "has_prior": false, "prior_study_ref": null, "interval_note": null },
    "identifiers": { "study_instance_uid": "1.2.840.113619.2.55.3.3", "accession_number": "ACC-20260709-MR-003",
      "patient_ref": { "system": "care.patient_id", "value": "PAT-000335" }, "study_datetime": "2026-07-09T12:05:00Z",
      "referring_physician_ref": { "system": "care.staff", "value": "dr_iyer" }, "performing_physician_ref": { "system": "care.staff", "value": "tech_ravi" } } },
  "sections": [
    { "lid": "s1", "kind": "findings", "finding_refs": ["f1"], "measurement_refs": ["m1"], "rendered": "…" },
    { "lid": "s2", "kind": "impression", "rendered": "…" }
  ],
  "findings": [
    { "lid": "f1", "definition_ref": "finding.spine.cord_compression", "presence": "present", "certainty": "definite",
      "laterality": null, "locations": ["loc.c5_c6"], "severity": "sev.severe", "interval_change": null,
      "parameters": [
        { "param": "param.disc_level", "kind": "option", "option": "c5_c6", "label": "C5–C6" },
        { "param": "param.myelomalacia", "kind": "boolean", "value": true, "label": "Cord signal change (myelomalacia)" }
      ],
      "measurement_refs": ["m1"],
      "sentence": "Large posterior disc-osteophyte complex at C5–C6 causing severe central canal stenosis with cord compression and intramedullary T2 hyperintensity.",
      "impression_fragment": "Severe C5–C6 cord compression with myelomalacia.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": true, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:10:00Z", "edited": false }, "ai": null, "order": 10 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.canal_ap_diameter", "finding_ref": "f1", "site": "loc.c5_c6", "laterality": null,
      "value": 5.0, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null,
      "normal_range": { "low": 11, "high": 16, "unit": "mm", "source": "catalog" }, "abnormal": true,
      "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null,
      "provenance": { "origin": "manual", "source": "manual", "confidence": 0.95, "edited": false }, "display": "AP canal C5–C6: 5.0 mm (critical narrowing)" }
  ],
  "impression": {
    "fragments": [ { "lid": "imp1", "finding_ref": "f1", "text": "Severe C5–C6 cord compression with myelomalacia — critical finding, communicated to referring clinician.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:00Z", "edited": true, "edited_by": "dr_abinash", "edited_at": "2026-07-09T12:13:00Z" }, "ai": null } ],
    "items": [ { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. Severe C5–C6 cord compression with myelomalacia. Critical finding." } ],
    "rendered": "IMPRESSION:\n1. Severe C5–C6 cord compression with myelomalacia. Critical finding — communicated."
  },
  "recommendations": [ { "lid": "rec1", "recommendation_ref": "rec.urgent_referral", "finding_refs": ["f1"], "text": "Urgent neurosurgical referral advised.", "priority": "critical", "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:30Z", "edited": false }, "ai": null } ],
  "critical_flags": [ { "lid": "crit1", "critical_ref": "crit.cord_compression", "finding_ref": "f1", "status": "communicated", "raised_at": "2026-07-09T12:12:00Z", "raised_by": "dr_abinash", "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:00Z", "edited": false } } ],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T12:10:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["manual"], "content_pack_versions": { "spine.mri": "1.3.0" }, "template_ref": "tpl.mri_cervical_spine_plain", "revision": 5 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "hash_algorithm": "jcs-sha256/1", "created_at": "2026-07-09T12:10:00Z", "last_modified_at": "2026-07-09T12:14:00Z", "revision": 5,
    "revisions": [ { "revision": 1, "at": "2026-07-09T12:10:00Z", "by": "dr_abinash", "action": "created" }, { "revision": 5, "at": "2026-07-09T12:14:00Z", "by": "dr_abinash", "action": "finalized" } ],
    "content_sha256": "sha256:1a2b3c", "audit_log_ref": 480231,
    "signature": { "state": "final", "signed_by": "dr_abinash", "signed_role": "radiologist", "signed_at": "2026-07-09T12:14:00Z", "signed_content_sha256": "sha256:1a2b3c", "amends_document_id": null } },
  "extensions": {}
}
```

### 17.4 USG Abdomen — normal biometry + incidental simple hepatic cyst (measurement import from DICOM SR)
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9Z6ABD0MEN0STDY0000A100",
  "catalog_snapshot": { "content_pack_versions": { "abdomen.usg": "1.4.0" }, "catalog_schema_version": "1.0.0", "ai_rules_version": { "abdomen.usg": "1.4.0" } },
  "study_context": { "modality": "USG", "body_region": "abdomen", "study_type": "grayscale", "template_ref": "tpl.usg_abdomen", "laterality_default": "lat.na",
    "comparison": { "has_prior": false, "prior_study_ref": null, "interval_note": null },
    "identifiers": { "study_instance_uid": "1.2.840.113619.2.55.3.4", "accession_number": "ACC-20260709-US-004",
      "patient_ref": { "system": "care.patient_id", "value": "PAT-000447" }, "study_datetime": "2026-07-09T09:25:00Z",
      "referring_physician_ref": { "system": "care.staff", "value": "dr_singh" }, "performing_physician_ref": { "system": "care.staff", "value": "tech_priya" } } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.abdomen.normal_survey", "presence": "normal", "certainty": "definite",
      "laterality": null, "locations": [], "severity": null, "interval_change": null, "parameters": [], "measurement_refs": ["m1","m2","m3"],
      "sentence": "Liver normal in size and echotexture. Both kidneys normal. Gallbladder, CBD, pancreas, spleen unremarkable. No free fluid.",
      "impression_fragment": "Normal abdominal ultrasound apart from the finding below.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false },
      "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.abd.normal", "created_at": "2026-07-09T09:30:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.liver.simple_cyst", "presence": "present", "certainty": "definite",
      "laterality": "lat.right", "locations": ["loc.right_lobe"], "severity": null, "interval_change": null,
      "parameters": [
        { "param": "param.echogenicity", "kind": "option", "option": "anechoic", "label": "Anechoic" },
        { "param": "param.margin", "kind": "option", "option": "well_defined", "label": "Well-defined" },
        { "param": "param.posterior_enhancement", "kind": "boolean", "value": true, "label": "Posterior acoustic enhancement" }
      ],
      "measurement_refs": ["m4"],
      "sentence": "Well-defined anechoic cyst with posterior acoustic enhancement in the right lobe of the liver, measuring 14 mm.",
      "impression_fragment": "Simple hepatic cyst, right lobe — benign, incidental.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": true }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.liver.simple_cyst", "created_at": "2026-07-09T09:34:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.liver_span", "finding_ref": "f1", "site": "loc.right_lobe", "laterality": null, "value": 142.0, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 120, "high": 160, "unit": "mm", "source": "catalog" }, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.97, "sop_instance_uid": "1.2.840.113619.2.1", "captured_at": "2026-07-09T09:31:00Z", "actor": "OHIF", "edited": false }, "display": "Liver span 142 mm" },
    { "lid": "m2", "measurement_ref": "meas.kidney_length", "finding_ref": "f1", "site": "loc.kidney_right", "laterality": "lat.right", "value": 102.0, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" }, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.98, "sop_instance_uid": "1.2.840.113619.2.2", "edited": false }, "display": "Right kidney 102 mm" },
    { "lid": "m3", "measurement_ref": "meas.kidney_length", "finding_ref": "f1", "site": "loc.kidney_left", "laterality": "lat.left", "value": 99.0, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" }, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.98, "edited": false }, "display": "Left kidney 99 mm" },
    { "lid": "m4", "measurement_ref": "meas.cyst_diameter", "finding_ref": "f2", "site": "loc.right_lobe", "laterality": null, "value": 14.0, "unit": "mm", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": null, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "Cyst 14 mm" }
  ],
  "impression": {
    "fragments": [ { "lid": "imp1", "finding_ref": "f2", "text": "Simple hepatic cyst in the right lobe (14 mm) — benign, incidental.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T09:36:00Z", "edited": false }, "ai": null } ],
    "items": [ { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. Otherwise normal abdominal ultrasound with an incidental 14 mm simple hepatic cyst in the right lobe." } ],
    "rendered": "IMPRESSION:\n1. Otherwise normal abdominal ultrasound with an incidental 14 mm simple hepatic cyst in the right lobe."
  },
  "recommendations": [ { "lid": "rec1", "recommendation_ref": "rec.no_followup_needed", "finding_refs": ["f2"], "text": "No follow-up required for this benign simple cyst.", "priority": "routine", "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T09:36:30Z", "edited": false }, "ai": null } ],
  "critical_flags": [],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T09:30:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["quick_select","measurement_import"], "content_pack_versions": { "abdomen.usg": "1.4.0" }, "template_ref": "tpl.usg_abdomen", "revision": 4 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "hash_algorithm": "jcs-sha256/1", "created_at": "2026-07-09T09:30:00Z", "last_modified_at": "2026-07-09T09:36:30Z", "revision": 4, "revisions": [ { "revision": 1, "at": "2026-07-09T09:30:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:2b3c4d", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_role": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

### 17.5 Doppler (carotid) — right ICA stenosis with velocity indices (derived RI/ratio)
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9Z6CAR0T1D0STDY0000A100",
  "catalog_snapshot": { "content_pack_versions": { "vascular.doppler": "1.1.0" }, "catalog_schema_version": "1.0.0", "ai_rules_version": { "vascular.doppler": "1.1.0" } },
  "study_context": { "modality": "USG", "body_region": "carotid_doppler", "study_type": "doppler", "template_ref": "tpl.doppler_carotid", "laterality_default": "lat.bilateral",
    "comparison": { "has_prior": false, "prior_study_ref": null, "interval_note": null },
    "identifiers": { "study_instance_uid": "1.2.840.113619.2.55.3.5", "accession_number": "ACC-20260709-US-005",
      "patient_ref": { "system": "care.patient_id", "value": "PAT-000559" }, "study_datetime": "2026-07-09T12:55:00Z",
      "referring_physician_ref": { "system": "care.staff", "value": "dr_das" }, "performing_physician_ref": { "system": "care.staff", "value": "tech_ravi" } } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.carotid.stenosis", "presence": "present", "certainty": "definite",
      "laterality": "lat.right", "locations": ["loc.ica_proximal"], "severity": "sev.stenosis_70_99", "interval_change": null,
      "parameters": [
        { "param": "param.plaque_morphology", "kind": "option", "option": "heterogeneous", "label": "Heterogeneous plaque" },
        { "param": "param.plaque_surface", "kind": "option", "option": "irregular", "label": "Irregular surface" }
      ],
      "measurement_refs": ["m1","m2","m3","m4"],
      "sentence": "Heterogeneous plaque with irregular surface in the proximal right ICA producing 70–99% stenosis by velocity criteria (PSV 320 cm/s, ICA/CCA ratio 4.6).",
      "impression_fragment": "Severe (70–99%) stenosis of the right internal carotid artery.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T13:00:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.carotid.normal", "presence": "normal", "certainty": "definite",
      "laterality": "lat.left", "locations": ["loc.ica_proximal"], "severity": null, "interval_change": null, "parameters": [], "measurement_refs": ["m5"],
      "sentence": "Left carotid system shows normal flow with no significant stenosis.", "impression_fragment": "Normal left carotid system.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.carotid.normal", "created_at": "2026-07-09T13:04:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.doppler_psv", "finding_ref": "f1", "site": "loc.ica_proximal", "laterality": "lat.right", "value": 320.0, "unit": "cm/s", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 0, "high": 125, "unit": "cm/s", "source": "catalog" }, "abnormal": true, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.92, "edited": false }, "display": "Right ICA PSV 320 cm/s" },
    { "lid": "m2", "measurement_ref": "meas.doppler_edv", "finding_ref": "f1", "site": "loc.ica_proximal", "laterality": "lat.right", "value": 110.0, "unit": "cm/s", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 0, "high": 40, "unit": "cm/s", "source": "catalog" }, "abnormal": true, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "Right ICA EDV 110 cm/s" },
    { "lid": "m3", "measurement_ref": "meas.doppler_ica_cca_ratio", "finding_ref": "f1", "site": "loc.ica_proximal", "laterality": "lat.right", "value": 4.6, "unit": "1", "value_kind": "ratio", "value_iso": null, "range": null,
      "components": [ { "measurement_ref": "meas.doppler_psv", "value": 320, "unit": "cm/s" }, { "measurement_ref": "meas.doppler_cca_psv", "value": 70, "unit": "cm/s" } ],
      "normal_range": { "low": 0, "high": 2.0, "unit": "1", "source": "catalog" }, "abnormal": true, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "calculated", "source": "calculated", "confidence": 1.0, "edited": false }, "display": "ICA/CCA ratio 4.6" },
    { "lid": "m4", "measurement_ref": "meas.doppler_ri", "finding_ref": "f1", "site": "loc.ica_proximal", "laterality": "lat.right", "value": 0.66, "unit": "1", "value_kind": "index", "value_iso": null, "range": null,
      "components": [ { "measurement_ref": "meas.doppler_psv", "value": 320, "unit": "cm/s" }, { "measurement_ref": "meas.doppler_edv", "value": 110, "unit": "cm/s" } ],
      "normal_range": null, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "calculated", "source": "calculated", "confidence": 1.0, "edited": false }, "display": "RI 0.66" },
    { "lid": "m5", "measurement_ref": "meas.doppler_psv", "finding_ref": "f2", "site": "loc.ica_proximal", "laterality": "lat.left", "value": 78.0, "unit": "cm/s", "value_kind": "scalar", "value_iso": null, "range": null, "components": null, "normal_range": { "low": 0, "high": 125, "unit": "cm/s", "source": "catalog" }, "abnormal": false, "prior_value": null, "prior_measurement_ref_document": null, "change_pct": null, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.92, "edited": false }, "display": "Left ICA PSV 78 cm/s" }
  ],
  "impression": {
    "fragments": [
      { "lid": "imp1", "finding_ref": "f1", "text": "Severe (70–99%) stenosis of the right internal carotid artery.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T13:06:00Z", "edited": false }, "ai": null },
      { "lid": "imp2", "finding_ref": "f2", "text": "Normal left carotid system.", "source": "finding_fragment", "rank": 2, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T13:06:01Z", "edited": false }, "ai": null }
    ],
    "items": [
      { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. Severe (70–99%) stenosis of the right internal carotid artery." },
      { "lid": "impi2", "fragment_refs": ["imp2"], "text": "2. Normal left carotid system." }
    ],
    "rendered": "IMPRESSION:\n1. Severe (70–99%) stenosis of the right internal carotid artery.\n2. Normal left carotid system."
  },
  "recommendations": [ { "lid": "rec1", "recommendation_ref": "rec.vascular_referral", "finding_refs": ["f1"], "text": "Vascular surgery consultation advised for symptomatic high-grade stenosis.", "priority": "urgent", "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T13:07:00Z", "edited": false }, "ai": null } ],
  "critical_flags": [],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T13:00:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["manual","quick_select"], "content_pack_versions": { "vascular.doppler": "1.1.0" }, "template_ref": "tpl.doppler_carotid", "revision": 3 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "hash_algorithm": "jcs-sha256/1", "created_at": "2026-07-09T13:00:00Z", "last_modified_at": "2026-07-09T13:07:00Z", "revision": 3, "revisions": [ { "revision": 1, "at": "2026-07-09T13:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:3c4d5e", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_role": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```
*(`m3`'s `components[]` references `meas.doppler_cca_psv`, a measurement whose own row is not separately materialized in this document — components reference the catalog measurement key + a captured value/unit for audit purposes; they are not required to also exist as a standalone top-level `measurements[]` entry.)*

---

## 18. Enumerations (canonical, closed unless noted)

| Field | Values |
|---|---|
| `finding.presence` | `present`, `absent`, `normal`, `indeterminate` |
| `finding.certainty` | `definite`, `probable`, `possible`, `cannot_exclude` |
| `finding.sentence_source` | `content_pack_default`, `rule`, `edited`, `manual` |
| `finding.interval_change` | `new`, `stable`, `increased`, `decreased`, `resolved` (optional; null when no prior) |
| `included_from.kind` | `included_findings_ref`, `combo` |
| `measurement.value_kind` | `scalar`, `ratio`, `range`, `derived`, `index`, `date` |
| `measurement.source` (raw-data source — narrower than `origin`, measurement-only) | `manual`, `dicom_sr`, `ocr`, `ai`, `calculated` |
| `provenance.origin` (universal — how the atom entered the document) | `manual`, `quick_select`, `content_pack_default`, `template`, `voice`, `ai_suggestion`, `measurement_import`, `calculated`, `ocr`, `schema_migration`, `backfill` *(open — R10 requires only presence + valid timestamp; an unrecognized value is a warning per R10w, never a reject)* |
| `impression.fragment.source` | `finding_fragment`, `rule`, `manual`, `ai_suggestion` |
| `section.kind` | `clinical_history`, `technique`, `comparison`, `findings`, `impression`, `recommendation`, `advice` |
| `recommendation.priority` | `routine`, `urgent`, `critical` |
| `critical_flag.status` | `raised`, `acknowledged`, `communicated` |
| `audit.signature.state` | `draft`, `preliminary`, `final`, `addendum`, `amended` |
| `audit.hash_algorithm` | `jcs-sha256/1` (versioned identifier; new algorithms get new suffixes, never silently redefine an existing one) |
| `lat.*` (laterality — fixed vocabulary, not a catalog table) | `left`, `right`, `bilateral`, `midline`, `na`, `none` |
| `ai.runs[].human_review` | `accepted_verbatim`, `accepted_edited`, `rejected`, `pending` |
| `ai.runs[].purpose` | `finding_suggestion`, `impression_suggestion`, `measurement_extraction`, `qc`, `completeness`, `contradiction` |

---

## 19. What the next phase (after C1) must build against this spec

1. `schemas/structured-report-v1.schema.json` — the full JSON Schema (§1.5) + a golden-fixture corpus (the five examples in §17 must pass; deliberately-broken variants fail each R-rule in §12, including the corrected R2b/R11b/R14b/R14c cases this revision added).
2. A **pure validator** `(document, catalogSnapshot, contentPackRegistries) → {ok, errors[], warnings[]}` implementing tiers A + B (§12) with the draft-save/finalize severity split as a first-class parameter, unit-tested with no DB (same shape as the B1/B2 and K1 validation layers).
3. **Writer/serializer** that emits `structured_json` + rendered prose, computes `content_sha256` via RFC 8785 JCS + SHA-256 (§10) with byte-for-byte golden fixtures, and enforces R13/R14/R14b/R14c at finalize.
4. **Reader/up-migration registry** (§2.3) with golden from→to fixtures, and the verify-before-migrate ordering rule enforced.
5. Additive **migrations** (`ADD COLUMN … jsonb`, expression indexes, `report_finding_index`) — §13/§15 — behind a flag, dormant. `GENERATED ... STORED` columns, if wanted, are their own explicitly-scheduled rewrite step, not bundled in.
6. Renderer switch and analytics projection — later, out of this spec's critical path.

Everything above is **specification only**; no runtime code, migration, endpoint, or DB import is delivered by Ticket D1.

---

## 20. Revision 2 — what changed and why (adversarial review record)

This revision followed a 9-lens adversarial review (repo-fidelity, schema/versioning, cross-object consistency, provenance/AI/audit, validation completeness, Postgres performance, backward-compat, clinical/modality coverage, future extensibility/interop) run against revision 1 of this document and the real B1/B2 catalog, K1 pipeline, and repo schema. All 12 **mustFix** findings from that review are applied above:

1. **§1.4/R1 reference grammar** — rewritten so `sev./loc./meas.` are finding-scoped (not global scales that don't exist in the schema), `rec./crit./tpl./combo.` resolve against K1 content-pack registries (no B1/B2 table backs them), and parameter options use an unambiguous two-field form instead of a three-segment dotted string.
2. **`lat.*`** — now a fixed closed enum (including `na`), not a catalog lookup.
3. **`content_sha256` canonicalization** — fully specified as RFC 8785 JCS + SHA-256 over a named object with an exact two-field exclusion set (by JSON Pointer) and a versioned `hash_algorithm`.
4. **`catalog_snapshot` reproducibility guarantee** — downgraded from "validates identically for 10 years" to an honest statement of what is and is not re-verified against a live, in-place-mutated catalog (§2.4).
5. **`x_*` under `additionalProperties:false`** — fixed via `patternProperties: {"^x_": true}` on every core object.
6. **`provenance.origin` enum inconsistency** (`"calculated"` missing from the closed list) — reconciled into one canonical list (§18), with `origin` vs measurement-only `source` now explicitly distinguished.
7. **Missing AI block on an AI-sourced impression fragment** (§17.1 `imp2`) — fixed, and a bidirectional anti-laundering rule (R11b) added so this class of gap is now mechanically caught.
8. **Draft-save vs. finalize rule contradiction** — replaced two conflicting prose paragraphs with a single per-rule "When enforced" column (§12); R8 moved to warn-on-save/block-finalize.
9. **Generated columns claimed as part of a "no rewrite" migration step** — corrected: `GENERATED ... STORED` forces a full-table rewrite; expression indexes are the actual zero-rewrite tool (§13, §15.2).
10. **Partitioning `patient_reports` by `created_at`** — withdrawn as a recommendation; it breaks the table's existing global unique constraints (`report_number`, `public_token`) (§15.5).
11. **`report_finding_index` design** — fixed to include a real dedup/supersede key (`document_id`+`finding_lid`), corrected the `report_id` type mismatch by keying on `document_id` instead, and removed draft rows from the projection (§15.4).
12. **Rollback claim** — scoped to pre-dual-write stages only; `DROP COLUMN` on a column holding any signed document is now explicitly prohibited (§13).

The highest-value **shouldFix** findings are also applied: required `catalog_snapshot`/`ai.guarding` at the top level; a pinned ULID pattern for `document_id`; the R0/forward-compat clarification (§1.2); AI reproducibility hardening (`prompt_digest`, `output_lids`, bidirectional R11b/R11c); signature hardening (`signed_by` distinctness, mandatory `audit_log_ref` linkage, `amends_document_id` chain integrity); a hashed `study_context.identifiers` block; an honest accounting of coding hooks (§11.3); the `included_from` self-reference bug fix; `sections[]` optionality clarified; the finding↔measurement bidirectional ownership rule (R2b) and the §17.2 example fix it required; the `provenance.revision`/`audit.revision` reconciliation rule; and the GIN/index-idempotency corrections (§15.3, §15.2).

**Explicitly deferred, not applied in this revision** (flagged rather than silently dropped):
- A sixth worked example for obstetric ultrasound (schema capability for GA/EDD/percentile was added in §11.4; the worked example was judged to exceed this ticket's five-modality scope).
- A worked example exercising `interval_change`/prior-study comparison (capability added in §3.7; not exercised in §17, since all five examples set `has_prior:false`).
- Multi-subject (twin/triplet) attribution, per-site/age-banded normal ranges, tenant/facility-scoped identifiers, and a first-class `codes[]` array for instance-level clinical/billing codes — noted as future strengthening, not required for this phase.
- An immutable, append-only catalog-snapshot store (would upgrade §2.4's guarantee from "rendered strings only" to "full referential re-validation over time") — explicitly named as a possible future ticket, not assumed here.
