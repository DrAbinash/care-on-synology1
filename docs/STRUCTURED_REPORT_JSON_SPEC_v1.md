# Canonical Structured Report JSON — Specification v1

**Ticket:** D1 (design only — no application code)
**Status:** Implementation specification for the engineering phase **after C1**
**Columns this document governs:** `radiology_report_drafts.structured_json`, `patient_reports.structured_json` (both to be added as `jsonb`, nullable — see §13)
**Depends on:** B1/B2 canonical catalog (`finding_definitions`, `parameter_groups`/`parameter_options`, `finding_*_bindings`, `finding_aliases`), K1 content-pack format, C1 (finding/measurement domain model)
**Non-goals of D1:** no runtime code, no migrations, no API endpoints, no DB import, no rendering changes. This document defines *what the JSON is*; later phases build the writer/reader/validator/renderer against it.

---

## 0. Design principles

1. **The JSON is the source of truth for structure; prose is a projection.** `structured_json` holds the machine-readable clinical content. The existing prose columns (`radiology_report_drafts.findingsSections`/`impression`, `patient_reports.body`) remain the rendered form and stay authoritative for legacy rows. New reports write **both**; the renderer is not changed by this ticket (coexistence — see §13).
2. **Everything clinical resolves to the canonical catalog.** Findings, parameters, options, severities, locations, lateralities, measurements, recommendations, critical flags and templates are **references** into the B1/B2 catalog, never free-form duplicates. This is what makes 10M findings queryable, comparable, and exportable to DICOM-SR/FHIR/HL7 later.
3. **Every clinical atom carries provenance and (if AI-derived) a reproducible AI pin.** This closes the medico-legal traceability gaps identified in the pre-implementation risk review (AI text indistinguishable from radiologist text; no prompt/model/input pinning).
4. **Finalized documents are immutable and self-verifying.** A finalized report freezes a content hash; the catalog versions it was authored against are pinned inside the document, so it renders and validates identically for its full 10-year retention even as the live catalog evolves.
5. **Open for extension, closed for corruption.** Core objects reject unknown keys (`additionalProperties: false`); a single reserved `x_*` / `extensions` channel absorbs future/vendor data without a schema bump.
6. **Additive and dormant.** The column is nullable; nothing consumes it until a later phase; legacy rows stay null and keep using prose.

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
    "catalog_schema_version": "1.0.0"
  },
  "study_context": { "...": "§3.1" },
  "sections": [ "...ordered display sections, §7.4" ],
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

### 1.2 `schema_version` semantics (semver)

| Component | Bumped when | Reader obligation |
|---|---|---|
| **major** (`X`.0.0) | A field is removed/renamed/retyped, or a required field is added — an old reader can no longer safely parse. | Must run the registered up-migration `from→to` (§2.3) before reading. |
| **minor** (1.`X`.0) | A new **optional** field or a new enum value is added. | Old readers ignore unknown fields/enum values gracefully (forward-compatible read). |
| **patch** (1.0.`X`) | Documentation/constraint clarification, no structural change. | None. |

`schema_version` is **write-stamped** by the producer and **never** silently rewritten on a finalized document.

### 1.3 Identifiers

- `document_id` — a ULID/UUIDv7 minted once when the structured document is first created; stable for the life of the report; distinct from the row `id`. (Chosen ULID/UUIDv7 for sortable, collision-free, offline-safe generation — aligns with risk-review C1.)
- **`lid` (local id)** — every finding / measurement / impression fragment / recommendation / critical flag / section instance carries a short `lid` (e.g. `"f1"`, `"m1"`, `"imp1"`) that is **unique within the document** and **immutable for the life of the document**. Cross-references inside the document use `lid`; references into the catalog use the namespaced `*_ref` syntax (§1.4).

### 1.4 Reference syntax (into the canonical catalog)

All catalog references are strings `"<namespace>.<catalog_key>"`. Namespaces map to B1/B2 tables:

| Namespace | Resolves to (B1/B2 table) | Example |
|---|---|---|
| `finding.` | `finding_definitions.key` | `finding.liver.simple_cyst` |
| `param.` | `parameter_groups.key` | `param.echogenicity` |
| `sev.` | `finding_severity_bindings.key` (scale key) | `sev.fazekas.2` |
| `lat.` | canonical laterality (`finding_locations.laterality` domain) | `lat.right` |
| `loc.` | `finding_locations.key` | `loc.liver.right_lobe` |
| `meas.` | `finding_measurement_bindings.key` | `meas.cyst.diameter` |
| `rec.` | `finding_recommendations` code / `rec` registry | `rec.followup_usg_6mo` |
| `crit.` | critical-registry key (`crit.*`) | `crit.acute_infarct` |
| `tpl.` | `structured_report_templates`/`radiology_master_templates` key | `tpl.mri_brain_plain` |

A **parameter option value** is written as `param.<group>.<option>` where `<option>` is a `parameter_options.key` within that group, e.g. `param.echogenicity.anechoic`.

> **Resolution rule:** references resolve against the catalog **pinned in `catalog_snapshot`**, not the live catalog. This guarantees reproducibility (§2.4, §12).

### 1.5 JSON Schema (normative skeleton, Draft 2020-12)

The full JSON Schema ships as `schemas/structured-report-v1.schema.json` in the C1-successor phase. Skeleton:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://care.local/schemas/structured-report/v1.json",
  "type": "object",
  "required": ["schema_version", "kind", "document_id", "study_context", "findings", "audit"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "kind": { "const": "radiology.structured_report" },
    "document_id": { "type": "string", "minLength": 20, "maxLength": 40 },
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
  "$defs": { "...": "each object §3–§11; core objects set additionalProperties:false except extensions" }
}
```

---

## 2. Backward compatibility strategy

### 2.1 Forward-compatible reads (minor changes)
Readers **must ignore** unknown optional fields and unknown enum values they do not recognize, degrading gracefully (e.g., render the stored `sentence` even if a new parameter kind is unknown). A minor bump never requires a migration.

### 2.2 The `sentence`/`impression_fragment` safety net
Every finding stores its **rendered** `sentence` and `impression_fragment` (§3.4) alongside its structured refs. If a future reader cannot interpret a structured atom (unknown param, retired catalog key), it **always** has faithful prose to display. No report is ever unreadable due to schema drift. This is the core backward-compat guarantee.

### 2.3 Up-migration registry (major changes)
Breaking changes ship with a pure, deterministic converter registered `from_version → to_version`:
```
migrate("1.x", "2.0", doc) -> doc'    // total function, no IO, unit-tested with golden fixtures
```
Rules:
- **Drafts** (`radiology_report_drafts`) may be migrated **in place** (rewrite the column).
- **Finalized** (`patient_reports`) documents are **never** mutated in place. Migration is applied **on read** (lazy, in-memory) so the stored, hashed, signed bytes remain the legal record. An optional batch job may write a *new revision* that preserves the original + records the migration in `audit.revisions` (§10) with `provenance.origin = "schema_migration"`.
- Converters are chained (1.0→1.1→2.0) so only adjacent steps are maintained.

### 2.4 Catalog evolution vs. document stability
The catalog (B1/B2) is versioned and soft-delete-only. A finding key may be **deprecated** but its row and key persist, so old documents keep resolving. `catalog_snapshot` pins the exact content-pack versions used, so:
- References resolve deterministically for the report's lifetime.
- Analytics can normalize across catalog versions using catalog alias/version history.
- A deprecated finding renders from the pinned snapshot even after it leaves the active picker.

### 2.5 Compatibility matrix (what is / isn't a breaking change)

| Change | Semver | Migration? |
|---|---|---|
| Add optional field to a finding | minor | no |
| Add new `provenance.origin` enum value | minor | no (readers treat unknown as `"unknown"`) |
| Add a new namespace (e.g. `bodysite.`) | minor | no |
| Make an optional field required | **major** | yes |
| Rename `sentence` → `rendered_text` | **major** | yes |
| Change `measurement.value` from number to object | **major** | yes |
| Retire a catalog key | none (catalog concern) | no (snapshot pin) |

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
  "comparison": { "has_prior": true, "prior_study_ref": "ACC-20260512-MR-014" }
}
```

