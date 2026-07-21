# CARE ERP Radiology AI Platform — Master Architecture Blueprint (v1)

> **The definitive long-term architecture for the AI layer of the CARE ERP Radiology
> Information System.** This is a *blueprint*, not code. It is the reference that all
> future coding agents and engineers must follow when building the AI-assisted radiology
> platform. It is deliberately opinionated and designed for a **10-year** horizon.

---

## The vision (one paragraph)

Every imaging study — MRI, CT, X-ray, USG, Doppler — should automatically receive an
**AI-generated structured provisional report *before* the radiologist opens it**. The
radiologist remains **fully and solely responsible** for approval and signature. The AI is
an **expert assistant, never the final authority**: it advises, grounds every finding in
verifiable evidence, and *never blocks, delays, or gates the human workflow*. On any AI
failure the platform silently degrades to the existing deterministic, human-driven
workflow — unchanged.

## What makes this blueprint different

This is **not a greenfield design**. CARE ERP already has a remarkably mature radiology
stack: a frozen "One Workspace / One Engine" **Reporting Platform**, a canonical
**Measurement Registry** (`lib/measurements`) with provenance-aware definitions, a
DB-backed **AI provider registry with task routing** (`lib/ai-providers`), a deterministic
**Quality Engine** (`lib/report-quality`), a 116 KB structured-report JSON spec, and ~140
Drizzle schema modules. The blueprint's job is therefore **consolidation and disciplined
extension**, not reinvention — impose a single canonical spine on subsystems that already
exist and have drifted, and add the missing AI-first machinery (gateway hardening,
processing pipeline, JSON-first generation, organ companions, feedback ledger, evidence
envelope) *on top of* what is there, honoring the existing **Platform Constitution**.

## The Platform Constitution (inherited, non-negotiable)

Every section of this blueprint slots into the seven principles that already govern the
Reporting Platform (`docs/reporting-platform/CARE_REPORTING_PLATFORM_ARCHITECTURE_V1.md`):

1. **One Workspace** · 2. **One Engine** · 3. **Content over Code** (clinical behaviour
lives in versioned registries / Knowledge Packs; engines only interpret) · 4. **Deterministic
Before AI** · 5. **AI Advises, Humans Decide** · 6. **Backward Compatibility** (no-delete;
strangler migrations) · 7. **Measure Before Building**.

---

## How to read this set

Start with **00** for the executive framing, then **01** and **19** — those three carry the
decisions. Read **02–05** for the structural spine (architecture, data model, gateway,
pipeline). The remaining files are the depth chapters for each capability.

| # | File | What it delivers |
|---|------|------------------|
| 00 | [`00-executive-summary.md`](00-executive-summary.md) | Vision, principles, "what exists vs what we add", headline decisions, C4 context diagram |
| 01 | [`01-current-state-and-simplification.md`](01-current-state-and-simplification.md) | Review of the existing workspace + a concrete **simplification / de-sprawl** plan *(Goal 1, Deliverable 16)* |
| 02 | [`02-enterprise-and-service-architecture.md`](02-enterprise-and-service-architecture.md) | **Enterprise, component & service** architecture; integration; scalability *(Deliverables 1, 2, 9; Goals 13, 14)* |
| 03 | [`03-canonical-data-model.md`](03-canonical-data-model.md) | The **Canonical Study Object**, ER model, database recommendations *(Deliverables 5, 7; Goal 1)* |
| 04 | [`04-ai-gateway.md`](04-ai-gateway.md) | The **AI Gateway** — provider abstraction, routing, contracts, resilience *(Goal 2)* |
| 05 | [`05-study-pipeline-and-dataflow.md`](05-study-pipeline-and-dataflow.md) | The **Study Processing Pipeline** state machine; **data-flow, AI-pipeline, sequence** diagrams *(Goal 3; Deliverables 3, 4, 6)* |
| 06 | [`06-ai-report-generation.md`](06-ai-report-generation.md) | **Structured-JSON-first** generation and JSON→canonical-engine conversion *(Goal 4)* |
| 07 | [`07-orchestration-and-night-processing.md`](07-orchestration-and-night-processing.md) | Background **queue, retries, GPU scheduling, priorities** (STAT/VIP/emergency) *(Goal 5)* |
| 08 | [`08-learning-and-feedback-system.md`](08-learning-and-feedback-system.md) | The **Feedback Ledger** — suggestion-vs-edit diffs, no auto-retrain *(Goal 6)* |
| 09 | [`09-organ-companions.md`](09-organ-companions.md) | The **Organ Companion** framework + the twelve companions *(Goal 7)* |
| 10 | [`10-prior-comparison-and-timeline.md`](10-prior-comparison-and-timeline.md) | **Prior comparison**, progression/regression/stable, timeline *(Goal 8)* |
| 11 | [`11-measurement-engine.md`](11-measurement-engine.md) | The canonical **Measurement Engine + provenance** *(Goal 9)* |
| 12 | [`12-explainability.md`](12-explainability.md) | The **Evidence Envelope** — confidence, evidence, images, measurements, heatmaps *(Goal 10)* |
| 13 | [`13-research-database.md`](13-research-database.md) | The **Research Data Mart** — registries, analytics, ML datasets *(Goal 11)* |
| 14 | [`14-safety-risk-and-failure-recovery.md`](14-safety-risk-and-failure-recovery.md) | **Safety** safeguards, **risk analysis**, **failure recovery** *(Goal 12; Deliverables 11, 12)* |
| 15 | [`15-security-model.md`](15-security-model.md) | The **security model** — PHI, authz, encryption, audit, model governance *(Deliverable 13)* |
| 16 | [`16-performance-and-scalability.md`](16-performance-and-scalability.md) | **Performance** recommendations + scaling single→multi-hospital→cloud/edge/hybrid *(Deliverable 14; Goal 13)* |
| 17 | [`17-api-and-folder-architecture.md`](17-api-and-folder-architecture.md) | **API architecture** + **folder / service structure** *(Deliverables 8, 10)* |
| 18 | [`18-roadmap.md`](18-roadmap.md) | The **3-year / 5-year / 10-year roadmap** *(Deliverable 15)* |
| 19 | [`19-critical-decisions-before-coding.md`](19-critical-decisions-before-coding.md) | **Decisions to lock BEFORE additional coding** — ADRs + sign-off checklist *(Deliverable 17)* |

