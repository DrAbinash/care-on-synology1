# Implementation Checklist

**Status:** Companion to `AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md`. This document converts the narrative gates referenced throughout the roadmap into literal, checkable items. Nothing here is new policy — every item is sourced from a prior document and restated as a checkbox specifically so it cannot be skipped under schedule pressure, which prior documents already named as a realistic risk.

---

## Gate 0 — Before Any Engineering Work Begins

- [ ] This roadmap and its six companion documents reviewed and accepted by engineering leadership.
- [ ] AI vendor (LLM provider) selected — no vendor selection had been made as of the Master Vision document.

## Gate 1 — Before Milestone 1 (Foundation & Security Closure) Is Considered Complete

- [ ] Every designed API category implemented and passing its idempotency test.
- [ ] AI-caller permission-matrix automated test exists, runs in CI, and confirms zero refund, delete, or radiologist-share-link permissions.
- [ ] The two unresolved CRITICAL findings from the prior full ERP security audit (default JWT/session secrets, default DB password) independently verified closed, not self-attested by whoever made the change.
- [ ] Super Admin redundancy confirmed: at least two staff members hold Super Admin-capable access.

## Gate 2 — Before Milestone 2 (Knowledge Engine) Is Considered Complete

- [ ] Hospital information content authored and approved.
- [ ] All active tests and packages represented in Knowledge Base content.
- [ ] Top 20 FAQs authored and approved.
- [ ] All preparation instructions for currently-offered modalities authored and clinically reviewed, not engineering-authored.
- [ ] Operational owners assigned by name, not just by role, for every content category.

## Gate 3 — Before Milestone 3 (AI Operations Center) Is Considered Complete

- [ ] An Admin has completed a real configuration change end to end without developer assistance.
- [ ] Attempting to disable all Escalation Rules is confirmed rejected by the system, not just discouraged by the UI.
- [ ] API key rotation tested for zero downtime.

## Gate 4 — Before Milestone 4 (WhatsApp AI) Goes Live to Any Real Patient

This is the highest-stakes gate in this checklist — every item below must be checked, none deferred.

- [ ] Gate 1 fully complete.
- [ ] Gate 2 fully complete.
- [ ] Gate 3 fully complete.
- [ ] Reception Command Center live and staff trained on it.
- [ ] Adversarial identity-gate testing passed, confirming no PII-bearing response possible from phone number alone.
- [ ] Every red-flag phrase in the Knowledge Base's clinical-escalation-trigger list tested individually for correct, fast escalation.
- [ ] Webhook-redelivery idempotency confirmed under load.
- [ ] Launch scope explicitly limited, allowlist or low-traffic window, not full-traffic on day one.
- [ ] Receptionist SOP trained and walked through by on-shift staff before go-live.

## Gate 5 — Before Any AI-Originated Payment Processes Real Money at Scale

- [ ] Basic chaos test passed at the Foundation milestone stage.
- [ ] Full hardening chaos test suite passed under real, not simulated, AI-originated traffic.
- [ ] Zero duplicate-charge incidents confirmed across the defined observation window.
- [ ] Per-channel kill switch for AI-originated payment initiation tested and confirmed functional.

## Gate 6 — Before Milestone 7 (Voice AI) Goes Live to Any Real Patient

- [ ] Gates 1-5 fully complete.
- [ ] Telephony fallback risk explicitly accepted or mitigated by leadership — a deliberate sign-off, not a default proceed.
- [ ] Voice-specific flow testing complete.
- [ ] Launch scope explicitly limited, same discipline as Gate 4.

## Gate 7 — Before Any Forecasting Output Is Shown to Management as Live Data

- [ ] Backtesting accuracy against held-out historical data meets a threshold leadership has explicitly defined in advance.
- [ ] Any forecast shown before that threshold is met carries explicit low-confidence labeling.

## Gate 8 — Before Radiology or Laboratory AI Schema Layer Build Work Begins

- [ ] Dedicated audit completed for the relevant domain, comparable in depth to the original audit of the Receptionist's core files.
- [ ] Audit findings confirm or correct every assumption this roadmap currently makes about the existing schema's actual behavior, not just its existence.

## Gate 9 — Before Corporate Diagnostics Receives Engineering Resource Beyond Scoping

- [ ] Business decision made by clinic leadership that this is a real, prioritized service line.
- [ ] Scoping audit confirms whether a Corporate Desk workflow currently exists in any form.

## Gate 10 — Standing Rules, Checked Continuously, Not Once

- [ ] No new database table created by this program lacks the foreign-key constraints the existing schema's convention would imply.
- [ ] No story belonging to a Must Have Epic ships without its named testing requirement.
- [ ] No marketing or social content publishes without human review.
- [ ] No AI-generated radiology or laboratory output is finalized without the relevant clinical professional's sign-off.

---

## How to Use This Document

Each Gate corresponds to a specific point in the master roadmap's Milestone sequence. A Gate is not mostly done or done except for one item — every checkbox in a Gate must be checked before the corresponding Milestone is considered complete for the purpose of unblocking whatever depends on it. This rigidity is intentional: a pilot which fails due to a skipped readiness item produces misleading signal — it looks like an AI-quality failure when it is actually a process failure — and that misdiagnosis is more costly to this program's credibility than a delayed launch.
