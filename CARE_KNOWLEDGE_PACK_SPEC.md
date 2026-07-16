# CARE Knowledge Pack Engine — Canonical Specification

**Status:** v1 (registry + loader + validator + manager). Additive, backward-compatible.
**One line:** *The Reporting Platform is the operating system; Knowledge Packs are the applications.* Adding a new study — or a new modality — becomes primarily a **clinical-content + registry** task, not a software-development task.

---

## 1. Architecture

### 1.1 The decision (why a thin registry, not a new engine)

The platform already behaves like a knowledge-pack system: clinical content is stored **by study type** across live tables and loaded that way at report time (region matched by `matchStudyRegion` → content filtered by `study_type`/`builder_type`/`category`). A full new "pack engine" that re-homed this content would duplicate engines and risk regressions.

An audit of HEAD confirmed three *pack-like* foundations already exist but are **dormant** — the `radiologyCatalog` B1/B2 tables, the K1/K2/K3 YAML pack pipeline (`seeds/radiology/content-packs/v1/`), and the `structuredReport` D1 layer — all feature-flagged off, with **zero UI consumers**; the YAML validator is even broken against the real seed files. The repo's own recent audit had already routed content into the **live** tables instead.

**Therefore, per the "smallest extension" directive, this engine is a thin registry/manifest + loader/validator + admin manager layered OVER the existing live content.** It builds no new reporting/measurement/copilot engine and moves no content. MRI/USG behaviour is unchanged — their packs merely *describe* content that was already there.

### 1.2 What a pack is

A **Knowledge Pack** is a named, versioned **manifest** (one `knowledge_packs` row) that:
- has an identity: `packId = {modality}.{slug(region)}` (e.g. `mri.brain`, `usg.whole_abdomen`, `ct.brain`);
- **references** the study's content by its existing string keys — it stores no copy of that content;
- carries a small `manifest_json` blob for pack-level declarative extras that have no dedicated table yet (companion/copilot module ids, comparison measurement labels, critical findings, quality rules, normal values, reporting notes, references).

The **loader assembles** a pack live by querying the tables the Reporting Workspace already reads.

### 1.3 Content sections → backing store (the loader/validator spec)

| Pack section | Backing table | Study-type key |
|---|---|---|
| Quick findings (structured findings) | `radiology_quick_findings` | `study_type` (region name) |
| Protocol · required measurements · checklist · recommendations | `radiology_protocols` | `study_type` (+ `modality`) |
| Clinical history chips | `radiology_clinical_history_chips` | `study_type` |
| Quick measurements | `radiology_quick_measurements` | `study_type` |
| Impression rules (rule-based impression) | `radiology_impression_rules` | `builder_type` |
| Report template | `structured_report_templates` / `USG_TEMPLATES` | `modality`+`body_part` / `UsgTemplateId` |
| Teaching notes | `teaching_cases` | `category` |
| Knowledge / normal values | `radiology_knowledge_base` | `category` |
| Companion rules · Copilot rules · Comparison rules · Critical findings · Quality rules · References | `knowledge_packs.manifest_json` | — |

Companion and Copilot already read this per-study-type content (quick findings by region, impression rules by `builderType`, knowledge by category), so they already "use the pack" in substance; the manifest additionally declares *which* registered `copilotModules.ts` module ids a pack activates.

---

## 2. Schema

`knowledge_packs` (`lib/db/src/schema/knowledgePacks.ts`, migration `migrations/add_knowledge_packs.sql`):

| Column | Purpose |
|---|---|
| `pack_id` (unique) | `{modality}.{slug}` identity |
| `modality` | MRI · USG · CT · XR · MG · PETCT · DEXA · FL · NM · EEG · ECG · TMT |
| `name`, `description`, `category` | display + grouping |
| `study_type` | region key into quick-findings/protocols/history/measurements |
| `builder_type` | key into impression rules |
| `body_part` | key into structured templates / the `UsgTemplateId` for USG |
| `knowledge_category` | key into knowledge base + teaching |
| `version`, `author`, `status`, `is_system` | lifecycle + guard |
| `depends_on_json` | pack dependencies |
| `manifest_json` | declarative extras (see 1.2) |

No FKs into the content tables — packs reference by **string key** (the same load-bearing pattern the content tables already use), so a pack and its content stay loosely coupled.