### 3.2 Finding object
```jsonc
{
  "lid": "f1",
  "definition_ref": "finding.brain.small_vessel_ischemia",
  "presence": "present",              // present | absent | normal | indeterminate
  "certainty": "definite",            // definite | probable | possible | cannot_exclude
  "laterality": "lat.bilateral",      // optional; lat.* or null
  "locations": ["loc.brain.periventricular", "loc.brain.deep_white_matter"],
  "severity": "sev.fazekas.2",        // optional; a sev.* scale point
  "parameters": [ "...§5" ],
  "measurement_refs": ["m1"],         // lids of measurements in the top-level measurements[]
  "sentence": "Scattered T2/FLAIR hyperintensities in the periventricular and deep white matter, Fazekas grade 2.",
  "impression_fragment": "Moderate chronic small vessel ischemic changes.",
  "sentence_source": "content_pack_default",  // content_pack_default | rule | edited | manual
  "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false },
  "included_from": null,              // §3.5 combos / included_findings_ref
  "provenance": { "...§8.2" },
  "ai": { "...§9.2" },
  "order": 10
}
```

Rules:
- `definition_ref` **must** resolve (§12-R1). `presence`, `certainty`, `sentence_source` are closed enums.
- `severity`, each `parameters[].param`, each `locations[]`, `laterality` must be **valid for** `definition_ref` per the catalog bindings (§12-R4) — e.g. `sev.fazekas.*` only if the finding binds the Fazekas scale.
- `sentence` and `impression_fragment` are **always present and rendered** (backward-compat net, §2.2), even for `presence:"normal"`.
- A `presence:"absent"` or `"normal"` finding **must not** carry positive measurements or a positive severity (§12-R7 clinical consistency).

### 3.3 Presence semantics
| `presence` | Meaning | Renders in |
|---|---|---|
| `present` | Abnormality asserted | Findings + (if significant) Impression |
| `normal` | Structure explicitly reported normal | Findings (normal statement) |
| `absent` | Pertinent negative explicitly excluded | Findings (negative statement) |
| `indeterminate` | Seen but not characterizable | Findings + Impression (recommend further work-up) |

### 3.4 Rendered text pinning
`sentence` is the finding's `default_sentence` (K1) with its parameter values interpolated at author time and then optionally edited. `sentence_source = "edited"` marks radiologist departure from the catalog default; `impression_fragment` mirrors the catalog `impression_fragment`. Storing the rendered strings is mandatory (immutability + backward-compat).

### 3.5 Composition: `included_from`, combos, `extends`
- **`included_findings_ref`** (content-pack macro): when a finding is materialized because a parent template/combo included it, `included_from = { "kind": "included_findings_ref", "ref": "finding.brain.normal_survey" }`.
- **Combo tile**: a single Quick Select tile that emits several findings — each emitted finding carries `included_from = { "kind": "combo", "ref": "combo.brain.normal_baseline", "tile_lid": "..." }`.
- **`extends`** is resolved at the **catalog/content-pack** layer (K1), not here; by the time a finding reaches `structured_json` it is fully expanded. The document records the provenance of the expansion, not the unresolved `extends` chain.

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
Acknowledgement/communication workflow state also lives in the DB (`patient_reports.critical_*`); the structured document records that a critical was raised, by whom, and against which finding. `critical_ref` must resolve to the `crit.*` registry (§12-R1).

---

## 4. Measurement representation

Measurements are **first-class** objects in the top-level `measurements[]`, optionally linked to an owning finding via `finding_ref`. This resolves study-level biometry (belongs to no abnormality) vs. lesion-level measurements uniformly, and gives every measurement independent provenance (which the current `usg_measurements` text/real split cannot).

```jsonc
{
  "lid": "m1",
  "measurement_ref": "meas.kidney.length",   // resolves to finding_measurement_bindings / meas registry
  "finding_ref": null,                        // or a finding lid (e.g. "f3")
  "site": "loc.kidney.right",                 // optional loc.* anatomical site
  "laterality": "lat.right",
  "value": 102.0,                             // canonical NUMERIC value (never a display string)
  "unit": "mm",                               // UCUM-compatible; must match catalog meas unit (§12-R5)
  "value_kind": "scalar",                     // scalar | ratio | range | derived | index
  "range": null,                              // {"low":x,"high":y} when value_kind=range
  "components": null,                          // for derived, e.g. EFW inputs; array of {measurement_ref,value,unit}
  "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" },
  "abnormal": false,
  "provenance": {
    "origin": "measurement_import",           // manual | measurement_import | ocr | ai | calculated
    "source": "dicom_sr",                     // manual | dicom_sr | ocr | ai | calculated
    "confidence": 0.98,                        // 0..1 (preferred) — legacy low/med/high maps to 0.3/0.6/0.9
    "sop_instance_uid": "1.2.840...",         // frame/image traceability when source=dicom_sr
    "frame_number": 12,
    "captured_at": "2026-07-09T10:05:11Z",
    "actor": "OHIF",
    "edited": false
  },
  "display": "Right kidney: 102 mm (normal)"
}
```

Rules:
- `value` is **always numeric** (or `null` if only qualitative). Display strings live in `display`, never in `value` (fixes the `usg_measurements.bpd = text` anti-pattern).
- `unit` **must** be UCUM-expressible and **must** equal the catalog `finding_measurement_bindings.unit` for `measurement_ref` (§12-R5), unless an explicit `unit_conversion` extension is present.
- `value_kind = "derived"` requires `components[]` (auditability of calculated values like EFW, RI).
- `measurement.source` enum aligns with existing `usg_measurements.source` (`dicom_sr | ocr | manual`) plus `ai | calculated`.
- Every measurement carries independent `provenance` (image-level traceability for medico-legal defense).

**Ratio/index example (Doppler RI):**
```json
{ "lid": "m5", "measurement_ref": "meas.doppler.ri", "finding_ref": "f2",
  "value": 0.78, "unit": "1", "value_kind": "index",
  "components": [
    {"measurement_ref": "meas.doppler.psv", "value": 82, "unit": "cm/s"},
    {"measurement_ref": "meas.doppler.edv", "value": 18, "unit": "cm/s"}
  ],
  "normal_range": {"low": 0.55, "high": 0.70, "unit": "1", "source": "catalog"}, "abnormal": true,
  "provenance": {"origin":"manual","source":"manual","confidence":0.9,"edited":false},
  "display": "RI 0.78 (elevated)" }
```

---

## 5. Parameter representation

Parameters are the **structured attributes** of a finding (echogenicity, margin, signal, disc-level, etc.). They live **inside** the finding (`parameters[]`) because a parameter value is only meaningful in a finding's context. Each references `param.*` and either an option or a scalar.

```jsonc
"parameters": [
  { "param": "param.echogenicity", "kind": "option", "option": "param.echogenicity.anechoic", "label": "Anechoic" },
  { "param": "param.margin",       "kind": "option", "option": "param.margin.well_defined",   "label": "Well-defined" },
  { "param": "param.size_category","kind": "option", "option": "param.size_category.small",    "label": "Small" },
  { "param": "param.wall",         "kind": "boolean","value": false,   "label": "Wall: thin" },
  { "param": "param.count",        "kind": "numeric","value": 2, "unit": "count" }
]
```

