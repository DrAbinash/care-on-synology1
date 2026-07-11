# Premium Report Layout — Audit (Ticket R1.1, Phases 1–3)

## 1. Existing premium implementation (found)

| Artifact | Location | State |
|---|---|---|
| Premium HTML renderer | `artifacts/diagnostic-erp/src/lib/premiumReportRenderer.ts` (669 lines) | Complete, dormant. Client-side HTML builder: 5 themes (classic/modern/journal/premium/minimal), clinic header, study-title bar, patient table, auto-structured findings, auto-bolded abnormal terms, numbered impression, image grid, signature + QR footer, watermark, A4 print CSS. |
| Premium viewer + image selector | `artifacts/diagnostic-erp/src/components/PremiumReportViewer.tsx` (501 lines) | Complete, dormant. Preview iframe + Orthanc series/instance thumbnail selector, theme picker, print/download buttons. |
| Only mount point | `artifacts/diagnostic-erp/src/pages/RadiologyReportGenerator.tsx` (line ~2095) | Deprecated page (M1.1), behind a session-local toggle. |
| Related tables | `radiology_image_references` (draft-scoped, free-text series/image numbers), `radiology_report_key_images` (uploaded screenshot FILES) | Neither stores DICOM UID references. |

Both files predate the 2026-07-05 module-boundary snapshot commit (`aab6a256`) — the
implementation came in with the historical "Antigravity"-era codebase and was never
routed into the canonical workflow. (The `Antigravity/` directory itself is the
architecture documentation tree, not code.)

## 2. Root cause — why premium never became active (proven, five independent blockers)

1. **Dead host page.** `PremiumReportViewer` is imported ONLY by
   `RadiologyReportGenerator.tsx`, which M1.1 explicitly deprecated
   (`App.tsx` route map comment: "deprecated; unique macro/key-image admin UI").
   The worklist's Report button navigates to `/radiology/report/:studyId`
   (`RadiologyWorklist.tsx:1020`) → `RadiologyReportingWorkspace` — which never
   imports anything premium. **Category: old workflow / dead component.**
2. **Default-off local toggle, no flag, no setting.** On the deprecated page it
   renders only when `premiumMode === true` — a `useState(false)`
   (`RadiologyReportGenerator.tsx:211`) that is not persisted anywhere. No
   feature flag, env var, or pacs_settings key references it.
   **Category: feature toggle that nothing ever turns on.**
3. **Study never linked.** Even when toggled on, the page passes
   `studyInstanceUID={null}` (line ~2118), so the image selector permanently
   shows "No DICOM study linked". **Category: wrong/missing wiring.**
4. **Browser-direct Orthanc access.** The selector fetches
   `{orthanc}/tools/find`, `/studies/{id}/series`, `/instances/{id}/preview`
   straight from the browser, reading `orthanc_username`/`orthanc_password`
   out of `/api/pacs/settings` into client JS. In production this is blocked
   by CORS/topology (the browser cannot reach `care-orthanc:8042`) and leaks
   PACS credentials. **Category: prototype-only integration.**
5. **Never connected to delivery.** Its output lives in a client iframe. The
   real print/PDF/WhatsApp/email/PACS-archive pipeline is server-side
   (`buildReportArtifact` → `renderReportVersionHtml` in
   `routes/patient-reports.ts`) and knows nothing about the premium layout, so
   even a printed premium page would diverge from every delivered copy.
   Selected images were ephemeral base64 — nothing persisted.
   **Category: duplicate, parallel implementation.**

## 3. Current production report flow (Phase 2 trace)

