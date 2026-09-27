# CARE Radiology Workspace — AI Memory Document (v1 · 2026-09-20)
Append-only. Never delete history; add changelog entries.

## 0. How to use
Any AI session starts by reading this file. Trust §1–§2; verify with targeted greps only.
Conventions in §5 are binding. Open work lives in §3 (findings) and §4 (studio state).

## 1. Topology (facts, do not re-derive)
- ERP compose: care-on-synology1 → care-db (pg16, loopback 127.0.0.1:5400), care-db-patch-v2 (SINGLE auto-migrator), care-schema-verify, care-api (:8080), care-web (nginx 8888→80), care-redis.
- PACS compose (separate net): Orthanc :8042 (LAN 172.16.1.139:8042), OHIF :3010, care-erp-sync (Orthanc→ERP; ERP in-process poller MUST stay ORTHANC_CHANGES_POLLER=false), mwl-guard.
- USG studio: /volume1/docker/usg-reports → usg-reporting-studio (Next) + usg-reporting-caddy (https usg.caredeoghar.com); SQLite data/db/studio.db (Prisma). Host sqlite3 edits ≠ container DB certainty — verify before trusting.
- Three URL planes: container (docker DNS, ORTHANC_INTERNAL_URL), server/LAN (172.16.1.x + ALLOW_PRIVATE_IPS=true), browser (LAN http / public https / Tailscale https).
- Mixed-content law: https page cannot embed/fetch http. ERP EmbeddedWadoViewer auto-selects route by window.location.protocol (https → tailscale keys ohif_base_url_tailscale / wado_base_url_tailscale). Studio viewer must clone this rule.
- Keys: REPORTING_STUDIO_API_KEY (x-api-key /api/internal/reporting-studio/*), INTERNAL_API_KEY (care_erp_sync), CRON_SECRET, BACKUP_PASSPHRASE (rotation trap: no previous-secret slot), SUPER_ADMIN_USB_*.
- Backups bind /volume1/docker/backups; uploads volume holds radiology-key-images (include in restore).

## 2. Workspace invariants (do not break)
- Single ingress to zustand: workflow queue → setStudies. A second fetch once crashed WorklistStrip (s.patient.id).
- Wrong-patient guards: canHydrateDraftForPatient; arrival cross-check toast; study-switch wipes editor unconditionally.
- Normal auto-bootstrap: ONE decision per studyId; guards = no draft, no content, no local backup, not locked/finalized.
- Finalize gauntlet order: session → AI-pending gate → save dirty → PCPNDT gate → validate → quality eval → critical detect → signatures (prefer Dr Sugandha) → composition gate → promptFinalize → finalize → honest toast → Hope push → cleanup → auto-advance.
- Layout: workspaceLayoutPrefs byMode; resize via ImperativePanelHandle only; paneManualOverrideRef; auto ~2/3 report bias on findings/impression focus.
- Retired via {false && …}: chocolate boxes, structured cards, inline FindingsToolDrawer group, floating AI assistant, viewer-column PrintImagePicker. Authoritative surface = ReportingToolsPanel. Recommendation accordion was restored to the main report (F1, 2026-09-25); do not re-retire it.
- Voice: deterministic grammar only (no AI rewrite of dictation); audit POST voice-command-audit.
- OHIF bridge: postMessage with derived allowed origins; annotated capture via CARE OHIF extension; Frames fallback.

## 3. Findings register (merge doctor's 10 points as D1–D10)
F1 Retired UI vs muscle memory (Recommendation only under Tools→More) — friction — DONE 2026-09-25 (accordion restored; More duplicate removed)
F2 Normal-bootstrap vs contradiction loop (banner never auto-resolves; extra click per abnormal) — HIGH-FREQ — DONE 2026-09-25 (auto-refresh unless radiologist-manual)
F3 Signed-report "Edit report" trial unlock in toast, no role check — COMPLIANCE — DONE 2026-09-25 (owner/admin only)
F4 Force release shown to locked-out user, no owner/admin check — consistency — DONE 2026-09-25
F5 Demography edits session-local only (demographyOverrides never reach patient master) — data quality — OPEN
F6 Queue defaults MR + today-yesterday on fresh browsers — minor — DONE 2026-09-25 (fresh browsers default to today; saved preset still honored)
F7 Three impression warning surfaces at once — noise — DONE 2026-09-25 (ImpressionWarningStrip)
F8 Left queue auto-collapses on every study open — minor — DONE 2026-09-25 (setting auto_collapse_queue_on_study_open, default true)
F9 Polling without tab-visibility pause (30s pcpndt, 30s mri-warm, 5min session) — perf — DONE 2026-09-25
F10 OHIF capture capability not preflighted at viewer load — minor — DONE 2026-09-25
F11 Study-open region was DICOM-primary; billed `testName` only ranked formats — DONE 2026-09-26 (billed-first `resolveAutoStudyRegion` + From billed/DICOM badge)
V-03 Abnormal-template branching engine — suggestion-only pattern library — DONE 2026-09-27 (telemetry deferred; apply/dismiss counts use the local usage-counter seam only; never auto-applies)
Stream — billed exam owns technique, findings, impression, and recommendation as one document — DONE 2026-09-27 (Quick Normal applies that exam's complete-normal format; protocol/template autofill no longer blocks it; a finding's own recommendation is written into the recommendation box)

## 4. USG studio state (2026-09-20)
Fixed: sync ReferenceError (full param); PACS fallback via DICOM-Web; Form F master-switch gate; stampIST honest IST labels; composer grid conditional; PACS Viewer nav item (page pending); UsgPacsQueue loud errors.
Pending: StudyTime enrichment (anchor not found in careSync.ts); composer patient dropdown; embedded viewer rail with LAN/Tailscale auto; referrer-truth probe (does ERP send referringDoctor for USG rows?).
Traps learned: /g sed injections hit early returns; guard `if "usgFormFEnabled ? (" not in u` blinded by its own partial success; host-vs-container SQLite confusion.

## 5. Conventions (binding)
- ERP changes → Cursor draft PR with tests; never merge autonomously.
- Studio/MRI changes → line-based python patches after READing the target lines; rebuild; verify in browser.
- Audit philosophy: monitors must confess; no silent catches; honest toasts; blank ≠ failure, say which.
- Fire-drill: docker stop care-api to exercise PACS fallback.

## 6. Changelog
2026-09-27 — **Report boxes follow the billed exam as one document** on `cursor/report-stream-coherence-c2ab`. Quick Normal applies the exam's complete-normal format (technique, findings, impression, recommendation together) instead of four generic sentences. Opening a new study still does that when the only text present is protocol or template autofill. A finding that carries recommendation text writes it into the recommendation box and leaves the format recommendation in place when the finding is removed. No new boxes. V-03 stays suggestion-only.
2026-09-27 — **V-03 abnormal-template branching engine implemented — suggestion-only; telemetry deferred; counts via local usage-counter seam** on `cursor/workspace-v03-abnormal-patterns`. Six verbatim catalog patterns hydrate from pacs-settings `abnormal_pattern_library` (seeds when missing). Matcher requires two independent signals and never auto-applies. Confirm reuses MergePreviewDialog store state, then `applyMacroBundle` source `abnormal-pattern`. Draft marker `careAppliedPatterns` keeps the applied version. 5b/5c remain deferred.
2026-09-26 — **Billed-first study region at open** on `cursor/billed-first-study-region-e9d1`. Auto Study Tab / region now prefers worklist `testName`/`billedTestName` via `resolveAutoStudyRegion`, then falls back to modality+StudyDescription. Manual override unchanged. Quiet “From billed” / “From DICOM” badge (+ DICOM mismatch hint) on Study / Region strip. Does not change format ranking or finalize billing link.
2026-09-26 — **Legacy monolith snapshot deleted** on `cursor/workspace-legacy-delete-2127` (stacked on Phase 4). Removed `RadiologyReportingWorkspace` pre-modular backup page; `/radiology/legacy-workspace` routes redirect to modular workspace; Layout nav entry removed; grounding + source-grep contracts retargeted. Git history retains the snapshot.
2026-09-26 — **Modularization Phase 4 (FINAL)** on `cursor/workspace-modularize-phase4-2127`. Extracted `useWorkspaceCommands` (dispatcher + Save&Next + unified keydown with voiceKeyAction first; voice listeners removed from `useVoiceReporting`), `useOhifViewerBridge` (measurements ingest, OHIF capture/bridge, caption refresh, key-image detach/reassign), and JSX shell under `components/radiology/workspace/` (`WorkspaceShell`, `WorkspaceTopBar`, `WorklistPanel`, `ViewerColumn`, `ReportCanvas`, `ReportingToolsRail`, `WorkspaceFooter`, `WorkspaceOverlays`, `types`). Remaining orchestration in `useWorkspaceClinicalUi`. Root page composition-only. **Final line counts:** root 19; `useWorkspaceCommands` 300; `useOhifViewerBridge` 498; `useWorkspaceClinicalUi` 3108; shell — TopBar 807, Worklist 476, Viewer 646, ReportCanvas 2013, ToolsRail 1054, Footer 451, Overlays 883, Shell 448, types 2. Pure extraction — no store/API/testid/finalize-order changes. **V-07 CLOSED** (modularization follow-up complete). Follow-up fix: restored `BROWSER_DICOMWEB_BASE` imports in `ReportCanvas`/`ReportingToolsRail` after dead-import trim (runtime ReferenceError).
2026-09-26 — **Modularization Phase 3** on `cursor/workspace-modularize-phase3-2127`. Extracted `useDraftPersistence`, `useStudyFinalize`, `useWorkspaceExportShare` under `hooks/radiology-workspace/`. Pure extraction — **finalize gauntlet ORDER unchanged**; data-testids, zustand store shape, and API URLs/payloads unchanged. Source-grep tests scan page + hooks. Commands/JSX extraction still deferred.
2026-09-26 — **Modularization Phase 2** on `cursor/workspace-modularize-phase2-2127`. Extracted `useReportSectionChrome`, `useWorkspaceLayout`, `useVoiceReporting` under `hooks/radiology-workspace/`. **A2 wiring:** `getContext().structuredFindings: useStructured` (live; never hardcoded false). **V-04 wiring:** `requiresCatalogConfirm` → CONFIRM_REQUIRED pending-preview; dictate catalog-match applies only after confirm via `applyCatalogAfterConfirmRef`; explicit select/remove uses `handleQuickToggleRef` immediately; negation ("no fatty liver") → zero chip toggles. Voice PTT/confirm keys owned by the voice hook (no double-mounted `voiceKeyAction` on the page). Page still owns JSX chrome; testid inventory + accordion greps scan hooks. No store/API/testid contract changes. Draft/finalize/commands/JSX extraction deferred.
2026-09-26 — **MRI abnormal strip + bill-desk selection + A2/V-04** on `cursor/mri-abnormal-billdesk-voice-2127`. Starting Canvas shows top MRI abnormal formats (Brain/LS/Cervical/Dorsal) ranked by billed `testName` + referring-doctor history. Worklist exposes `testId`/`testName`/`referringDoctorId`/`referringDoctorDegree`/`referringDoctorMasterName` from bill→order→`doctors.degree` (Settings → Doctors). Strip label uses `formatDoctorWithDegree(name, degree)` — degree only from master, never invented. A2: `structuredFindings: useStructured`. V-04: catalog-matching prose requires pending-preview confirm then `applyPathologyOverlay`; explicit select/remove stays immediate. Lightweight `workspace-telemetry` POST + local ring.
2026-09-26 — **Modularization Phase 1** (no behavior / UI moves). Branch `cursor/workspace-modularize-2127` from `origin/main` (feat/workspace-usability-multistudy content already on main via #750–#755; remote feat branch gone). Extracted pure helpers: `recommendationChips.ts`, `findingsMapText.ts`. Added `resolveQuickFindingFromSpeech` (+ forward `matchQuickFindingBySpokenTerm`) with A1 unit tests (negation, two-finding segment, ambiguity, zero-match narrative). Committed `lib/fixtures/radiologyReportingWorkspace.testids.json` + parity test for Phase-3 gate. A2 safety-matrix tests added on `voiceSafetyPolicy` (structured-on blocks free dictate; quick-select allowed; structured-off unchanged). Wiring `useStructured` into `getContext` and V-04 pending-preview confirm deferred to Phase 2.
2026-09-26 — Workspace density: always compact+exclusive accordion (ultrawide included). Starting Canvas collapses to a thin row (Quick Normal stays one-click). Study details auto-closes during clinical sections. AnchorRail renders only when `activeAnchor.studyInstanceUID` is set. Viewer-focus “Show details” → “Show patient details” (restores chrome + opens demography). Branch `cursor/workspace-density-chrome-2127`.
2026-09-25 — Ctrl+Shift+Enter Save & Next: silent draft save, then finalize when findings and impression are both filled. Empty sections toast “Please complete findings/impression before Save & Next” and do not open the finalize dialog. Listed on the workspace footer as ⌃⇧↵ save & next. Finalize still owns Zero-Click Read Loop auto-advance.
2026-09-25 — Multi-study combined report + workspace usability F1–F4, F6–F10 (F5 untouched). Primary studyId stays the route. Linked study lives in structuredJson.linkedStudyId. Findings sub-sections stitch around applyPathologyOverlay (single triad ingress). Finalize marks both worklist rows REPORT_FINAL. Branch `feat/multi-study-and-usability`.
2026-09-25 — Quick Normal fallback on the Starting Canvas (`quick-normal-fallback`). Wholesale `setField(..., "quick-normal")` fills technique, findings, impression, and recommendation without the format picker. Provenance source `quick-normal` is not radiologist-manual, so it does not raise the stale impression banner. Recommendation accordion stays on the main report.
2026-09-25 — `auto_collapse_queue_on_study_open` also gates Report Focus queue collapse. Key-image rail camera is disabled with “OHIF not reachable for this study” when the viewer has no OHIF launch URL.
2026-09-25 — Workspace polish F7/F8/F10. Impression warnings stay on one ImpressionWarningStrip (no collapsed header warning). Queue auto-collapse remains the clinic setting in Settings → Radiology → Workspace. Branch `fix/workspace-polish-f7-f8-f10`.
2026-09-20 v1 — initial analysis; F1–F10 registered; studio fixes/pending listed.
2026-09-25 — WhatsApp Delivery v2 (Lane 1): pure `whatsappDelivery` lib (phone/routing/PHI messages/wa.me); clinic settings `whatsapp_delivery_routing` / `whatsapp_auto_offer_after_print` / `whatsapp_clicktochat_number` / station-remember; patient `whatsapp_consent` (+ by/at) on registration & online booking; Bill tab WhatsApp + Print & Send (print once then offer; draft/cancelled disabled); signed 7-day `/share/bill|report/:token` pages (SESSION_SECRET HMAC, noindex, expired → clean leak-free page); booking confirm + chatbot handoff enqueue `wa_delivery_queue`; front-desk one-click Send → sent + `wa_delivery_audit`; Settings → Audit WA panel (security). No Meta/Cloud API; never silent auto-send. Branch `cursor/erp-whatsapp-delivery-c2ab`.

## 7. Open follow-ups (this change)
- V-03 telemetry stays deferred by owner decision. Do not add an event bus. Counts stay on the local usage-counter seam until that decision changes.
- Phase 4 done: modularization complete / V-07 CLOSED. Monolith snapshot delete shipped on `cursor/workspace-legacy-delete-2127` (git history retains file).
- Lane 2 Cloud API/BSP adapter plugs into `DeliveryChannel` stub (`cloud-api` + `notConfigured`) without rework.
- Report workspace share dialog still uses legacy Meta share path for verified reports — migrate to Lane-1 dialog when Meta remains unavailable.
- Synology: apply `migrations/zzzz_whatsapp_delivery_v2.sql` (or boot ALTER) before relying on queue/audit tables in prod.