Rules:
- `kind ∈ {option, numeric, boolean, text}` and **must** match the catalog `parameter_groups.data_type` for `param` (§12-R6).
- `option` (when `kind=option`) **must** be a `parameter_options.key` of that group (§12-R6).
- `label` is the rendered display value, pinned for backward-compat.
- A finding's **required** parameters (per `finding_parameter_bindings.required`) **must** be present (§12-R8).
- `allow_multiple` parameters (per catalog) may appear more than once for the same `param`; otherwise a `param` appears at most once per finding (§12-R6).

---

## 6. Recommendation representation

```jsonc
"recommendations": [
  {
    "lid": "rec1",
    "recommendation_ref": "rec.followup_usg_6mo",   // rec.* catalog code; or null for free-text
    "finding_refs": ["f3"],                          // findings this recommendation follows from
    "text": "Suggest follow-up ultrasound in 6 months to confirm stability.",
    "priority": "routine",                           // routine | urgent | critical
    "provenance": { "...§8.2" },
    "ai": { "...§9.2" }
  }
]
```

Rules:
- `recommendation_ref` must resolve (§12-R1) when non-null; **`code` uniqueness** — no two recommendations in the document share the same non-null `recommendation_ref` unless they attach to disjoint `finding_refs` (§12-R9, mirrors K1 "no duplicate recommendation codes").
- `finding_refs[]` must be valid `lid`s of findings present in the document (§12-R2).
- A `priority:"critical"` recommendation should correspond to a `critical_flags[]` entry.

---

## 7. Impression fragments

The impression is assembled from **fragments**, each traceable to its source finding, plus the final ordered rendered lines.

```jsonc
"impression": {
  "fragments": [
    { "lid": "imp1", "finding_ref": "f1", "text": "Moderate chronic small vessel ischemic changes.",
      "source": "finding_fragment", "rank": 1, "provenance": {"...":"§8.2"} },
    { "lid": "imp2", "finding_ref": null, "text": "No acute intracranial abnormality.",
      "source": "manual", "rank": 2, "provenance": {"...":"§8.2"} }
  ],
  "items": [
    { "lid": "impi1", "fragment_refs": ["imp2"], "text": "1. No acute intracranial abnormality." },
    { "lid": "impi2", "fragment_refs": ["imp1"], "text": "2. Moderate chronic small vessel ischemic changes (Fazekas 2)." }
  ],
  "rendered": "IMPRESSION:\n1. No acute intracranial abnormality.\n2. Moderate chronic small vessel ischemic changes (Fazekas 2)."
}
```

Rules:
- Each `fragments[].finding_ref` (when non-null) must be a valid finding `lid` (§12-R2). `source ∈ {finding_fragment, rule, manual, ai_suggestion}`.
- `items[]` is the ordered impression the radiologist approved; `rendered` is the exact prose (backward-compat + immutability).
- `impression_fragment` on a finding (§3.2) is the *candidate*; an `impression.fragments[]` entry is the *accepted* fragment (may be edited; `source:"finding_fragment"` + edited flag in provenance).

### 7.4 `sections[]` (display ordering)
`sections[]` is the ordered list of display sections binding structured content to the rendered report layout:
```json
{ "lid": "s3", "kind": "findings", "title": "FINDINGS",
  "finding_refs": ["f1","f2"], "measurement_refs": ["m1"], "rendered": "…prose…" }
```
`kind ∈ {clinical_history, technique, comparison, findings, impression, recommendation, advice}`.

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

### 8.2 Instance-level provenance (attached to each atom)
```json
{
  "origin": "quick_select",            // manual | quick_select | content_pack_default | template |
                                       // voice | ai_suggestion | measurement_import | schema_migration | backfill
  "actor": "dr_abinash",               // human username or system/agent id
  "source_ref": "qs.brain.svd_fazekas2",
  "created_at": "2026-07-09T10:03:12Z",
  "edited": false,                     // true once a human modifies the emitted value
  "edited_by": null,
  "edited_at": null
}
```

Rules:
- **Every** finding/measurement/impression-fragment/recommendation/critical-flag **must** carry `provenance` with a known `origin` and `created_at` (§12-R10).
- `origin = "ai_suggestion"` **requires** a sibling `ai` block with model + prompt pins (§9, §12-R11).
- `edited=true` marks radiologist departure from an automated suggestion — the audit/medico-legal signal that a human owned the final content.

---

## 9. AI metadata

Closes the risk-review findings: *AI text indistinguishable from radiologist text* and *no (prompt-version + model-version + input) pin → non-reproducible*.

### 9.1 Document-level `ai` block — immutable run registry
```json
"ai": {
  "runs": [
    {
      "run_id": "airun_01J9Z...",
      "purpose": "impression_suggestion",     // finding_suggestion | impression_suggestion | measurement_extraction | qc | completeness | contradiction
      "provider": "ollama",
      "model_ref": "llama3.1:8b-instruct-q4",  // exact model identifier/tag
      "model_digest": "sha256:…",              // immutable model fingerprint when available
      "prompt_ref": "aiprompt.impression.neuro", // ai_prompt_templates key
      "prompt_version": 7,                      // pinned version, NOT "latest"
      "params": { "temperature": 0.2, "top_p": 0.9, "seed": 42 },
      "input_digest": "sha256:…",               // hash of the exact input (text/measurements/image refs)
      "input_refs": { "image_sop_uids": ["1.2.840…"], "finding_lids": ["f1"] },
      "started_at": "2026-07-09T10:07:00Z",
      "latency_ms": 1840,
      "output_digest": "sha256:…",
      "human_review": "accepted_edited"         // accepted_verbatim | accepted_edited | rejected | pending
    }
  ],
  "guarding": { "auto_sign": false }            // invariant: AI NEVER auto-signs (risk-review)
}
```

### 9.2 Instance-level `ai` block (on any AI-derived atom)
```json
{
  "suggested": true,
  "run_id": "airun_01J9Z...",       // ties back to ai.runs[]
  "accepted_verbatim": false,        // false ⇒ radiologist edited the suggestion
  "confidence": 0.71,
  "model_ref": "llama3.1:8b-instruct-q4",
  "prompt_ref": "aiprompt.impression.neuro",
  "prompt_version": 7
}
```

Rules:
- Any atom with `provenance.origin = "ai_suggestion"` **must** carry `ai.suggested = true`, a `run_id` present in `ai.runs[]`, and `model_ref` + `prompt_ref` + `prompt_version` (§12-R11). No unpinned `"latest"` model/prompt is permitted (§12-R12).
- `human_review` and `accepted_verbatim` make **AI-vs-human authorship explicit at the atom level** — the medico-legal record can prove what the radiologist wrote vs accepted.
- `ai.guarding.auto_sign` must be `false` for any document that reaches finalization (§12-R13).

---

## 10. Audit metadata

Makes the structured document **self-verifying and immutable once signed**, complementing the append-only `audit_logs` hash chain (see Ticket E0.2).

```json
"audit": {
  "schema_version": "1.0.0",
  "created_at": "2026-07-09T10:00:00Z",
  "last_modified_at": "2026-07-09T10:20:00Z",
  "revision": 4,
  "revisions": [
    { "revision": 1, "at": "2026-07-09T10:00:00Z", "by": "dr_abinash", "action": "created" },
    { "revision": 4, "at": "2026-07-09T10:20:00Z", "by": "dr_abinash", "action": "edited" }
  ],
  "content_sha256": "…",              // hash over the canonicalized `report` with `audit.content_sha256`+`signature` removed
  "audit_log_ref": 480231,            // FK-by-value to audit_logs.id for the finalize event
  "signature": {
    "state": "final",                 // draft | preliminary | final | addendum | amended
    "signed_by": "dr_abinash",
    "signed_role": "radiologist",
    "signed_at": "2026-07-09T10:20:30Z",
    "signed_content_sha256": "…",     // frozen at signing; equals content_sha256 at that instant
    "amends_document_id": null        // set for addendum/amended docs → prior document_id
  }
}
```

