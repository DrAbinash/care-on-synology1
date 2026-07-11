# R1.2 — Enterprise Report Template Engine (Implementation)

Builds a safe, versioned report-template engine on the R1.1 shared
presentation layer. No new renderer, no new report page, no drag-and-drop
designer, no server-side PDF. Presentation only — structured JSON, hashes,
audit, amendments, billing, auth, viewer architecture and report lifecycle
are untouched. (No separate audit document — no blocker was found in Phase 1;
the naming collision with the pre-existing clinical `report_template_versions`
was avoided by naming the new tables `radiology_presentation_templates` /
`radiology_report_presentation_freeze`.)

## 1. Data model

**`TemplateDefinition`** (validated JSON stored per version) — pure DATA, no
HTML/JS/CSS:
- `typography`: 9 slots (header, patientBlock, studyTitle, sectionHeading,
  body, footer, signature, imagePanel, impression); each with fontFamily
  (approved list), fontSize/letterSpacing (bounded pt/px/em/mm), color
  (#hex), fontWeight (400–800), lineHeight (1.0–2.5), textTransform, textAlign.
- `colors`: 8 palette roles (#hex only).
- `spacing`: lineHeight, sectionGap.
- `page`: size (A4/A5/Letter), orientation, margins ("10mm"/"10mm 12mm").
- `header` (show/showLogo/showTagline/showContact/style banded|underlined),
  `patientBlock` (grid|table), `studyTitle` (bar|plain), `signature`
  (show/showImage), `footer` (show), `imagePanel` (placement inline|side-panel,
  panelWidthMm 40–90), `watermark` (enabled/text ≤40 safe chars), `qr` (show),
  `pageBreaks` (orphans/widows 1–6).

**`radiology_presentation_templates`** — one row per `(template_key, version)`:
templateKey (immutable slug), version, displayName, description, orgScope
(global; organization/branch/department reserved), copyType
(standard/patient/referrer), status (published/retired), rendererVersion,
isSystem, definition (jsonb), createdBy, createdAt, retiredAt, retiredBy.
Unique `(template_key, version)`.

**`radiology_report_presentation_freeze`** — one row per signed report id:
templateKey, templateVersion, snapshot (resolved palette/layout/page for
reproducibility), createdAt. Unique `(report_id)`; never updated or deleted.

The 8 system templates live as **code seeds** (version 1) — the store resolves
DB rows first and falls back to the seed, so system templates are re-themed by
publishing v2+ and their v1 base is always available and immutable.

## 2. Versioning & immutability

- **Editing publishes version n+1** — there is NO endpoint that updates a
  definition. `publishTemplateVersion` / `importTemplate` only INSERT, via a
  transaction-scoped advisory lock keyed on the template key, so concurrent
  publishes of the same key produce deterministic sequential versions (the
  unique `(key, version)` index is the ultimate backstop).
- **Signing freezes identity WITH a full-definition snapshot** — the three
  sign paths (structured finalize, amendment, legacy `/sign`) call
  `freezeReportPresentation(reportId, record)` (best-effort, post-response,
  `ON CONFLICT DO NOTHING`). A signed revision always renders the exact
  `(key, version)` it was signed under; if that version row is ever lost
  (partial restore, seed constants changing in a future deploy), rendering
  reconstructs from the frozen snapshot's full definition.
- **Retirement is soft** (`status='retired'`, only flips published rows so an
  already-retired version's bookkeeping is never overwritten); frozen reports
  keep rendering retired versions by exact id; new renders of an active key
  skip retired versions. System seed v1 cannot be retired. Retiring the last
  published version of a currently-**active** key is refused (409 + the
  orphaned copy types) unless `force=true`.
- **Reset-to-default** selects `care-classic` — it moves the active selection
  only; it never rewrites finalized reports.
- **Import never overwrites** — an envelope naming an existing `(key, version)`
  is reported and imported as the NEXT version.
- **Config-change ledger parity** — activating/resetting a template writes a
  `radiology_config_changes` row (surfaced in the Flight Deck config history),
  matching R1.1's `POST /pacs-settings` behavior, in addition to the
  hash-chained audit entry.

## 3. Resolution precedence (deterministic; never throws)

The frozen identity is the finalized **STANDARD (clinical) document** — that is
what must stay byte-reproducible. Patient/referrer copies are derived,
live-branded deliveries, so their active selection outranks the frozen
standard identity (otherwise a report signed after R1.2 — which always freezes
a standard identity — could never be delivered under the patient-copy /
referrer-copy templates this ticket ships).

`resolveTemplateRecordForRender`, for **copyType = standard**:
1. **explicit** `?template=key[@version]` (staff surfaces),
2. **frozen** standard identity of the served signed revision,
3. **standard active** selection (`report_presentation_template` — the R1.1 key),
4. **care-classic** seed.

For **copyType = patient/referrer** (e.g. public delivery):
1. explicit override,
2. **copy-type active** selection (`report_presentation_template_{patient,referrer}`),
3. frozen standard identity (so a copy still renders something stable),
4. standard active selection,
5. care-classic seed.

Reserved immediately below the copy-type selection for R1.3+: organization →
branch → department → radiologist preference (documented, not implemented;
only `global` scope today). Resolution never throws — any failure (including
the R1.2 table not existing yet on a partial deploy) degrades to the
**requested key's seed** (all 8 system keys have seeds), so an R1.1
deployment configured for care-premium keeps rendering premium.

## 4. Templates delivered

care-classic, care-premium (both compile byte-identically to R1.1),
care-v2 (teal), hope (green serif), government (mono, watermark, orphans 4),
teleradiology (navy side-panel, watermark), patient-copy (copyType=patient,
larger type, watermark), referrer-copy (copyType=referrer, compact, side-panel,
watermark). Same canonical render model — brand/copy variants only.

## 5. Security restrictions

- Fonts: `SAFE_FONT_FAMILIES` allowlist only.
- Colors: `#rgb`/`#rrggbb` only.
- Measurements: bounded regexes (fontSize/letterSpacing pt/px/em/mm; margins
  1–2 mm values; lineHeight 1.0–2.5; panelWidthMm 40–90; orphans/widows 1–6).
- Unknown properties rejected at every level (anti-smuggling / anti-typo).
- A recursive sweep rejects any string containing `< > url( expression(
  javascript: http:// https:// data: @import \ { } ; /* */` anywhere in a
  definition. Validation runs on every publish AND every import.
- No JavaScript, no remote assets, no free-form HTML/CSS anywhere.

## 6. Import/export format

Versioned JSON envelope: `{ schemaVersion:1, rendererVersion, templateKey,
version, displayName, description?, copyType, definition, exportedAt? }`.
`validateImportEnvelope` checks schema version, renderer compatibility
(rejects future rendererVersion), key/version/name/copyType, unknown envelope
keys, and the full definition. **Dry-run** returns 200 with issues +
`wouldCreate`; **commit** is whole-or-nothing (any issue aborts). Immutable
versions are never overwritten — import always creates the next version.

## 7. Routes

Mounted at `/api/radiology/presentation-templates` (staff auth +
`/radiology` permission):
- `GET /` — list versions + active selections + safe fonts + slots (staff).
- `GET /:key/:version` — one version (staff).
- `GET /:key/:version/preview[?images=false]` — server-rendered SAMPLE data
  (no patient data; real clinic header) (staff).
- `GET /:key/:version/export` — JSON envelope (**admin**).
- `POST /publish | /duplicate | /retire | /activate | /reset-default | /import`
  — **admin**, audited (hash-chained). No update endpoint exists.

Render surfaces pass the resolution through the R1.1 builder: staff print/PDF
(`?template=` override), draft print-preview, public delivery (`copyType:
"patient"`), email, PACS archive.

## 8. UI

Radiology Settings → Report Style → `PresentationTemplateManager`:
active-template selectors per copy type, template list with versions,
server-preview iframe, and (admin) new-version/duplicate editor (typography
from the approved lists, colors via pickers, page/layout/toggles), retire,
import (dry-run then commit), export. Radiologists see the list and preview;
all controls are disabled/hidden for them.

## 9. Compatibility

- No `pacs_settings` configured → renders care-classic exactly as R1.1
  (byte-identical, pinned by tests).
- `report_presentation_template=care-premium` → premium as in R1.1.
- Historical reports without a freeze row → documented fallback to the active
  selection.
- Renderer refactor keeps every R1.1 default (banded/title-bar derivations,
  64mm panels, orphans/widows 3, line heights, section gap, @page) — the
  seeds compile to identical output.
- `reportPresentationConfig.ts` (R1.1 shim) removed; its one consumer
  (radiology-report-generator draft preview) now uses `resolveTemplateForRender`.

## 10. Deployment

Synology Container Manager — no new compose project, no volume changes, no DB
deletion. `migrations/add_presentation_templates_r12.sql` applies through the
existing db-patch pipeline (idempotent; verified applied 3×). No new env vars.
Default behavior unchanged until an admin activates a non-classic template.

## 11. Rollback

Revert the single R1.2 commit. With no template rows and no freeze rows the
system resolves to the care-classic seed = the R1.1 default. The two additive
tables are inert when empty. No schema/hash/audit/amendment/lifecycle change.

## 12. Remaining work → R1.3

- Multi-centre scope hierarchy (organization/branch/department/radiologist
  preference) — schema field + precedence slots exist; resolution + UI pending.
- Per-template live editing preview in the manager (edit → preview before
  publish); today preview is per stored version.
- True server-side PDF (headless print) for portals; today PDF = print HTML.
- Localized/RTL typography and multi-page header/footer repetition.
- Template diff/compare view across versions.
- Bulk import/export (a pack of templates); today one envelope per call.
