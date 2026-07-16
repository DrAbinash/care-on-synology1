<!-- markdownlint-disable -->
# CARE Reporting Platform — Master Engineering Audit

| | |
|---|---|
| **Audit version** | 1.0.0 |
| **Audit date** | 2026-07-16 |
| **Audit base commit** | `8200e766` (post MRI PR 5 — the tree the `file:line` evidence below refers to) |
| **Committed onto** | `01b0ee49` |
| **Responsible reviewer** | DrAbinash (platform owner) — pending human sign-off |
| **Method** | Six independent read-only audit sweeps, cross-checked and consolidated |
| **Status** | Snapshot — **documentation only** |

> **This is a point-in-time audit snapshot, not live telemetry.** Percentage/score values are **engineering judgments (estimates)**; asset counts (templates, protocols, Copilot modules, `modalityMap`) were **code-verified** at the audit base commit. Nothing here is wired to the running app, database, or CI. The companion cockpit ([`cockpit/index.html`](./cockpit/index.html)) renders a subset of these findings; this document is the authoritative evidence. USG consolidation (#92) merged after the audit base, so USG-related items may already be advancing.

**Scope:** MRI Reporting + CARE Copilot + shared reporting platform (radiology core), read-only.
**Method:** Six independent parallel audits (architecture/dead-code/extension · workflow/UX/a11y · chaos/reliability/state · performance · security · copilot/DB/docs), cross-checked against each other and against firsthand knowledge from building the MRI PR 1–5 series. Evidence is `path:line`.
**Constraint honored:** *audit, not edit.* No repository files were modified. The highest-value fixes concentrate in `RadiologyReportingWorkspace.tsx`, `patient-reports.ts`, and `lib/db/src/schema/*` — the same surfaces the in-flight **USG (PR B)** and **PCPNDT** branches touch — so everything below is framed as a **recommended future PR**, not a change made now.

> **Bottom line.** This is a genuinely well-engineered platform in its core (finalize truthfulness, study-lock, reliability layer, and the Copilot are exemplary) that has accumulated **safety-critical duplication** and one **silent-data-loss gap in the default editing mode** after five major MRI PRs landed. None of it blocks day-to-day MRI reporting today, but three issues should be fixed **before** USG completion and new modalities scale the surface further.

---

## 1. Executive Summary

**What's excellent (leave alone):**
- **CARE Copilot (86/100)** — a genuine *composition* of existing engines (`observeReportText` + `computeQualityScore`/`validateReport`), not a second engine. 9 modules were added with **zero** core/panel/registry edits — proven extensibility. Advisory-only safety is enforced end-to-end.
- **Finalize truthfulness & study-lock** — the finalize flow honestly distinguishes structured-signed / legacy-fallback / saved-but-not-signed / unbilled, never claiming a sign that didn't happen; the lock has heartbeat, expiry, stale-async dropping, and never touches local text on loss.
- **Reliability layer** — autosave + 30-snapshot history, `beforeunload`, `guardedLeave`, offline gating, `retryWithBackoff`, 401 rescue, wrong-patient cross-check. (Its one blind spot is the default structured mode — see Critical #2.)
- **Artifact boundaries** — no cross-artifact imports; shared code flows through `lib/*`. Clean layering.

**What must be addressed before scaling:**
1. **Patient-safety:** three parallel critical-finding alert systems, one silently shadowed by route-mount order, one acknowledge endpoint returning 404.
2. **Data integrity:** manually-typed structured findings (the **default** mode) are invisible to dirty-detection, local backup, and 401 rescue → **silent loss** on Next/close/crash.
3. **Security/privacy:** an unauthenticated public-booking endpoint leaks PHI by phone number; report bodies are stored unsanitized and rendered as raw HTML in server PDFs/print with CSP disabled.

**The strategic risk:** the platform is **MRI-primary with USG bolted on**, not modality-generic (Extension Readiness 38/100). The clean data-driven path exists (`radiologyCatalog` + `structuredReport`) but is flag-gated `wired: false`. Adding CT is partly feasible; Mammography/Nuclear/PET-CT require code changes across many hardcoded sites. Consolidation of the duplicated safety/template/render systems is the prerequisite for clean expansion.

---

## 2. Platform Scorecard

| Dimension | Score | One-line |
|---|---|---|
| **Architecture Health** | **44** | Safety-critical triplication + 4–5 render paths + giant files, offset by clean boundaries + governed flags |
| **Performance** | **62** | Great infra (lazy routes, chunking, query discipline); the hot *typing* path is undebounced + one remount bug |
| **Security** | **57** | Strong controls exist but on flag-off paths; 1 unauth PHI leak, stored-XSS via server docs, sign-forgery on default path |
| **Maintainability** | **48** | 5,724-line workspace / 9,538-line Settings, ~250KB dead code, flag noise — but strong tests + documented deprecations |
| **Reliability** | **73** | Deeply guarded free-text flow; the default structured mode is not crash/dirty-protected |
| **Clinical Workflow** | **78** | Complete, hardened E2E path; a few real flow leaks + a native-`confirm` safety gate |
| **Tech-Debt Management** *(higher = better)* | **45** | Large debt, but much is *documented* and mid-strangler-fig, not chaotic |
| **Extension Readiness** | **38** | MRI-hardcoded gates; the generic path is built but unwired |
| **Overall Platform** | **60** | Production-capable and impressively engineered in its core; safety/data/security gaps gate confident expansion |

*Supporting sub-scores:* State Management **72** · UX **68** · Database Health **62** · Documentation **58** · Accessibility **55**.

**How "Overall 60" was derived:** a safety/security/reliability-weighted blend of the above. The core is 70s–80s; it is pulled to 60 by the Architecture (44) and Extension (38) structural debt and the specific Critical findings — i.e. the platform *works well* but is *not yet safe to scale* without the top-tier fixes.

---

## 3. Per-Audit Summary (the 13 requested audits)

- **A1 Architecture (44):** safety-critical triplication (critical alerts, voice ×3, templates ×9, render ×4–5), giant files; good boundaries, flag governance, genuine finalize dedup.
- **A2 E2E Workflow (78):** complete & hardened; leaks: Send-on-unsigned, protocol/checklist/nudge state carrying across studies, no Finalize-&-Next, no in-workspace Amend, wall-of-text finalize confirm.
- **A3 Chaos (Reliability 73):** free-text flow well-guarded; **structured-mode silent loss**, `transitioning` deadlock on failed load, non-idempotent finalize (duplicate row), save not lock-gated after loss, 2-tab thrash, preview-stale-while-dirty, AI calls no timeout.
- **A4 Performance (62):** `TemplatesTab` remount (focus-loss bug), undebounced per-keystroke Copilot/quality (×2 duplicate runs), no child memo → DICOM viewer re-renders per keystroke, 296KB route chunk. Infra otherwise clean.
- **A5 State (72):** pure tested rule libs are the strength; `serializeReportSnapshot` omits `findingsMap` (root of Critical #2), two preview sources of truth, `findingsMap`↔`rawFindings` never reconcile on mode toggle.
- **A6 Security (57):** unauth PHI (public booking), stored-XSS via server report docs (CSP off), sign/verify forgery on default legacy path, unauth `/uploads`, SVG upload XSS; strong RBAC/SQLi/structured-sign/public-token controls.
- **A7 UX (68):** strong speed scaffolding (palette, quick findings, voice); hot-loop friction (Finalize bottom vs Next top, `window.prompt` measurements, 8 cramped tabs, density via shrinking type).
- **A8 Accessibility (55):** keyboard coverage strong; 8px type (87× ≤10px in the workspace), marginal muted contrast on tinted tiles, two modals without focus-trap/return, tabs not an ARIA tablist.
- **A9 Dead code:** ~250KB+ confirmed 0-importer (AI-copilot cluster 68KB, assembler 26KB, quick-add data 40KB, smart-engine cluster 50KB, orphan utils 90KB), 3 unmounted routers, dead HL7, ~19 unread flags, 97MB tracked working dir.
- **A10 Documentation (58):** excellent *content* (canonical guides, code headers) crippled by no README/index, ~70 duplicate files, contradictory test counts, and the Copilot architecture documented nowhere but code.
- **A11 Database (62):** disciplined naming/PK/timestamp; advisory-only FKs on core entities, `radiology_studies` missing hot-column indexes, 3 critical-findings + 5 draft + 3 amendment tables, two migration systems.
- **A12 Copilot (86):** the standout — genuine composition, clean registry, provider abstraction reused, advisory-only, 13 test files; defects: AI-query field mismatch, two "Copilot" component names, hand-assigned confidence.
- **A13 Extension (38):** MRI-hardcoded modality map/templates/protocol schema; USG special-cased; the generic `radiologyCatalog`/`structuredReport` path is unwired.

---

## 4. Consolidated Top Issues (ranked)

Fields per issue: **Description · Why it matters · Files · Effort (S/M/L) · Regression risk · Recommended PR.** ✅ = independently corroborated by ≥2 audits (or an audit + the PR-series history).

### 🔴 CRITICAL

**C1 — Three critical-finding alert systems; one silently shadowed by mount order; acknowledge is a 404** ✅
*Desc:* "flag→notify→acknowledge→escalate" is built 3× over 3 tables (`radiology_critical_findings`, `critical_findings`, `critical_findings_alerts`) with different severity vocab. `pacsEnterpriseRouter` mounts at `/radiology` **before** `radiologyRouter`, so `GET/POST /api/radiology/critical-findings` are **shadowed dead** (PacsDashboard silently reads a different system); `CriticalAlertsManager.tsx:45` PATCHes an acknowledge route that **doesn't exist** (404). *Why:* the platform's patient-safety spine has 3 sources of truth — a critical result acknowledged on one surface stays "unacknowledged" on another; staff actions silently no-op. Highest medico-legal risk. *Files:* `schema/{radiology.ts:189, criticalFindings.ts:4, enterpriseRadiology.ts:47}`, `routes/{radiology.ts:1667-1692, pacsEnterprise.ts:1687-1734, radiologyWorkflow.ts:344-364, index.ts:537-596}`, `CriticalAlertsManager.tsx:45`, `PacsDashboard.tsx:282`. *Effort:* L · *Risk:* High · *PR:* "Unify critical-finding alerts on one table+service+API; fix `/radiology` mount order; add the missing acknowledge endpoint." **Do the mount-order + 404 fix first (small, high-safety); defer table convergence.**

**C2 — Silent data loss: structured (default) findings absent from dirty-detection, backup, and 401 rescue** ✅
*Desc:* `serializeReportSnapshot`/`isReportDirty` serialize only `clinicalHistory,technique,rawFindings,impression,recommendation,quickSelectIds` — **not `findingsMap`**. Typing into an Abnormal section textarea or toggling Normal/Abnormal changes only `findingsMap`, so `dirty` stays **false** → no "unsaved" pill, `beforeunload` never arms, `guardedLeave` returns ok, and `resetWorkspaceState` wipes it on Next/Previous. The local backup snapshot and the rescue saver also omit `findingsMap` (the rescue saver even early-returns when `rawFindings` is empty), so pure structured dictation is **crash- and session-expiry-unprotected**. *Why:* structured mode is the default (`useStructured=true`); this is silent loss of clinical work in the primary editing mode. *Files:* `workspaceReportState.ts:23-52`, `RadiologyReportingWorkspace.tsx:2451-2454, 1304-1357, 1876-1916, 4718-4762`, `useLocalDraftBackup.ts:52-62`. *Effort:* S–M · *Risk:* Med (flips many "clean" studies to dirty; retune baseline recapture) · *PR:* "Include `findingsMap` in the report snapshot + backup + rescue envelope; unit-test a structured-only edit."

**C3 — Unauthenticated PHI exposure via public booking** ⚠️ *(pre-existing, already has an internal writeup; outside the reporting core)*
*Desc:* `GET /api/public/booking/my-bookings` has **no auth** and returns the full booking row by a `phone` query param (name, phone, email, age/sex, test/package ids revealing suspected conditions, notes, VIP flag, payment-gateway ids). The paired `send-otp` **returns the OTP code in its own JSON response** and `verify-otp` issues no session, so OTP is not a real control. Phone-number enumeration harvests PHI at scale. *Why:* mass PHI + payment-metadata disclosure to the open internet; DPDP/privacy exposure. *Files:* `public-booking.ts:290-307, 1581-1606`, `index.ts:226`; writeup `SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md`. *Effort:* M · *Risk:* Med · *PR:* "Gate booking history behind a verified-OTP session; stop returning OTP codes; column-project + strict per-route limiter."

**C4 — Stored XSS in radiology report body → server PDF/print/public link, CSP disabled** ⚠️
*Desc:* `POST/PATCH /api/patient-reports` store `body` verbatim/unsanitized; for `type==="radiology"` it renders as **trusted raw HTML** in the server document (`reportPresentation.ts:365` `<div class="body">${model.bodyHtml}</div>`) served by `/:id/print`, `/:id/pdf`, and the public `/api/p/r/:token/pdf`. Helmet CSP is `false` (`app.ts:63`), so injected `<script>` runs on the clinic origin; the staff bearer token lives in `localStorage` → session theft/account takeover. (The workspace's *on-screen* previews are safe — sandboxed `srcDoc` without `allow-scripts`, escaped fields — the exposure is the **server-rendered** document + `RadiologyReportGenerator.tsx:2140` `dangerouslySetInnerHTML`.) *Files:* `patient-reports.ts:1913,2377,2580,2627,2659,2686`, `reportPresentation.ts:365-366`, `app.ts:63`, `RadiologyReportGenerator.tsx:2140`, `radiology-report-generator.ts:1376,1430`. *Effort:* M · *Risk:* Med (preserve legit formatting) · *PR:* "Sanitize radiology report HTML on write+render (allowlist); add strict CSP to report/PDF/public responses."

### 🟠 HIGH

**H1 — Sign/verify identity forgery on the DEFAULT legacy path** ⚠️
*Desc:* the session-derived-actor structured pipeline is behind `ff_radiology_structured_final`, which **defaults OFF**, so the legacy path runs: `/:id/sign` and `/:id/verify` record client-supplied `signedByName`/`verifiedByName` and accept any `signatureId` (global pool, no owner check). One user can sign as "Dr A" and verify as "Dr B", forging the two-person countersign on regulated reports. *Files:* `patient-reports.ts:2045-2065,2109-2138,1125-1146`, `featureFlags.ts:33`. *Effort:* M · *Risk:* Med · *PR:* "Server-derive signer/verifier identity + owner-scope signatures on the legacy path (or default the structured path on)."

**H2 — `TemplatesTab` defined inside the component → remounts every render → template search loses focus** ✅
*Desc:* `function TemplatesTab()` is declared inside the 5,724-line component and rendered `<TemplatesTab/>`; its identity is new each render, so React unmounts+remounts the subtree — including the search `<Input>` — on every parent render. Templates is the **default tab**, so its search box **loses focus after each keystroke** (correctness bug), and dozens–hundreds of buttons rebuild per render. *Files:* `RadiologyReportingWorkspace.tsx:3681,5297,3713`. *Effort:* S–M · *Risk:* Low–Med · *PR:* "Extract `TemplatesTab` to a module-level component (props: search, modalities, filtered, handlers)."

**H3 — Per-keystroke Copilot/quality recompute is undebounced; `observeReportText` + `computeQualityScore` each run twice** ✅ *(3 audits)*
*Desc:* `copilotContext`→`copilotReport` runs `analyzeCopilot` + 9 local modules synchronously on every keystroke (~15–20 full-text passes); `observeReportText` and `computeQualityScore` each execute **twice** (once in a memo, once inside `analyzeCopilot`). `useDebouncedValue` exists but is unused here. Also computes even when the Copilot is disabled. *Why:* input-latency risk that grows with report length on clinical hardware. *Files:* `RadiologyReportingWorkspace.tsx:1463,1599,1640-1692,3893-3901`, `copilotOrchestrator.ts:216,307`, `copilotModules.ts:52`. *Effort:* M · *Risk:* Med · *PR:* "Debounce the advisory analyses off the typing path; share one `quality`/`observations` computation; short-circuit when Copilot off."

**H4 — "Ask Copilot (AI)" is effectively non-functional — request field mismatch** ✅
*Desc:* `askCopilotAi` POSTs `{ promptText }` but the route destructures `{ prompt }`, so the structured `buildCopilotAiPrompt` output never reaches the server; the reply lacks the `DIFFERENTIAL:/MISSING:/…` prefixes the parser needs → ~0 items. The provider is also hardcoded `"gemini"`. A leaky, untyped `AiAsk`↔endpoint boundary the unit tests can't see. *Files:* `RadiologyReportingWorkspace.tsx:1706-1716`, `aiReporting.ts:462-534`, `copilotAiModule.ts:22-65`. *Effort:* Low · *Risk:* Low · *PR:* "Fix Copilot AI query param + introduce a typed `AiReportingQuery` contract; omit hardcoded provider."

**H5 — No child memoization → heavy DICOM viewer re-renders every keystroke** ✅
*Desc:* 0 `React.memo` / 0 `useCallback` in the workspace; `EmbeddedWadoViewer` (forwardRef, not memo) and `FindingsHighlightEditor` re-render on every `setRawFindings` though their props are unchanged. *Files:* `EmbeddedWadoViewer.tsx:73`, `RadiologyReportingWorkspace.tsx:4268`, `FindingsHighlightEditor.tsx:44`. *Effort:* M · *Risk:* Low · *PR:* "`memo` the always-mounted panels; stabilize their handler props."

**H6 — `transitioning` wedges permanently if the next study fails to load** ✅
*Desc:* `beginTransition` sets `transitioning=true`; the only reset (`markArrived`) is in an effect that bails `if (!entry) return`. If the new study's query errors, `entry` stays undefined → Next/Previous stay disabled and `canLeaveStudy` returns "blocked: already switching". Only escape is the hard Worklist button. *Files:* `RadiologyReportingWorkspace.tsx:1930-1944,4113-4123`, `useReportingWorkflow.ts:129-161`. *Effort:* S · *Risk:* Low · *PR:* "Clear `transitioning` on entry-query error / bounded timeout."

**H7 — Advisory-only foreign keys across core entities** ✅
*Desc:* `report_id`/`worklist_id` are 100% unconstrained integers, `study_id` 91%, `patient_id` 86% (24/131 schema files use `.references()`). A deliberate, documented "link-by-value" convention — but no referential integrity or cascades; orphan rows are silently allowed. *Files:* `patientReports.ts:26`, `radiologyWorklist.ts:14-15`, `dicomStudies.ts:21`, convention `reportFindingInstances.ts:12-19`. *Effort:* High · *Risk:* High · *PR:* "FK retrofit phase 1 (patient_id/report_id on hot tables) after orphan cleanup + live-DB diff." **Document as accepted-risk; do not blanket-migrate during PCPNDT/USG work.**

**H8 — "Send Report" (WhatsApp) reachable on unsigned drafts**
*Desc:* the Send button is disabled only on `!entry?.patientId` — no `reportStatus==="FINAL"`/signed gate — so a "your report is ready" patient notification can precede sign-off. *Files:* `RadiologyReportingWorkspace.tsx:5190-5198,3625-3644`. *Effort:* S · *Risk:* Low · *PR:* "Gate Send on a signed final report."

**H9 — Protocol / checklist / Copilot-dismissal / teaching-note state leaks across study switches** ✅
*Desc:* `resetWorkspaceState` omits `activeProtocol`, `checklistPercent`, `checklistRemaining`, `dismissedCoPilotIds`, and `teachingNotes` — so the next patient's Quality score, one-click normals, protocol dropdown, suppressed safety nudges, and teaching notes carry over from the previous study. *Files:* `RadiologyReportingWorkspace.tsx:1876-1916` (+ `1104-1106,1436-1441,4507-4512,1598-1603,645`). *Effort:* S · *Risk:* Low · *PR:* "Reset protocol/checklist/nudge/teaching state on study switch."

**H10 — Four hardcoded critical-keyword scanners with no shared source of truth** ✅
*Desc:* emergency-term lists are curated 4×: `criticalResults.ts:33` (client, ~45, negation-aware — added in MRI PR 3), `criticalFindingsAlert.ts:68` (server, ~10), `missedFindingDetector.ts:16` (client, per-modality), `radiologyReportAssembler.ts:471` (dead). The client nudge and server auto-flag can disagree on what's "critical". *Files:* as listed. *Effort:* M · *Risk:* Med · *PR:* "Single shared critical-term dictionary consumed by client + server." *(Honest note: MRI PR 3 reused the Copilot registry but did add a 4th term list; converging these is the right follow-up.)*

**H11 — `radiology_studies` (hottest table) missing indexes on its main join columns**
*Desc:* indexed on accession/status/date/priority but **not** `patientId`/`billId`/`orderId`/`testId`/`assignedRadiologistId` — "all studies for patient" / "my worklist" full-scan as data grows. *Files:* `radiology.ts:17-29,71-77`. *Effort:* Low · *Risk:* Low · *PR:* "Add hot-column indexes (after diffing the live DB — hand-SQL may already cover some)."

**H12 — Dead AI-copilot cluster (~68KB, 0 importers)** ✅
*Desc:* `RadiologyAICopilotPanel.tsx` has no importers (its host `RadiologyReportUnified` was deleted) and is the sole importer of `radiologyIntelligenceEngine.ts` (38KB) + `radiologyDifferentialEngine.ts` (20KB) + `radiologyFollowUpEngine.ts` (9.7KB) — all unreachable; their jobs are done by the live `copilotOrchestrator`/`reportValidator`/`structuredFindings`. *Effort:* S (delete as a 4-file unit) · *Risk:* Low · *PR:* "Remove dead RadiologyAICopilotPanel cluster."

**H13 — Dead multi-study combine engine `radiologyReportAssembler.ts` (26KB) + false-defaulted flag** ✅
*Desc:* `composeMultiStudy`/`assembleReportFromItems`/`detectCriticalFindings` have 0 importers; the live combine path is `radiologyMasterTemplates.assembleReport()` (used by `studyCombinations.ts`, MRI PR 4). A user-visible feature flag toggles nothing. *Files:* `radiologyReportAssembler.ts`, flag `staffSession.ts:283`. *Effort:* S · *Risk:* Low · *PR:* "Delete dead assembler + its flag."

**H14 — Three parallel voice/dictation systems in one workspace** ✅
*Desc:* canonical System A (`useVoiceSession` + grammar/safety/providers) runs **alongside** legacy System B (`useVoiceDictation` + `VoiceDictationButton`, still rendered at `:4528/4605/4642/4822`) plus a mock System C (`VoiceDictation.tsx`, simulated). ~1,000 LOC duplicate; two paths dictate Findings/Impression. *Effort:* L · *Risk:* Med · *PR:* "Route all dictation through System A; retire the button, mock page, and `voice-cleanup` route."

**H15 — ~9 overlapping template/findings stores + two master-template sources + `StructuredTemplate` defined 3×** ✅
*Desc:* hardcoded `radiologyMasterTemplates.ts` library vs DB `radiology_master_templates`/`structured_report_templates`/`report_templates`/`presentation_templates`/`quick_findings`/`snippets`/`smart_findings`/`ai_normal_report_templates` + the normalized `radiologyCatalog`; `MasterTemplate` defined 2× and `StructuredTemplate` 3× (drift risk). *Effort:* L · *Risk:* High · *PR:* "Converge on the DB catalog as the single template source behind `ff_radiology_catalog`."

**H16 — 4–5 report render/PDF producers** ✅
*Desc:* client `buildPreviewHtml` (stored verbatim as `htmlBody`), server `renderReportDocument` (letterhead/QR), server `renderStructuredReport` (dormant flag), client `renderEngine`, client jsPDF `reportPdfGenerator` (used by the older per-modality pages, not the workspace). Two emit a demographics header → drift; `buildPreviewHtml` stores trusted unescaped HTML (feeds C4). The unwired `ff_radiology_render_v2` is the acknowledged fix. *Effort:* L · *Risk:* High · *PR:* "Wire render_v2 as the single body producer; make jsPDF pages consume the server render."

**H17 — Giant files concentrate risk** ✅
*Desc:* `Settings.tsx` 9,538 · `RadiologyReportingWorkspace.tsx` 5,724 (buildPreviewHtml + dispatch + voice + copilot + USG all inline) · `pacsEnterprise.ts` 3,318 · `aiReporting.ts` 3,116 · `patient-reports.ts` 2,862. Merge contention, weak testability, hard onboarding. *Effort:* L · *Risk:* Med · *PR:* "Extract buildPreviewHtml, the voice adapter, and USG mode from the workspace; split Settings by domain." *(Coordinate to avoid USG-branch conflicts.)*

**H18 — Unauthenticated PHI files served from `/uploads`** ⚠️
*Desc:* `express.static("data/uploads")` with no auth — patient docs and scanned IDs/Aadhaar are protected only by a random filename; leaked URLs (referer/logs/WhatsApp) grant permanent unauthenticated access. *Files:* `app.ts:282-285`, `scans.ts:161`, `uploads.ts:100-109`. *Effort:* M · *Risk:* Med · *PR:* "Authenticated/tokenized download endpoint; retire the public /uploads mount."

**H19 — Copilot architecture is documented nowhere but code comments**
*Desc:* grepping all 312 `.md` finds no doc for `copilotOrchestrator`/`registerCopilotModule`/the `CopilotContext`→`CopilotItem` contract — the platform's headline feature is un-onboardable except by reading source; contributors will diverge from the (excellent) pattern. *Effort:* Low–Med · *Risk:* None · *PR:* "docs/architecture/COPILOT.md + a 20-line module-extension guide."

### 🟡 MEDIUM

**M1 — Finalize confirmation is a monolithic native `window.confirm`** — identity + validation + warnings + finalize-safety + unbilled note concatenated into one unscannable wall of text → trains reflexive "OK" on the most important safety gate. `RadiologyReportingWorkspace.tsx:3186-3213`. S/M · Med · *PR:* structured modal with grouped, highlighted blocking errors + explicit confirm for critical/uncommunicated findings.

**M2 — Non-idempotent finalize can duplicate the `patient_reports` row on partial failure** — create→sign→status-flip; if the status POST throws, the row is already created+signed but `reportStatus` stays DRAFT, so a retry creates a **duplicate**; `patient-reports` create isn't covered by the `/orders`+`/bills` idempotency. `radiologyReportLifecycle.ts:166-273`. M · Med · *PR:* server idempotency key on create, or make finalize resumable.

**M3 — Save not blocked after lock loss** — `isLocked` excludes `lockLost`; finalize is gated but `saveDraft` isn't, so after your heartbeat lapses and another radiologist reclaims, you can still overwrite the single per-study draft row (last-write-wins). `RadiologyReportingWorkspace.tsx:2444,3004-3009`. S · Low · *PR:* block/confirm Save on `lockLost`; add `updatedAt` optimistic concurrency.

**M4 — Two tabs, same study, same user → shared draft row + shared backup key thrash** — the lock can't distinguish same-user tabs; both write the same localStorage key and draft row. M · Low · *PR:* BroadcastChannel "open in another tab" advisory + tab nonce.

**M5 — Preview shows stale (last-saved) content while dirty** — the server-preview fetch depends on `[previewMode,draftId,linkedReportId,refreshToken]`, not editor content, so Preview shows the last *saved* doc with no "reflects last save" cue. `:2809-2822`. S · Low · *PR:* badge preview when dirty, or rebuild on open.

**M6 — `findingsMap` ↔ `rawFindings` dual stores never reconcile on mode toggle** — toggling `useStructured` doesn't migrate content; free-text typed in one mode is hidden after a toggle and can be finalized empty at the wrong moment. M · Med · *PR:* warn/merge on toggle-with-content.

**M7 — AI/Copilot calls have no timeout** — `askCopilotAi`/`aiImpressionMutation` rely on default fetch timeout; a hung provider spins until the socket dies (no report data at risk). S · Low · *PR:* AbortController + timeout.

**M8 — Two components named "Copilot" + prior-tab comparison overlap** — legacy `RadiologyCopilotPanel` (prior + ai tabs) vs new `CareCopilotPanel` (copilot tab); in the prior tab it overlaps `ComparisonPanel` above it. `:5254,5318-5342,5436`. Med · Med · *PR:* rename legacy → `PriorReportsPanel`; de-dup prior comparison.

**M9 — Three unmounted routers + a fully dead HL7 feature** — `reportDelivery.ts`, `hl7.ts`, `teleradiologyPortal.ts` never mounted (~36KB); `Hl7Settings.tsx` calls `/api/radiology/hl7/*` served by nothing → broken 404 admin page. S · Low · *PR:* delete unmounted routers; remove or fully wire HL7.

**M10 — Fragmented draft/amendment storage (5 draft + 3 amendment tables)** — `patient_reports`/`radiology_report_drafts`/`ai_reporting_drafts`/`sonographer_drafts`/`usg_report_drafts`; amendments in 3 tables; no single server finalize authority. L · High · *PR:* define canonical report/draft/amendment tables; migrate the rest (continue the `reportFindingInstances` "Strand A" consolidation).

**M11 — Legacy engine cluster alive only via the deprecated owner-only CommandCenter** — `radiologySmartEngine.ts` (44KB) + `NeuroPromptPanel` + `LocalAiPanel` reachable only through `@deprecated` `RadiologyCommandCenter`; a second structured-findings paradigm. M · Med · *PR:* retire CommandCenter + its exclusive engine/panels (~50KB).

**M12 — `radiologySmartFindings` route mounted but surfaced by no live page** — its only consumer is the dead `RadiologySmartFindingsPanel`; live-but-unsurfaced endpoint. S · Low · *PR:* delete route + panel together.

**M13 — Dead / unwired feature flags at scale** — ~19 client flags defined-but-never-read (incl. `showUnifiedReporting`, `showAiDraftPanel`, 11 `ff_radiology_*`); 12 server flags `wired:false`; two flags gate dead modules. M · Low · *PR:* prune unread flags; annotate the 12 unwired as roadmap-reserved.

**M14 — MRI-hardcoded modality gates block clean expansion** — literal `modalityMap={X-RAY,USG,MRI,CT}` (`:2348`), hardcoded template consts (8 MRI/2 CT/7 US, none MG/NM/PT/XR), MRI-only `mri_protocol_specs` with no CT/US analogue; the generic `radiologyCatalog`/`structuredReport`/`ff_radiology_modality_expand` path is unwired. L · Med · *PR:* wire the catalog; make modality map + templates + protocols DB-driven.

**M15 — ~70 duplicate docs + no entry point** — 5 docs in 3 identical copies, ~30 in 2, byte-identical `_from_*` clones; no root README, no docs index, 30 loose root `.md`. M · Low · *PR:* single-tree docs consolidation + root README + docs index + CI dead-link/dup-hash lint.

**M16 — 97MB `.SynologyWorkingDirectory` + 5MB `__super_admin_quarantine` (full app duplicate) tracked in git** — repo bloat, slow clones, a shadow copy that confuses grep and can be mistaken for live code. S · Low · *PR:* gitignore/remove from version control.

**M17 — SVG accepted in uploads with no content verification → stored XSS via direct navigation** — `SAFE_MIME_TYPES` includes `image/svg+xml`, MIME is client-declared, filename ext kept; a scripted SVG served inline same-origin executes on direct navigation. (Signature upload correctly forbids SVG; the general uploader doesn't.) Low · Low · *PR:* drop SVG / force attachment + verify magic bytes.

**M18 — Two parallel migration systems + journal drift** — managed `drizzle/` (snapshots only for 0000/0001/0006, synthetic timestamps) vs 64 hand-written `migrations/*.sql` with `z_`/`zz_` ordering hacks and recurring `*_schema_reconcile_*` — the reason TS schema and live DB can diverge. M · Med · *PR:* pick one system; regenerate a clean baseline (**defer** during PCPNDT/USG).

### 🟢 LOW *(condensed)*

- **L1** Pervasive 8–10px typography (smallest `text-[8px]`; 87× ≤10px in the workspace) — fatigue/legibility for a high-volume reader. *PR:* raise the floor to ~11–12px.
- **L2** Two hand-rolled modals (`StructuredFindingDialog`, `protocolReplacePrompt`) lack focus-trap/return; the protocol prompt has no Escape. *PR:* route through Radix Dialog.
- **L3** Right tabs aren't an ARIA tablist; some icon-only buttons unlabeled. *PR:* add roles + `aria-label`s.
- **L4** `muted-foreground` (~4.7:1) drops below AA on `muted/20` tinted tiles, often at 9–10px. *PR:* darken on tinted surfaces.
- **L5** Impression points need a mouse click between lines; Quick measurements use a blocking `window.prompt`. *PR:* Enter-adds-point; inline numeric entry.
- **L6** No in-workspace Amend action for finalized reports (amendment step dead-ends). *PR:* Amend spawns a new version via the lifecycle route.
- **L7** `previewHtml` rebuilt every keystroke even when the preview is hidden. *PR:* gate on `previewMode`.
- **L8** 296KB workspace route chunk — heavy tab panels statically imported. *PR:* `React.lazy` per-tab panels.
- **L9** `copilotPanelReport`/`copilotAlerts`/`RIGHT_TABS`/`dirty` rebuilt as fresh objects each render — blocks child memo. *PR:* memoize/hoist.
- **L10** Global keydown effect re-registers every render (no dep array). *PR:* handlers-in-refs, attach once.
- **L11** No server CSP (`app.ts:63`) — removes a strong XSS mitigation. *PR:* add CSP for report docs + SPA.
- **L12** Staff bearer token in `localStorage` — amplifies any XSS to takeover. *PR:* httpOnly cookie + CSRF (high effort).
- **L13** Public report token is bearer-only (no recipient binding) within 72h TTL. *PR:* optional OTP step-up; shorten TTL.
- **L14** Audit hash-chain is unkeyed (tamper-evident, not tamper-proof). *PR:* HMAC/external-anchor the chain head.
- **L15** Orphan modules (~90KB): `__preview_gen[_v3].ts`, `radiologyMeasurementLibrary.ts`, `radiologyQuickAddData.ts` (40KB), `useBridge.ts`, `OcrCapturePanel`, `RadiologyKnowledgePanel`, `IdCardScanPanel.tsx.bak`; dead `voice_dictation_logs` + `conversations`/`messages` schemas. *PR:* batch-delete after import re-check.
- **L16** Dead assembler `detectCriticalFindings`/`compareWithPrevious` name-collide with the live detectors (maintenance trap). *PR:* remove with H13.
- **L17** "Personal-style learning" is a misnomer — `copilotLearning.ts` only suppresses ignored ids. *PR:* relabel, or scope a real style model.
- **L18** Contradictory test counts across docs (164 vs 295 vs actual); stale point-in-time reports in active locations; broken doc index links. *PR:* single-source the count from `pnpm test`; archive reports.
- **L19** Non-constant-time `INTERNAL_API_KEY` compare; a few unescaped-but-currently-safe HTML interpolations (`img.src` data-URI, FormF bill number). *PR:* constant-time compare; escape defensively.
- **L20** `refetchOnWindowFocus:true` globally refetches active workspace queries on alt-tab (bounded by 5-min staleTime). *PR:* disable for heavy workspace queries or leave as-is.

---

## 5. Clean Areas (verified solid — do not "fix")

- **Copilot composition & registry** — genuine composition of existing engines; error-isolated `local|ai` plugin registry; 9 modules added with zero core edits; advisory-only enforced; store reuse (`radiology_copilot_logs`, `radiology_user_copilot_profiles`); 13 test files.
- **Finalize truthfulness** — structured-signed / legacy-fallback / saved-not-signed / unbilled all distinguished; never claims an unperformed sign.
- **Study lock** — visible claim, bounded heartbeat (TTL/3, floor 30s), stale-async dropping, server-expiry-authoritative, no auto-steal, release on safe navigation, never touches local text on loss.
- **Reliability (free-text)** — autosave + 30-snapshot history, `guardedLeave`/`canLeaveStudy` (pure+tested), `retryWithBackoff` transient-only, fetchApi backoff+jitter+onLine-wait, offline block, 401-rescue design with a scoped auth-path allowlist, two-layer wrong-patient defense, synchronous print-popup.
- **Security controls** — structured D5/D9 sign/verify (session identity, signer≠verifier both ways, content-hash gate, deny-list roles); 192-bit expiring status-gated public token; server-side RBAC with active-account re-check + idle timeout + super-admin gate; parameterized Drizzle / no user-controlled raw SQL; rate-limited bcrypt login; local-Ollama AI never executed; fail-closed internal routes; Bearer (not cookie) auth; pino secret redaction.
- **Performance infra** — every route `React.lazy`'d; deliberate vendor chunking keeps recharts/jsPDF/html2canvas off the workspace chunk; strong react-query discipline (shared caches, staleTime, no N+1); debounced local autosave; hidden tabs unmounted; a prior infinite-fetch loop already fixed.
- **Architecture discipline** — clean artifact boundaries; genuine finalize dedup (`radiologyReportLifecycle`); single-source modality helpers (`matchStudyRegion`, `usgModality`, `OBSTETRIC_USG_STUDY_PATTERN`); governed feature-flag registry (`wired`/`dependsOn`/`enableOrder` + validation) running a disciplined strangler-fig; verified distinct-not-duplicate systems (`abnormal_findings`, `anomaly_alerts`, `redeliveryObligations`, `structuredReport`); generic `modalities` DB table.
- **Workflow/state** — comprehensive `resetWorkspaceState` + once-per-study hydration guards prevent cross-patient text/selection bleed (except the specific leaks in H9/C2); nonce-based dirty baseline; Radix command palette (real focus trap); voice safety-classing ("voice alone never finalizes").
- **Docs where they live in code/contracts** — copilot/reporting header comments, `structuredReport/README.md`, `CARE_RADIOLOGY_BACKEND_V1_FREEZE.md`, `PROTECTED_FILES.md`, `HOW_TO_ADD_DB_MIGRATIONS.md`.

*Areas explicitly checked and found NOT to be problems:* `paletteItems`/`priorComparisonMetrics`/`serverDraftContent` are correctly not per-keystroke; no giant state context; the workspace `srcDoc` previews are XSS-safe; the "35-byte stub" routes are intentional USB-plugin stubs, not dead code; `critical_escalation_log` and `fetal_usg_critical_alerts` are legitimately distinct (not part of the triplication).

---

## 6. Future Roadmap (next ~6 months)

Sequenced to (a) not collide with the in-flight **USG PR B** and **PCPNDT** branches, (b) fix safety/data/security first, (c) *then* consolidate so new modalities land cleanly. Each phase is independently shippable.

**Phase 0 — Safety & data hotfixes (weeks 1–3, small & isolated).** The three lowest-risk, highest-value fixes: **(C1a)** fix the `/radiology` router mount order + add the missing critical-alert acknowledge endpoint; **(C2)** add `findingsMap` to the report snapshot + backup + rescue; **(H4)** fix the Copilot AI `promptText`→`prompt` param. Small diffs, high payoff — but coordinate the C2 change (touches the workspace) around the USG branch's merge window.

**Phase 1 — Security hardening (weeks 2–6, parallel, mostly server).** **(C3)** real OTP-gated public booking; **(C4/H1)** sanitize report HTML on write+render + strict CSP + server-derive signer/verifier identity; **(H18/M17)** authenticated file downloads + drop SVG uploads. Mostly outside the reporting-workspace file, so low USG-conflict risk.

**Phase 2 — Reporting correctness & performance (weeks 4–8).** **(H6)** `transitioning` deadlock; **(H9)** state-leak resets; **(H8)** gate Send on signed; **(M2/M3)** idempotent finalize + lock-gated save; **(H2/H3/H5)** `TemplatesTab` extraction + debounced advisory analyses + child memoization. *Do these after PR B merges to minimize workspace conflicts.*

**Phase 3 — Consolidation for expansion (weeks 6–14).** **(C1b/H10)** converge critical-finding tables + one shared critical-term dictionary; **(H15/H16/M10)** single template source (`ff_radiology_catalog`) + single render producer (`ff_radiology_render_v2`) + canonical draft/amendment tables; **(H14)** one voice system; dead-code sweep (H12/H13/M9/M11/M12/M16 — ~250KB + 97MB). This is the prerequisite for modality expansion and the natural home for USG's own templates once PR B settles.

**Phase 4 — Modality generalization (weeks 12–20).** **(M14)** wire `ff_radiology_modality_expand`; make the modality map + templates + protocol specs DB-driven off `radiologyCatalog`. Land **USG completion** and **Voluson automation** *on the generalized path* (not as more special-casing), then **CT** (the closest existing fit: 2 templates + shared protocol shape), then **Mammography / X-Ray** (need MG/XR vocab + BI-RADS structured fields), then **Nuclear/PET-CT**. **Knowledge Packs** = per-modality catalog seed bundles (findings/protocols/critical terms/checklists) loaded into the unified catalog — the clean unit of "add a modality".

**Continuous:** documentation (**H19** Copilot architecture doc + **M15** docs consolidation + CI dead-link/dup-hash lint); a11y/UX polish (L1–L5); DB index/FK phasing (**H11/H7**, live-DB-diffed, post-freeze); flag pruning (M13).

**Guardrails for every phase:** diff against the **live database** before any schema change (hand-SQL isn't round-tripped by Drizzle); keep the strangler-fig discipline (new path behind a `wired`/`dependsOn` flag, old path removed only after the flag defaults on); never blanket-migrate the advisory-FK convention during PCPNDT/USG work; and treat `RadiologyReportingWorkspace.tsx` / `patient-reports.ts` / `schema/*` as merge-hot — sequence edits around the USG/PCPNDT merge windows.

---

*Audit performed read-only; no repository files were modified. Scores are engineering judgments synthesized from six independent evidence-based sweeps and cross-checked against the MRI PR 1–5 implementation history. Every remediation is a recommended future PR, not a change applied here.*