Rules:
- `content_sha256` is computed over a **canonicalized** serialization (sorted keys, normalized whitespace/number formatting — the same canonicalization discipline as `audit.ts::canonicalHashPayload`) of the `report` object with the two hash/signature fields removed.
- For a **finalized** document: `signature.state = "final"`, `signed_content_sha256` present, and it **must** equal the recomputed `content_sha256` (§12-R14). Any later change requires an **addendum/amended** *new document* (`amends_document_id` set), never an in-place edit — this makes signed reports tamper-evident and satisfies the risk-review "signed report integrity" gap.
- `audit_log_ref` links the finalize event to the tamper-evident chain.

---

## 11. Future extensibility

1. **`extensions` (document) and `x_*` (any object):** namespaced open channels. Validators **ignore** unknown `x_*`/`extensions.*` keys; core keys stay `additionalProperties:false`. Example:
   ```json
   "extensions": { "x_biRADS": { "category": 3 }, "x_fetal": { "ga_weeks": 22, "percentile": 40 } }
   ```
2. **New namespaces** (e.g. `bodysite.` for SNOMED body-site, `code.` for LOINC/RadLex) can be added minor-version without touching existing docs — the reference grammar `<ns>.<key>` is open.
3. **Coding hooks:** every `*_ref` maps to a catalog row that already carries optional `code_system`/`code_value` (B1/B2), so DICOM-SR / FHIR (Observation/DiagnosticReport) / HL7 export is a downstream transform, not a schema change.
4. **Modality growth:** a new modality/body-region needs new *content-pack* entries (K1) and *catalog* rows (B1/B2), **not** a JSON-schema change — proven by the five modality examples below all using the identical schema.
5. **Deprecation without breakage:** retire catalog keys via soft-delete; pinned `catalog_snapshot` keeps old docs valid.

---

## 12. Validation rules

Validation runs in **two tiers**: (A) **structural** (JSON Schema Draft 2020-12) and (B) **semantic/referential** (a rule engine that needs the pinned catalog). A document is *valid* only if both pass. Rules:

| # | Rule | Tier | On failure |
|---|---|---|---|
| R0 | Parses as JSON; matches the JSON Schema for its `schema_version`; core objects reject unknown keys | A | reject |
| R1 | Every `*_ref` (`finding./param./sev./lat./loc./meas./rec./crit./tpl.`) resolves in the pinned catalog | B | reject |
| R2 | Every intra-doc reference (`finding_ref`, `measurement_refs`, `fragment_refs`, `finding_refs`, `tile_lid`) targets an existing `lid` | B | reject |
| R3 | All `lid`s are unique within the document | A/B | reject |
| R4 | `severity`/`laterality`/`locations`/`parameters[].param` are **permitted for** the finding's `definition_ref` per catalog bindings | B | reject |
| R5 | `measurement.unit` is UCUM-valid and equals the catalog unit for `measurement_ref` (unless `x_unit_conversion` present) | B | reject |
| R6 | `parameters[].kind` matches `parameter_groups.data_type`; `option` ∈ that group's options; single-valued unless `allow_multiple` | B | reject |
| R7 | Clinical consistency: `presence ∈ {absent, normal}` ⇒ no positive severity and no `abnormal:true` measurement on that finding | B | reject |
| R8 | Required parameters (per `finding_parameter_bindings.required`) present on the finding | B | reject |
| R9 | No duplicate `recommendation_ref` across recommendations that share a `finding_ref` (no duplicate recommendation codes) | B | reject |
| R10 | Every finding/measurement/impression-fragment/recommendation/critical-flag has `provenance` with known `origin` + `created_at` | A/B | reject |
| R11 | `provenance.origin="ai_suggestion"` ⇒ `ai.suggested=true` + `run_id` ∈ `ai.runs` + `model_ref`+`prompt_ref`+`prompt_version` | B | reject |
| R12 | No AI `model_ref`/`prompt` may be an unpinned alias (`"latest"`, `"prod"`) | B | reject |
| R13 | `ai.guarding.auto_sign` is `false` (AI never auto-signs) | A | reject |
| R14 | Finalized doc: `signature.state="final"`, `signed_content_sha256` present and equals recomputed `content_sha256` | B | reject |
| R15 | `ai_contradiction_rules` fire clean: no two findings/measurements violate a catalog contradiction rule (e.g. "no free fluid" + a positive free-fluid measurement) | B | **warn** (block finalize; allow save) |
| R16 | `ai_completeness_rules` satisfied: template-required sections/findings present | B | **warn** (block finalize; allow save) |
| R17 | `critical_flags[].critical_ref` resolves to the `crit.*` registry; no duplicate critical registry keys per finding | B | reject |
| R18 | `document_id` present, well-formed; `schema_version` matches a known schema | A | reject |

**Severity of validation:** R0–R14, R17–R18 are **hard** (reject on write). R15–R16 are **soft**: they must not block *saving a draft* but **must block finalization** (a signed report must be complete and contradiction-free). This mirrors K1's `ai_contradiction_rules`/`ai_completeness_rules` and the "AI assists, radiologist decides" boundary.

**Where validation runs:** on every write to `structured_json` (draft save = tiers A + soft-B; finalize = full A + hard + soft-B). Validation is **pure** given (document, pinned catalog snapshot) — no other IO — so it is exhaustively unit-testable (same pattern as the B1/B2 validation layer).

---

## 13. Migration strategy (design only — no migration written in D1)

**Schema/DDL (later phase):**
1. `ALTER TABLE radiology_report_drafts ADD COLUMN IF NOT EXISTS structured_json jsonb;` (nullable)
2. `ALTER TABLE patient_reports ADD COLUMN IF NOT EXISTS structured_json jsonb;` (nullable)
3. Optional companion columns are **generated** from the jsonb for cheap filtering (§15), added in the same phase.

Both are **additive, nullable, dormant** — no backfill required, no rewrite of existing rows, consistent with the program's coexistence rule and the repo's idempotent-migration convention (`ADD COLUMN IF NOT EXISTS`).

**Data lifecycle:**
- **Legacy rows** keep `structured_json = NULL`; the prose columns remain authoritative. Readers branch on `structured_json IS NULL`.
- **New reports** (post-enablement) write `structured_json` **and** the rendered prose columns. The renderer is unchanged initially (it reads prose); a later phase switches rendering to derive from `structured_json`.
- **Draft → final promotion:** when a `radiology_report_drafts` row is promoted to `patient_reports`, the `structured_json` is copied and `audit.signature` is set to `final` (freeze + hash). The draft's `structured_json` remains for history.
- **Optional backfill (future, not D1):** NLP re-extraction of legacy prose into `structured_json` with `provenance.origin="backfill"`, low confidence, never overwriting a human-signed prose record — explicitly out of scope here.

**Rollout ordering** (later phase): (1) add columns; (2) ship writer behind `ff_radiology_catalog`/a `ff_structured_report` flag (default off) so nothing consumes it; (3) enable dual-write; (4) switch renderer; (5) enable analytics projections. Each step is independently reversible.

**Rollback:** drop the (empty/unused) columns or leave them null; because writes are flag-gated and additive, disabling the flag fully reverts behavior with zero data loss.

---

## 14. Performance considerations

