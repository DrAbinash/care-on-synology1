# Master Product Backlog

**Status:** Working document. Full detail populated for every Must Have Epic; Epic/Feature-level seeding only for the rest, to be expanded as each Epic approaches its Milestone — see `AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md` §4.1 for the reasoning behind this scoping.
**Columns:** Epic | Feature | Story | Priority | Dependencies | Estimated Effort | Suggested Owner | Status | Business Value | Technical Complexity

---

## Epic 1 — Knowledge Engine

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 1.1 Content Store & Categories | 1.1.1 Create/edit KB entries | Must Have | None | M | Backend | Not Started | High | Medium |
| 1.1 Content Store & Categories | 1.1.2 AI face queries KB | Must Have | 1.1.1 | M | Backend | Not Started | High | Medium |
| 1.2 Suggestion & Approval Lifecycle | 1.2.1 Route gaps to category owner | Must Have | 1.1.1 | M | Backend | Not Started | High | Medium |
| 1.3 Versioning & Rollback | 1.3.1 Revert single entry | Should Have | 1.1.1 | S | Backend | Not Started | Medium | Low |

## Epic 2 — AI Receptionist Foundation & Internal APIs

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 2.1 AI Caller Identity & Permission Scope | 2.1.1 ai_caller role + automated permission test | Must Have | None | M | Backend/Security | Not Started | Critical (enabler) | Medium |
| 2.2 Patient API | 2.2.1 Idempotent lookup/register | Must Have | 2.1.1 | M | Backend | Not Started | Critical (enabler) | Medium |
| 2.3 Booking/Appointment/Queue/Report/Payment/Notification APIs | 2.3.1 Idempotent booking create | Must Have | 2.2.1 | L | Backend | Not Started | Critical (enabler) | High |
| 2.3 Booking/Appointment/Queue/Report/Payment/Notification APIs | 2.3.2 Payment idempotency (reuse existing gateway mechanism) | Must Have | 2.3.1 | M | Backend/Payments | Not Started | Critical, highest-risk | High |

## Epic 3 — WhatsApp AI

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 3.1 Inbound Message Processing | 3.1.1 Identity resolution before PII disclosure | Must Have | Epic 2 | L | Backend/Security | Not Started | Critical | High |
| 3.1 Inbound Message Processing | 3.1.2 Emergency red-flag escalation | Must Have | Epic 1, Epic 6, Epic 7 | M | Backend | Not Started | Critical (safety) | Medium |
| 3.2 Booking via Conversation | 3.2.1 Full booking flow via WhatsApp | Must Have | Epic 2, Epic 1 | XL | Backend/Conversation | Not Started | High | High |

## Epic 6 — Reception Command Center

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 6.1 Unified Live Feed | 6.1.1 Three-pane multi-channel feed | Must Have | Epic 3 | L | Frontend | Not Started | High | Medium |
| 6.2 Human Handoff Queue | 6.2.1 Context-packaged handoff items | Must Have | Epic 3, Epic 7 | M | Frontend/Backend | Not Started | High | Medium |

## Epic 7 — AI Operations Center

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 7.1 Escalation Rules Configuration | 7.1.1 Configurable VIP/Emergency/refund routing, no-zero-path safeguard | Must Have | Epic 2 | M | Frontend/Backend | Not Started | High | Medium |
| 7.2 Provider Selection & Cost Governance | 7.2.1 Daily budget visibility and alerting | Should Have | Epic 2/3 | M | Frontend/Backend | Not Started | Medium | Medium |

## Epic 8 — Queue/Payments/Report Hardening

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 8.1 Payment Idempotency Under Real Traffic | 8.1.1 Chaos-test payment-initiate under real conditions | Must Have | Epic 2 (2.3.2), Epic 3 | M | Backend/QA | Not Started | Critical (risk-avoidance) | Medium |
| 8.2 Report Identity Verification Under Real Traffic | 8.2.1 Adversarial identity-gate testing | Must Have | Epic 3 (3.1.1) | M | Backend/QA/Security | Not Started | Critical (risk-avoidance) | Medium |

