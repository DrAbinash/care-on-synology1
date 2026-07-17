# ⚠ DEPRECATED — do not build on this catalog

**Decision (resolves the "wire-or-deprecate" follow-up from
`docs/usg-reporting/platform-consolidation-pr-b.md` §18.2): formally
deprecated in favor of the live database tables.**

This YAML catalog was authored as a foundation for a content-pack loader
that was **never built** — nothing in `artifacts/api-server` or
`artifacts/diagnostic-erp` reads these files, and nothing ever has. Since
then, the platform's real content path has been decided and repeatedly
executed the other way:

- Study tabs, quick findings, clinical-history chips and protocols live in
  the shared DB tables (`radiology_study_tabs`, `radiology_quick_findings`,
  `radiology_clinical_history_chips`, `radiology_protocols`), seeded by SQL
  migrations (e.g. `migrations/zz_add_usg_platform_content_pack.sql`) and
  edited in **Settings → Radiology Quick Select**.
- Structured report templates live in `structured_report_templates`
  (seeded via `POST /api/structured-report-templates/seed`, edited in the
  canonical template CRUD).
- Pack manifests live in `knowledge_packs` (Knowledge Pack Manager).

Building the YAML loader now would create a second, parallel content
pipeline for data the live tables already own — exactly the duplication
the platform's Hard Rules forbid.

**What to do instead of editing these files:**
- New study-type content → rows in the live tables (migration or the
  Quick Select settings UI).
- New structured templates → `structured_report_templates`.

The files are kept for reference only (some content here may still be
worth transcribing into the live tables when a study type gets built out).
Do not add new files, and do not write a loader without first reversing
this decision in `docs/usg-reporting/platform-consolidation-pr-b.md`.