- **Column type is `jsonb`, not `text`** — parsed once, binary-stored, GIN-indexable, and TOAST-compressed above ~2 KB. (The current `patient_reports.parameters`/`radiology_report_drafts.findingsSections` are `text` — this spec deliberately does not repeat that anti-pattern.)
- **Document size budget:** typical structured report **< 50 KB**; **soft cap 256 KB**, **hard cap 1 MB** (R-perf). Image pixel data, full DICOM tag dumps, and large AI transcripts are **never** embedded — only references (SOP UIDs, `input_digest`). Voice transcripts stay in `radiology_voice_logs`; AI raw outputs in the AI tables.
- **Hot path is single-document read by PK** (open a report) — O(1), no jsonb scanning. Never make the reporting workspace depend on a GIN scan.
- **Write path** validates in-process against the pinned catalog (cached in memory) — no extra round-trips beyond the catalog cache.
- **Analytics/search path** does **not** scan `structured_json` across 100M rows. It reads a **derived normalized projection** (§15) that is btree-indexed. GIN on the jsonb is reserved for ad-hoc containment queries on **recent/hot** partitions only.
- **Canonicalization for hashing** is O(document size) and only on write/finalize, not on read.
- **At 100M reports** the dominant cost is table size; §15's partitioning + projection strategy keeps per-query cost bounded and avoids full-table jsonb scans (directly addressing risk-review theme T3).

---

## 15. Storage & indexing recommendations

1. **Store the document in `jsonb`** on both tables (nullable).
2. **Generated columns for cheap scalar filters** (added with the column, no app change):
   ```sql
   ALTER TABLE patient_reports
     ADD COLUMN sr_schema_version text
       GENERATED ALWAYS AS (structured_json->>'schema_version') STORED,
     ADD COLUMN sr_modality text
       GENERATED ALWAYS AS (structured_json #>> '{study_context,modality}') STORED,
     ADD COLUMN sr_finalized boolean
       GENERATED ALWAYS AS ((structured_json #>> '{audit,signature,state}') = 'final') STORED;
   -- btree indexes on sr_modality, sr_schema_version as needed
   ```
3. **GIN index (containment, hot data):**
   ```sql
   CREATE INDEX CONCURRENTLY patient_reports_sr_gin
     ON patient_reports USING gin (structured_json jsonb_path_ops);
   ```
   Use `jsonb_path_ops` (smaller, faster for `@>`/`@?`). Reserve for ad-hoc "reports containing finding X" on recent partitions.
4. **Derived normalized projection table (the scale answer)** — populated by the writer (or a trigger), the real substrate for cross-report analytics, QA surveillance, and DICOM-SR/FHIR export:
   ```sql
   CREATE TABLE report_finding_index (
     id            bigserial PRIMARY KEY,
     report_id     bigint NOT NULL,             -- → patient_reports.id
     report_kind   text   NOT NULL,             -- 'draft' | 'final'
     finding_key   text   NOT NULL,             -- finding_definitions.key
     presence      text   NOT NULL,
     severity_key  text,
     modality      text,
     body_region   text,
     is_critical   boolean NOT NULL DEFAULT false,
     created_at    timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX ON report_finding_index (finding_key, created_at);
   CREATE INDEX ON report_finding_index (report_id);
   ```
   Cross-report questions ("how many Fazekas-2 studies this quarter", "all reports with acute infarct") hit a btree here — never a GIN scan over 100M jsonb blobs.
5. **Partition `patient_reports` by `created_at` (range/monthly)** at scale so GIN/index maintenance and vacuum stay bounded and old partitions can be archived; `structured_json` rides along. (Ties to risk-review D-schema partitioning gap — recommendation, not required by D1.)
6. **Do not index the draft table for analytics** — drafts churn; index only `report_finding_index` from finalized reports for surveillance.

---

## 16. Object relationships (diagram)

```
structured_json (document)
│
├─ schema_version, kind, document_id
├─ catalog_snapshot ──────────────► pins content-pack + catalog versions (B1/B2)
├─ study_context ─ template_ref ──► tpl.*   (structured_report_templates)
│
├─ findings[]  (lid f*)
│    ├─ definition_ref ───────────► finding.*   (finding_definitions)
│    ├─ severity ─────────────────► sev.*       (finding_severity_bindings)
│    ├─ laterality ───────────────► lat.*
│    ├─ locations[] ──────────────► loc.*       (finding_locations)
│    ├─ parameters[]
│    │     ├─ param ──────────────► param.*     (parameter_groups)
│    │     └─ option ─────────────► param.*.*   (parameter_options)
│    ├─ measurement_refs[] ──┐
│    ├─ provenance (§8.2)    │  (lid → measurements[])
│    └─ ai (§9.2) ──────────┼──► ai.runs[] (run_id)
│                           │
├─ measurements[] (lid m*) ◄┘
│    ├─ measurement_ref ──────────► meas.*      (finding_measurement_bindings)
│    ├─ finding_ref ──────────────► findings[].lid
│    └─ provenance (source: dicom_sr/ocr/manual/ai/calculated)
│
├─ impression
│    ├─ fragments[] ─ finding_ref ► findings[].lid
│    └─ items[] ─ fragment_refs ──► impression.fragments[].lid
│
├─ recommendations[] ─ finding_refs ► findings[].lid ; recommendation_ref ► rec.*
├─ critical_flags[] ─ finding_ref ► findings[].lid ; critical_ref ► crit.*
│
├─ sections[] ─ finding_refs/measurement_refs ► lids   (display order)
├─ provenance (document, §8.1)
├─ ai.runs[]  (immutable model/prompt/input pins, §9.1)
├─ audit (content_sha256, signature — immutability, §10)
└─ extensions / x_*  (open channel, §11)
```

**Cardinalities:** document 1—* findings; finding 1—* parameters; finding 1—* measurements (via `measurement_refs`); measurement 0..1 finding (`finding_ref`); finding 0..1 impression-fragment→0..1 impression-item; finding 0..* recommendations; finding 0..* critical-flags; every atom 1—1 provenance; AI-atom *—1 `ai.runs[]` entry.

---

## 17. Complete modality examples

All five use the **identical schema** — only catalog references differ. (Abbreviated `audit`/`provenance` where repetitive; a real document carries them on every atom per §8, §10.)

