# Premium Report Layout — Implementation (Ticket R1.1)

Companion to `PREMIUM_LAYOUT_AUDIT.md` (existing implementation, root cause,
active flow). This document records what was built.

## 1. Files changed

### Backend (api-server)
| File | Change |
|---|---|
| `src/lib/reportPresentation.ts` | **NEW — THE shared presentation layer.** `renderReportDocument(model, template)` renders every report surface. Slot-separated model (header / patientBlock / studyTitle / sectionHeading / body / footer / signature / imagePanel) + template registry (`care-classic` default = today's look, `care-premium` = activated premium layout). |
| `src/lib/reportPresentationConfig.ts` | NEW — resolves the admin-selected template (`pacs_settings.report_presentation_template`), failure-tolerant. |
| `src/lib/reportImages.ts` | NEW — resolves persisted DICOM image references to inlined data-URL pixels at render time (server-side Orthanc fetch via ORTHANC_INTERNAL_URL, bounded size/time/count, in-process cache, graceful skip on PACS outage). |
| `src/routes/patient-reports.ts` | `renderReportVersionHtml` now BUILDS a `ReportDocumentModel` (same queries, same D6 structured read, same D8 safeguards) and calls the shared renderer. `?template=` override on staff print/PDF; `?preview=true` on `/print` renders WITHOUT delivery bookkeeping. Key images resolved via draft `final_report_id` linkage. |
| `src/routes/radiology-report-generator.ts` | NEW `GET /drafts/:id/print-preview` (shared-layer draft artifact, DRAFT watermark); image-references API extended (UID triple + frame + displayOrder, PATCH for caption/order); GET ordered by displayOrder. |
| `src/lib/radiologyDiagnosticsRules.ts` | `report_presentation_template` registered in the Flight Deck settings registry. |

### Frontend (diagnostic-erp)
| File | Change |
|---|---|
| `src/lib/reportImageRefs.ts` | NEW — pure helpers: reference payload builder (UID-validated), DICOMweb thumbnail URL, OHIF deep-link guard, display-order append. |
| `src/components/radiology/ReportImagePicker.tsx` | NEW — image selector inside the canonical workspace: browses study series/instances over the SAME browser DICOMweb base the embedded viewer uses, persists REFERENCES only, caption editing, thumbnail click → OHIF. Read-only when the study is finalized/locked. |
| `src/pages/RadiologyReportingWorkspace.tsx` | Preview panel now shows the CANONICAL server artifact (iframe of `/print?preview=true` for finalized, `/drafts/:id/print-preview` for drafts); Print button prints the same canonical artifact; picker mounted below the embedded viewer. Fixed a latent M1.4 bug: validation WARNINGS are issue objects and crashed React when rendered raw. |
| `src/pages/RadiologyReportGenerator.tsx` (deprecated page) | Premium toggle now renders the SERVER premium preview (`?template=care-premium`) — merged into the one pipeline. |
| `src/components/PremiumReportViewer.tsx` | **DELETED** (dormant; browser-direct Orthanc + credential exposure). |
| `src/lib/premiumReportRenderer.ts` | **DELETED** (its layout/typography now lives in the server `care-premium` template). |
| `src/pages/RadiologySettingsCenter.tsx` | Report Style tab: admin-only presentation-template selector. |

### Schema / migration
| File | Change |
|---|---|
| `lib/db/src/schema/radiologyReportGenerator.ts` | `radiology_image_references` + `study_instance_uid`, `series_instance_uid`, `sop_instance_uid`, `frame_number`, `display_order` (additive). |
| `migrations/add_report_presentation_r11.sql` | The same columns + `(draft_id, display_order)` index. Idempotent (applied twice in verification). |

## 2. Routes

- `GET /api/patient-reports/:id/print` — canonical print; `?preview=true` (no side effects, no auto-print), `?template=care-classic|care-premium` (staff override), `?version=` unchanged (D8).
- `GET /api/patient-reports/:id/pdf` — same artifact, `?template=` supported.
- `GET /api/p/r/:token/pdf`, email share, PACS archive — unchanged call sites; they flow through the same builder and pick up the admin-selected template.
- `GET /api/radiology/report-generator/drafts/:id/print-preview` — shared-layer draft artifact (staff auth; DRAFT watermark; `?template=`, `?autoPrint=true`).
- `GET/POST/PATCH/DELETE /api/radiology/report-generator/image-references` — reference persistence (UID-validated).

## 3. Renderer / presentation architecture (Phases 6–9)

```
                 ┌────────────────────────────────────────────┐
 patient_reports │ renderReportVersionHtml (data + D6 + D8)   │  drafts │ drafts/:id/print-preview
 (print, PDF,    │        builds ReportDocumentModel          │         │  builds ReportDocumentModel
 public PDF,     └───────────────────┬────────────────────────┘         └──────────┬──────────
 email, PACS)                        ▼                                             ▼
                        lib/reportPresentation.renderReportDocument(model, template)
                                     ▲                              ▲
                    PRESENTATION_TEMPLATES registry     lib/reportImages (UID refs → inlined pixels)
                    care-classic (default, today's look)
                    care-premium (activated premium)
                    [future: care-v2, hope, government,
                     teleradiology, patient-copy, referrer-copy]
```

- ONE pipeline: browser preview, browser print, PDF, delivery — and future
  portals — all call the same renderer. The workspace's client-side preview
  assembly remains ONLY as the unsaved-draft fallback.
- Typography is consumed exclusively through the per-slot map
  (header/patientBlock/studyTitle/sectionHeading/body/footer/signature/imagePanel)
  — configurable typography later means editing template data, not render code.
- Premium layout: desktop = CSS grid (report left, 64mm image rail right);
  print = floated right rail so text wraps and pagination stays natural; full
  width automatically when a report has no images. Page-break rules: orphans/
  widows 3, images/signatures/impression/header never split, headings never
  orphaned from their section.

## 4. Print / PDF architecture

Print and "PDF" are the same server-rendered, self-contained HTML document
(all images inlined as data: URLs — no PACS URL ever appears) with print CSS;
the browser's print dialog produces the paper/PDF output exactly as before.
`?preview=true` returns the identical document minus delivery bookkeeping and
the auto-print script; real prints keep the D8 share-log/delivered/audit
behavior unchanged.

## 5. Image handling (Phases 10–11)

- Persisted per selected image: StudyInstanceUID, SeriesInstanceUID,
  SOPInstanceUID, FrameNumber, caption (`description`), DisplayOrder — never
  pixels, never blob URLs (enforced by UID regex validation at both the pure
  payload builder and the zod route schema).
- Pixels resolve at render time server-side (internal Orthanc endpoint +
  server credentials). PACS outage → report renders without images.
- Picker thumbnails reuse the M1.2 browser DICOMweb base; thumbnail click
  opens the study in OHIF via the admin-configured launch URL. Rendered
  documents carry `data-sop-instance-uid` on each figure for future
  image-level deep links.

## 6. Deployment (Synology Container Manager)

- No new compose project, no volume changes, no database deletion.
- `migrations/add_report_presentation_r11.sql` applies through the existing
  db-patch pipeline on redeploy (idempotent; verified twice).
- No new environment variables (reuses ORTHANC_INTERNAL_URL /
  ORTHANC_USERNAME / ORTHANC_PASSWORD already used by diagnostics).
- Default behavior is UNCHANGED until an admin selects "CARE Premium" in
  Radiology Settings → Report Style (`/erp` route unaffected; the frontend
  build ships the same route map plus the picker/preview changes).

## 7. Rollback

Revert the single R1.1 commit. The template setting defaults to
`care-classic`; the additive image-reference columns are inert when unused.
No schema, hash, audit, amendment or lifecycle change occurred (verified:
D5–D9 suites green; D8 print test asserts the banner text byte-identical).

## 8. Remaining work → R1.2

- Template customization UI (per-template typography editing; new templates:
  CARE V2, Hope, Government, Teleradiology, Patient Copy, Referrer Copy —
  registry entries only, no render-logic changes needed).
- True server-side PDF generation (headless print) if a file artifact is
  needed for portals; today PDF = print-ready HTML.
- Image-level OHIF deep links (open the exact SOP instance, not just the
  study) — `data-sop-instance-uid` hooks are already in the documents.
- Unify the draft save-path `formatted_report_html` cache with the shared
  layer (currently a save artifact, not a presentation surface).
- ReportHub print/PDF buttons open the routes directly (no Bearer header) —
  predates R1.1; move them to the fetch-and-print pattern the workspace uses.