```
Radiology Worklist              pages/RadiologyWorklist.tsx
  └─ "Report" button            → navigate(`/radiology/report/${entry.id}`)   (line 1020)
React route                     App.tsx:367  /radiology/report/:studyId
  └─ RadiologyReportingWorkspace pages/RadiologyReportingWorkspace.tsx  (M1.1 canonical)
Save Draft                      lib/radiologyReportLifecycle.ts
  └─ POST /api/radiology/report-generator/save-draft
                                routes/radiology-report-generator.ts:1381
                                → radiology_report_drafts (structured_json_d1 = canonical D1,
                                  structured_json = A4 render cache,
                                  formatted_report_html via buildFormattedReportHtml)
Finalize (sign)                 routes/patient-reports.ts (create + D5 sign path)
                                → patient_reports row (body, structured_json signed doc,
                                  jcs-sha256/1 content hash, signature stamps)
Structured read (D6)            applyStructuredRead() — flag-gated display body
Version resolution (D8)         lib/radiologyReportVersion.ts resolveReportVersion()
                                — the ONLY latest-revision authority
Presentation (server)           routes/patient-reports.ts
                                buildReportArtifact() → renderReportVersionHtml()
                                — ONE builder for ALL of:
  ├─ Staff print                GET /api/patient-reports/:id/print   (line 2571)
  ├─ Staff PDF                  GET /api/patient-reports/:id/pdf     (line 2594; print-ready
  │                             HTML + Content-Disposition, browser prints to PDF)
  ├─ Public/WhatsApp PDF        GET /api/p/r/:token/pdf              (line 2618, token-gated)
  ├─ Email share                buildReportArtifact(surface:"email") (line 2739)
  └─ PACS archive               lib/pacsArchive.ts (same artifact)
Delivery bookkeeping            report_shares + D10 re-delivery obligations (BEND-1)
```

**Additional (duplicated) presentations found in the flow today:**

| # | Builder | Where | Used for |
|---|---|---|---|
| 1 | `renderReportVersionHtml` | `routes/patient-reports.ts:2282` | ALL delivery surfaces (canonical) |
| 2 | `buildFormattedReportHtml` | `routes/radiology-report-generator.ts` (~770) | draft `formatted_report_html` + key-image `<figure>` grid |
| 3 | `buildPreviewHtml` | `pages/RadiologyReportingWorkspace.tsx:238` | workspace on-screen preview AND its Print button (`window.open(previewRef.innerHTML)` — prints an unstyled duplicate, not the canonical artifact) |
| 4 | `renderPremiumReport` | `lib/premiumReportRenderer.ts` | dormant premium |

This is the Phase 6 problem in one table: four HTML presentations, only #1 is
delivered to patients.

## 4. Files required for activation

- `artifacts/api-server/src/routes/patient-reports.ts` — canonical artifact builder (host of the new shared layer call).
- `artifacts/diagnostic-erp/src/lib/premiumReportRenderer.ts` — layout/typography source to port server-side.
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` — canonical workspace (preview/print unification + image selector).
- `artifacts/diagnostic-erp/src/components/EmbeddedWadoViewer.tsx` — proven browser DICOMweb access pattern (`{dicomWebBase}/studies/.../rendered`) reused by the selector.
- `lib/db/src/schema/radiologyReportGenerator.ts` — `radiology_image_references` (extended additively with DICOM UID columns).
- `routes/radiology-report-generator.ts` — image-references CRUD (extended), draft print-preview endpoint.
- `lib/pacs/pacsConfig.ts` — server-side Orthanc endpoints for image inlining (ORTHANC_INTERNAL_URL pattern).

## 5. Decision (Phase 4/5 — minimum safe activation)

The premium implementation is **reused, not rewritten**: its layout, section
hierarchy and print rules are ported into ONE server-side presentation module
that `renderReportVersionHtml` (and the draft preview) call. The client-side
`PremiumReportViewer`'s browser-direct Orthanc access is NOT activated (root
causes 4–5 make it unshippable); its image-selection UX is re-implemented thin
inside the canonical workspace on the existing DICOMweb path, persisting only
UID references. The current visual remains the default template so no delivery
surface changes until the admin selects the premium template
(`pacs_settings: report_presentation_template`).

## 6. Rollback

Revert the single R1.1 commit. The `report_presentation_template` setting
defaults to the classic template, so simply not setting it (or setting
`care-classic`) restores the exact prior presentation; the additive
image-reference columns are unused when empty and can stay.