## Epic 13a — Laboratory Turnaround & Critical-Value Flagging

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 13a.1 Result-Value Location Discovery | 13a.1.1 Audit task — confirm schema location | Must Have | None | S | Backend (audit) | Not Started | Critical (blocks 13a.3) | Low |
| 13a.2 Turnaround Time Calculation | 13a.2.1 Lab TAT table + dashboard | Must Have | None | S | Backend/Frontend | Not Started | High | Low |
| 13a.3 Critical Value Flagging | 13a.3.1 Severity-based escalation | Must Have, contingent | 13a.1.1 | M | Backend | Not Started | Critical (patient safety) | Medium |

## Epic 20 — Business Continuity & Security Hardening

| Feature | Story | Priority | Dependencies | Effort | Suggested Owner | Status | Business Value | Tech Complexity |
|---|---|---|---|---|---|---|---|---|
| 20.1 Prior Audit Findings Closure | 20.1.1 Close 2 CRITICAL findings, independently verified | Must Have, blocking | None | Unknown (re-audit needed) | Security/IT | Not Started | Critical, blocking | Unknown |
| 20.2 Failure-Mode Fallback Behaviors | 20.2.1 Per-dependency safe-degrade behavior | Must Have, per-dependency | Built alongside Epics 3/4/5 | M (incremental) | Backend | Not Started | Critical (risk-avoidance) | Medium |

---

## Seeded (Epic/Feature Level Only) — Expand as Each Epic Approaches Its Milestone

| Epic | Features (Story-level detail pending) |
|---|---|
| 4 — Voice AI | Inbound Call Handling; TTS/STT Integration; Warm Transfer (capability-flagged); Missed Call Callback |
| 5 — Website Assistant | Web Chat Widget; Quick-Reply UI; Session Continuity |
| 9 — Follow-up & CRM | Appointment Reminders; Opt-out Management; Birthday Wishes; Health Package Reminders; Complaint Routing; Referral Acknowledgment |
| 10 — Internal Staff Assistant | Per-Role Query Scoping; Read-Only Retrieval; Write-Action Allowlist; Staff-Identity Audit Logging |
| 11 — Management Dashboard & BI | Daily/Weekly/Monthly Views; High-Maturity Display; Low-Maturity Forecasting |
| 12 — Radiology AI Enhancement | Dedicated Audit (discovery); Worklist Prioritization; Template Recommendation; QC Flagging |
| 13b — Lab AI Schema Layer | Dedicated Audit (discovery); AI Schema Design |
| 14 — Health Passport/Timeline | Longitudinal Aggregation View; Patient-Facing Passport UI; Staff-Facing Timeline UI; Identity-Gate Compliance |
| 15 — Marketing Intelligence | Content Drafting Assistant; Human-Approval Workflow; Channel Attribution |
| 16 — Quality Intelligence | Wait-Time/Turnaround Synthesis; Complaint-Trend Analysis; Downtime Trend; Bottleneck Detection; Aggregate Productivity View |
| 17 — Corporate Diagnostics | Workflow Scoping Audit |
| 18 — Home Collection AI | Collection Route/Schedule Optimization |
| 19 — Administration Intelligence | Configuration-Change Trend Reporting; KB Edit-Frequency Analysis |

**Owner key:** "Backend"/"Frontend" denote function, not a named individual — owner assignment to specific engineers happens at sprint planning, outside this document's scope. "Suggested Owner" here indicates which functional area should lead, since several stories (e.g. 2.3.2, 3.1.1, 8.1.1, 20.1.1) specifically need Security/Payments domain expertise, not generalist assignment.

**Status key:** Not Started (all items currently — this document reflects the planning phase, no engineering has begun under this roadmap). Future statuses (In Progress, Blocked, Done) update as work proceeds; this document does not pre-populate them.
