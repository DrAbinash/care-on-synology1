# Master Release Plan

**Status:** Companion to `AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md` Section 13. Versioning is capability-based, not calendar-based — a version increments when its Milestones are genuinely complete and their gated checklist items clear, never on a fixed date.

---

## Version 1.1 — Foundation

- Features: AI Receptionist Foundation and Internal APIs, AI Operations Center, the security-findings-closure sub-scope of Business Continuity.
- Goals: Stand up the load-bearing architecture and close the platform's single largest named security risk before any patient-facing exposure.
- Business Impact: None directly visible to patients or general staff — this release exists to make every subsequent release safe.
- Risk: Medium — the Foundation Epic's reimplementation risk; the security sub-scope's schedule risk if deprioritized.
- Testing Requirements: Full permission-matrix automated test suite; idempotency tests for every write API; independent, not self-attested, verification of security-findings closure.
- Deployment Strategy: Internal-only. No external traffic, no patient visibility.
- Rollback Strategy: Per-API-category feature flags; trivial rollback since nothing patient-facing depends on this release yet.

## Version 1.2 — First Patient-Facing AI Channel

- Features: Knowledge Engine, WhatsApp AI, Reception Command Center, the Payments/Report hardening sub-scope, the WhatsApp-specific fallback sub-scope of Business Continuity.
- Goals: Launch the platform's first real patient-facing AI capability, on the channel with the highest existing readiness, to a limited audience first.
- Business Impact: First real data on AI Resolution Rate, Conversion Rate, and patient response — the data every later release's planning depends on.
- Risk: Medium-High — highest-stakes release in this plan, given it's the first real external exposure and includes the platform's highest-severity failure mode, payment duplicate-charge risk.
- Testing Requirements: Full Conversation Flow suite; adversarial identity-gate testing; webhook-redelivery idempotency load testing; payment chaos testing under real traffic.
- Deployment Strategy: Limited phone-number allowlist or low-traffic window first, not a full-traffic launch on release day. Graduated rollout based on observed AI Resolution Rate and zero critical incidents.
- Rollback Strategy: The existing AI-assistant-enabled kill switch — instant, complete revert to pre-AI WhatsApp behavior.

## Version 1.5 — Multi-Channel & Internal Tooling

- Features: Voice AI, Website Assistant, the core sub-scope of Follow-up Automation, Internal Staff Assistant, the Voice and Web-Chat fallback sub-scopes of Business Continuity.
- Goals: Extend the proven WhatsApp foundation to additional channels and add internal staff productivity tooling, sequenced with Voice deliberately after Website given its higher risk and complexity.
- Business Impact: Broader patient reach via Voice and Website; internal efficiency gains via Staff Assistant; reduced no-show rate via reminders.
- Risk: Medium-High for Voice specifically, the weakest redundancy story in the platform; Low for Website and Internal Staff Assistant.
- Testing Requirements: Voice-specific flow re-testing; per-role permission-boundary testing for Internal Staff Assistant; opt-out enforcement testing for reminders.
- Deployment Strategy: Sequential, not simultaneous — Website first, Voice second with its own limited-launch window, Internal Staff Assistant phased per role with Reception first.
- Rollback Strategy: Provider/PBX-level routing revert for Voice; widget removal for Website; standard internal-tool deprecation for Staff Assistant.

## Version 2.0 — Intelligence Layer

- Features: The data-display half of Management Dashboard, Laboratory Quick Wins, Quality Intelligence, the forecasting half of Business Intelligence once data-readiness permits.
- Goals: Turn the operational data earlier versions generated into management-visible insight, and close the Laboratory turnaround-tracking gap identified by the Laboratory module correction.
- Business Impact: Director-level visibility into platform performance; patient-safety improvement via faster lab critical-value escalation; process-improvement insight via Quality Intelligence.
- Risk: Low for the data-display and Laboratory items; Medium for forecasting, given the named risk of premature, confident-sounding-but-unreliable output.
- Testing Requirements: Data-accuracy reconciliation against source tables for every displayed metric; staff-productivity framing review; forecast-accuracy backtesting before any forecast is shown live.
- Deployment Strategy: Data-display and Laboratory items released as soon as ready; forecasting soft-launched with explicit low-confidence labeling until backtesting accuracy meets a leadership-defined threshold.
- Rollback Strategy: All display-only; reverting any item in this release has no data-integrity implication.

## Version 3.0 — Clinical AI Deepening & New Domains

- Features: Radiology AI Enhancement, Laboratory AI Schema Layer, Health Passport/Timeline, Marketing Intelligence, Home Collection AI, Administration Intelligence, Corporate Diagnostics if its scoping decision proceeded.
- Goals: Extend AI capability into the platform's deepest existing clinical investment, Radiology, and close the gap with its least-built clinical domain, Laboratory, while exploring genuinely new ground.
- Business Impact: Highest potential clinical value via Radiology/Laboratory workflow assistance; new business lines if Corporate Diagnostics proceeds; longest-horizon, least-certain ROI of any release in this plan.
- Risk: Medium across most items, gated by dedicated audits that have not yet been performed — this release's true scope and risk profile cannot be fully specified until those audits complete.
- Testing Requirements: Not fully definable until post-audit; the AI-assists-never-decides clinical boundary must be the central testing focus for whatever Radiology/Laboratory capability emerges.
- Deployment Strategy: Not fully definable until post-audit.
- Rollback Strategy: Not fully definable until post-audit, except for Marketing Intelligence and Home Collection AI, both well-understood today.

---

## Cross-Release Principle

No release in this plan ships a patient-facing capability without its corresponding Milestone Go-live Checklist having cleared. Version numbers in this document are a planning convenience for grouping related capability; they do not override the per-Milestone gating that governs whether any individual feature within a version is actually ready to ship.
