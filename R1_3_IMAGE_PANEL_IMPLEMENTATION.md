# R1.3 — Enterprise Image Panel & Viewer Integration (Implementation)

Builds the enterprise image panel on the R1.1 reference-only image
persistence and the R1.1/R1.2 single-renderer presentation stack. No new
report page, no viewer redesign, no persistence redesign — Backend V1 stays
frozen. Image operations are presentation-only: they never touch clinical
text, structured JSON, hashes, audit chains or report lifecycle, and never
regenerate a report.

## 1. Architecture

One panel, one renderer, one launch builder:

- **`ReportImagePanel.tsx`** — THE reusable panel for a report's selected
  images (thumbnail strip, drag reorder, caption editing, key-image badge +
  toggle, remove, selection count, empty/loading/error states). Today it is
  mounted by `ReportImagePicker` inside the canonical
  RadiologyReportingWorkspace; any future surface mounts this same component.
  `ReportImagePicker` keeps only what it always owned: browsing the study
  (series/instances over the M1.2 browser DICOMweb base) and toggling
  selections.
- **`renderReportDocument`** (R1.1/R1.2) stays the ONE renderer. R1.3 adds a
  `key-image-badge` to flagged figures — preview, browser print, print
  preview, delivered PDF/HTML, public token links and email all inherit it
  because they all flow through this single function. No duplicated HTML.
- **`GET /studies/:uid/ohif-launch`** stays the ONE launch contract; R1.3
  teaches the SERVER to build deeper links (below).

## 2. Image model (canonical ReportImage)

`radiology_image_references` — one row per selected image, REFERENCES only:
StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, FrameNumber (nullable),
Caption (`description`), DisplayOrder, **`is_key_image`** (R1.3),
**`created_by`** (R1.3), timestamps. No blob URLs, no browser object URLs,
no pixels, no PACS credentials — pixels resolve server-side at render time
(`lib/reportImages.ts`, internal Orthanc vantage, inlined `data:` URLs).
Thumbnail state and loading/error states are client-side only, never stored.

**Duplicate prevention is enforced twice**: the API pre-checks
(draft, SOP, frame) and returns **409** ("already attached"), and a partial
unique index `(draft_id, sop_instance_uid, COALESCE(frame_number, -1)) WHERE
sop_instance_uid IS NOT NULL` closes the race window. The migration dedupes
ONLY non-finalized drafts (keeping the EARLIEST row — original caption and
order) — a signed report's rendered image set is never changed by a
migration. If duplicates survive on finalized drafts, the index build is
skipped with a NOTICE and the API pre-check remains authoritative.

**Finalized reports are immutable**: once a draft is promoted
(`final_report_id` set / status FINAL), POST/PATCH/DELETE/reorder on its
image references return **409** — matching the workspace panel, which is
already read-only at that point. What was signed is what keeps rendering.

API (`/api/radiology/report-generator/image-references`, staff-auth):
- `GET ?draftId=` — ordered by displayOrder.
- `POST` — zod-validated (UID regex `^[0-9.]{1,128}$`), max 100 per draft,
  records `created_by` from the staff session; 409 on duplicate.
- `PATCH :id` — caption / displayOrder / isKeyImage only.
- `POST /reorder` — atomic drag-reorder: `{draftId, orderedIds}` →
  displayOrder = index in one transaction, serialized per draft with a
  transaction-scoped advisory lock (concurrent reorders can't interleave or
  deadlock). Rejects duplicate ids and ids belonging to another draft; ids
  missing from the list (concurrent add) keep their relative order after the
  reordered ones.
- `DELETE :id`.

## 3. Viewer integration (server-built launch URLs)

Thumbnail click asks the server for the launch URL:
`GET /studies/:studyUID/ohif-launch?seriesInstanceUID=&sopInstanceUID=`.
The server (`buildOhifLaunchUrl`, unit-tested pure function):

1. builds the study URL from the admin-configured template (or the standard
   `{base}/viewer?StudyInstanceUIDs=` default),
2. fills `{seriesInstanceUID}` / `{sopInstanceUID}` placeholders if the
   template has them (a SOP-capable template launches at exact SOP level),
3. otherwise appends the standard OHIF `SeriesInstanceUIDs=` filter when the
   URL is a standard viewer URL.

