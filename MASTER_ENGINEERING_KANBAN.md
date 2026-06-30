# Master Engineering Kanban Board

**Status:** Working document, snapshot at planning-phase completion. No engineering work has begun under this roadmap — every story currently sits in Backlog or Future. This document's columns should be updated by the team as work proceeds; the backlog and this board are the living artifacts, not regenerated from the narrative roadmap going forward.

---

## Backlog
*(Ready to be picked up once dependencies clear; not yet actively planned for the current sprint)*

- 2.2.1 Idempotent patient lookup/register
- 2.3.1 Idempotent booking creation
- 2.3.2 Payment idempotency
- 3.1.1 Identity resolution before PII disclosure
- 3.1.2 Emergency red-flag escalation
- 3.2.1 Full booking flow via WhatsApp
- 6.1.1 Three-pane multi-channel feed
- 6.2.1 Context-packaged handoff items
- 7.1.1 Configurable escalation rules
- 7.2.1 Daily budget visibility
- 8.1.1 Payment idempotency chaos-testing
- 8.2.1 Adversarial report identity-gate testing
- 13a.2.1 Lab turnaround calculation
- 13a.3.1 Critical value flagging, contingent on 13a.1.1
- 20.2.1 Per-dependency failure-mode fallback behaviors

## Ready for Development
*(No blocking dependency; can start immediately)*

- 1.1.1 Create/edit KB entries
- 2.1.1 ai_caller role plus automated permission test
- 13a.1.1 Result-value location discovery, audit task
- 20.1.1 Prior audit findings closure, re-audit plus remediation

## In Development
*(empty — no work has begun)*

## Code Review
*(empty)*

## Testing
*(empty)*

## Ready for Production
*(empty)*

## Released
*(empty)*

## Future
*(Explicitly deferred — time-dependent, audit-dependent, or scope-dependent)*

- 1.2.1 Route knowledge gaps to category owner — needs a live AI face for meaningful testing
- 1.3.1 Revert single KB entry to previous version
- The remainder of the Conversation Flow suite beyond the core booking flow
- All Voice AI stories — sequenced behind WhatsApp's proof point
- All Website Assistant stories — sequenced behind WhatsApp
- Follow-up and CRM stories beyond core reminders — needs real patient interaction history
- Internal Staff Assistant stories — benefits from earlier Epics being proven first
- Forecasting-half stories — explicitly time-dependent, not engineering-schedulable
- Radiology AI Enhancement build-phase stories — blocked on its dedicated audit
- Laboratory AI Schema Layer build-phase stories — same audit-blocked reasoning
- Health Passport/Timeline, Marketing Intelligence, Quality Intelligence, Home Collection AI, Administration Intelligence — Could Have or lower priority, deferred past near-term sprints
- Corporate Diagnostics — blocked on a business decision outside engineering's authority

---

## Board Maintenance Notes

- WIP limits are not specified by this document — a team's actual WIP limit per column should reflect real team size and is outside this planning document's authority to prescribe.
- Definition of Done per column boundary: Code Review to Testing requires the testing requirements named in `MASTER_PRODUCT_BACKLOG.md`'s corresponding story to be written, not just passing. A story without its named adversarial, chaos, or permission test cannot move to Testing regardless of whether happy-path tests pass, given how many Must Have stories in this program are security or safety critical.
- Ready for Production to Released gate: for any story belonging to an Epic with a Milestone-level Go-live Checklist, that checklist's items take precedence over this board. A story can sit in Ready for Production indefinitely if its Milestone's checklist hasn't cleared, and that is correct, intended behavior, not a process failure.
