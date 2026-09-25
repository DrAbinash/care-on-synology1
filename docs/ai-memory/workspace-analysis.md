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
- Retired via {false && …}: chocolate boxes, structured cards, inline FindingsToolDrawer group, recommendation accordion, floating AI assistant, viewer-column PrintImagePicker. Authoritative surface = ReportingToolsPanel.
- Voice: deterministic grammar only (no AI rewrite of dictation); audit POST voice-command-audit.
- OHIF bridge: postMessage with derived allowed origins; annotated capture via CARE OHIF extension; Frames fallback.

## 3. Findings register (merge doctor's 10 points as D1–D10)
F1 Retired UI vs muscle memory (Recommendation only under Tools→More) — friction — OPEN
F2 Normal-bootstrap vs contradiction loop (banner never auto-resolves; extra click per abnormal) — HIGH-FREQ — OPEN
F3 Signed-report "Edit report" trial unlock in toast, no role check — COMPLIANCE — OPEN
F4 Force release shown to locked-out user, no owner/admin check — consistency — OPEN
F5 Demography edits session-local only (demographyOverrides never reach patient master) — data quality — OPEN
F6 Queue defaults MR + today-yesterday on fresh browsers — minor — OPEN
F7 Three impression warning surfaces at once — noise — OPEN
F8 Left queue auto-collapses on every study open — minor — OPEN
F9 Polling without tab-visibility pause (30s pcpndt, 30s mri-warm, 5min session) — perf — OPEN
F10 OHIF capture capability not preflighted at viewer load — minor — OPEN

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
2026-09-20 v1 — initial analysis; F1–F10 registered; studio fixes/pending listed.
2026-09-25 — WhatsApp Delivery v2 (Lane 1): pure `whatsappDelivery` lib (phone/routing/PHI messages/wa.me); clinic settings `whatsapp_delivery_routing` / `whatsapp_auto_offer_after_print` / `whatsapp_clicktochat_number` / station-remember; patient `whatsapp_consent` (+ by/at) on registration & online booking; Bill tab WhatsApp + Print & Send (print once then offer; draft/cancelled disabled); signed 7-day `/share/bill|report/:token` pages (SESSION_SECRET HMAC, noindex, expired → clean leak-free page); booking confirm + chatbot handoff enqueue `wa_delivery_queue`; front-desk one-click Send → sent + `wa_delivery_audit`; Settings → Audit WA panel (security). No Meta/Cloud API; never silent auto-send. Branch `cursor/erp-whatsapp-delivery-c2ab`.

## 7. Open follow-ups (this change)
- Lane 2 Cloud API/BSP adapter plugs into `DeliveryChannel` stub (`cloud-api` + `notConfigured`) without rework.
- Report workspace share dialog still uses legacy Meta share path for verified reports — migrate to Lane-1 dialog when Meta remains unavailable.
- Synology: apply `migrations/zzzz_whatsapp_delivery_v2.sql` (or boot ALTER) before relying on queue/audit tables in prod.
