# 02 — Existing Documentation Audit (Claims vs. Reality)

*Audit-only document. As-of commit: `15ed9dfc`. Method: every document listed in the task was read; 26 named documents plus 8 additional highly-relevant files surfaced by a repo-wide keyword search were reviewed. Every claim in "Claims vs Reality" below was checked directly against source files, DB schema, routes, and `git log` — not against other documents.*

## The single most important structural finding

These documents fall into two eras separated by an explicit, self-documenting rewrite:

- A **June 5–24, 2026** cluster of audits/roadmaps describes a genuinely chaotic state — three competing "unified reporting page" candidates, a completely broken reporting workspace (500 errors on every load), and USG treated as a bolted-on "separate workflow."
- A **July 9–15, 2026** cluster (`CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`, `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md`, `docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md`, `R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md`) resolves that chaos: the workspace was fixed, one page (`RadiologyReportingWorkspace.tsx`) won, a backend was built and frozen, and — as of July 12 — USG/Doppler/OB was explicitly folded into that one canonical page. This is confirmed directly in current code, not just in the docs' own say-so (see Part 2).
- A **mid-July, still-in-progress** wave (commits `4bd80d2e` "Smart Findings engine" through `21f870ba` "CARE Copilot — unified advisory assistant panel", spanning PRs #71–#80 on the `claude/radiology-clinical-history-chips-j04t4b` branch) continued building on top of the July 9–12 architecture — Smart Findings, Structured Finding Assistant, unlimited Clinical History chips, a universal Ctrl+K Command Palette, and (as of this writing) a "CARE Copilot" advisory panel. **This wave has no dedicated status document yet** — it is documented only in commit messages. This audit is the first document to describe it in one place (see doc 03).

---

## Part 1 — Document-by-document findings

### A. Current, authoritative tier (July 9–15, 2026)

**`CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md`** (repo root, 2026-07-09) — the single highest-authority engineering document in the corpus. States explicitly that it **supersedes** the Master Design Spec, UX Review, AI Experience Spec, Knowledge Catalog, and Seed Spec "wherever they conflict." A 40-item numbered decision register (D-01…D-40) plus 15 chapters covering the as-built system. Key claims: `patient_reports.body` is the one authoritative signed record (D-19); server-side `feature_flags` table is the only sanctioned flag mechanism, legacy client `localStorage` flags are frozen (D-24); OCR is characterized as the primary automated USG measurement source in production because Voluson concept codes are discarded on ingest (nuanced — see Claims vs Reality #7); USG Thyroid/Neck is named as the forcing function for a not-yet-built TI-RADS classification engine; `/api/usg-reports/*` was, as of this doc, still the USG finalize surface pending migration into the Workspace sign pipeline (later addressed, partially, by R2.0).

**`CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`** (repo root, 2026-07-09) — "Status: Single authoritative design document." Explicitly **"Consolidates and supersedes"** the UX Review, AI Experience Spec, Knowledge Catalog, and Seed Spec (Parts 1–2, 7). Key USG claims: only two USG studies are in the v1 seeded catalog — USG Whole Abdomen (26 findings) and USG KUB — and USG Obstetric, Thyroid/Neck (TI-RADS), and Scrotum are explicitly **next-tranche, not yet built**, with obstetric USG requiring "its own document" since biometry tables/growth curves/anomaly checklists exceed this doc's scope. **This is the clearest single articulation anywhere in the corpus of the "shared reporting-core across modalities" answer** (§5, §6) — see Part 3.

**`docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md`** (2026-07-11) — an explicit freeze contract (BEND-1), **"Status: FROZEN."** A governance document naming the exact tables/routes making up "Backend v1" (structured report lifecycle D1–D9, workflow M1.x) and prohibiting schema redesign, a second/competing report lifecycle, a new renderer, or a duplicate catalog without an explicit "Backend v2" decision. Confirms structured-report lifecycle code (D1–D9) exists but every relevant feature flag (`ff_radiology_structured_core`, `ff_radiology_catalog`, `ff_radiology_structured_d1_draft`, `ff_radiology_structured_final`, `ff_radiology_structured_read`) defaults **OFF** — code-complete, not necessarily switched on.

**`R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md`** (repo root, 2026-07-12) — the document most directly relevant to this audit's question, and its claims are **directly confirmed in running code** (Part 2). "Folds ultrasound reporting into the ONE canonical Radiology Worklist → Reporting Workspace flow. No new report page... Backend V1 stays frozen. R2.0 is additive integration on top of it." States `RadiologyReportingWorkspace.tsx` "had zero USG mode concept before R2.0." Documents the `lib/usgModality.ts` normalizer, additive worklist fields, the 13-template USG catalog wired into the Templates tab, an `ObDashboardStrip` for obstetric studies, and a "Review & Map to Form F" PCPNDT action. Honest about gaps: `UsgReporting.tsx`/`UsgDopplerReporting.tsx`'s PCPNDT compliance-lock machinery was deliberately **not** ported into the canonical workspace this round; `usg_key_images` and `radiology_image_references` remain two overlapping stores; its own test environment "has no real PACS/Orthanc server, so OHIF/Weasis launch calls 404/400 in testing."

**`R1_2_TEMPLATE_ENGINE_IMPLEMENTATION.md`** and **`R1_3_IMAGE_PANEL_IMPLEMENTATION.md`** (both 2026-07-11) — modality-agnostic presentation-layer work that R2.0 explicitly reuses unmodified for USG. R1.2 built a versioned template engine (8 system templates); R1.3 built the reusable `ReportImagePanel.tsx` / `radiology_image_references` table that R2.0 says "needed no changes — already exactly what Key Images needs." Current and not superseded.

**`docs/STRUCTURED_REPORT_JSON_SPEC_v1.md`** — "Ticket D1 (design only)," revision 2, "frozen," 2026-07-09. One JSON schema and reference grammar used identically across MRI/CT/USG/Doppler. Explicitly a design doc, not shipped code. §11.4 flags obstetric USG as only schema-capable, not proven: "this revision adds the schema capability but does not ship a sixth worked obstetric example."

**`artifacts/api-server/src/lib/structuredReport/README.md`** — implements the first items of the D1 spec. Contains the single most unambiguous "not live yet" statement in the corpus: **"FOUNDATION ONLY. Nothing in the running product reads or writes `structured_json` yet. No route, migration, or UI depends on this module."** (Nuance in Claims vs Reality #8 — a *separate* wired-but-flagged-off path exists elsewhere.)

**`seeds/radiology/content-packs/v1/README.md`** — confirms only two USG content packs exist (`usg_abdomen.yaml`, 27 findings; `usg_kub.yaml`, 8 findings + 6 reused); no obstetric/thyroid/scrotum/Doppler-USG packs exist yet.

### B. Superseded design docs (explicit banners, consolidated 2026-07-09)

`RADIOLOGY_KNOWLEDGE_CATALOG.md`, `RADIOLOGY_KNOWLEDGE_SEED_SPEC.md`, `RADIOLOGY_WORKSTATION_UX_REVIEW.md`, `AI_RADIOLOGIST_EXPERIENCE_SPEC.md` (all repo root, 2026-07-09) — each carries an explicit banner: three say **"Superseded: consolidated into CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md... Retained for historical traceability."** The Seed Spec says **"Partially superseded"** — its data annex (Parts 3–6, the actual per-study seed data) remains the live, normative reference still cited by the seed content-pack README. These are the cleanest, most explicit supersession markers found anywhere in the corpus.

### C. June 2026 evidence-audit cluster (historical — describes a state since substantially rewritten)

`Antigravity/02_AUDITS/RADIOLOGY_PACS_EVIDENCE_AUDIT_JUNE_2026.md`, `RADIOLOGY_PRODUCTION_READINESS_AUDIT.md` (and its `SOP/RECOVERY/17_AUDITS/` duplicate), `RADIOLOGY_REALITY_AUDIT.md` — all dated June 6, 2026, all evidence-based (live SQL queries, HTTP status codes, screenshots). Mutually-corroborating cluster describing a genuinely broken system at that time: `/api/portal/settings` 500 errors due to `clinic_settings` schema drift cascading into an unusable reporting workspace ("She CANNOT report a single case"); a configured Voluson node blocked by an SSRF guard against private IPs; zero USG studies ever pulled; USG routes explicitly catalogued as "UNUSED (backend only)." **Stale relative to current state** — both the schema-drift bug and the SSRF gap were addressed by the July rewrite and a new `local-dicom-bridge` service respectively. Still valuable as ground-truth history.

`RADIOLOGY_AUDIT.md` (undated) and `RADIOLOGY_AUDIT_REPORT.md` (2026-06-05) — code-review-only (no runtime verification), and optimistic in ways the June 6 evidence cluster directly contradicts. `RADIOLOGY_AUDIT.md` calls `RadiologyReportingWorkspace` "already the unified workstation... already working" — the same page the June 6 audits show returning 500s. `RADIOLOGY_AUDIT_REPORT.md` instead nominates a *third* candidate, `RadiologyReportUnified.tsx`, which was later built, then deleted (see Claims vs Reality #2). Stale.

`Antigravity/01_ARCHITECTURE/Radiology_Architecture_Master.md` and `Radiology_Architecture_Master_from_docs.md` — **byte-for-byte identical** files (a documentation-hygiene finding on its own). Both nominate a *fourth* candidate, `RadiologyCommandCenter.tsx`. Current code shows that file is now owner-only legacy, not canonical. Stale.

`Antigravity/02_AUDITS/RADIOLOGY_KNOWLEDGE_BASE_AUDIT.md` (2026-06-24) — the most detailed and credible USG-content audit in the June cluster. Gives USG modality coverage as 45%, Doppler 15%, notes obstetric USG fields are "wedged as a sub-section" of the generic USG Abdomen builder. **Still largely accurate as of current codebase** — only USG Abdomen and USG KUB packs exist. One of the more durable June documents.

`Antigravity/02_AUDITS/VOICE_DICTATION_AUDIT_from_USG_DOPPLER.md` (2026-06-24) — confirms real voice-dictation wiring but flags an internal contradiction: its executive summary calls voice dictation "production-ready" while its own GAP-04 finding shows the "Record" button only sets a local state flag ("simulated" per code comment). Overclaims in its summary relative to its own body.

`Antigravity/02_AUDITS/PCPNDT_INTEGRATION_AUDIT_from_USG_DOPPLER.md` — a forward-looking design doc (not a status report) for linking obstetric USG to the regulatory Form F. Its named gaps should be independently re-verified before being treated as still-open.

### D. June 5 roadmap/changelog/inventory cluster (superseded, and internally contradictory even at the time)

`Antigravity/11_ROADMAP/RADIOLOGY_IMPLEMENTATION_ROADMAP_v2.md`, `Antigravity/12_CHANGELOG/RADIOLOGY_ACTION_PLAN.md`, `Antigravity/12_CHANGELOG/RADIOLOGY_MODULE_INVENTORY.md` — all 2026-06-05, all describing the (now-deleted) `RadiologyReportUnified.tsx` as the target page. These three same-day documents **contradict each other** (the Inventory claims "0 not implemented" while the Roadmap treats the same feature as not-yet-built) and both are contradicted by the codebase's own history. All superseded by the July 9–12 tier.

`docs/RADIOLOGY_V2_STATUS.md` (2026-07-03) — a narrower initiative than the June 5 cluster. **Now stale in a specific, checkable way**: reports "ONE Reading Room (RadiologistCockpit)" as ✅ Done, but current code shows `RadiologistCockpit` was **removed entirely** on 2026-07-15 — the "one reading room" is now `RadiologyReportingWorkspace.tsx`. A live example of a status doc going stale within the same audit window.

### E. USG-specific archive/roadmap cluster (undated, pre-June, superseded by R2.0's "audit-then-integrate" pass)

`Antigravity/Archive/USG_DOPPLER_MASTER_DOCUMENTATION.md`, `USG_IMPLEMENTATION_HISTORY.md`, `USG_PRODUCTION_CHECKLIST.md`, `Antigravity/11_ROADMAP/USG_ROADMAP.md`, `Antigravity/04_MODULE_DOCUMENTATION/USG_FEATURE_INDEX.md`, `Antigravity/03_WALKTHROUGHS/walkthrough_from_USG_DOPPLER.md` — a self-consistent family describing a USG-specific pipeline (Voluson push → Conquest → extraction → measurement engine → Pregnancy Dashboard → Sonologist Assistant → Form F). `USG_FEATURE_INDEX.md` marks all 10 rows "Complete," including tables/routes that **do not appear in the supposedly-exhaustive `RADIOLOGY_MODULE_INVENTORY.md`** from the same era — a real, checkable discrepancy, and direct verification confirms the Archive family's claims were the more accurate ones. Treat as historical background; superseded in framing (R2.0 kept `UsgReporting.tsx`/`UsgDopplerReporting.tsx` routed-but-legacy rather than deleting them, contrary to what these docs recommended), not necessarily wrong in every individual fact.

### F. Governance and supporting context

`PROTECTED_FILES.md` (repo root) — not a status document; a change-control boundary (🔴 Billing sign-off-required vs. 🟡 Radiology/PACS lower-risk vs. 🟢 Shared/Core treat-like-billing). Confirmed current and directly useful: radiology files (including `RadiologyReportingWorkspace.tsx`, `UsgWorklist.tsx`, `usgReports.ts`, `usgDoppler.ts`, `fetalUsgLevel4`) sit in the 🟡 tier — free to iterate on without sign-off — while anything touching the 🟢 shared list (`ai.ts`, `sync.ts`, `Layout.tsx`, `App.tsx`, `components/ui/*`) needs billing-grade caution.

`.agents/memory/phase-10-radiology.md` — a cheat-sheet for Organ Intelligence/AI Research features, not USG-specific.

`docs/archive/RADIOLOGY_OPERATIONS_DASHBOARD.md` — physically archived; its "Real Patient Validation" is an explicitly **simulated** pipeline test, and its file paths belong to a different, older repo layout. Unambiguously stale.

---

## Part 2 — Claims vs Reality: spot-checks

**1. CLAIM (`RADIOLOGY_AUDIT.md`, undated): "RadiologyReportingWorkspace is ALREADY the unified workstation... already working."**
**Verdict: PARTIALLY TRUE, now current but wasn't at time of claim.** The June 6 evidence audits show this exact page returning 500 errors on load at the time. Current `App.tsx` documents the resolution: *"M1.1 canonical workspace consolidation (July 2026)... RadiologyReportingWorkspace is THE canonical radiology reporting page."* True now, for reasons the original claim didn't anticipate.

**2. CLAIM (three separate June docs, independently): the "one true unified reporting page" is `RadiologyCommandCenter.tsx` / `RadiologyReportUnified.tsx` / `RadiologyReportingWorkspace.tsx`.**
**Verdict: FALSE for two of three, CONFIRMED for one.** `RadiologyReportUnified.tsx` no longer exists (an in-code comment: *"The dead RadiologyReportUnified page (resurrected by the V2 merge) was removed again."*). `RadiologyCommandCenter.tsx` still exists but is owner-only legacy. `RadiologyReportingWorkspace.tsx` is the sole canonical page.

**3. CLAIM (`R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md`, 2026-07-12): USG mode is folded directly into the canonical workspace, no separate USG reporting workflow.**
**Verdict: CONFIRMED.** `RadiologyReportingWorkspace.tsx` carries the identical comment and imports `UsgMeasurementReviewPanel`, `isUltrasoundModality`; gates a USG measurement-insert handler; fetches a USG template catalog when `isUltrasound` is true; reads obstetric prefill data from a fetal-USG dashboard endpoint. `RadiologyWorklist.tsx` independently confirms via `usgMeasurementCount`/`usgKeyImageCount`/`usgReportStatus` columns.

**4. CLAIM (multiple docs): a USG reporting workspace exists and is reachable, with routes at `/usg/reporting`, `/usg/doppler`, etc.**
**Verdict: CONFIRMED, but nuanced.** These are real, substantial pages, not stubs — but per R2.0's own audit table they are now classified "Legacy, preserved," deliberately not merged this round because their PCPNDT compliance-lock machinery is materially more advanced than the generic report lifecycle. Two parallel, both-real USG reporting surfaces coexist by design, not oversight.

**5. CLAIM (multiple docs): obstetric/Doppler/TVS USG study types have working templates.**
**Verdict: CONFIRMED for a lightweight practical template catalog; the doc claims of a "dedicated structured builder" are still a genuine gap.** `usgReportTemplates.ts` defines a real 13-template catalog including OB Early/Growth/Anomaly, Pelvis Female (TV/TA), Arterial/Venous/Carotid Doppler, wired into the canonical workspace. But no dedicated structured content-pack (severity/parameter-bound YAML) exists for obstetric/Doppler/thyroid USG — only Whole Abdomen and KUB.

**6. CLAIM (June 6 audits): Voluson USG DICOM integration is configured but non-functional (SSRF-blocked, 0 studies pulled).**
**Verdict: CONFIRMED as of June, with evidence the connectivity gap has since been engineered around.** A dedicated `artifacts/local-dicom-bridge/` service now exists specifically to run inside the clinic LAN and reach the Voluson's private IP — a direct engineering response to exactly this gap, though this audit did not verify the bridge is actually deployed/running in production.

**7. CLAIM (`CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md`, 2026-07-09): "DICOM SR is explicitly not today's automated measurement source... OCR is the primary automated measurement source."**
**Verdict: PARTIALLY TRUE / contradicted by code capability.** `usgExtractor.ts` contains a real DICOM SR parser with an explicit merge-priority comment: `"Priority: DICOM SR (high) > GE Private Tags (high) > OCR (medium/low)"` — the code gives SR top priority, not OCR. The `usg_measurements.source` column defaults to `"ocr"`, consistent with the Guide's framing only if the Voluson isn't sending true SR objects in practice — plausible given finding #6, but not independently confirmable for current production traffic from this audit. Treat as an accurate characterization of *operational reality*, an overstatement of *code capability*.

**8. CLAIM (`structuredReport/README.md`): "Nothing in the running product reads or writes `structured_json` yet."**
**Verdict: CONFIRMED for this specific module, but the picture is more nuanced repo-wide.** This module is genuinely unwired. However, a **separate, already-wired D1 write path exists** in `radiology-report-generator.ts`, writing to `radiology_report_drafts.structured_json_d1` — gated behind `ff_radiology_structured_core` (default OFF). Two parallel "structured JSON" efforts exist: one truly unwired, one wired-but-flag-gated-off. Neither is live for an ordinary user with default settings, but they shouldn't be conflated.

**9. CLAIM (`docs/RADIOLOGY_V2_STATUS.md`, 2026-07-03): Phase D "ONE Reading Room (RadiologistCockpit)" — ✅ Done.**
**Verdict: STALE.** `git log` shows a 2026-07-15 commit "Radiology: remove the deprecated RadiologistCockpit page"; current `App.tsx` confirms Cockpit's features were ported into the canonical Workspace and old links redirect there. The doc's July 3 "done" state is now factually wrong about which page is "the" reading room.

**10. CLAIM (`RADIOLOGY_MODULE_INVENTORY.md`, 2026-06-05): "Total Database Tables: 63... Not Yet Implemented: 0."**
**Verdict: FALSE.** Direct schema search finds tables this "exhaustive" inventory omits entirely but that genuinely exist and are wired to live routes: all seven `fetal_usg_*` tables, `usg_audit_log`, `radiology_memory_phrases`, plus routes `/api/fetal-usg-dashboard/*` and `/api/radiology-copilot/sonologist-assistant`. A supposedly-exhaustive inventory missing this much real, routed content should not be trusted as complete even for its own stated date.

**11. CLAIM (multiple docs, implicitly; `PROTECTED_FILES.md` explicitly): USG/PACS/DICOM code carries lower change-control risk than billing.**
**Verdict: CONFIRMED as current governance policy** — directly relevant operational guidance for a new USG Reporting Workspace: it can be iterated on freely, but anything touching the 🟢 shared tier needs billing-grade caution.

**12. CLAIM (`RADIOLOGY_KNOWLEDGE_CATALOG.md` / Master Design Spec): the clinical knowledge catalog's shared libraries (parameters, severities, recommendations, critical registry) are bound identically by every study pack, USG included.**
**Verdict: CONFIRMED.** The content-pack README documents the load order and a "fail loudly on unresolved reference" rule, and cites a concrete fix already applied to the USG pack specifically to satisfy this rule — real evidence the mechanism is enforced against USG content, not just described.

---

## Part 3 — Does prior work already answer "shared reporting-core across modalities"?

**Yes — decisively, and repeatedly, across the current-tier documents.** This is not a question this audit needs to re-derive from scratch; it has been answered in writing at least four times by different documents in the July 9–12 tier, and the answer is architecturally consistent with what's actually in the code:

- **`CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`** §5/§6: one clinical knowledge catalog — shared parameter/severity/laterality/location/measurement/recommendation/critical-registry/normal-template libraries, referenced by key — powers Quick Select, structured reporting, the AI Copilot, search, the impression builder, and analytics, identically for MRI, CT, USG, Doppler, mammography, X-ray, and Echo. Principle: "Reference, never copy."
- **`docs/STRUCTURED_REPORT_JSON_SPEC_v1.md`**: one JSON schema and reference grammar for the structured report document itself, proven against five worked examples spanning MRI Brain, LS Spine, Cervical Spine, USG Abdomen, and Doppler Carotid — designed and tested to generalize across modalities from day one.
- **`R1_2_TEMPLATE_ENGINE_IMPLEMENTATION.md`** / **`R1_3_IMAGE_PANEL_IMPLEMENTATION.md`**: one presentation renderer, one template-versioning engine, one image panel component — reused unmodified by every modality.
- **`docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md`** §4: this shared-core decision is now *enforced by governance* — explicitly prohibits a second/competing report lifecycle or a duplicate catalog without a formal Backend v2 decision.
- **`R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md`** is the concrete proof this architecture was actually exercised for USG specifically: its Phase 1 audit table classifies almost every piece of the pre-existing USG surface as **"Reuse"** or **"Integrate"** into the shared stack, not "replace" or "build new."
- The most recent commit found (`21f870ba`, "CARE Copilot — unified advisory assistant panel"), by its own message, is built "by ORCHESTRATING the engines that already exist, not adding a new one" — the same discipline continuing into the very latest work.

**Practical implication for a new USG Reporting Workspace project**: the architectural decision has already been made and substantially executed — don't re-litigate "one engine vs. per-modality engines." The genuinely-unsolved gaps (confirmed by direct code + doc cross-check) are narrower: (1) no dedicated structured content-pack for obstetric/Doppler/thyroid USG; (2) the two legacy USG report pages still carry PCPNDT compliance/locking logic deliberately not ported into the canonical workspace; (3) the D1 structured-JSON pipeline is code-complete but flag-gated off by default; (4) real Voluson DICOM SR ingestion remains unproven in this clinic's actual environment.

---

## Part 4 — Which documents to treat as authoritative vs. archived

**Current/authoritative, in precedence order:**
1. `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md` (top authority for engineering)
2. `docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md` (governs what can/can't change in the frozen backend)
3. `R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md` (most current specifically on USG integration)
4. `CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md` (top authority for design/UX/content conventions)
5. `R1_2_TEMPLATE_ENGINE_IMPLEMENTATION.md` / `R1_3_IMAGE_PANEL_IMPLEMENTATION.md` (current presentation-layer record)
6. `docs/STRUCTURED_REPORT_JSON_SPEC_v1.md` + `structuredReport/README.md` (current but explicitly foundation-only — read together)
7. `seeds/radiology/content-packs/v1/README.md` (current content inventory)
8. `PROTECTED_FILES.md` (current governance boundary)
9. **This audit's own doc 03** (`03-mri-reporting-architecture.md`), which is now the only document describing the mid-July Smart Findings / Structured Finding Assistant / Command Palette / CARE Copilot wave — treat it as the current record until a proper status doc is written for that wave.

**Explicitly superseded (say so if cited):** `RADIOLOGY_KNOWLEDGE_CATALOG.md`, `RADIOLOGY_KNOWLEDGE_SEED_SPEC.md` (Parts 1–2/7 only — Parts 3–6 still live), `RADIOLOGY_WORKSTATION_UX_REVIEW.md`, `AI_RADIOLOGIST_EXPERIENCE_SPEC.md`.

**Historical/stale — useful for narrative context only, not "what exists today":** the entire June 5–24, 2026 cluster, the July 3 `docs/RADIOLOGY_V2_STATUS.md`, everything in `Antigravity/Archive/`, and the pre-June USG-specific family. None are individually worthless — several (especially `RADIOLOGY_KNOWLEDGE_BASE_AUDIT.md` and the three June-6 evidence audits) contain specific, well-sourced findings that are still true today — but none should be read as describing present-day system state without cross-checking against the July 9–15 documents and the code itself.