### 17.1 MRI Brain (plain) — normal survey + small-vessel ischemia (AI-assisted impression)
```json
{
  "schema_version": "1.0.0",
  "kind": "radiology.structured_report",
  "document_id": "01J9ZBRAIN000000000000001",
  "catalog_snapshot": { "content_pack_versions": { "neuro.mri": "2.1.0" }, "catalog_schema_version": "1.0.0" },
  "study_context": { "modality": "MRI", "body_region": "brain", "study_type": "plain",
    "template_ref": "tpl.mri_brain_plain", "laterality_default": "lat.na",
    "comparison": { "has_prior": false, "prior_study_ref": null } },
  "sections": [
    { "lid": "s1", "kind": "technique", "rendered": "Multiplanar multisequence MRI of the brain without contrast." },
    { "lid": "s2", "kind": "findings", "finding_refs": ["f1","f2"], "measurement_refs": [], "rendered": "…" },
    { "lid": "s3", "kind": "impression", "rendered": "…" }
  ],
  "findings": [
    { "lid": "f1", "definition_ref": "finding.brain.normal_survey", "presence": "normal",
      "certainty": "definite", "laterality": null, "locations": [], "severity": null,
      "parameters": [], "measurement_refs": [],
      "sentence": "Ventricles, sulci and basal cisterns are normal. No diffusion restriction. No abnormal enhancement territory.",
      "impression_fragment": "No acute intracranial abnormality.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false },
      "included_from": { "kind": "included_findings_ref", "ref": "finding.brain.normal_survey" },
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.brain.normal", "created_at": "2026-07-09T10:03:00Z", "edited": false },
      "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.brain.small_vessel_ischemia", "presence": "present",
      "certainty": "definite", "laterality": "lat.bilateral",
      "locations": ["loc.brain.periventricular","loc.brain.deep_white_matter"], "severity": "sev.fazekas.2",
      "parameters": [ { "param": "param.signal", "kind": "option", "option": "param.signal.t2_flair_hyper", "label": "T2/FLAIR hyperintense" } ],
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
        "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T10:07:00Z", "edited": false } },
      { "lid": "imp2", "finding_ref": "f2", "text": "Moderate chronic small vessel ischemic changes (Fazekas 2).", "source": "ai_suggestion", "rank": 2,
        "provenance": { "origin": "ai_suggestion", "actor": "system", "created_at": "2026-07-09T10:07:05Z", "edited": true, "edited_by": "dr_abinash", "edited_at": "2026-07-09T10:07:40Z" } }
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
  "ai": { "runs": [ { "run_id": "airun_01J9Zbrain", "purpose": "impression_suggestion", "provider": "ollama", "model_ref": "llama3.1:8b-instruct-q4", "model_digest": "sha256:aa..", "prompt_ref": "aiprompt.impression.neuro", "prompt_version": 7, "params": { "temperature": 0.2, "seed": 42 }, "input_digest": "sha256:bb..", "input_refs": { "finding_lids": ["f2"], "image_sop_uids": [] }, "started_at": "2026-07-09T10:07:00Z", "latency_ms": 1610, "output_digest": "sha256:cc..", "human_review": "accepted_edited" } ], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "created_at": "2026-07-09T10:00:00Z", "last_modified_at": "2026-07-09T10:07:40Z", "revision": 3, "revisions": [ { "revision": 1, "at": "2026-07-09T10:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:dd..", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

### 17.2 MRI LS Spine — L4–L5 disc herniation with canal measurement + follow-up recommendation
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9ZLSSPINE00000000000001",
  "catalog_snapshot": { "content_pack_versions": { "spine.mri": "1.3.0" }, "catalog_schema_version": "1.0.0" },
  "study_context": { "modality": "MRI", "body_region": "ls_spine", "study_type": "plain", "template_ref": "tpl.mri_ls_spine_plain", "laterality_default": "lat.na", "comparison": { "has_prior": false, "prior_study_ref": null } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.spine.disc_herniation", "presence": "present", "certainty": "definite",
      "laterality": "lat.left", "locations": ["loc.spine.l4_l5"], "severity": "sev.disc.extrusion",
      "parameters": [
        { "param": "param.disc_level", "kind": "option", "option": "param.disc_level.l4_l5", "label": "L4–L5" },
        { "param": "param.herniation_type", "kind": "option", "option": "param.herniation_type.paracentral_left", "label": "Left paracentral" },
        { "param": "param.nerve_root_contact", "kind": "boolean", "value": true, "label": "Contacts traversing nerve root" }
      ],
      "measurement_refs": ["m1"],
      "sentence": "Left paracentral disc extrusion at L4–L5 indenting the thecal sac and contacting the traversing left L5 nerve root.",
      "impression_fragment": "L4–L5 left paracentral disc extrusion with left L5 nerve root contact.",
      "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.spine.l4l5_extrusion", "created_at": "2026-07-09T11:00:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.spine.canal_stenosis", "presence": "present", "certainty": "probable",
      "laterality": null, "locations": ["loc.spine.l4_l5"], "severity": "sev.stenosis.moderate",
      "parameters": [], "measurement_refs": ["m1"],
      "sentence": "Moderate central canal narrowing at L4–L5.", "impression_fragment": "Moderate L4–L5 central canal stenosis.",
      "sentence_source": "content_pack_default", "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T11:02:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.spine.canal_ap_diameter", "finding_ref": "f2", "site": "loc.spine.l4_l5", "laterality": null,
      "value": 8.5, "unit": "mm", "value_kind": "scalar", "normal_range": { "low": 12, "high": 20, "unit": "mm", "source": "catalog" }, "abnormal": true,
      "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "AP canal diameter L4–L5: 8.5 mm (reduced)" }
  ],
  "impression": {
    "fragments": [
      { "lid": "imp1", "finding_ref": "f1", "text": "L4–L5 left paracentral disc extrusion with left L5 nerve root contact.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T11:05:00Z", "edited": false } },
      { "lid": "imp2", "finding_ref": "f2", "text": "Moderate L4–L5 central canal stenosis.", "source": "finding_fragment", "rank": 2, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T11:05:02Z", "edited": false } }
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
  "audit": { "schema_version": "1.0.0", "created_at": "2026-07-09T11:00:00Z", "last_modified_at": "2026-07-09T11:06:00Z", "revision": 2, "revisions": [ { "revision": 1, "at": "2026-07-09T11:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:ee..", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

### 17.3 MRI Cervical Spine — C5–C6 cord compression (critical) + addendum-ready signature
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9ZCSPINE000000000000001",
  "catalog_snapshot": { "content_pack_versions": { "spine.mri": "1.3.0" }, "catalog_schema_version": "1.0.0" },
  "study_context": { "modality": "MRI", "body_region": "cervical_spine", "study_type": "plain", "template_ref": "tpl.mri_cervical_spine_plain", "laterality_default": "lat.na", "comparison": { "has_prior": false, "prior_study_ref": null } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.spine.cord_compression", "presence": "present", "certainty": "definite",
      "laterality": null, "locations": ["loc.spine.c5_c6"], "severity": "sev.cord_compression.severe",
      "parameters": [
        { "param": "param.disc_level", "kind": "option", "option": "param.disc_level.c5_c6", "label": "C5–C6" },
        { "param": "param.myelomalacia", "kind": "boolean", "value": true, "label": "Cord signal change (myelomalacia)" }
      ],
      "measurement_refs": ["m1"],
      "sentence": "Large posterior disc-osteophyte complex at C5–C6 causing severe central canal stenosis with cord compression and intramedullary T2 hyperintensity.",
      "impression_fragment": "Severe C5–C6 cord compression with myelomalacia.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": true, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:10:00Z", "edited": false }, "ai": null, "order": 10 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.spine.canal_ap_diameter", "finding_ref": "f1", "site": "loc.spine.c5_c6", "laterality": null,
      "value": 5.0, "unit": "mm", "value_kind": "scalar", "normal_range": { "low": 11, "high": 16, "unit": "mm", "source": "catalog" }, "abnormal": true,
      "provenance": { "origin": "manual", "source": "manual", "confidence": 0.95, "edited": false }, "display": "AP canal C5–C6: 5.0 mm (critical narrowing)" }
  ],
  "impression": {
    "fragments": [ { "lid": "imp1", "finding_ref": "f1", "text": "Severe C5–C6 cord compression with myelomalacia — critical finding, communicated to referring clinician.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:00Z", "edited": true, "edited_by": "dr_abinash", "edited_at": "2026-07-09T12:13:00Z" } } ],
    "items": [ { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. Severe C5–C6 cord compression with myelomalacia. Critical finding." } ],
    "rendered": "IMPRESSION:\n1. Severe C5–C6 cord compression with myelomalacia. Critical finding — communicated."
  },
  "recommendations": [ { "lid": "rec1", "recommendation_ref": "rec.urgent_referral", "finding_refs": ["f1"], "text": "Urgent neurosurgical referral advised.", "priority": "critical", "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:30Z", "edited": false }, "ai": null } ],
  "critical_flags": [ { "lid": "crit1", "critical_ref": "crit.cord_compression", "finding_ref": "f1", "status": "communicated", "raised_at": "2026-07-09T12:12:00Z", "raised_by": "dr_abinash", "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T12:12:00Z", "edited": false } } ],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T12:10:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["manual"], "content_pack_versions": { "spine.mri": "1.3.0" }, "template_ref": "tpl.mri_cervical_spine_plain", "revision": 5 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "created_at": "2026-07-09T12:10:00Z", "last_modified_at": "2026-07-09T12:14:00Z", "revision": 5, "revisions": [ { "revision": 1, "at": "2026-07-09T12:10:00Z", "by": "dr_abinash", "action": "created" }, { "revision": 5, "at": "2026-07-09T12:14:00Z", "by": "dr_abinash", "action": "finalized" } ], "content_sha256": "sha256:ff11..", "audit_log_ref": 480231, "signature": { "state": "final", "signed_by": "dr_abinash", "signed_role": "radiologist", "signed_at": "2026-07-09T12:14:00Z", "signed_content_sha256": "sha256:ff11..", "amends_document_id": null } },
  "extensions": {}
}
```