### Deliverable → file cross-map

| Deliverable | Where |
|---|---|
| 1 Enterprise architecture diagram | 02 (§1), 00 (context) |
| 2 Component diagram | 02 (§2), 04, 17 |
| 3 Data-flow diagram | 05 (§4) |
| 4 AI-pipeline diagram | 05 (§5), 06 |
| 5 Canonical data model | 03 |
| 6 Sequence diagram | 05 (§6), 02, 04, 10, 12 |
| 7 Database recommendations | 03 (§7) |
| 8 Folder structure | 17 |
| 9 Service architecture | 02 |
| 10 API architecture | 17, 04 |
| 11 Risk analysis | 14 (Part B) |
| 12 Failure recovery | 14 (Part C) |
| 13 Security model | 15 |
| 14 Performance recommendations | 16 |
| 15 Future roadmap (3/5/10 yr) | 18 |
| 16 Simplify current architecture | 01 |
| 17 Critical decisions before coding | 19 |

---

## The canonical vocabulary (used verbatim across all 20 files)

| Term | Meaning |
|---|---|
| **Canonical Study Object** | The single logical study aggregate, identity-anchored on `studyInstanceUID` via a new `canonical_study` crosswalk reconciling `radiology_studies` (order/financial spine), `radiology_worklist` (PACS/queue spine) and `dicom_studies` (imaging-identity registry & UID uniqueness authority). Everything revolves around it. |
| **AI Gateway** | The hardened evolution of `lib/ai-providers`. The single entry point the ERP calls; the ERP never knows which model answered. |
| **Study Processing Pipeline** | The arrival → … → provisional-report state machine, driven by the existing `ai_job_queue` (Postgres `SKIP LOCKED`). |
| **Provisional Report** | The AI-generated **structured** draft (JSON-first). Never final; the radiologist approves. |
| **Organ Companion** | An independent, registered per-region AI module (the twelve: **Brain, Spine, Chest, Abdomen, Liver, Kidney, Prostate, Breast, OBGYN, Ultrasound, Doppler, Musculoskeletal**), each with its own templates, measurements, checklists, lexicon and rules — data, not a workspace fork. |
| **Feedback Ledger** | The structured diff store of AI-suggestion vs radiologist-edit. Feeds analytics and human-gated dataset curation; **never** silent auto-retraining. |
| **Evidence Envelope** | The explainability payload bound to every finding: confidence band, evidence anchors, key images (series/SOP/frame), measurements (with provenance), reasoning, and a reserved slot for future heatmaps. |
| **Research Data Mart** | The analytics/registry store, fed **only** by finalized, approved reports. |
| **Measurement Provenance** | Mandatory on every value: `seriesUid + sopUid + frameNumber + extractionMethod + confidence` (+ extractor version, timestamp). |

## The load-bearing invariants

- **AI never auto-signs, blocks, or delays the radiologist.** Degrade-to-deterministic always re-converges on human reading.
- **Deterministic before AI.** Nothing the platform can evaluate deterministically is guessed by a model.
- **No finding without an Evidence Envelope anchor.** Ungrounded findings are quarantined, never shown as confident.
- **Structured JSON first, prose derived.** Free text is only ever rendered *from* validated structured objects.
- **One AI seam.** All model calls go through the AI Gateway (`generateAiForTask`); direct provider calls are banned. One image path, one queue, one audit hash-chain.
- **Local-first PHI egress.** Images/PHI default to the on-prem Ollama/MedGemma node; cloud models are opt-in per policy.
- **Content over Code.** Clinical behaviour (companions, checklists, recommendations) lives in versioned registries, not branches in the engine.

---

## Status & provenance

- **Version:** 1 (initial master blueprint). Design-only; no implementation code is included.
- **Grounding:** authored against the actual codebase — real packages (`lib/ai-providers`,
  `lib/measurements`, `lib/report-quality`, `lib/db`), real tables (`ai_job_queue`,
  `radiology_studies`, `radiology_worklist`, `dicom_studies`, `radiology_ai_review_audits`,
  `aiModelRoutes`, `turnaround_times`, …), and the existing specs
  (`docs/STRUCTURED_REPORT_JSON_SPEC_v1.md`, the Reporting Platform architecture).
- **Diagrams:** Mermaid throughout (renders on GitHub) — flowchart, component, data-flow,
  AI-pipeline, sequence, ER, and state-machine diagrams.
- **Before you build:** read **19-critical-decisions-before-coding.md** and complete its
  sign-off checklist. Those decisions must be locked first; several are inputs to database
  migrations that cannot be cheaply reversed later.
