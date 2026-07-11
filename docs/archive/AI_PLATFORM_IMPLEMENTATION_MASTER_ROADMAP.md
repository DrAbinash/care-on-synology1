# AI Platform Implementation — Master Roadmap

**Status:** Final planning-phase document. References `01_CURRENT_ARCHITECTURE_AUDIT.md`, `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`, `03_AI_RECEPTIONIST_IMPLEMENTATION_BLUEPRINT.md`, `04_AI_RECEPTIONIST_OPERATIONAL_DESIGN.md`, `CARE_DIAGNOSTICS_AI_MASTER_VISION_2035.md`, and `LABORATORY_MODULE_CORRECTION_AND_ENHANCEMENT.md` as Version 1.0 reference architecture. **Does not redesign, rewrite, or contradict any of them.** No code, migrations, routes, or APIs are created by this document.
**Scope discipline:** Care Diagnostics is a diagnostic centre. This roadmap excludes ICU, OT, IPD, pharmacy, ward management, nursing, bed management, and hospital EMR, for the same reason the Master Vision document gave — these are not this business.

---

## How to Read This Document

This is the longest of eight documents in this deliverable. The companion documents (`MASTER_PRODUCT_BACKLOG.md`, `MASTER_ENGINEERING_KANBAN.md`, `MASTER_RELEASE_PLAN.md`, `IMPLEMENTATION_CHECKLIST.md`, `PROJECT_RISK_REGISTER.md`, `QUICK_WINS.md`, `EXECUTIVE_SUMMARY.md`) each extract one operational view from what's designed here, rather than repeating it — read this document for the *reasoning*, the companions for the *working artifacts* a team actually uses sprint to sprint.

Every citation to a prior document uses its short form (`01_`, `02_`, `03_`, `04_`, `MV` for Master Vision, `LAB` for the Laboratory correction) and a section reference, so a claim here can be traced to its source rather than taken on faith.

---

# SECTION 1 — Platform Maturity Review

## 1.1 The Numbers, Carried Forward Unchanged

This roadmap does not recalculate maturity — it inherits the figures already established, because recalculating them without new evidence would be exactly the kind of unjustified precision `MV` §7.3 and §14.9 warned against.