### 17.4 USG Abdomen — normal biometry + incidental simple hepatic cyst (measurement import from DICOM SR)
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9ZUSGABD0000000000000001",
  "catalog_snapshot": { "content_pack_versions": { "abdomen.usg": "1.4.0" }, "catalog_schema_version": "1.0.0" },
  "study_context": { "modality": "USG", "body_region": "abdomen", "study_type": "grayscale", "template_ref": "tpl.usg_abdomen", "laterality_default": "lat.na", "comparison": { "has_prior": false, "prior_study_ref": null } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.abdomen.normal_survey", "presence": "normal", "certainty": "definite",
      "laterality": null, "locations": [], "severity": null, "parameters": [], "measurement_refs": ["m1","m2","m3"],
      "sentence": "Liver normal in size and echotexture. Both kidneys normal. Gallbladder, CBD, pancreas, spleen unremarkable. No free fluid.",
      "impression_fragment": "Normal abdominal ultrasound apart from the finding below.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false },
      "included_from": { "kind": "included_findings_ref", "ref": "finding.abdomen.normal_survey" },
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.abd.normal", "created_at": "2026-07-09T09:30:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.liver.simple_cyst", "presence": "present", "certainty": "definite",
      "laterality": "lat.right", "locations": ["loc.liver.right_lobe"], "severity": null,
      "parameters": [
        { "param": "param.echogenicity", "kind": "option", "option": "param.echogenicity.anechoic", "label": "Anechoic" },
        { "param": "param.margin", "kind": "option", "option": "param.margin.well_defined", "label": "Well-defined" },
        { "param": "param.posterior_enhancement", "kind": "boolean", "value": true, "label": "Posterior acoustic enhancement" }
      ],
      "measurement_refs": ["m4"],
      "sentence": "Well-defined anechoic cyst with posterior acoustic enhancement in the right lobe of the liver, measuring 14 mm.",
      "impression_fragment": "Simple hepatic cyst, right lobe — benign, incidental.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": true }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.liver.simple_cyst", "created_at": "2026-07-09T09:34:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.liver.span", "finding_ref": "f1", "site": "loc.liver.right_lobe", "value": 142.0, "unit": "mm", "value_kind": "scalar", "normal_range": { "low": 120, "high": 160, "unit": "mm", "source": "catalog" }, "abnormal": false, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.97, "sop_instance_uid": "1.2.840.113619.2.1", "captured_at": "2026-07-09T09:31:00Z", "actor": "OHIF", "edited": false }, "display": "Liver span 142 mm" },
    { "lid": "m2", "measurement_ref": "meas.kidney.length", "finding_ref": "f1", "site": "loc.kidney.right", "laterality": "lat.right", "value": 102.0, "unit": "mm", "value_kind": "scalar", "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" }, "abnormal": false, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.98, "sop_instance_uid": "1.2.840.113619.2.2", "edited": false }, "display": "Right kidney 102 mm" },
    { "lid": "m3", "measurement_ref": "meas.kidney.length", "finding_ref": "f1", "site": "loc.kidney.left", "laterality": "lat.left", "value": 99.0, "unit": "mm", "value_kind": "scalar", "normal_range": { "low": 90, "high": 120, "unit": "mm", "source": "catalog" }, "abnormal": false, "provenance": { "origin": "measurement_import", "source": "dicom_sr", "confidence": 0.98, "edited": false }, "display": "Left kidney 99 mm" },
    { "lid": "m4", "measurement_ref": "meas.cyst.diameter", "finding_ref": "f2", "site": "loc.liver.right_lobe", "value": 14.0, "unit": "mm", "value_kind": "scalar", "normal_range": null, "abnormal": false, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "Cyst 14 mm" }
  ],
  "impression": {
    "fragments": [ { "lid": "imp1", "finding_ref": "f2", "text": "Simple hepatic cyst in the right lobe (14 mm) — benign, incidental.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T09:36:00Z", "edited": false } } ],
    "items": [ { "lid": "impi1", "fragment_refs": ["imp1"], "text": "1. Otherwise normal abdominal ultrasound with an incidental 14 mm simple hepatic cyst in the right lobe." } ],
    "rendered": "IMPRESSION:\n1. Otherwise normal abdominal ultrasound with an incidental 14 mm simple hepatic cyst in the right lobe."
  },
  "recommendations": [ { "lid": "rec1", "recommendation_ref": "rec.no_followup_needed", "finding_refs": ["f2"], "text": "No follow-up required for this benign simple cyst.", "priority": "routine", "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T09:36:30Z", "edited": false }, "ai": null } ],
  "critical_flags": [],
  "provenance": { "created_by": "dr_abinash", "created_at": "2026-07-09T09:30:00Z", "authoring_app": "care-radiology-report-generator", "authoring_app_version": "2.3.1", "input_methods": ["quick_select","measurement_import"], "content_pack_versions": { "abdomen.usg": "1.4.0" }, "template_ref": "tpl.usg_abdomen", "revision": 4 },
  "ai": { "runs": [], "guarding": { "auto_sign": false } },
  "audit": { "schema_version": "1.0.0", "created_at": "2026-07-09T09:30:00Z", "last_modified_at": "2026-07-09T09:36:30Z", "revision": 4, "revisions": [ { "revision": 1, "at": "2026-07-09T09:30:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:1122..", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

### 17.5 Doppler (carotid) — right ICA stenosis with velocity indices (derived RI/ratio)
```json
{
  "schema_version": "1.0.0", "kind": "radiology.structured_report", "document_id": "01J9ZDOPPLER00000000000001",
  "catalog_snapshot": { "content_pack_versions": { "vascular.doppler": "1.1.0" }, "catalog_schema_version": "1.0.0" },
  "study_context": { "modality": "USG", "body_region": "carotid_doppler", "study_type": "doppler", "template_ref": "tpl.doppler_carotid", "laterality_default": "lat.bilateral", "comparison": { "has_prior": false, "prior_study_ref": null } },
  "findings": [
    { "lid": "f1", "definition_ref": "finding.carotid.stenosis", "presence": "present", "certainty": "definite",
      "laterality": "lat.right", "locations": ["loc.carotid.ica_proximal"], "severity": "sev.carotid_stenosis.70_99",
      "parameters": [
        { "param": "param.plaque_morphology", "kind": "option", "option": "param.plaque_morphology.heterogeneous", "label": "Heterogeneous plaque" },
        { "param": "param.plaque_surface", "kind": "option", "option": "param.plaque_surface.irregular", "label": "Irregular surface" }
      ],
      "measurement_refs": ["m1","m2","m3","m4"],
      "sentence": "Heterogeneous plaque with irregular surface in the proximal right ICA producing 70–99% stenosis by velocity criteria (PSV 320 cm/s, ICA/CCA ratio 4.6).",
      "impression_fragment": "Severe (70–99%) stenosis of the right internal carotid artery.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": true, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "manual", "actor": "dr_abinash", "created_at": "2026-07-09T13:00:00Z", "edited": false }, "ai": null, "order": 10 },
    { "lid": "f2", "definition_ref": "finding.carotid.normal", "presence": "normal", "certainty": "definite",
      "laterality": "lat.left", "locations": ["loc.carotid.ica_proximal"], "severity": null, "parameters": [], "measurement_refs": ["m5"],
      "sentence": "Left carotid system shows normal flow with no significant stenosis.", "impression_fragment": "Normal left carotid system.", "sentence_source": "content_pack_default",
      "status_flags": { "is_significant": false, "is_critical": false, "is_incidental": false }, "included_from": null,
      "provenance": { "origin": "quick_select", "actor": "dr_abinash", "source_ref": "qs.carotid.normal", "created_at": "2026-07-09T13:04:00Z", "edited": false }, "ai": null, "order": 20 }
  ],
  "measurements": [
    { "lid": "m1", "measurement_ref": "meas.doppler.psv", "finding_ref": "f1", "site": "loc.carotid.ica_proximal", "laterality": "lat.right", "value": 320.0, "unit": "cm/s", "value_kind": "scalar", "normal_range": { "low": 0, "high": 125, "unit": "cm/s", "source": "catalog" }, "abnormal": true, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.92, "edited": false }, "display": "Right ICA PSV 320 cm/s" },
    { "lid": "m2", "measurement_ref": "meas.doppler.edv", "finding_ref": "f1", "site": "loc.carotid.ica_proximal", "laterality": "lat.right", "value": 110.0, "unit": "cm/s", "value_kind": "scalar", "normal_range": { "low": 0, "high": 40, "unit": "cm/s", "source": "catalog" }, "abnormal": true, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.9, "edited": false }, "display": "Right ICA EDV 110 cm/s" },
    { "lid": "m3", "measurement_ref": "meas.doppler.ica_cca_ratio", "finding_ref": "f1", "site": "loc.carotid.ica_proximal", "laterality": "lat.right", "value": 4.6, "unit": "1", "value_kind": "ratio", "components": [ { "measurement_ref": "meas.doppler.psv", "value": 320, "unit": "cm/s" }, { "measurement_ref": "meas.doppler.cca_psv", "value": 70, "unit": "cm/s" } ], "normal_range": { "low": 0, "high": 2.0, "unit": "1", "source": "catalog" }, "abnormal": true, "provenance": { "origin": "calculated", "source": "calculated", "confidence": 1.0, "edited": false }, "display": "ICA/CCA ratio 4.6" },
    { "lid": "m4", "measurement_ref": "meas.doppler.ri", "finding_ref": "f1", "site": "loc.carotid.ica_proximal", "laterality": "lat.right", "value": 0.66, "unit": "1", "value_kind": "index", "components": [ { "measurement_ref": "meas.doppler.psv", "value": 320, "unit": "cm/s" }, { "measurement_ref": "meas.doppler.edv", "value": 110, "unit": "cm/s" } ], "normal_range": null, "abnormal": false, "provenance": { "origin": "calculated", "source": "calculated", "confidence": 1.0, "edited": false }, "display": "RI 0.66" },
    { "lid": "m5", "measurement_ref": "meas.doppler.psv", "finding_ref": "f2", "site": "loc.carotid.ica_proximal", "laterality": "lat.left", "value": 78.0, "unit": "cm/s", "value_kind": "scalar", "normal_range": { "low": 0, "high": 125, "unit": "cm/s", "source": "catalog" }, "abnormal": false, "provenance": { "origin": "manual", "source": "manual", "confidence": 0.92, "edited": false }, "display": "Left ICA PSV 78 cm/s" }
  ],
  "impression": {
    "fragments": [
      { "lid": "imp1", "finding_ref": "f1", "text": "Severe (70–99%) stenosis of the right internal carotid artery.", "source": "finding_fragment", "rank": 1, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T13:06:00Z", "edited": false } },
      { "lid": "imp2", "finding_ref": "f2", "text": "Normal left carotid system.", "source": "finding_fragment", "rank": 2, "provenance": { "origin": "content_pack_default", "actor": "dr_abinash", "created_at": "2026-07-09T13:06:01Z", "edited": false } }
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
  "audit": { "schema_version": "1.0.0", "created_at": "2026-07-09T13:00:00Z", "last_modified_at": "2026-07-09T13:07:00Z", "revision": 3, "revisions": [ { "revision": 1, "at": "2026-07-09T13:00:00Z", "by": "dr_abinash", "action": "created" } ], "content_sha256": "sha256:3344..", "audit_log_ref": null, "signature": { "state": "draft", "signed_by": null, "signed_at": null, "signed_content_sha256": null, "amends_document_id": null } },
  "extensions": {}
}
```

---

## 18. Enumerations (canonical, closed unless noted)

| Field | Values |
|---|---|
| `finding.presence` | `present`, `absent`, `normal`, `indeterminate` |
| `finding.certainty` | `definite`, `probable`, `possible`, `cannot_exclude` |
| `finding.sentence_source` | `content_pack_default`, `rule`, `edited`, `manual` |
| `included_from.kind` | `included_findings_ref`, `combo` |
| `measurement.value_kind` | `scalar`, `ratio`, `range`, `derived`, `index` |
| `measurement.source` / `provenance.source` | `manual`, `dicom_sr`, `ocr`, `ai`, `calculated` |
| `provenance.origin` | `manual`, `quick_select`, `content_pack_default`, `template`, `voice`, `ai_suggestion`, `measurement_import`, `schema_migration`, `backfill` *(open — unknown ⇒ `unknown`)* |
| `impression.fragment.source` | `finding_fragment`, `rule`, `manual`, `ai_suggestion` |
| `section.kind` | `clinical_history`, `technique`, `comparison`, `findings`, `impression`, `recommendation`, `advice` |
| `recommendation.priority` | `routine`, `urgent`, `critical` |
| `critical_flag.status` | `raised`, `acknowledged`, `communicated` |
| `audit.signature.state` | `draft`, `preliminary`, `final`, `addendum`, `amended` |
| `ai.runs[].human_review` | `accepted_verbatim`, `accepted_edited`, `rejected`, `pending` |
| `ai.runs[].purpose` | `finding_suggestion`, `impression_suggestion`, `measurement_extraction`, `qc`, `completeness`, `contradiction` |

---

## 19. What the next phase (after C1) must build against this spec

1. `schemas/structured-report-v1.schema.json` — the full JSON Schema (§1.5) + a golden-fixture corpus (the five examples above pass; deliberately-broken variants fail each R-rule).
2. A **pure validator** `(document, catalogSnapshot) → {ok, errors[], warnings[]}` implementing tiers A + B (§12), unit-tested with no DB (same shape as the B1/B2 validation layer).
3. **Writer/serializer** that emits `structured_json` + rendered prose, computes `content_sha256`, and enforces R13/R14 at finalize.
4. **Reader/up-migration registry** (§2.3) with golden from→to fixtures.
5. Additive **migrations** (`ADD COLUMN … jsonb`, generated columns, `report_finding_index`) — §13/§15 — behind a flag, dormant.
6. Renderer switch and analytics projection — later, out of this spec's critical path.

Everything above is **specification only**; no runtime code, migration, endpoint, or DB import is delivered by Ticket D1.