---

## 3. Lifecycle & status

`enabled` (live content) → `disabled` (kept, not active) · `placeholder` (registered, awaiting Gold-Standard content) · `planned` (registry-only, future modality).

- **Install** = insert/import a manifest row.
- **Enable/Disable** = flip `status` (never deletes content).
- **System packs** (`is_system = true`, the production MRI/USG packs) cannot be deleted and are never overwritten by import without `force: true` — *"never overwrite production packs accidentally."*

API (`/api/radiology/knowledge-packs`, staff read / admin write): `GET /`, `GET /stats`, `GET /:packId` (assembled: registry + live coverage + validation + samples), `GET /:packId/validate`, `GET /:packId/export`, `POST /`, `POST /import`, `PATCH /:id`, `DELETE /:id`.

---

## 4. Validation

`validatePack(pack, coverage, knownPackIds)` (`artifacts/api-server/src/lib/knowledgePackManifest.ts`, pure + tested) returns `{ health, ok, issues[], coveredSections, totalSections }`:

- **dependencies** must resolve → `error` otherwise (any status);
- `placeholder`/`planned` → intentionally empty, health `placeholder`, `ok`;
- `disabled` → health `disabled`, `ok`;
- `enabled` → `warn` on missing template/protocol/findings, `info` on missing history/measurements/impression-rules/teaching/knowledge, and `error` only when an enabled pack has **no** live content in any section.

Health rolls up to `ok` / `warn` / `error`. Coverage counts the 8 standard sections that resolve live.

---

## 5. Versioning & best practices

- Semantic version per pack (`major.minor.patch`); bump `minor` when adding content sections, `patch` for content edits, `major` for breaking key changes.
- Keep clinical content in the existing admin surfaces (Quick Select / Protocol / Knowledge). The pack manager administers the **registry**, not the content — one source of truth per concern.
- Reference teaching/knowledge by **category** — never copy articles into a pack.
- Prefer `builder_type` (lower_snake) as the impression-rule key; reconcile the Title-Case region (`study_type`) via `slug()` in the manifest helpers.
- Placeholders are first-class: registering `ct.brain` as a placeholder makes the vision visible — installing CT Brain content later makes the pack "light up" with zero code.

---

## 6. Migration strategy

- **MRI** and **USG** existing content → registered as `enabled`, `is_system` packs (`migrations/seed_knowledge_packs.sql`). No content moves; **no behaviour change** — validation simply reports each pack's live coverage.
- **CT / X-Ray / Mammography** → `placeholder` packs (CT Brain/Chest/Abdomen/KUB/HRCT/CTA/Spine/PNS; XR Chest/KUB/Spine/Pelvis/Shoulder/Hand/Foot; MG Screening/Diagnostic/Tomosynthesis).
- **Future modalities** (PET-CT, DEXA, Fluoroscopy, Nuclear Medicine, EEG, ECG, TMT) → `planned` registry entries only.
- Seed is idempotent (`ON CONFLICT (pack_id) DO NOTHING`) — never overwrites admin edits.

---

## 7. Examples

- **`usg.whole_abdomen`** (enabled, system) → studyType `Whole Abdomen`, builderType `usg_abdomen`, bodyPart `WHOLE_ABDOMEN`, knowledgeCategory `Abdomen`; manifest declares copilot modules `copilotUsgAbdomenModule`/`…Liver`/`…Gallbladder`/`…Kidney` and comparison measurements `Right/Left Kidney, CBD, Liver`. Loader assembles its live quick-findings/protocol/history/impression-rules/knowledge and validates coverage.
- **`ct.brain`** (placeholder) → registered identity, no content yet; validation health `placeholder`. Authoring CT Brain quick-findings/protocol later turns it `enabled` and healthy — no code change.

---

## 8. Future expansion

- Turn the idempotent `zz_add_usg_platform_content_pack.sql` UPSERT pattern into a reusable **content importer** so a pack's content can ship as one file.
- Optionally repair + wire the dormant `radiologyCatalog`/YAML pipeline as a *second projection* once something reads `structured_json`.
- Pack diff/compare + version history UI; per-pack dependency graphs; pack usage analytics.
- Let the Companion/Copilot resolve their per-study rules through the pack loader explicitly (currently they read the same underlying content directly — already pack-sourced in substance).
