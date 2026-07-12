# Quick Wins

**Status:** Companion to `AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md` Section 9. Items here are selected for genuinely fast, low-cost delivery, not for being important — several Must Have Epics are far more important but are not quick by any honest estimate, and are deliberately excluded from this list to keep "quick" meaningful.

**Sorting principle:** by timeframe, then by ROI-to-cost ratio within each timeframe band. "Highest ROI / Lowest Engineering Cost" is reflected in ordering, not stated as a fabricated number, consistent with this program's standing refusal to invent currency figures without data to back them.

---

## 1 Day

### Result-Value Location Discovery
- What: Confirm where actual lab result values live in the schema.
- Why it's quick: Pure read-only schema/code investigation, no implementation.
- Why it matters: Blocks critical-value flagging entirely until resolved — the single highest-leverage one-day task in this program, since it unblocks a patient-safety-relevant capability.
- Engineering cost: Minimal — one engineer, one day, no new code shipped.

### Corporate Diagnostics Scoping Audit
- What: Confirm whether a Corporate Desk workflow currently exists in the ERP in any form.
- Why it's quick: Same nature as above, discovery not build.
- Why it matters: Resolves a question repeated across three prior documents without further engineering investment until the answer is known.
- Engineering cost: Minimal.

## 3 Days

### Birthday Wishes
- What: A simple, optional, non-promotional birthday message sent via existing WhatsApp infrastructure.
- Why it's quick: Patient date of birth is already captured; the WhatsApp send mechanism already exists — this is template content plus a scheduled trigger, not new infrastructure.
- Why it matters: Named explicitly in the Master Vision document for its low cost and genuine warmth — the kind of detail that contributes meaningfully to a remembered, not just processed, patient experience, at near-zero engineering cost.
- Engineering cost: Low — reuses existing send mechanism entirely; new work is a scheduled query plus a message template.

### AI-Caller Permission-Matrix Automated Test
- What: The automated test confirming the AI-caller role has zero refund, delete, or radiologist-share-link permissions.
- Why it's quick: A focused test suite, not a feature — can be written as soon as the permission-matrix structure exists, without waiting for the rest of the Foundation Epic.
- Why it matters: Security-critical and explicitly named in a prior document as something that should be encoded as an automated test, not just documentation — the cheapest possible insurance against the platform's most named permission-scope risk.
- Engineering cost: Low.

## 1 Week

### Lab Turnaround Time Tracking
- What: New lab-specific turnaround table, computed from the sample table's four already-existing timestamps.
- Why it's quick: Per the Laboratory correction's own finding — the data is already captured, only the read/aggregate layer is missing.
- Why it matters: Directly corrects a documented error in an earlier document, which incorrectly assumed this tracking already existed, and gives Laboratory supervisors genuinely new operational visibility.
- Engineering cost: Low-Medium — one new table, one computation job, one dashboard view.

### Radiology Dedicated Audit
- What: A code-level audit of what the roughly twenty existing radiology-AI tables actually do in practice, comparable in depth to the original audit of the Receptionist's core files.
- Why it's quick relative to its unlock value: One week of audit work unblocks an entire Epic that would otherwise remain permanently blocked, disproportionate leverage for the time invested.
- Why it matters: This audit had not been performed previously; building against assumed rather than audited schema semantics is a risk that has already materialized once in this program.
- Engineering cost: Medium — a full week of a senior engineer's time, but produces a document, not production code, so it carries none of the production-risk weight a build week would.

### Laboratory AI Schema Layer Dedicated Audit
- What: Same treatment as the Radiology audit above, applied to Laboratory's path toward an AI-specific schema layer.
- Why it's quick, why it matters, engineering cost: Identical reasoning to the Radiology audit, applied to the domain already identified as starting from a thinner base.

## 2 Weeks

### Knowledge Base Minimum Content — Top 20 FAQs and Hospital Information
- What: Author and approve the highest-priority subset of the minimum content checklist.
- Why it's quick relative to the full Knowledge Engine build: The service takes longer, but a useful initial content set can be authored in parallel using existing staff knowledge, without waiting for every engineering task to complete — content authorship and platform-building are parallel tracks, not sequential.
- Why it matters: This is the literal gate-checklist item that unblocks the WhatsApp AI milestone — starting it early shortens the critical path to the platform's highest-value near-term release.
- Engineering cost: None directly — this is a content/staff-time cost, not an engineering cost, which is precisely why it can run in parallel with engineering work rather than waiting behind it.

## 1 Month

### Machine Utilization Trend Dashboard
- What: A simple trend view over the already-existing machine status field, showing utilization and downtime patterns over time.
- Why it's quick relative to its strategic framing: A larger Predictive Maintenance vision is described elsewhere, but the trend-display layer alone, without any predictive modeling, is achievable quickly since the underlying data already exists and is confirmed real.
- Why it matters: Named as having outsized value relative to most predictive capabilities given how severe an unplanned machine outage's downstream disruption is — even the non-predictive trend view gives supervisors earlier warning than the status quo.
- Engineering cost: Medium — mostly a dashboard/query task over existing data, no new core capture.

## 3 Months

### Appointment Reminders
- What: Automated, opt-in reminders for upcoming appointments.
- Why it's quick at the 3-month mark rather than sooner: This genuinely depends on the Foundation through WhatsApp AI milestones being stable in production first, since it needs real patient interaction history and a stable Notification Adapter — cannot be pulled earlier the way the items above can.
- Why it matters: This has the most mature design of any item in the broader Follow-up/CRM Epic, with clear success criteria already defined — the lowest-ambiguity, most implementation-ready capability in that Epic once its dependencies clear.
- Engineering cost: Medium — reuses existing Notification Adapter infrastructure; new work is primarily the reminder-scheduling logic and opt-out enforcement.

---

## What Was Deliberately Excluded From This List

WhatsApp AI and the full Knowledge Engine build are the two highest-business-value items in this entire program, and both are explicitly not on this list. WhatsApp AI is rated XL effort; the Knowledge Engine is rated M effort but with organizational, not just engineering, dependencies that make "quick" a misleading label even at that size. Including them here to make this document look more impressive would undermine its actual purpose: helping a team find genuine fast wins to build momentum while the larger Must Have work is properly underway, not a relabeling of the main roadmap's priorities.