| Maturity dimension | Figure | Source |
|---|---|---|
| Infrastructure (ERP's underlying AI-readiness) | ~70% | `02_` component audit, restated `MV` §14.1 |
| Digital (the ERP as a digital system, independent of AI) | ~65-70% | `MV` §14.10 |
| AI (blended infrastructure/operational/strategic) | ~25-30% | `MV` §14.9 |
| Operational (organization's readiness to run AI day to day) | ~10-15% | `04_` §12.8 |
| Innovation (appetite vs. execution capability) | ~40-45% | `MV` §14.11 |

## 1.2 Component-Level Detail (from `02_`)

| Component | Readiness | What's missing |
|---|---|---|
| Patient Registration | 85% | AI-driven introduction/onboarding only |
| Booking | 90% | Conversational wrapper around an otherwise-complete flow |
| WhatsApp | 75% | AI hooks defined in schema, not yet wired to conversation logic |
| Voice | 20% | Schema exists; no service integration |
| Knowledge Base | 30% | RAG tables exist; no indexing/retrieval logic built |
| Queue | 60% | Token system works; no AI wait-time estimation or proactive notification |
| Reports | 75% | Delivery mechanism mature; no AI-generated summaries |
| Portal | 70% | Data access complete; no AI guidance layer |
| Email | 85% | Service mature; needs AI-specific patient templates |
| SMS | 10% | Schema ready; no provider wired |
| Human Handoff | 65% | Staff auth/permission model exists; no queue-assignment logic |

## 1.3 Architecture Maturity

`03_`'s entire blueprint exists because architecture maturity was, at the time of that document, **zero for the AI-specific layer** (ERP API Gateway, Conversation Manager, Provider Manager, Human Handoff) despite substantial maturity in the layer beneath it (the eleven components above). `03_` brought architecture maturity to **fully designed, not yet built** — every Epic in Section 2 below that touches the AI Receptionist inherits a complete architectural specification, which is a materially different starting position than most of this roadmap's other Epics (Business Intelligence, Marketing AI), which have strategic framing (`MV`) but no architectural blueprint comparable to `03_`'s depth yet.

## 1.4 Operational Maturity — The Gate, Not Just a Number

`04_` §12.8's figure (~10-15%) is restated here with its full implication intact: this is not a soft caveat, it is **the primary blocker** on Milestone 1 (Section 6). `04_` §12.2's gap list — no Knowledge Base content authored, no assigned content owners, unresolved security findings, no Super Admin redundancy, no vendor selected — is reproduced in full in `IMPLEMENTATION_CHECKLIST.md` as literal go/no-go items, not narrative concerns a team might read past.

## 1.5 Business Maturity

Distinct from operational maturity: business maturity asks whether the *organization's processes* (not the AI program specifically) are ready to be measured and improved by AI tooling. Per `MV` §14.1's third tier ("strategic maturity"), this is genuinely uneven — Radiology has two decades of structured schema investment to build on (`MV` §4.1); Marketing and most of Business Intelligence have none (`MV` §7.1, §9.1). This roadmap's Epic sequencing (Section 2) reflects that unevenness rather than treating all domains as equally ready.

## 1.6 Readiness for Implementation — The Honest Verdict

**Ready, with one hard gate.** Engineering work on Milestone 1 (Foundation — `03_` Phase 1, restated Section 6 below) can begin immediately; it touches no patient-facing surface and has no operational-readiness dependency. Every milestone after it that exposes a channel to real patients is gated on `04_` §12.2's checklist clearing first. This is the single most important sentence in this Section, and it is restated at the start of Section 6 so it cannot be missed by a reader who skips ahead.

---

# SECTION 2 — Epics

## 2.1 Method

The brief's example list (Knowledge Engine, AI Receptionist, WhatsApp AI, Website Assistant, Reception Command Center, Management Dashboard, Business Intelligence, Radiology AI Enhancement, Laboratory AI Enhancement, Patient Health Passport, Diagnostic Timeline, Marketing Intelligence, Quality Intelligence, Customer Relationship AI, Corporate Diagnostics, Home Collection AI, Administration Intelligence) is reviewed below — kept, merged, split, or added to, with the reasoning shown, per the brief's explicit instruction to "review and improve," not transcribe.

## 2.2 Changes Made to the Brief's List, and Why

- **"AI Receptionist" is split into its constituent `03_` Deliverable 10 phases rather than kept as one Epic.** A single "AI Receptionist" Epic spanning Foundation through Internal Staff Assistant would be too large to estimate, prioritize, or release independently — `03_` already broke this into 11 phases with their own dependencies/risk/rollback; this roadmap's Epics 2-6 below map 1:1 to phase groups from that document rather than re-bundling them.
- **"WhatsApp AI" is absorbed into the AI Receptionist Epics** (specifically Epic 4) rather than kept separate, since `03_` Phase 4 already *is* WhatsApp AI — a separate Epic would create exactly the duplicate-workflow risk this entire program is built to avoid.
- **"Website Assistant" is kept as its own Epic** (Epic 6) because `03_` Phase 6 treats it as architecturally distinct enough (different Gateway, different UX constraints) to warrant separate planning, even though it reuses the Conversation Manager core.
- **"Patient Health Passport" and "Diagnostic Timeline" are merged into one Epic** (Epic 13). Both describe the same underlying capability — a longitudinal, AI-assisted view of a patient's testing history — viewed from two angles (patient-facing "passport" vs. internally-useful "timeline"). Keeping them separate risks building two views of the same data, which is the duplicate-workflow risk this program exists to prevent; one Epic with two interface surfaces is the correct shape.
- **"Laboratory AI Enhancement" is re-scoped** per `LAB`'s correction — split into a near-term, low-effort sub-scope (turnaround tracking, critical-value flagging — `LAB` items 1-2) and a longer-term sub-scope (AI-specific schema layer — `LAB` item 4), rather than one undifferentiated Epic, because `LAB` demonstrated these have wildly different effort/risk profiles that a single Epic would obscure.
- **Two Epics are added that the brief's list omitted:** *Internal Staff Assistant* (`03_` Phase 11 / `04_` Section 5 — already fully designed in prior documents, and too significant to leave implicit inside "Administration Intelligence") and *Business Continuity & Security Hardening* (`03_` §8.17, `04_` Section 8 — not a feature Epic in the traditional sense, but the brief's own Section 10 requires a Technical Debt Review, and the unresolved CRITICAL security findings are significant enough to warrant Epic-level tracking rather than being buried in a risk register alone).
- **"Corporate Diagnostics" is kept but explicitly marked lower-confidence** than other Epics, per `04_` §3.13 and `MV` §12.7's shared finding that no Corporate Desk workflow has been confirmed to exist in the current ERP — this Epic's first Feature (Section 4) is a scoping/discovery task, not a build task.

## 2.3 The Epic List

| # | Epic | Status relative to prior docs |
|---|---|---|
| 1 | Knowledge Engine | `03_` Deliverable 5 / `04_` Section 6 designed; `MV` Section 11 extended scope to staff-facing content — not yet built |
| 2 | AI Receptionist Foundation & Internal APIs | `03_` Phases 1-2 — architecturally complete, not yet built |
| 3 | WhatsApp AI | `03_` Phase 4 — architecturally complete, not yet built |
| 4 | Voice AI | `03_` Phase 5 — architecturally complete, not yet built |
| 5 | Website Assistant | `03_` Phase 6 — architecturally complete, not yet built |
| 6 | Reception Command Center | `04_` Section 1 — designed, not yet built |
| 7 | AI Operations Center (Administration) | `04_` Section 2 — designed, not yet built |
| 8 | Queue Integration & Payments/Report Hardening | `03_` Phases 7-9 — architecturally complete, not yet built |
| 9 | Follow-up Automation & Customer Relationship AI | `03_` Phase 10 / `MV` Section 8 — partially designed, partially new ground |
| 10 | Internal Staff Assistant | `03_` Phase 11 / `04_` Section 5 — architecturally complete, not yet built |
| 11 | Management Dashboard & Business Intelligence | `MV` Sections 6-7 — strategic framing only, new ground |
| 12 | Radiology AI Enhancement | `MV` Section 4 — substantial existing schema (~20 tables per `02_`), strategic direction only, no implementation blueprint yet |
| 13 | Laboratory AI Enhancement | `LAB`-corrected — operational core mature; near-term TAT/critical-value sub-scope low-effort; AI-schema sub-scope new ground |
| 14 | Patient Health Passport / Diagnostic Timeline | New ground — synthesizes `MV` Section 3's journey design with longitudinal data not yet structured for this purpose |
| 15 | Marketing Intelligence | `MV` Section 9 — entirely new ground, no prior schema |
| 16 | Quality Intelligence | `MV` Section 10 — partial grounding (`aiQualityScores`, `radiologyAiReviewAudits` exist), mostly new ground |
| 17 | Corporate Diagnostics | Unconfirmed workflow — scoping required before build, per `04_` §3.13 |
| 18 | Home Collection AI | `04_` §3.7/§10.9 — existing service line confirmed, AI layer is new ground |
| 19 | Administration Intelligence | Distinct from Epic 7 — this is *analytics about* administration (e.g. settings-change audit trends), not the AI Operations Center control surface itself; kept separate to avoid conflating "the screen admins use" with "insight about how admins use it" |
| 20 | Business Continuity & Security Hardening | `03_` §8.17/`04_` Section 8 — not a feature Epic; tracked because it gates every externally-facing Epic above |

This is a deliberately longer list than the brief's example — 20 Epics rather than ~17 — because splitting (#2-#10 from a single "AI Receptionist" bucket) produces more Epics even as it produces *less* ambiguity per Epic, which is the more important property for a backlog a new engineering team needs to execute without re-deriving scope boundaries themselves.

---

# SECTION 3 — Epic Detail

Each Epic below: Objective, Business Value, Users, Dependencies, Complexity (Low/Medium/High/Very High, relative within this program), Risk, Priority (Must/Should/Could/Future — defined fully in Section 8), Success Criteria, Rollback Strategy, Expected ROI (quantified only where prior documents already permit it; otherwise stated as not quantifiable yet, with the reason, consistent with this program's established discipline).

## Epic 1 — Knowledge Engine

- Objective: Build the centralized, staff-editable content store designed in `03_` Deliverable 5 and `04_` Section 6, extended in scope by `MV` Section 11 to cover staff-facing SOPs alongside patient-facing content.
- Business Value: Every other Epic's output quality is gated on this Epic's content quality — this is infrastructure value, not a standalone feature's value.
- Users: Admin (content approval), department supervisors (content suggestion/ownership), every AI face as a consumer.
- Dependencies: None upstream — can begin immediately, in parallel with Epic 2.
- Complexity: Medium.
- Risk: Low technical risk; Medium-High content risk — clinical-authorship bandwidth is a genuine, not fully solvable, constraint per prior documents.
- Priority: Must Have.
- Success Criteria: `03_` Phase 3's minimum content checklist met before any patient-facing channel (Epic 3+) goes live.
- Rollback Strategy: Individual content entries are versioned and revertible; the service itself can be disabled, causing all AI faces to fall back to aggressive escalation, never to AI improvisation.
- Expected ROI: Not quantifiable in isolation — its ROI is inherited by every downstream Epic's success or failure.

## Epic 2 — AI Receptionist Foundation & Internal APIs

- Objective: `03_` Phases 1-2 — stand up the `ai_caller` credential/permission-matrix entry and the ERP API Gateway.
- Business Value: The load-bearing layer every patient-facing Epic depends on; no standalone patient-visible value.
- Users: Engineering only at this stage.
- Dependencies: None upstream.
- Complexity: High.
- Risk: Medium — the named risk is accidentally reimplementing existing logic instead of wrapping it, mitigated by the required code-review citation discipline.
- Priority: Must Have.
- Success Criteria: Every API category callable, idempotent where required, producing results indistinguishable from the equivalent existing staff/public action.
- Rollback Strategy: Per-API-category feature flags.
- Expected ROI: Not quantifiable directly; enables Epics 3-10's ROI.

## Epic 3 — WhatsApp AI

- Objective: `03_` Phase 4 — extend the existing `waChatbot.ts` skeleton into the full Conversation Manager + WhatsApp Gateway.
- Business Value: Highest near-term patient-facing value in this roadmap, per `02_`'s 75% WhatsApp readiness figure.
- Users: Patients (primary), Reception staff (Human Handoff recipients).
- Dependencies: Epics 1, 2.
- Complexity: High — first real Conversation Manager implementation, first real patient exposure.
- Risk: Medium — mitigated by a limited phone-number allowlist or low-traffic launch window.
- Priority: Must Have.
- Success Criteria: Flows 4.1-4.10 function correctly via WhatsApp; AI Resolution Rate and Conversion Rate tracked from day one.
- Rollback Strategy: `whatsapp_settings.ai_assistant_enabled` is the literal kill switch — instant revert to pre-project behavior.
- Expected ROI: Not quantifiable yet — this Epic generates the data needed to quantify it for everything downstream.

## Epic 4 — Voice AI

- Objective: `03_` Phase 5 — Voice Gateway, Telephony Provider interface, voice-specific Conversation Manager extensions.
- Business Value: High, but lower-confidence than WhatsApp given the 20% existing-readiness figure for Voice specifically.
- Users: Patients (primary).
- Dependencies: Epics 1, 2, 3.
- Complexity: Very High — real-time latency, no visual confirmation.
- Risk: Medium-High — the weakest-redundancy channel in the entire platform, no telephony-vendor failover designed yet.
- Priority: Should Have, sequenced behind WhatsApp's lower-risk proof point.
- Success Criteria: Dropped Call and Average Call Duration metrics within clinic-defined acceptable range.
- Rollback Strategy: Provider/PBX-level routing revert to direct-to-staff, independent of application code.
- Expected ROI: Not quantifiable yet.

## Epic 5 — Website Assistant

- Objective: `03_` Phase 6 — Web Chat Gateway, lower-risk than Voice given shared shape with WhatsApp.
- Business Value: Medium-High, incremental to WhatsApp.
- Users: Patients (website visitors specifically).
- Dependencies: Epics 1, 2, 3.
- Complexity: Medium.
- Risk: Low — closest channel to WhatsApp in shape.
- Priority: Should Have.
- Success Criteria: Equivalent resolution/conversion metrics to WhatsApp within a reasonable margin.
- Rollback Strategy: Widget removable from website without affecting any other channel.
- Expected ROI: Not quantifiable yet.

## Epic 6 — Reception Command Center

- Objective: `04_` Section 1 — the unified single-screen staff interface for live calls, WhatsApp, queue, handoffs, etc.
- Business Value: High — directly determines whether Epics 3-5's Human Handoff volume is sustainable for Reception staff.
- Users: Reception staff (primary), Supervisors.
- Dependencies: Epic 3 at minimum; ideally Epics 3-5 for full value.
- Complexity: Medium-High — new staff-facing UI surface, though specified as a new tab within the existing staff shell, not a new application.
- Risk: Low-Medium.
- Priority: Must Have — Epic 3 cannot safely run in production without this; Human Handoff has nowhere to surface without it.
- Success Criteria: Receptionist never needs to switch screens; Emergency/VIP items visually distinct and acknowledged.
- Rollback Strategy: Falls back to whatever staff process existed before, since it's additive to existing staff tools.
- Expected ROI: Not quantifiable directly; prevents a negative ROI outcome more than it generates a positive one independently.

## Epic 7 — AI Operations Center (Administration)

- Objective: `04_` Section 2 — the staff control surface for Prompt Management, Business Hours, Knowledge Base admin CRUD, Escalation Rules, Provider Selection, Cost/Budget Limits, Testing Sandbox, Version History/Rollback.
- Business Value: High — this is how the organization governs the AI without engineering involvement.
- Users: Admin, Super Admin.
- Dependencies: Epic 2.
- Complexity: Medium-High — includes four genuinely new sub-capabilities beyond the original architectural scope (Cost Limits, Version History/Rollback, Testing Sandbox, Conversation Policies).
- Risk: Low technical risk; misconfiguration risk is real but mitigated by permission tiering and the explicit safeguard that escalation cannot be silently disabled entirely.
- Priority: Must Have — Epic 3 cannot safely run without the Escalation Rules and kill switch this Epic provides.
- Success Criteria: Admins control the AI without editing code.
- Rollback Strategy: Individual setting categories revertible per Version History; this Epic itself has no meaningful rollback beyond disabling specific capabilities it controls.
- Expected ROI: Not quantifiable directly.

## Epic 8 — Queue Integration & Payments/Report Hardening

- Objective: `03_` Phases 7-9 combined — formalize Queue Adapter source-field usage across live channels; harden Payment API idempotency under real traffic; harden Report API privacy gates under real traffic.
- Business Value: High, and disproportionately about risk reduction rather than new capability.
- Users: Patients (indirectly, via reliability), Billing staff, Reception staff.
- Dependencies: Epics 2, 3 (needs real AI-originated traffic to harden against).
- Complexity: Medium — mostly hardening existing design, not new design.
- Risk: Medium-High specifically for the Payments sub-scope — duplicate-charge is named as the single highest-severity failure mode in the entire platform.
- Priority: Must Have — the Payments sub-scope specifically cannot be deferred once Epic 3 is live and processing real payments.
- Success Criteria: Zero duplicate-charge incidents across a defined observation window; no report delivered to an unverified identity across a defined observation window.
- Rollback Strategy: AI-originated payment initiation can be disabled per-channel while booking continues with pay-at-counter.
- Expected ROI: Risk-avoidance value, not revenue-generation value — measured in incidents prevented, not currency.

## Epic 9 — Follow-up Automation & Customer Relationship AI

- Objective: `03_` Phase 10 (appointment reminders, missed-call callback hardening, satisfaction prompts) combined with `MV` Section 8's broader CRM vision (birthday wishes, referral engagement, complaint handling, loyalty).
- Business Value: Medium near-term, higher long-term once patient history accumulates.
- Users: Patients, Marketing-responsible staff.
- Dependencies: Epics 1-3 stable in production (needs real patient interaction history).
- Complexity: Medium for the Phase 10 sub-scope; Medium-High for the fuller CRM sub-scope, which has less existing design depth.
- Risk: Low-Medium — notification fatigue/opt-out handling needs explicit, tested design, not an assumption.
- Priority: Should Have for the Phase 10 sub-scope; Could Have for the full CRM vision, with birthday wishes as an explicit exception (see `QUICK_WINS.md`).
- Success Criteria: Reminder send rate and opt-out rate both within clinic-acceptable ranges.
- Rollback Strategy: Outbound automation independently toggleable from inbound conversation handling.
- Expected ROI: Not quantifiable yet for the full CRM vision; the Phase 10 sub-scope's value is closer to measurable (reduced no-show rate) once live.

## Epic 10 — Internal Staff Assistant

- Objective: `03_` Phase 11 / `04_` Section 5 — staff-facing natural-language query interface, reusing the patient-facing engine's Provider Manager and Knowledge Base, authenticated via existing staff login.
- Business Value: Medium-High — internal productivity tool, lower external risk than any patient-facing Epic.
- Users: Reception, Billing, Radiology, Laboratory, Report Delivery, Doctors, Managers, Administrators.
- Dependencies: Epics 1, 2 minimum; benefits from Epics 3-8 having proven the core infrastructure with patients first.
- Complexity: Medium.
- Risk: Low — internal-only, no new external attack surface; primary risk is permission-boundary scope creep, mitigated by reusing the existing staff permission model unmodified.
- Priority: Should Have.
- Success Criteria: Zero permission-boundary violations found in testing; positive informal staff adoption feedback.
- Rollback Strategy: Standard internal-tool deprecation, no patient-facing impact.
- Expected ROI: Not quantifiable directly; qualitative staff-time-saved signal only.

## Epic 11 — Management Dashboard & Business Intelligence

- Objective: `MV` Sections 6-7 — the Director's morning dashboard and the analytical capability underneath it.
- Business Value: High long-term, contingent on data maturity — roughly half this Epic's items are High-maturity-today, half Low-maturity.
- Users: Director/Management, Admin.
- Dependencies: Epics 1-3 minimum for the High-maturity half; Epic 9 and real operating history for the Low-maturity half (forecasting, growth prediction).
- Complexity: Medium for the data-already-exists half; High for the forecasting half, which is time-dependent regardless of engineering effort.
- Risk: Low for the data-display half; Medium for the forecasting half — the risk being premature, confident-sounding but unreliable output.
- Priority: Should Have for the data-display half; Future for the forecasting half.
- Success Criteria: One screen, no folder of separate reports.
- Rollback Strategy: Display-only Epic; reverts to whatever reporting process existed before.
- Expected ROI: Not quantifiable yet for the forecasting half; the data-display half has a plausible but unmeasured efficiency value.

## Epic 12 — Radiology AI Enhancement

- Objective: `MV` Section 4 — worklist prioritization, template recommendation, quality-control flagging, study tracking, building on the ~20 existing AI-adjacent tables `02_` confirmed.
- Business Value: Potentially the highest-leverage clinical Epic in this roadmap, given the existing schema investment — but this document has not audited what each existing table currently does in practice.
- Users: Radiologists, Radiology technicians.
- Dependencies: None on other Epics directly — could proceed largely independently, since it builds on pre-existing schema rather than the new AI Receptionist infrastructure.
- Complexity: High — needs a dedicated deep audit, comparable to the Receptionist's core-file audit, before implementation-level planning, which this roadmap has not performed.
- Risk: Medium — clinical-adjacent, requires the "AI assists, radiologist decides" boundary already established as non-negotiable.
- Priority: Should Have — high potential value, blocked on a scoping/audit prerequisite this roadmap does not skip past.
- Success Criteria: Not yet definable at the detail this roadmap defines for other Epics, precisely because the prerequisite audit hasn't happened — see Epic 12's first Feature in Section 4, a discovery task.
- Rollback Strategy: Cannot be specified meaningfully before the scoping audit; deferred.
- Expected ROI: Not quantifiable, and not quantifiable even directionally without the prerequisite audit — audit-dependent, not just time-dependent.

## Epic 13 — Laboratory AI Enhancement

- Objective: Per `LAB`'s corrected scope — split into Epic 13a (turnaround-time tracking plus critical-value flagging, low effort, data largely already captured) and Epic 13b (AI-specific schema layer analogous to Radiology's, high effort, genuinely new ground).
- Business Value: 13a is immediate, low-cost, patient-safety-relevant. 13b is long-term, comparable in ambition to Epic 12 but starting from a thinner base.
- Users: Laboratory staff, Laboratory supervisors.
- Dependencies: 13a needs only confirmation of where result values live in the schema — itself the first task. 13b depends on a dedicated audit, same caveat as Epic 12.
- Complexity: 13a Low; 13b High.
- Risk: 13a Low, contingent on the result-value location being confirmed safe to read from. 13b Medium, same clinical-boundary caution as Epic 12.
- Priority: 13a Must Have, given its low cost relative to existing foundation. 13b Should Have, sequenced well behind 13a.
- Success Criteria: 13a — turnaround data genuinely trackable per sample, correcting the prior documented error. 13b — not yet definable, same reasoning as Epic 12.
- Rollback Strategy: 13a is purely additive read-side capability, no rollback risk beyond disabling the new dashboard view. 13b deferred.
- Expected ROI: 13a not quantified but plausible near-term. 13b not quantifiable, audit-dependent.

## Epic 14 — Patient Health Passport / Diagnostic Timeline

- Objective: A longitudinal, AI-assisted view of a patient's testing history — patient-facing (passport) and internally-useful (timeline) from the same underlying data.
- Business Value: Medium-High, primarily as an enabler of other Epics (9's CRM reminders, 11's BI retention analysis) rather than standalone value.
- Users: Patients (passport view), Doctors/Radiologists/Lab staff (timeline view).
- Dependencies: Epic 1, real accumulated patient visit history.
- Complexity: Medium — primarily a new read/aggregation view over existing tables, not new core data capture.
- Risk: Low-Medium — main risk is PII exposure if the passport view doesn't respect the same identity-verification gate every other patient-facing data view already requires.
- Priority: Could Have.
- Success Criteria: Not yet defined in any prior document — new ground, deferred to Features.
- Rollback Strategy: Read-only view; disabling it has no data-integrity implication.
- Expected ROI: Not quantifiable yet.

## Epic 15 — Marketing Intelligence

- Objective: `MV` Section 9 — AI-assisted content drafting, always human-approved before publishing.
- Business Value: Unconfirmed — entirely new ground with no prior schema or workflow audited anywhere.
- Users: Marketing-responsible staff.
- Dependencies: Epic 1.
- Complexity: Medium — mostly content-generation tooling with a mandatory human-review gate.
- Risk: Medium — reputational risk of unsupervised AI-generated public content, mitigated entirely by the mandatory-human-review constraint.
- Priority: Could Have.
- Success Criteria: Not yet defined, deferred to Features.
- Rollback Strategy: Disabling it reverts to fully-manual marketing content creation, the status quo.
- Expected ROI: Not quantifiable — Marketing ROI analysis is itself dependent on this Epic existing first, a circularity this roadmap does not resolve prematurely.

## Epic 16 — Quality Intelligence

- Objective: `MV` Section 10 — wait-time, turnaround, complaint-trend, machine-downtime-trend, and workflow-bottleneck analysis, illuminating processes without auto-correcting or judging individual staff.
- Business Value: Medium-High, growing as underlying data sources (Epics 6, 8, 13a) mature.
- Users: Supervisors, Admin, Management.
- Dependencies: Epics 6, 8, 13a — this Epic is a synthesis layer, not a primary data source.
- Complexity: Medium.
- Risk: Medium — staff-productivity metrics require careful framing (aggregate/process-level, never individual-judgment) to avoid misuse.
- Priority: Should Have.
- Success Criteria: Not yet defined, deferred to Features, since specific KPIs were left as a leadership decision rather than a prescription.
- Rollback Strategy: Display/analysis-only Epic; no data-integrity rollback risk.
- Expected ROI: Not quantifiable yet.

## Epic 17 — Corporate Diagnostics

- Objective: If Care Diagnostics operates or wants to operate a corporate-client desk, scope it before building AI on top of an unconfirmed workflow.
- Business Value: Unknown — contingent on whether this is a real, prioritized business line.
- Users: TBD pending scoping.
- Dependencies: A business decision outside this roadmap's authority, then a scoping audit.
- Complexity: Unknown, pending scoping.
- Risk: Low at the scoping stage; unknown thereafter.
- Priority: Future — not sequenced into near-term milestones given the unconfirmed-workflow caveat repeated across three prior documents.
- Success Criteria: Scoping audit completed, workflow confirmed to exist or not.
- Rollback Strategy: N/A at the scoping stage.
- Expected ROI: Not quantifiable — not even a defensible "not yet" answer is available, since the underlying business activity isn't confirmed to exist.

## Epic 18 — Home Collection AI

- Objective: AI-assisted scheduling/routing logistics for an already-confirmed existing service line (home-collection messaging exists in clinic settings).
- Business Value: Medium — builds on confirmed existing infrastructure, unlike Epics 15, 17.
- Users: Staff managing home-collection logistics, via Internal Staff Assistant.
- Dependencies: Epic 10.
- Complexity: Medium.
- Risk: Low.
- Priority: Could Have.
- Success Criteria: Not yet defined, deferred to Features.
- Rollback Strategy: Reverting means falling back to current manual scheduling, the status quo.
- Expected ROI: Not quantifiable yet.

## Epic 19 — Administration Intelligence

- Objective: Analytics about administrative/configuration activity — distinct from Epic 7, which is the control surface itself.
- Business Value: Low-Medium — a meta-analytics capability, valuable mainly for a maturing, multi-admin organization.
- Users: Super Admin, Management.
- Dependencies: Epic 7.
- Complexity: Low.
- Risk: Low.
- Priority: Could Have, arguably Future — the lowest-urgency Epic relative to its dependency.
- Success Criteria: Not yet defined, deferred to Features.
- Rollback Strategy: Display-only.
- Expected ROI: Not quantifiable, unlikely to be a near-term priority to quantify.

## Epic 20 — Business Continuity & Security Hardening

- Objective: Close the two unresolved CRITICAL security findings from the prior full ERP audit; build out failure-mode handling for every dependency as it becomes live through Epics 3-5.
- Business Value: Risk-avoidance, not feature value — the highest-stakes Epic in this roadmap by its own framing.
- Users: IT, Admin.
- Dependencies: The security-findings-closure sub-scope has no dependency and should begin immediately, in parallel with Epic 1. The failure-mode-handling sub-scope is built incrementally alongside each channel Epic as it goes live.
- Complexity: Medium for both sub-scopes.
- Risk: This Epic exists to reduce risk elsewhere; its own risk is schedule risk — if deprioritized, it becomes the platform's largest latent liability.
- Priority: Must Have, and specifically a hard blocker on Epics 3, 4, 5 going live externally, not just high-priority alongside them.
- Success Criteria: Both CRITICAL findings confirmed closed before Epic 3 launches; every failure mode has a tested fallback behavior before its corresponding channel Epic launches.
- Rollback Strategy: N/A in the conventional sense — this Epic's rollback is the fallback behaviors it builds for every other Epic.
- Expected ROI: Risk-avoidance value, immeasurable in currency but treated as non-negotiable regardless.

---

# SECTION 4 — Features and User Stories

## 4.1 A Scoping Decision, Stated Up Front

The brief asks for every Epic broken into Features, every Feature broken into User Stories, for ten different user roles, each with full detail. Done literally for all 20 Epics, this would produce several hundred user stories in a single document — which would not be more useful to an engineering team than fewer, well-chosen stories; it would be harder to navigate and more likely to contain inconsistencies.

**The approach taken:** full Feature/Story depth for every Must Have Epic (1, 2, 3, 6, 7, 8's Payments sub-scope, 13a, 20) — these are the Epics a team actually starts work on, per Section 6's Milestone sequencing. For every other Epic, this section provides the Feature breakdown and representative User Stories, rather than an exhaustive set — with `MASTER_PRODUCT_BACKLOG.md` carrying the complete, sprint-ready story list as work on each Epic approaches, written against real implementation discoveries rather than speculated now. This avoids two failure modes: stories so generic they provide no real guidance, and stories detailed enough to look authoritative but written before the prerequisite work (Epic 12/13b's audits, for example) that would make them accurate.

## 4.2 Story Format

Every story below: As a [role], I want [capability], so that [value] — followed by Acceptance Criteria, Business Rules, Dependencies, Priority, Security Considerations, Testing Requirements.

---

## Epic 1 — Knowledge Engine

### Feature 1.1 — Content Store & Categories

**Story 1.1.1** — As an Admin, I want to create and edit Knowledge Base entries organized by the categories already defined, so that content has one canonical home rather than being scattered across prompts or staff memory.
- Acceptance Criteria: Entry has category, content, version number, last-edited-by, last-edited-at; categories match the existing reference table exactly, no ad-hoc categories created outside this Epic's own change-control process.
- Business Rules: PCPNDT and preparation-instruction categories require a clinically-authorized editor role, not editable by general Admin.
- Dependencies: None.
- Priority: Must Have.
- Security Considerations: Edit access gated by existing staff auth/permission middleware, new knowledge_base module.
- Testing Requirements: Attempt to edit a PCPNDT entry as general Admin must fail; attempt as clinically-authorized role must succeed and version correctly.

**Story 1.1.2** — As any AI face, I want to query the Knowledge Base for relevant content given a patient or staff question, so that responses are grounded in approved content rather than improvised.
- Acceptance Criteria: Query returns matching entries or an explicit no-match signal, never a silent empty or guessed response.
- Business Rules: No-match must trigger escalation in the calling Conversation Manager, never AI improvisation.
- Dependencies: Story 1.1.1.
- Priority: Must Have.
- Security Considerations: Read access via the AI service credential, not patient or staff session.
- Testing Requirements: Query for content with no matching entry returns the explicit no-match signal, distinguishable from a failed search.

### Feature 1.2 — Suggestion & Approval Lifecycle

**Story 1.2.1** — As a department supervisor, I want AI-flagged knowledge gaps routed to my category specifically, so that I'm not wading through suggestions for content I don't own.
- Acceptance Criteria: Suggestion includes the triggering question, proposed content, and target category, routed per the established owner table.
- Business Rules: AI never auto-applies a suggestion.
- Dependencies: Story 1.1.1, and a live AI face generating real no-match events for meaningful testing.
- Priority: Must Have.
- Security Considerations: Suggestion routing respects the same category-based permission tiers as direct editing.
- Testing Requirements: A no-match event for a PCPNDT-adjacent query routes only to clinically-authorized reviewers.

### Feature 1.3 — Versioning & Rollback

**Story 1.3.1** — As an Admin, I want to revert a single Knowledge Base entry to its previous version, so that a bad edit is correctable in seconds.
- Acceptance Criteria: Rollback restores prior content and version number; the rollback action itself is logged.
- Business Rules: Rollback affects only the single entry, never a whole-system snapshot.
- Dependencies: Story 1.1.1.
- Priority: Should Have.
- Security Considerations: Same edit-permission tier as the category being rolled back.
- Testing Requirements: Roll back a PCPNDT entry as general Admin must fail with the same permission denial as a direct edit.

---

## Epic 2 — AI Receptionist Foundation & Internal APIs

### Feature 2.1 — AI Caller Identity & Permission Scope

**Story 2.1.1** — As a Super Admin, I want a distinct AI-caller credential class with its own rows in the existing permission matrix, so that AI-originated actions are auditable and scoped without inventing a parallel authorization system.
- Acceptance Criteria: Role exists in the same permission-matrix structure as staff roles; automated test confirms zero refund, radiologist-audience-share, patient-delete, or any delete permission.
- Business Rules: Per-channel sub-credentials — a WhatsApp Gateway credential cannot call Voice Gateway endpoints.
- Dependencies: None.
- Priority: Must Have.
- Security Considerations: This story is itself a security control.
- Testing Requirements: The permission-matrix automated test must exist and run in CI, not just be documented.

### Feature 2.2 — Patient API

**Story 2.2.1** — As the Booking Engine Adapter, I want to look up or register a patient by phone number with an idempotency key, so that a retried request never creates a duplicate patient record.
- Acceptance Criteria: Register accepts and respects an idempotency key tied to the conversation turn; ambiguous multi-match returns a disambiguation response, never a silent pick.
- Business Rules: No edit permission beyond what register/identify requires.
- Dependencies: Feature 2.1.
- Priority: Must Have.
- Security Considerations: Rate-limited per phone number.
- Testing Requirements: Duplicate register call with the same idempotency key produces one patient record, confirmed by direct database check.

### Feature 2.3 — Booking, Appointment, Queue, Report, Payment, Notification APIs

**Story 2.3.1** — As the Booking Engine Adapter, I want to create a booking with an idempotency key that writes to the existing online-bookings table exactly as the website form would, so that no parallel booking table or logic is ever created.
- Acceptance Criteria: Resulting row is indistinguishable from a website-originated booking except for the channel/source field.
- Business Rules: Idempotency is mandatory and non-negotiable, the most repeated requirement across this entire program.
- Dependencies: Feature 2.2.
- Priority: Must Have.
- Security Considerations: Rate-limited per session.
- Testing Requirements: A retried create-booking call with the same idempotency key produces exactly one booking row, verified by direct query.

**Story 2.3.2** — As the Payment Adapter, I want payment initiation to reuse the existing gateway integration's idempotency mechanism rather than build a new one, so that duplicate-charge risk is governed by the same tested logic the staff-facing payment flow already relies on.
- Acceptance Criteria: Idempotency key reuses the existing payment gateway's mechanism, not a new AI-specific one.
- Business Rules: No refund permission at all in this category, ever — refunds route to Human Handoff unconditionally.
- Dependencies: Story 2.3.1.
- Priority: Must Have.
- Security Considerations: This is the single highest-stakes idempotency case in the platform.
- Testing Requirements: Chaos-style test confirms zero duplicate charges — escalated to Epic 8 for hardening under real traffic, but the basic version must pass here first.

---

## Epic 3 — WhatsApp AI

### Feature 3.1 — Inbound Message Processing

**Story 3.1.1** — As a Patient messaging the clinic's WhatsApp number, I want my message routed to the AI with my prior booking/report context already loaded, so that I'm not asked to repeat information the clinic already has.
- Acceptance Criteria: Patient identity resolution runs before Knowledge Base lookup; context includes recent bookings, pending reports, outstanding bills where the patient is already identified.
- Business Rules: A phone number alone is not sufficient to reveal booking/report details; a second factor is required before any PII-bearing response.
- Dependencies: Epic 2.
- Priority: Must Have.
- Security Considerations: This story is the primary enforcement point for the platform's most likely-to-erode privacy control. Code review should explicitly check identify-before-reveal sequencing.
- Testing Requirements: A message from an unrecognized or unconfirmed phone number must never receive booking/report details, tested adversarially.

**Story 3.1.2** — As a Patient, I want the AI to escalate to a human immediately if I mention emergency-adjacent language, so that I'm never left in an automated conversation when something urgent is happening.
- Acceptance Criteria: Matching language triggers immediate escalation, bypassing any in-progress flow state.
- Business Rules: The red-flag list lives in the Knowledge Base, clinically authored, not hard-coded into the AI's prompt.
- Dependencies: Epic 1, Epic 6, Epic 7.
- Priority: Must Have.
- Security Considerations: N/A directly; treated as a patient-safety control with security-level rigor.
- Testing Requirements: Every red-flag phrase triggers escalation within the configured response-time threshold, tested individually.

### Feature 3.2 — Booking via Conversation

**Story 3.2.1** — As a Patient, I want to book a test through natural WhatsApp conversation and receive a confirmation with my token number, so that I don't need to call or visit in person for a routine booking.
- Acceptance Criteria: Availability check, quote, confirm, create (idempotent), queue token issuance, notification — all functioning end to end.
- Business Rules: Package recommendations stay within doctor-approved Knowledge Base mappings, never AI-improvised bundles.
- Dependencies: Epic 2, Epic 1.
- Priority: Must Have.
- Security Considerations: Same identity-verification gate as Story 3.1.1.
- Testing Requirements: Full flow tested against a slot that becomes unavailable between quote and create — must return a specific code and re-offer, not a generic error.

---

## Epic 6 — Reception Command Center

### Feature 6.1 — Unified Live Feed

**Story 6.1.1** — As a Receptionist, I want every channel's live activity in one chronological feed, so that I never need to check multiple screens to know what needs attention.
- Acceptance Criteria: Three-pane layout, filterable by channel and priority, persists filter state per staff login.
- Business Rules: Colour is never the only signal — every coloured card carries a text label too.
- Dependencies: Epic 3.
- Priority: Must Have.
- Security Considerations: Feed content respects the same per-role data visibility as existing staff UI.
- Testing Requirements: Emergency-priority item triggers a persistent audible and visual alert that remains until explicitly acknowledged.

### Feature 6.2 — Human Handoff Queue

**Story 6.2.1** — As a Receptionist picking up a handoff item, I want the patient's identity, conversation summary, and in-progress booking/payment state pre-loaded, so that I never have to ask the patient to repeat what they already told the AI.
- Acceptance Criteria: Summary-first display, full transcript available on demand.
- Business Rules: Escalation reason and priority determine queue ordering — Emergency and VIP ahead of Normal.
- Dependencies: Epic 3, Epic 7.
- Priority: Must Have.
- Security Considerations: Transcript access logged the same as any other PII access.
- Testing Requirements: A handoff item's summary never includes raw clinical content beyond what the linked record view already permits.

---

## Epic 7 — AI Operations Center (Administration)

### Feature 7.1 — Escalation Rules Configuration

**Story 7.1.1** — As a Super Admin, I want to configure VIP, Emergency, and refund routing rules without code changes, so that the clinic's escalation policy can evolve without engineering involvement.
- Acceptance Criteria: UI for the existing routing table design; system refuses to save a configuration with zero Human Handoff path entirely.
- Business Rules: Super Admin only, not general Admin.
- Dependencies: Epic 2.
- Priority: Must Have.
- Security Considerations: The cannot-disable-escalation-entirely safeguard is itself a safety control.
- Testing Requirements: Attempt to save a configuration with all escalation paths disabled must be rejected by the system, not merely discouraged by the UI.

### Feature 7.2 — Provider Selection & Cost Governance

**Story 7.2.1** — As an Admin, I want to see today's LLM and telephony spend against the configured Daily Budget, so that I have visibility before a budget ceiling is reached, not just after.
- Acceptance Criteria: Alert at the configured approach-threshold; behavior at 100% configurable, never silently destructive by default.
- Business Rules: Budget-ceiling behavior choice belongs to the clinic, not an architectural default this Epic imposes.
- Dependencies: Epic 2/3 generating real provider usage.
- Priority: Should Have.
- Security Considerations: API key fields write-only after entry, never displayed in plaintext.
- Testing Requirements: Key rotation tested for zero downtime.

---

## Epic 8 — Queue Integration & Payments/Report Hardening

### Feature 8.1 — Payment Idempotency Under Real Traffic

**Story 8.1.1** — As the platform, I want payment initiation to survive simulated network failures and retries without ever producing a duplicate charge, tested under conditions closer to real-world flakiness than Epic 2's basic test.
- Acceptance Criteria: Zero duplicate-charge incidents across a defined observation window of real AI-originated traffic.
- Dependencies: Epic 2's Story 2.3.2, Epic 3 (real traffic to harden against).
- Priority: Must Have.
- Security Considerations: Continuation of the single highest-stakes story in the platform.
- Testing Requirements: Chaos engineering test suite targeting the payment-initiate endpoint under realistic connection-flakiness patterns.

### Feature 8.2 — Report Identity Verification Under Real Traffic

**Story 8.2.1** — As the platform, I want the report-status and share-link identity gate tested adversarially under real traffic patterns, so that the phone-number-alone-is-not-enough control is proven, not just designed.
- Acceptance Criteria: No report delivered to an unverified identity across a defined observation window.
- Dependencies: Epic 3's Story 3.1.1, hardened here under real conditions.
- Priority: Must Have.
- Security Considerations: Direct extension of a previously-named risk.
- Testing Requirements: Adversarial test cases attempting to extract report status or links using only a phone number, no second factor.

---

## Epic 13a — Laboratory Turnaround & Critical-Value Flagging

### Feature 13a.1 — Result-Value Location Discovery

**Story 13a.1.1** — As an engineer beginning this Epic, I want to confirm where actual lab result values live in the schema before designing any critical-value alerting, so that I don't build alerting logic against an assumption that turns out to be wrong.
- Acceptance Criteria: Either confirm result values live in an identified location, or confirm they don't yet exist in structured form anywhere, before Feature 13a.3 begins.
- Business Rules: This is a discovery task, not a build task.
- Dependencies: None.
- Priority: Must Have, blocking Feature 13a.3.
- Security Considerations: N/A — read-only schema investigation.
- Testing Requirements: N/A — this is an audit deliverable.

### Feature 13a.2 — Turnaround Time Calculation

**Story 13a.2.1** — As a Laboratory supervisor, I want to see how long samples actually take from collection to report, broken down by stage, so that I can identify where delays concentrate.
- Acceptance Criteria: New lab-specific turnaround table, computed from the sample table's four existing timestamps, structurally parallel to but not reusing the radiology-specific turnaround table.
- Business Rules: This corrects a prior documented error which assumed this data was already tracked.
- Dependencies: None beyond the sample table already existing.
- Priority: Must Have.
- Security Considerations: Low — aggregate operational data, not patient-result content.
- Testing Requirements: Computed turnaround for a known test sample, manually traced through its four timestamps, matches the dashboard's displayed value exactly.

### Feature 13a.3 — Critical Value Flagging (contingent on Feature 13a.1's findings)

**Story 13a.3.1** — As a Laboratory technician, I want a result outside the defined reference range flagged for fast escalation to the relevant clinician, so that critical values are never sitting unnoticed in a queue.
- Acceptance Criteria: Extends the existing abnormal-findings table's severity field and lab-modality concept rather than building a parallel taxonomy; AI's role is speed-of-escalation only, never interpretation of clinical significance.
- Business Rules: This is the one Laboratory AI capability prioritized on safety grounds ahead of feasibility grounds.
- Dependencies: Feature 13a.1's findings.
- Priority: Must Have, contingent — if no structured result-value location exists, this story is blocked and should be re-scoped as building the result-capture mechanism first.
- Security Considerations: Patient-safety-critical; a false-negative is a more serious failure mode than a false-positive, and testing should weight accordingly.
- Testing Requirements: A deliberately-constructed out-of-range test result triggers the flag within the target escalation-speed window.

---

## Epic 20 — Business Continuity & Security Hardening

### Feature 20.1 — Prior Audit Findings Closure

**Story 20.1.1** — As an IT/Security lead, I want the two unresolved CRITICAL findings from the prior full ERP security audit confirmed closed before any external AI channel launches, so that this program doesn't compound an existing, known risk.
- Acceptance Criteria: Both findings independently verified closed, not just marked closed in a tracker.
- Business Rules: Hard blocker on Epic 3's launch, not a parallel-track item.
- Dependencies: None — should begin immediately.
- Priority: Must Have, blocking.
- Security Considerations: This story is entirely a security consideration.
- Testing Requirements: Independent verification that default secrets are no longer in use anywhere in the deployed configuration.

### Feature 20.2 — Failure-Mode Fallback Behaviors

**Story 20.2.1** — As the platform, I want every dependency failure to degrade to a safe, non-writing fallback rather than attempt an uncertain action, so that a failure never compounds into a duplicate or orphaned record.
- Acceptance Criteria: For each dependency, a tested fallback behavior exists before its corresponding channel Epic launches, built incrementally.
- Business Rules: When uncertain, do not write — applies without exception.
- Dependencies: Built alongside each channel Epic as implemented.
- Priority: Must Have per-dependency, gating its corresponding channel Epic.
- Security Considerations: A reliability/data-integrity control treated with security-level seriousness.
- Testing Requirements: Simulated failure of each dependency confirmed to produce zero writes and the correct fallback message.

---

## 4.3 Remaining Epics — Feature Breakdown Only

For Epics 4, 5, 9, 10, 11, 12, 13b, 14, 15, 16, 17, 18, 19, full User Story detail is deferred to `MASTER_PRODUCT_BACKLOG.md`, populated as each Epic approaches its milestone.

- Epic 4 (Voice AI): Inbound Call Handling, Text-to-Speech/Speech-to-Text Integration, Warm Transfer (capability-flagged), Missed Call Callback.
- Epic 5 (Website Assistant): Web Chat Widget, Quick-Reply UI Adaptation, Session Continuity with WhatsApp/Voice identity.
- Epic 9 (Follow-up & CRM): Appointment Reminders, Opt-out Management, Birthday Wishes, Health Package Reminders, Complaint Handling Routing, Referral Acknowledgment.
- Epic 10 (Internal Staff Assistant): Per-Role Query Scoping, Read-Only Retrieval Actions, Write-Action Allowlist, Audit Logging Under Staff Identity.
- Epic 11 (Management Dashboard & BI): Daily/Weekly/Monthly Views, High-Maturity Metric Display, Low-Maturity Forecasting (deferred to Future priority).
- Epic 12 (Radiology AI Enhancement): Dedicated Audit (first Feature, discovery task), Worklist Prioritization, Template Recommendation, QC Flagging — the latter three not yet scoped to Story level pending the audit.
- Epic 13b (Lab AI Schema Layer): Dedicated Audit (first Feature, same treatment as Epic 12), AI Schema Design (deferred pending audit).
- Epic 14 (Health Passport/Timeline): Longitudinal Data Aggregation View, Patient-Facing Passport UI, Staff-Facing Timeline UI, Identity-Gate Compliance.
- Epic 15 (Marketing Intelligence): Content Drafting Assistant, Human-Approval Workflow, Channel Attribution Tracking.
- Epic 16 (Quality Intelligence): Wait-Time/Turnaround Synthesis, Complaint-Trend Analysis, Machine-Downtime Trend, Workflow Bottleneck Detection, Aggregate Productivity View.
- Epic 17 (Corporate Diagnostics): Workflow Scoping Audit — everything else deferred pending its outcome.
- Epic 18 (Home Collection AI): Collection Route/Schedule Optimization, an Internal Staff Assistant extension.
- Epic 19 (Administration Intelligence): Configuration-Change Trend Reporting, Knowledge Base Edit-Frequency Analysis.

---

# SECTION 5 — Technical Task Breakdown

## 5.1 Scope

Per the same scoping decision as Section 4: full task breakdown is given for the highest-leverage stories — those that other stories' tasks would otherwise reference repeatedly. The remaining stories follow the same task-category pattern; `MASTER_PRODUCT_BACKLOG.md` is where task breakdown is completed for every story as its Epic's milestone approaches.

## 5.2 Story 2.1.1 — AI Caller Identity & Permission Scope

| Task category | Tasks |
|---|---|
| Frontend | None — this story has no UI surface |
| Backend | Add ai_caller role handling to existing auth middleware; implement per-channel sub-credential issuance |
| Database | New rows in the existing permission-matrix table for the ai_caller role across every module; no new tables |
| API | None — this story configures access to APIs Feature 2.2/2.3 will build |
| Security | Write the automated permission-matrix test asserting zero refund/delete/radiologist-share permissions; security review of credential-issuance mechanism |
| Testing | Unit tests for permission checks; integration test simulating a cross-channel credential misuse attempt |
| Documentation | Document the ai_caller role's exact permission grant in a form the Administration UI can later display read-only to Admins |
| Deployment | No production data migration; purely additive configuration |
| Rollback Plan | Remove the ai_caller role rows; no data to migrate back |

## 5.3 Story 2.3.1 — Idempotent Booking Creation

| Task category | Tasks |
|---|---|
| Frontend | None — internal API consumed by the Booking Engine Adapter |
| Backend | Implement idempotency-key check wrapping the existing booking-creation call path; ensure it's the same call path the website form uses, not a reimplementation |
| Database | No new tables — online_bookings reused as-is; consider an idempotency-key tracking index if the existing path has no native support, to confirm during implementation |
| API | New booking-create endpoint per the designed API category |
| Security | Rate limiting per session; confirm idempotency key cannot be guessed or replayed by an unrelated session |
| Testing | Concurrent-request test confirms one booking row; retried-after-failure test confirms the same |
| Documentation | Document the exact idempotency-key derivation for future Channel Gateway implementers |
| Deployment | No migration; new endpoint only |
| Rollback Plan | Feature-flag this endpoint independently of other Booking API endpoints |

## 5.4 Story 2.3.2 — Payment Idempotency

| Task category | Tasks |
|---|---|
| Frontend | None |
| Backend | Wrap existing payment-gateway-integration idempotency mechanism; explicitly do not implement a second, AI-specific idempotency layer |
| Database | None new — reuses existing payment/transaction tables |
| API | New payment-initiate endpoint |
| Security | Highest-priority security review item in Epic 2 — reviewed by whoever owns the existing payment-gateway integration specifically |
| Testing | Basic chaos test here; full hardening deferred to Epic 8 |
| Documentation | Document explicitly that this reuses the existing mechanism, with a pointer to it, to prevent a future engineer adding a redundant second layer |
| Deployment | No migration |
| Rollback Plan | Disable AI-originated payment initiation per-channel; booking flow falls back to pay-at-counter |

## 5.5 Story 3.1.1 — Identity Resolution Before PII Disclosure

| Task category | Tasks |
|---|---|
| Frontend | WhatsApp message templates for the identity-confirmation step |
| Backend | Conversation Manager logic enforcing identify-before-reveal sequencing, structurally enforced (the API does not return PII-bearing fields pre-identification), not just prompt-instructed |
| Database | None new |
| API | Consumes Patient API's lookup and identify endpoints |
| Security | Primary review item for this Epic — explicit adversarial test plan required before this story is considered done |
| Testing | Adversarial test suite attempting to extract booking or report info using only a phone number across multiple phrasing variants |
| Documentation | Document the exact identity-confirmation factor used and why |
| Deployment | Feature-flagged behind the existing ai_assistant_enabled setting |
| Rollback Plan | The existing kill switch; instant revert |

## 5.6 Story 6.1.1 — Unified Live Feed

| Task category | Tasks |
|---|---|
| Frontend | Three-pane layout component; filter persistence; colour-coding with accompanying text labels |
| Backend | Aggregation endpoint pulling from WhatsApp conversations, queue/token tables, booking tables, and eventually voice/web-chat session stores into one feed |
| Database | None new — read aggregation over existing tables |
| API | New internal endpoint for the feed; staff-facing, not part of the AI-facing API set |
| Security | Feed respects existing per-role data visibility; no new PII exposure |
| Testing | Load test with realistic multi-channel volume; alert-persistence test (Emergency item remains until acknowledged, survives page refresh) |
| Documentation | Operator-facing documentation matching the Receptionist SOP |
| Deployment | New staff-facing route within the existing application shell |
| Rollback Plan | New tab/route is removable without affecting existing staff tools it sits alongside |

## 5.7 Story 13a.2.1 — Lab Turnaround Calculation

| Task category | Tasks |
|---|---|
| Frontend | Supervisor-facing turnaround dashboard view |
| Backend | Computation job reading samplesTable's four timestamps, populating a new lab-turnaround table; confirm whether this should be computed on-write or batch, matching whichever pattern the radiology equivalent uses |
| Database | New, lab-specific turnaround table — this is the one Story in this set that involves a new table, named explicitly since this document's own "do not create database tables" instruction applies to this document not creating them, while still scoping what implementation will need |
| API | New internal read endpoint for the dashboard |
| Security | Low — aggregate operational data |
| Testing | Manual-trace verification against a known sample's timestamps |
| Documentation | Document the computation method and its parallel-but-distinct relationship to the radiology turnaround table, to prevent future confusion between the two |
| Deployment | New table requires a migration — flagged for the implementation team, not created here |
| Rollback Plan | Purely additive; disabling the dashboard view has no data-integrity implication |

## 5.8 Pattern for All Remaining Stories

Every story not detailed above follows the same eight-category structure. The pattern that should hold across all of them: frontend tasks are absent for backend-only or API stories; database tasks are "none new" far more often than not, since this program's central discipline is reusing existing tables; security tasks scale with PII/financial sensitivity, not uniformly; rollback plan is feature-flag-based wherever a kill switch was already specified in prior documents, and explicitly designed where one wasn't.

---

# SECTION 6 — Implementation Milestones

## 6.1 Restated From Section 1, Because It Governs Everything Below

Engineering work on Milestone 1 can begin immediately. Every milestone from Milestone 4 onward (the first patient-facing channel) is gated on Milestone 1's operational-readiness items clearing, not just its technical items. This is checked, not assumed, in `IMPLEMENTATION_CHECKLIST.md`.

## 6.2 The Milestone List

The brief's example list is reviewed and optimized below, the same way Section 2 reviewed the Epic list — Patient Health Passport and Diagnostic Timeline merged for the same reason their Epics were merged, Business Continuity/Security pulled forward as its own milestone rather than left implicit, and the AI Operations Center, Internal Staff Assistant, and Payments/Report Hardening added since they're Must-Have Epics the brief's example list omitted.

| # | Milestone | Maps to Epic(s) |
|---|---|---|
| 1 | Foundation & Security Closure | Epic 2, Epic 20 findings-closure sub-scope |
| 2 | Knowledge Engine | Epic 1 |
| 3 | AI Operations Center | Epic 7 |
| 4 | WhatsApp AI | Epic 3, Epic 20 WhatsApp-fallback sub-scope |
| 5 | Reception Command Center | Epic 6 |
| 6 | Payments & Report Hardening | Epic 8 |
| 7 | Voice AI | Epic 4, Epic 20 Voice-fallback sub-scope |
| 8 | Website Assistant | Epic 5, Epic 20 Web-Chat-fallback sub-scope |
| 9 | Internal Staff Assistant | Epic 10 |
| 10 | Follow-up Automation & CRM | Epic 9 |
| 11 | Laboratory Quick Wins | Epic 13a |
| 12 | Management Dashboard | Epic 11 data-display half |
| 13 | Quality Intelligence | Epic 16 |
| 14 | Business Intelligence Forecasting | Epic 11 forecasting half |
| 15 | Radiology AI Enhancement | Epic 12 |
| 16 | Laboratory AI Schema Layer | Epic 13b |
| 17 | Patient Health Passport / Diagnostic Timeline | Epic 14 |
| 18 | Marketing Intelligence | Epic 15 |
| 19 | Home Collection AI | Epic 18 |
| 20 | Corporate Diagnostics Scoping | Epic 17 |
| 21 | Administration Intelligence | Epic 19 |

This is a longer, more granular list than the brief's example for the same reason Section 2's Epic list was longer than its example — granularity produces clearer go/no-go gates per milestone.

---

# SECTION 7 — Milestone Detail

Each milestone: Dependencies, Estimated Development Effort (relative t-shirt sizing — S/M/L/XL, not calendar time, consistent with this program's standing refusal to fabricate time estimates without a real team's velocity to calibrate against), Testing Strategy, Risk, Rollback, Deployment Strategy, Go-live Checklist, Success Criteria.

## Milestone 1 — Foundation & Security Closure
- Dependencies: None.
- Estimated Effort: XL.
- Testing Strategy: Permission-matrix automated tests; idempotency tests for every write API; independent verification of security-findings closure.
- Risk: Medium for Foundation's reimplementation risk; schedule risk for the security sub-scope if deprioritized.
- Rollback: Per-API-category feature flags; no patient-facing exposure to roll back from at this stage.
- Deployment Strategy: Internal-only release.
- Go-live Checklist: All API categories implemented and idempotency-tested; permission matrix tested; both CRITICAL security findings independently confirmed closed.
- Success Criteria: APIs produce results indistinguishable from existing staff/public actions; findings closure independently verified, not self-attested.

## Milestone 2 — Knowledge Engine
- Dependencies: None, can run in parallel with Milestone 1.
- Estimated Effort: M.
- Testing Strategy: Permission-tier tests for sensitive categories; no-match-signal honesty test.
- Risk: Low technical; Medium-High content-authorship risk, organizational not engineering.
- Rollback: Service-level disable, falling back to aggressive escalation everywhere it's consumed.
- Deployment Strategy: Internal tool release to Admin/supervisor roles.
- Go-live Checklist: Minimum content checklist met — hospital info, all active tests/packages, top 20 FAQs, all prep instructions.
- Success Criteria: Content-completeness checklist met before Milestone 4 can go live externally.

## Milestone 3 — AI Operations Center
- Dependencies: Milestone 1.
- Estimated Effort: L.
- Testing Strategy: Escalation-rules safeguard test; API-key rotation zero-downtime test.
- Risk: Low technical; misconfiguration risk mitigated by permission tiering.
- Rollback: Individual setting categories revertible via Version History.
- Deployment Strategy: Internal tool release to Admin/Super Admin only.
- Go-live Checklist: Escalation Rules configurable and tested; Provider Selection functional; Cost/Budget governance functional; Testing Sandbox available before any prompt change reaches production.
- Success Criteria: An Admin completes a configuration change end to end without developer assistance.

## Milestone 4 — WhatsApp AI
- Dependencies: Milestones 1, 2, 3.
- Estimated Effort: XL.
- Testing Strategy: Full Conversation Flow suite against WhatsApp specifically; adversarial identity-gate testing; webhook-redelivery idempotency load test.
- Risk: Medium — first real patient exposure in this program.
- Rollback: The existing AI-assistant-enabled kill switch.
- Deployment Strategy: Limited phone-number allowlist or low-traffic window first, not full-traffic launch on day one.
- Go-live Checklist: Milestone 1's findings closed; Milestone 2's minimum content present; Milestone 3's escalation rules configured; Milestone 5 live, since Human Handoff has nowhere to surface without it.
- Success Criteria: Core conversation flows functioning; AI Resolution Rate and Conversion Rate tracked from day one.

## Milestone 5 — Reception Command Center
- Dependencies: Milestone 4 functionally complete in staging; built in parallel with late-stage Milestone 4 in practice.
- Estimated Effort: L.
- Testing Strategy: Load test with realistic multi-channel volume; alert-persistence test.
- Risk: Low-Medium.
- Rollback: New tab/route removable without affecting existing staff tools.
- Deployment Strategy: Staff-facing release, trained via the Receptionist SOP before go-live.
- Go-live Checklist: SOP training completed for on-shift staff; Human Handoff queue tested end to end with Milestone 4's flows.
- Success Criteria: Receptionist never needs to switch screens during a trained walkthrough.

## Milestone 6 — Payments & Report Hardening
- Dependencies: Milestone 4 live with real traffic.
- Estimated Effort: L.
- Testing Strategy: Chaos engineering for payment idempotency; adversarial identity-gate testing for reports, both under real traffic.
- Risk: Medium-High for the payment sub-scope specifically.
- Rollback: Per-channel disable of AI-originated payment initiation, falling back to pay-at-counter.
- Deployment Strategy: Continuous hardening alongside live traffic, not a single release event.
- Go-live Checklist: Zero duplicate-charge incidents and zero unverified-identity report deliveries across the defined observation window.
- Success Criteria: Sign-off that hardening is sufficient, since the underlying capability is already live via Milestone 4.

## Milestone 7 — Voice AI
- Dependencies: Milestones 1-6.
- Estimated Effort: XL.
- Testing Strategy: Voice-specific flow re-testing; Dropped Call and Average Call Duration monitoring from day one.
- Risk: Medium-High — weakest redundancy story in the platform.
- Rollback: Provider/PBX-level routing revert to direct-to-staff.
- Deployment Strategy: Limited launch window first, same pattern as Milestone 4.
- Go-live Checklist: Telephony fallback risk explicitly accepted or mitigated by leadership before launch — a deliberate decision point, not a default proceed.
- Success Criteria: Dropped Call and Average Call Duration within clinic-defined acceptable range.

## Milestone 8 — Website Assistant
- Dependencies: Milestones 1-6.
- Estimated Effort: M.
- Testing Strategy: Same flow suite as WhatsApp, adapted for chat-widget UX.
- Risk: Low.
- Rollback: Widget removable from website independently.
- Deployment Strategy: Standard release, lower-ceremony launch than Voice.
- Go-live Checklist: Equivalent resolution/conversion metrics to WhatsApp confirmed in staging.
- Success Criteria: Per Epic 5's design.

## Milestone 9 — Internal Staff Assistant
- Dependencies: Milestones 1, 2; benefits from Milestones 4-8 proving core infrastructure with patients first.
- Estimated Effort: L.
- Testing Strategy: Per-role permission-boundary testing.
- Risk: Low.
- Rollback: Standard internal-tool deprecation.
- Deployment Strategy: Phased per-role rollout — Reception first, then Billing/Radiology/Lab, then Doctors/Management/Admin.
- Go-live Checklist: Zero permission-boundary violations in testing for each role before that role's rollout phase.
- Success Criteria: Positive informal staff adoption feedback, zero violations found.

## Milestone 10 — Follow-up Automation & CRM
- Dependencies: Milestones 1-4 stable in production.
- Estimated Effort: M for the core sub-scope, L for the full CRM vision.
- Testing Strategy: Opt-out enforcement testing; reminder-timing conflict testing against Business Hours/Holiday logic.
- Risk: Low-Medium — notification fatigue.
- Rollback: Outbound automation independently toggleable from inbound handling.
- Deployment Strategy: Birthday wishes first, then appointment reminders, then broader CRM capabilities.
- Go-live Checklist: Opt-out mechanism tested and confirmed functional before any outbound automation enables for real patients.
- Success Criteria: Reminder send rate and opt-out rate within clinic-acceptable ranges.

## Milestone 11 — Laboratory Quick Wins
- Dependencies: None beyond the existing sample table — can run in parallel with much of this program, including before Milestone 4.
- Estimated Effort: S for turnaround tracking, M for critical-value flagging contingent on discovery.
- Testing Strategy: Manual-trace verification for turnaround; deliberately-constructed out-of-range result test for critical-value flagging.
- Risk: Low for turnaround; Low-Medium contingent on discovery for critical-value flagging.
- Rollback: Purely additive.
- Deployment Strategy: Standard release to Laboratory staff/supervisors.
- Go-live Checklist: Result-value location confirmed before critical-value flagging work begins.
- Success Criteria: Turnaround data genuinely trackable, correcting the prior documented error.

## Milestone 12 — Management Dashboard
- Dependencies: Milestones 1-4.
- Estimated Effort: M.
- Testing Strategy: Data-accuracy reconciliation against source tables.
- Risk: Low.
- Rollback: Display-only; reverts to prior reporting process.
- Deployment Strategy: Standard release to Director/Management.
- Go-live Checklist: Every displayed metric traced to a confirmed existing source.
- Success Criteria: One screen, no folder of separate reports.

## Milestone 13 — Quality Intelligence
- Dependencies: Milestones 5, 6, 11.
- Estimated Effort: M.
- Testing Strategy: Staff-productivity framing review — a design-review requirement, not just a code test.
- Risk: Medium — misuse risk of productivity metrics if framing isn't enforced.
- Rollback: Display/analysis-only.
- Deployment Strategy: Standard release to Supervisors/Admin/Management.
- Go-live Checklist: Productivity-metric framing reviewed and approved by Management, specifically checked for individual-staff-identifiable framing.
- Success Criteria: Specific KPIs defined by clinic leadership, demonstrably actionable in at least one real instance.

## Milestone 14 — Business Intelligence Forecasting
- Dependencies: Milestone 12, plus sufficient real operating history — time-dependent, may sit idle even after technical dependencies are met.
- Estimated Effort: L.
- Testing Strategy: Forecast-accuracy backtesting against held-out historical data before trusting live forecasts.
- Risk: Medium — premature, confident-sounding-but-unreliable output.
- Rollback: Display-only; forecasting outputs hideable without affecting the data-display half.
- Deployment Strategy: Soft-launch with explicit early/low-confidence labeling until backtesting accuracy meets a leadership-defined threshold.
- Go-live Checklist: Backtesting threshold met; confidence labeling implemented for any forecast shown before that threshold is met.
- Success Criteria: Forecasts demonstrably more useful than no forecast at all.

## Milestone 15 — Radiology AI Enhancement
- Dependencies: A dedicated audit — not gated on other milestones, could run early, requires its own audit phase before build work.
- Estimated Effort: Unknown pending audit.
- Testing Strategy / Risk / Rollback / Deployment Strategy: Not yet definable.
- Go-live Checklist: Audit completed; Features/Stories scoped from findings.
- Success Criteria: The audit's completion and quality.

## Milestone 16 — Laboratory AI Schema Layer
- Dependencies: A dedicated audit, same treatment as Milestone 15.
- Estimated Effort / Testing / Risk / Rollback / Deployment: Not yet definable.
- Go-live Checklist: Audit completed.
- Success Criteria: The audit's completion and quality.

## Milestone 17 — Patient Health Passport / Diagnostic Timeline
- Dependencies: Milestone 2, sufficient accumulated patient visit history.
- Estimated Effort: M.
- Testing Strategy: Identity-gate compliance testing, same rigor as Milestone 4.
- Risk: Low-Medium — PII exposure if identity gate isn't respected.
- Rollback: Read-only view; no data-integrity rollback risk.
- Deployment Strategy: Staff-facing timeline view first, patient-facing passport view second.
- Go-live Checklist: Identity-gate tested adversarially before the patient-facing view releases.
- Success Criteria: Not yet defined in prior documents — first definition at Feature-scoping stage.

## Milestone 18 — Marketing Intelligence
- Dependencies: Milestone 2.
- Estimated Effort: M.
- Testing Strategy: Human-approval-gate enforcement test — no content path exists that bypasses review before publishing.
- Risk: Medium — reputational, mitigated by mandatory review.
- Rollback: Reverts to fully-manual content creation.
- Deployment Strategy: Standard release to Marketing-responsible staff.
- Go-live Checklist: Human-approval gate tested and confirmed unbypassable.
- Success Criteria: Not yet defined — new ground.

## Milestone 19 — Home Collection AI
- Dependencies: Milestone 9.
- Estimated Effort: M.
- Testing Strategy: Standard Internal Staff Assistant testing pattern.
- Risk: Low.
- Rollback: Reverts to current manual scheduling.
- Deployment Strategy: Standard release.
- Go-live Checklist / Success Criteria: Not yet defined.

## Milestone 20 — Corporate Diagnostics Scoping
- Dependencies: A business decision outside this roadmap's authority.
- Estimated Effort: S.
- Testing Strategy / Rollback: N/A at scoping stage.
- Risk: Low at scoping stage.
- Deployment Strategy: N/A — produces a scoping document, not a release.
- Go-live Checklist: N/A.
- Success Criteria: Workflow confirmed to exist or not, as a documented finding.

## Milestone 21 — Administration Intelligence
- Dependencies: Milestone 3.
- Estimated Effort: S.
- Testing Strategy: Data-accuracy reconciliation against Milestone 3's Version History records.
- Risk: Low.
- Rollback: Display-only.
- Deployment Strategy: Standard release to Super Admin/Management.
- Go-live Checklist / Success Criteria: Not yet defined — lowest-urgency milestone, deferred until next in queue.

---

# SECTION 8 — Feature Prioritization

## 8.1 Categories, Defined

- Must Have: Required before the relevant channel or capability can safely go live. Absence blocks launch, not just delays it.
- Should Have: Materially improves the platform but a defensible launch can proceed without it, with a named gap.
- Could Have: Real value, but the program's overall trajectory is not harmed by deferring it past the near-term roadmap.
- Future: Either time-dependent (needs data/history that doesn't exist yet) or scope-dependent (needs a business decision or audit outside this roadmap's authority).

## 8.2 Full Prioritization Table

| Epic | Priority | Why |
|---|---|---|
| 1 — Knowledge Engine | Must Have | Every patient-facing Epic's output quality depends on it |
| 2 — Foundation & Internal APIs | Must Have | Load-bearing layer; nothing patient-facing can build without it |
| 3 — WhatsApp AI | Must Have | Highest-readiness, highest near-term value channel |
| 4 — Voice AI | Should Have | High value but highest risk channel; correctly sequenced behind WhatsApp's proof point |
| 5 — Website Assistant | Should Have | Lower risk than Voice, but not load-bearing for any other Epic |
| 6 — Reception Command Center | Must Have | Epic 3 cannot safely run without a place for Human Handoff to surface |
| 7 — AI Operations Center | Must Have | Epic 3 cannot safely run without Escalation Rules and the kill switch this provides |
| 8 — Queue/Payments/Report Hardening | Must Have for Payments sub-scope | Duplicate-charge risk is unacceptable once Epic 3 processes real payments |
| 9 — Follow-up & CRM | Should Have for the core sub-scope, Could Have for the full vision | Phase 10's reminders are proven design; the fuller CRM vision is less grounded |
| 10 — Internal Staff Assistant | Should Have | High value, low risk, but not blocking any patient-facing launch |
| 11 — Management Dashboard & BI | Should Have for data-display, Future for forecasting | Forecasting is time-dependent, not deferrable by choice but by necessity |
| 12 — Radiology AI Enhancement | Should Have | High potential value but blocked on an unperformed audit |
| 13a — Lab Turnaround/Critical-Value | Must Have | Low cost, patient-safety relevant, per the Laboratory correction's own recommendation to elevate priority |
| 13b — Lab AI Schema Layer | Should Have | Same audit-blocked reasoning as Epic 12 |
| 14 — Health Passport/Timeline | Could Have | Real value but enabler-shaped, not urgent on its own |
| 15 — Marketing Intelligence | Could Have | Entirely new ground, no existing investment to build on |
| 16 — Quality Intelligence | Should Have | Synthesis layer, valuable once its inputs mature |
| 17 — Corporate Diagnostics | Future | Workflow existence itself unconfirmed |
| 18 — Home Collection AI | Could Have | Real existing service line, but logistics-optimization value is incremental |
| 19 — Administration Intelligence | Could Have, arguably Future | Lowest urgency relative to its dependency |
| 20 — Business Continuity & Security | Must Have, blocking | Highest-stakes Epic in the roadmap by explicit prior-document framing |

## 8.3 Why This Differs Slightly From a Naive Reading of Section 3

A reader scanning Section 3's individual Epic priorities might expect every Must Have to be schedulable identically. Two refinements: first, Epic 13a is Must Have despite being a small, easily-overlooked Epic — included at this tier specifically because the Laboratory correction demonstrated its unusually high value-to-cost ratio, not because it's architecturally central like Epics 2, 3, 6, 7, 20. Second, Epics 9 and 11 are split-priority within themselves, which a single Epic-level priority tag would obscure — Section 3's per-Epic detail and this section's table should be read together.

---

# SECTION 9 — Quick Wins (Summary)

Full detail in `QUICK_WINS.md`. Summarized here for completeness:

| Item | Timeframe | Source |
|---|---|---|
| Birthday wishes | 1-3 Days | Named explicitly for its low cost and immediate relationship value |
| Lab turnaround tracking | 1 Week | Data already captured on the sample table, only the read/aggregate layer is missing |
| Result-value location discovery | 1 Day | Pure audit task, blocks the critical-value flagging story |
| Knowledge Engine minimum content for top 20 FAQs | 1-2 Weeks | Content-authorship task, not engineering, but unblocks Milestone 4 |
| AI-caller permission-matrix automated test | 3 Days | Security-critical, low engineering complexity, should not wait for the rest of Epic 2 |
| Corporate Diagnostics scoping audit | 1 Day | Pure discovery, resolves a repeatedly-flagged open question |
| Radiology/Laboratory AI dedicated audits | 1 Week each | Discovery tasks that unblock larger downstream work |

This summary deliberately does not include the highest-ROI-sounding items from Sections 2-3 (WhatsApp AI, full Knowledge Engine build) — those are correctly Must Have priorities, but they are not quick by any honest estimate, and conflating important with quick would undermine the purpose of a Quick Wins document.

---

# SECTION 10 — Technical Debt Review

## 10.1 Areas Requiring Cleanup

Carried forward from the original architecture audit: `online_bookings.patient_id`/`.bill_id` and `tokens.order_id`/`.patient_id` lack foreign-key constraints. This roadmap treats it as a Should Have cleanup item, elevated to Must Have once Epic 3's AI-driven write volume materially increases, per the original reasoning that higher write volume raises the cost of this gap.

## 10.2 Modules Requiring Particular Care

- Payment callback handlers — production-tested, payment-critical; any modification should follow the same hardening discipline Epic 8 establishes.
- WhatsApp webhook handling — the existing webhook-verify-token pattern must be replicated by any new webhook-receiving code (Voice, Web Chat), not skipped.

## 10.3 Modules That Should Never Be Modified (as part of this program)

`online_bookings`, `appointments`, `tokens`/`test_tokens`, `patients`, billing/payment tables and their existing write paths; the existing staff authentication and permission model; the existing WhatsApp send/template mechanism. This program's entire discipline is building interfaces to these, never replacements of these.

## 10.4 Refactoring Opportunities

The radiology-specific turnaround table and the new lab-specific table this roadmap proposes are structurally similar but deliberately not unified into one polymorphic table — a considered and rejected refactor, not an oversight: unifying them would require either a nullable-field-heavy shared table or a generic key-value structure, both worse than two small, clear, parallel tables for a difference this contained.

## 10.5 Performance Bottlenecks

Not assessed by this roadmap — no prior document performed load/performance testing on the existing ERP, and this roadmap does not fabricate findings in an area it hasn't investigated. Flagged as an open gap: a performance baseline should be established before Epic 3's traffic volume makes any existing bottleneck visible for the first time under AI-driven load rather than human-paced load.

## 10.6 Scalability Bottlenecks

Multi-branch deployment would require a Knowledge Base branch-scoping concept that does not currently exist — a real, new design need, not assumed solvable by the current single-branch structure. This roadmap does not include multi-branch Epics for this reason; it is out of scope until single-branch operation is mature.

## 10.7 Database Risks

The FK-constraint gaps above are the primary named risk. Secondarily: this roadmap proposes new tables in Epics 1, 13a, and implicitly others pending audits (12, 13b) — every new table proposal should be reviewed against the existing schema's FK-constraint conventions before implementation, so this program does not introduce new instances of the same gap it inherited.

## 10.8 Security Risks

The two unresolved CRITICAL findings from the prior full ERP audit are this program's single largest named security risk, tracked as a blocking Epic rather than a background concern. No other security risk identified across prior documents rises to comparable severity in this roadmap's assessment.

---

# SECTION 11 — Product Backlog

Generated as a standalone, working document: `MASTER_PRODUCT_BACKLOG.md`. Not duplicated here — a backlog is a living artifact a team edits sprint to sprint, and embedding it inside this narrative roadmap would create exactly the two-sources-of-truth problem this program is built to avoid elsewhere. This section exists only to confirm the backlog's structure matches Sections 2-7 above: Epic to Feature to Story, with Priority, Dependencies, Estimated Effort, Suggested Owner, Status, Business Value, and Technical Complexity per item, populated in full for every Must Have Epic and seeded at Epic/Feature level for the rest.

---

# SECTION 12 — Engineering Kanban Board

Generated as a standalone document: `MASTER_ENGINEERING_KANBAN.md`. Columns: Backlog, Ready for Development, In Development, Code Review, Testing, Ready for Production, Released, Future — populated with the Must Have stories from Section 4 in their appropriate starting columns. Everything not yet started begins in Backlog or Future; nothing is pre-populated into In Development, Code Review, Testing, or Released, since no engineering work has begun under this roadmap yet.

---

# SECTION 13 — Release Roadmap

Generated in full as a standalone document: `MASTER_RELEASE_PLAN.md`. Summarized here:

| Version | Theme | Maps to |
|---|---|---|
| 1.1 | Foundation, internal only | Milestones 1-3 |
| 1.2 | First patient-facing AI channel | Milestones 4-6 |
| 1.5 | Multi-channel, internal tooling | Milestones 7-10 |
| 2.0 | Intelligence layer | Milestones 11-14 |
| 3.0 | Clinical AI deepening and new domains | Milestones 15-21 |

This versioning is capability-based, not calendar-based — a version increments when its Milestones are genuinely complete and gated checklist items clear, not on a fixed release date.

---

# SECTION 14 — Implementation Timeline

## 14.1 Why This Section Is Phrased as Ranges and Conditions, Not Dates

Every prior document in this series declined to fabricate calendar estimates without a real engineering team's velocity to calibrate against. This roadmap inherits that discipline, while still satisfying the request for realistic sequencing by expressing timeline as dependency-ordered horizons rather than dates, naming where complexity is most likely to be underestimated.

## 14.2 3 Months

Realistically achievable: Milestone 1 and Milestone 2 complete; Milestone 3 substantially complete; Milestone 11 complete, since it has no dependency on the others. Most likely underestimate: Milestone 1's security-findings-closure sub-scope — its effort is genuinely unknown until the prior audit is re-reviewed in detail, which has not happened. A team treating Milestone 1 as mostly the API work risks under-budgeting the security sub-scope specifically.

## 14.3 6 Months

Realistically achievable, building on Month 3: Milestone 4 live to a limited allowlist; Milestone 5 live; Milestone 6 in active progress, not necessarily complete, since it requires real production traffic to harden against. Most likely underestimate: Milestone 4 itself, rated High complexity with an explicit recommendation for a cautious, limited launch — a team under pressure to reach full launch by month 6 is the most likely place in this entire roadmap for the identity-verification gate to be weakened for a smoother conversational UX, a named, realistic risk, not a hypothetical one.

## 14.4 12 Months

Realistically achievable, building on Month 6: Milestone 6 complete; Milestone 7 or Milestone 8 live, not necessarily both, given Voice's Very High complexity rating; Milestone 9 in progress; Milestone 13a's full scope complete. Most likely underestimate: attempting both Voice and Website simultaneously rather than sequentially — they share dependencies but Voice's complexity and weaker redundancy story make parallel full-scale delivery of both a meaningfully higher-risk bet than this roadmap recommends; sequential delivery is the safer default.

## 14.5 24 Months

Realistically achievable, building on Month 12: Milestones 7-10 complete; Milestone 12 live; Milestone 17 and Milestone 9's full per-role rollout complete; the Radiology and Laboratory AI schema audits completed, with early build work begun on whichever the audit reveals is more tractable. Most likely underestimate: treating those audits as a formality rather than genuine discovery work — the existing roughly-twenty-table Radiology schema's actual current behavior has not been verified by any prior document, only its existence; a team that skips straight to building against assumed table semantics risks the exact reimplementation/misunderstanding risk this program's discipline exists to prevent.

## 14.6 36 Months

Realistically achievable, building on Month 24: Milestone 14 live, contingent on sufficient real operating history having accumulated — genuinely uncertain whether 36 months is sufficient, since this depends on transaction volume, not just elapsed time; Milestone 13 mature; Milestones 15/16's build phases substantially complete assuming their Month-24 audits went well; Milestone 18 live. Most likely underestimate: assuming forecasting accuracy is purely a function of elapsed time — it is a function of volume and variety of real transactions, which could plausibly still be insufficient at 36 months for a single-branch diagnostic centre.

## 14.7 60 Months

Realistically achievable, building on Month 36: the bulk of this roadmap's Could Have and Future-tier Epics substantially delivered; the Master Vision document's Year-5 roadmap items become realistic. Most likely underestimate: this entire horizon's accuracy depends on every prior horizon having gone roughly as planned — a 10-year vision document should be substantially revised by its own Year 10, and this roadmap's 60-month projection should be treated as the most speculative entry in this section, re-validated at the 24-month and 36-month checkpoints rather than trusted as originally written.

## 14.8 The One Timeline Commitment This Roadmap Does Make

Regardless of how the specific month-by-month projections above land in practice: no patient-facing channel launches before its corresponding Foundation/Knowledge Engine/Operations Center go-live checklist items are independently verified complete. This is the one piece of sequencing in this entire timeline section that is not a projection subject to revision — it is a standing rule.

---

# SECTION 15 — Future Innovation Opportunities

## 15.1 Method

Per the brief's restriction, only ideas appropriate for a diagnostic centre. Every item below is already named in the Master Vision document's Sections 12-13; this section's contribution is the four-part structure the brief specifically requests (Business Benefit, Technical Complexity, Expected ROI, Recommended Timeframe), which that document did not impose on its own future-opportunities section.

| Opportunity | Business Benefit | Technical Complexity | Expected ROI | Recommended Timeframe |
|---|---|---|---|---|
| AI Preventive Health | Strengthens long-term patient relationship; diagnostic centres are unusually well-positioned for this since diagnostics is the service itself | Medium — mostly content/scheduling logic on top of existing patient history | Not quantifiable yet, time-dependent on accumulated patient history | Year 3 |
| Corporate Wellness Analytics | New revenue-generating capability, distinct from most other items which are internal-efficiency-focused | Medium-High, contingent entirely on Epic 17's scoping outcome | Not quantifiable, contingent on a business decision not yet made | Year 5, contingent |
| Predictive Scheduling | Reduces idle machine time, an unusually high-leverage, easily-calculated opportunity cost for a diagnostic centre | Medium, building on existing-constraint-respecting scheduling design | Plausible but unmeasured — machine-utilization data exists, the forecasting layer does not yet | Year 2 |
| Machine Utilization Optimization | Direct extension of already-confirmed machine status data | Low-Medium — mostly analysis/dashboard work on data that already exists | More measurable than most items on this list, since the underlying data is already real | Year 2 |
| Diagnostic Timeline / Patient Health Passport | Enabler for CRM and BI retention analysis | Medium | Not quantifiable yet, enabler-shaped value | Year 3-5 |
| AI Knowledge Engine (full staff-facing scope) | Foundation for every other AI capability in this roadmap; value independent of AI itself | Medium, mechanism already designed, only scope is new | Highest value-to-cost ratio of any single item in this section, though still not quantified in currency | Year 1, immediate |
| Referral Intelligence | Builds patient/doctor relationship data largely untracked today | Medium — requires structured referral-source fields not confirmed to currently exist | Not quantifiable, depends on confirming the underlying data gap first | Year 3 |
| Business Intelligence (full forecasting) | Eventually answers the ROI and revenue-impact questions this roadmap has repeatedly declined to fabricate | High, explicitly time-dependent not just engineering-dependent | The mechanism that will eventually quantify everything else's ROI — circular but honestly so | Year 5 |
| Predictive Maintenance | Prevents the one failure mode named as having no AI-side workaround | Medium-High, depends on Quality Intelligence's downtime-trend data maturing first | Outsized value relative to most predictive capabilities, since the disruption it prevents is unusually severe | Year 5 |
| Quality Monitoring (full Quality Intelligence scope) | Sustained, decade-long discipline of measurable improvement | Medium, synthesis layer over data multiple other Epics produce | Not quantifiable directly; value compounds over the program's lifetime | Year 2-3 |

## 15.2 What This Section Does Not Add

This roadmap does not introduce any innovation opportunity the Master Vision document did not already name. Producing a different list here would create exactly the document-contradicts-document risk this program's own rules warn against. This section's value is the structured framing, not new ideas.

---

# SECTION 16 — Executive Summary

Generated in full as a standalone document: `EXECUTIVE_SUMMARY.md`, intentionally kept separate and short so a board-level reader can stop there without needing this full roadmap. Every claim in that document is sourced from Sections 1-15 above; nothing in the standalone summary contradicts or extends beyond what this roadmap establishes.

---

**Status:** Final planning-phase document complete. No code, APIs, database tables, migrations, or existing architecture were created, modified, or redesigned. Every Epic, Feature, Story, Milestone, and timeline projection above is traceable to a specific prior document, or is explicitly marked as new ground this document introduces with its own reasoning shown.

**This roadmap's own first recommended action:** begin Milestone 1's two parallel tracks simultaneously — Epic 2's API work, and Epic 20's security-findings re-audit — since neither has any dependency and the security re-audit's true scope is the single largest unknown quantity in the entire 3-month horizon. Everything else in this roadmap can wait one sprint; confirming the true size of that unknown cannot wait without risk to every later timeline projection in Section 14.