**Degradation is explicit: SOP → Series → Study.** SOP-level addressing is
not a stable OHIF URL parameter, so with the default template a SOP request
launches its exact series; the response reports both `requestedLevel` and
`launchLevel`, and the panel tells the radiologist ("Viewer opened at study
level") when a per-image launch could only reach study level — a wrong-image
risk is never silent. Every UID (path and query) is validated; malformed
identifiers get 400; `sopInstanceUID` without `seriesInstanceUID` gets 400.
Never patient-name matching; the browser never sees a PACS URL — only the
admin-configured OHIF URL, and the panel navigates only `http(s)` URLs
(same scheme guard the R1.1 launch path had — a misconfigured template can
never become a `javascript:` sink). Study-level responses are unchanged for
existing callers (new fields are additive).

Round trip: the viewer opens in a new tab (popup-blocker-safe synchronous
`window.open` + severed `opener`), so returning to the report preserves the
selection with no study reload.

## 4. Report integration

- **Premium** (side-panel placement): report left, image rail right —
  unchanged R1.1 geometry; flagged images now carry the `★ KEY` badge.
- **Classic** (inline placement): images render in the inline grid below the
  body; same badge, same renderer.
- Captions render escaped (`escapeHtml`) — caption edits can never inject
  HTML into a document. Add/delete/reorder/caption/key-flag changes take
  effect on the next render of any surface; the clinical content is
  untouched (proven by tests: image ops change no draft/report text).
- Documents with no flagged images render **byte-identically** to R1.1/R1.2:
  the badge markup AND its CSS are emitted only when a flagged image exists
  (pinned by tests).

## 5. Performance (0 / 1 / 5 / 20 / 100 images)

`lib/reportImages.ts`:
- Cap raised to **100 images per report** (server POST cap + render cap).
- **Adaptive viewport**: rendered-thumbnail edge scales with count. The
  compat boundary is R1.1's maximum: every count possible before R1.3 (≤8)
  keeps the original 800px so existing reports reprint identically; only new
  counts shrink (≤20 → 560, ≤50 → 420, else 320).
- **Whole-report byte budget** (~8 MB of JPEG) on top of the ~400 KB
  per-image cap, enforced with reserve-then-refund accounting so concurrent
  workers can never overshoot it; once spent, remaining images are skipped
  gracefully (same degradation as a PACS miss). Display order is preserved
  regardless.
- **Bounded concurrency** (4 workers) — a 100-image report doesn't serialize
  100 PACS round-trips and doesn't stampede Orthanc.
- In-process rendered cache is now keyed by path AND viewport and evicted by
  total bytes (24 MB / 512 entries, 10-min TTL). It lives in server memory
  only. Patient data is never cached publicly: staff print/PDF now send
  `Cache-Control: no-store` (public token links and the draft preview
  already did).
- Panel thumbnails load lazily (`loading="lazy"`) with per-thumbnail error
  fallback.

## 6. Security

- No PACS credentials in the browser (server-held Basic auth only, unchanged).
- No internal Orthanc URLs in any document, response, or launch URL
  (verified against the rendered HTML in the PG harness).
- Every UID validated on every surface: reference CRUD (zod regex), launch
  endpoint (path + query, 400 on malformed), render path builder (pure
  function rejects incomplete/malformed references).
- Reorder cannot move another report's images (draft-scoped validation).
- Captions escaped at render; UID query params URI-encoded into launch URLs.
- Reference endpoints require a staff session (401 otherwise).

## 7. Testing

- **Unit (vitest, suite now 99 files / 1489 tests green)**:
  `reportPresentation.test.ts` (key badge on flagged figures only, badge in
  premium + classic, adaptive viewport curve), `pacsEnterprise.launch.test.ts`
  (degradation ladder, placeholder templates, encoding),
  `reportImageRefs.test.ts` (payload key flag, launch query builder, pure
  reorder).
- **Real PostgreSQL harness (40 checks)**: migration idempotence (applied
  4×), dedupe index + 409 + explicit pre-check, createdBy, PATCH/key-flag,
  finalized-draft immutability (POST/PATCH/DELETE/reorder all 409), atomic +
  partial + foreign-id reorder, launch levels + UID validation, render
  integration (badge exactly once and its CSS absent without flags,
  displayOrder, hostile-caption escaping, no-store on draft preview + staff
  print + pdf, no PACS internals in HTML), 21-image render with adaptive
  420px fetches, 100-image cap, PACS-outage graceful skip.
- **Real Chromium harness (23 checks)**: the real workspace bundle against
  the real server — select→persist, count badge, caption blur-save,
  key toggle + badge, drag reorder persisted atomically, per-image launch
  popup carrying the server-built series URL (admin OHIF host, not PACS),
  selection preserved after the viewer round trip, canonical preview with
  badge, read-only panel on a finalized study, error state + retry, mobile
  390×844, zero page JS errors everywhere.
- Covered scenarios: reports with 0/1/2/21/100 images, MRI worklist studies,
  no-image drafts, broken PACS, duplicate selections, malformed UIDs.

## 8. Deployment

Synology Container Manager — no new compose project, no volume changes, no
DB deletion, no new env vars. `migrations/add_report_image_panel_r13.sql`
applies through the existing db-patch pipeline (additive + idempotent;
the dedupe DELETE only removes exact duplicate reference rows that the R1.1
client-side guard could not prevent). Default behavior is unchanged until a
user flags a key image or reorders.

## 9. Rollback

Revert the single R1.3 commit. The two added columns and the unique index
are inert for R1.1 code (it never reads them; inserts leave them at
defaults). Existing references keep rendering exactly as in R1.1/R1.2 —
no schema/hash/audit/lifecycle change to unwind.

## 10. Remaining work → R1.4

- True SOP-level OHIF navigation once the deployed OHIF version exposes a
  stable URL parameter (the template placeholder path already supports it).
- Frame-level thumbnails in the panel for multi-frame instances (rendering
  already supports frames; the browser picker selects whole instances).
- Panel reuse on other surfaces (ReportHub, amendment workspace) — the
  component is surface-agnostic by design.
- Key-image export to DICOM KOS (Key Object Selection) for PACS round-trip.
- Multi-study reports: the panel handles per-ref study UIDs, but the picker
  browses only the workspace's study.
- Organization/branch template scope hierarchy carried from R1.2's list.
