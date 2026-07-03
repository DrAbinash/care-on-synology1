# AI Receptionist — Phase 4: Operational Design

**Project:** Care Diagnostics ERP / RIS / PACS
**Status:** Design only. No code, migrations, routes, or APIs created.
**Builds on:** `01_CURRENT_ARCHITECTURE_AUDIT.md`, `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`, `03_AI_RECEPTIONIST_IMPLEMENTATION_BLUEPRINT.md`
**Scope of this document:** Not architecture (covered in `03_`). This is the **operational handbook** — how a receptionist, supervisor, administrator, and IT staff actually run the AI Receptionist day to day, once `03_`'s architecture is built.

This document assumes the reader has `03_` open alongside it. Where a capability is architecturally described there (e.g. Human Handoff, Escalation Rules, Provider Manager), this document does not re-derive it — it describes how a human uses it.

---

## Notation Used Throughout

Same convention as `03_`: **Exists** (already in the ERP today, confirmed by schema/code review), **Extend** (partially exists), **New** (does not exist, must be built as part of this project — and per the Phase 4 brief, *designed* here, not implemented).

---

# SECTION 1 — Reception Command Center

## 1.1 Design Principle

A receptionist today, per `01_`'s audit, works from the existing staff application (patient lookup, billing desk, queue/counter views). The Reception Command Center is **not a replacement application** — it is a new single screen *within* that same staff application shell (consistent with `03_` §6.4's "new tab within existing shell, not a separate app" rule for the Staff Inbox Bridge). The receptionist should never have a reason to open a second browser tab to see AI-channel activity.

## 1.2 Screen Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOP BAR: Clinic name | Date/Time | Staff name | Online staff count │ 🔔  │
├───────────────┬──────────────────────────────────┬───────────────────────┤
│               │                                  │                       │
│  LEFT RAIL    │         CENTER: LIVE FEED          │   RIGHT RAIL          │
│  (filters &   │   (unified, chronological,         │   (status panels)     │
│   channel      │    newest-first, color-coded)      │                       │
│   switches)    │                                    │                       │
│               │                                    │                       │
│  ☐ Calls       │  [Card] Emergency — Voice — 0:08    │  QUEUE STATUS         │
│  ☐ WhatsApp    │  [Card] VIP — WhatsApp — 0:42       │  Counter 1: Tok #14   │
│  ☐ Web Chat    │  [Card] Handoff — Web Chat — 1:10   │  Counter 2: Tok #9    │
│  ☐ QR          │  [Card] Booking — WhatsApp — 2:03    │  Reports: Tok #22     │
│  ☐ Walk-in     │  [Card] AI active — Voice — 3:15    │                       │
│               │  [Card] Missed call — 4:40           │  DOCTOR AVAILABILITY   │
│  ─────────    │  [Card] Payment pending — 5:01        │  Dr. Sharma  ● In     │
│  Priority:    │  ...                                 │  Dr. Rao     ○ Out    │
│  ☐ Emergency   │                                    │                       │
│  ☐ VIP         │                                    │  MACHINE STATUS        │
│  ☐ Normal      │                                    │  MRI-1   ● Active     │
│               │                                    │  CT-1    ● Active     │
│  Search: [___]│                                    │  USG-2   ⚠ Down       │
│               │                                    │                       │
└───────────────┴──────────────────────────────────┴───────────────────────┘
```

This is a three-pane layout, not a dashboard of disconnected widgets: **left rail filters what the center feed shows; right rail is always-visible context that doesn't scroll away.** This avoids the brief's explicit failure mode — "the receptionist should never need to switch between multiple screens."

## 1.3 Widget Inventory and Source Mapping

| Widget | Data source | Status |
|---|---|---|
| Live phone calls | Voice Gateway, via Telephony Provider driver (`03_` §7.3) | New (channel doesn't exist yet) |
| WhatsApp conversations | `whatsapp_conversations` table | **Exists** — extend the existing staff WhatsApp inbox UI into this feed rather than rebuilding it (per `03_` §6.4) |
| Website chat | Web Chat Gateway session store | New |
| QR enquiries | QR Gateway, reusing `barcode-resolver.ts` pattern (`01_` §2.5) | Extend |
| Walk-in patients | `tokens`/`test_tokens` where `source = 'walkin'` | **Exists** |
| Today's appointments | `appointments` table | **Exists** |
| Today's bookings | `online_bookings` table | **Exists** |
| Pending payments | Payment status on `online_bookings`/bills | **Exists** |
| Pending reports | Report status (`01_` §2.5's existing lookup) | **Exists** |
| Queue status | `tokens`/`test_tokens` + counter assignment | **Exists** |
| Emergency calls | Conversation flow 4.12 trigger (`03_`) | New (flow is designed, UI surfacing is new) |
| VIP patients | VIP flag — **location unconfirmed**, per `03_` §4.14's explicit caveat | Flagged unresolved — see §1.6 below |
| Human handoff queue | Context Packager output (`03_` §6.2) | New |
| Missed calls | Telephony Provider driver | New |
| Callback requests | Conversation flow 4.16 (`03_`) | New |
| Unread conversations | Per-channel "unread" flag, extending `whatsapp_conversations`-style tracking to all channels | Extend |
| AI conversations in progress | Conversation Manager session store | New |
| Staff currently online | Existing staff session/login tracking, if present — **to confirm during implementation**, not assumed | Extend or New (see note) |
| Doctor availability | `doctors` table — **confirm whether a live availability/in-clinic flag already exists**, or only static doctor records | Exists (records) / unconfirmed (live status) |
| MRI/CT/USG status | `modalities` table — **only has `is_active` (static config flag), not live operational/down status** | Partially exists — see §1.6 |
| Machine downtime | `machines` table — has a `status` text field (`active` default) already designed for this purpose | **Exists** — this is the one "downtime" data point genuinely ready to surface as-is |

## 1.4 Colour Coding

| Colour | Meaning | Used for |
|---|---|---|
| Red | Emergency / Critical | Emergency call cards, machine down, payment gateway failure banner |
| Purple | VIP | VIP patient cards, regardless of channel |
| Orange | Pending human action | Handoff queue items, pending payments aging beyond a configurable threshold |
| Blue | AI actively handling | Conversations where AI has not escalated |
| Grey | Informational / completed | Resolved conversations, completed tokens |
| Green | Available / healthy | Online staff, active machines, doctor "in" status |

Colour is never the *only* signal — every coloured card also carries a text label, for staff who are colourblind or working under bright ambient light (a real diagnostic-center reception condition).

## 1.5 Filters, Search, Keyboard Shortcuts, Notifications

- **Filters (left rail):** channel checkboxes + priority checkboxes, combinable (e.g. "VIP + WhatsApp only"). Filter state persists per staff login (a receptionist who always filters out QR enquiries shouldn't have to re-filter every shift).
- **Search:** single search box, searches across patient name/phone/booking ref/token number simultaneously — receptionist should never need to know *which* identifier they have before searching.
- **Keyboard shortcuts:** `/` focuses search (common convention); number keys `1`–`4` toggle priority filters; `Esc` clears all filters. Kept minimal and conventional — a reception desk under time pressure should not need to memorize a large shortcut set.
- **Notifications:** Emergency and VIP-priority new items trigger an audible + visual alert that persists until acknowledged (clicked), not a toast that auto-dismisses — an unacknowledged emergency must not silently disappear from view.
- **Priority indicators:** A small badge count per priority tier in the left rail (e.g. "Emergency (1)") so a receptionist glancing at the screen from across the room can register urgency without reading card content.
- **Escalation indicators:** Any card that has been sitting in "AI active, no resolution" state beyond a configurable time threshold (e.g. 5 minutes) automatically gains a visual "aging" indicator — distinct from the Human Handoff queue, since this is a softer signal ("this might need attention soon") rather than the hard signal of an explicit escalation.

## 1.6 Open Items Flagged for Phase 4 Implementation (Not Resolved Here)

Consistent with `03_`'s repeated discipline of not inventing fields that may already exist under a different name:

- **VIP flag location** — `03_` §4.14 already flagged this as unconfirmed. Repeated here because the Reception Command Center is the first place it becomes a *visible* operational gap, not just a conversation-flow detail.
- **Staff "currently online" tracking** — needs confirmation of whether existing staff session infrastructure already exposes a live online/offline signal, or whether this is new tracking to add.
- **Live doctor availability** — `doctors` table existing as a record store is confirmed; whether there's already an "in clinic today" / "on leave" live flag versus only static doctor profile data needs confirmation before this widget can be built as designed.
- **Live modality/equipment status** — `machines.status` is real and ready to use. `modalities` table has no equivalent live field — only a static `is_active` config flag. If real-time MRI/CT/USG operational status (as opposed to machine-level status) is required, this is a **New** data point, not an extension of existing schema, and should be scoped as such rather than assumed free.

---

# SECTION 2 — AI Operations Center

## 2.1 Design Principle

Every item in this section maps directly onto the **Administration APIs** category already designed in `03_` §3.2.9 (`GET/PUT /admin/ai-gw/v1/settings`, `/escalation-rules`, `/providers`) and the Knowledge APIs admin CRUD in `03_` §3.2.7. This section is the **UI** for those APIs — it does not introduce new backend capability beyond what `03_` already scoped. Where this section asks for something `03_` didn't cover (e.g. Cost Limits, Testing Sandbox), that gap is named explicitly as a blueprint addendum, not silently assumed to already exist.

## 2.2 Module Layout

```
AI Operations Center
├── Conversation Design
│   ├── Prompt Management        (system prompts per channel/flow)
│   ├── Greeting Messages        (per channel, per language)
│   ├── Language Selection       (enable/disable languages — ties to 03_ §4.15)
│   └── Voice Selection          (TTS voice per language, voice channel only)
│
├── Schedule & Availability
│   ├── Business Hours           (extends existing clinic-settings concept — 03_ §4.18)
│   └── Holiday Calendar         (extends existing concept if present, else new)
│
├── Knowledge Base               (admin CRUD UI for 03_ §3.2.7 / Deliverable 5)
│
├── Policy & Safety
│   ├── Escalation Rules         (UI for 03_ §6.3 table)
│   ├── Conversation Policies    (turn limits, off-topic handling — see §2.5)
│   ├── Allowed Actions          (UI view of ai_caller permission grants — 03_ §8.2)
│   ├── Blocked Actions          (UI view of ai_caller permission denials — 03_ §8.2)
│   ├── Safety Rules             (prompt-injection guardrails reference — 03_ §8.7)
│   ├── Patient Privacy          (identity-verification gate config — 03_ §8.3)
│   └── Call Recording Policy    (consent/retention config — 03_ §8.12, §8.14, §8.15)
│
├── Provider & Cost Control
│   ├── Provider Selection       (UI for 03_ §7.2/§7.3 driver config)
│   ├── Model Selection
│   ├── Fallback Models          (UI for 03_ §7.2 fallback-provider design)
│   ├── API Keys                 (secret management — see §2.6 security note)
│   ├── Cost Limits              [New — not scoped in 03_, addendum below]
│   ├── Usage Limits             [New — addendum below]
│   ├── Daily Budgets            [New — addendum below]
│   └── Monthly Budgets          [New — addendum below]
│
├── Monitoring (summary view — full detail in Section 7 of this document)
│   ├── Analytics                (UI for 03_ Deliverable 9)
│   ├── Conversation History     (UI for 03_ §3.2.10 transcript endpoint)
│   ├── Error Logs
│   └── Performance Metrics
│
└── Change Management
    ├── Version History          [New addendum — see §2.7]
    ├── Prompt Versioning        [New addendum — see §2.7]
    ├── Rollback                 [New addendum — see §2.7]
    └── Testing Sandbox          [New addendum — see §2.8]
```

## 2.3 Permission Model for This Module

Per `03_` §3.2.9: this entire module is gated behind `requireStaffAuth` + `requireStaffPermission`, restricted to Admin/Super Admin roles only — **not** available to Reception-level staff, consistent with `03_`'s explicit reasoning that misconfiguration here is a patient-safety-adjacent risk. This document does not relax that restriction.

Within Admin/Super Admin, two sub-tiers are recommended (new refinement, not in `03_`):

- **Admin** — can edit Knowledge Base, Greeting Messages, Business Hours, view Analytics/Logs.
- **Super Admin only** — can edit Escalation Rules, Allowed/Blocked Actions, Provider Selection, API Keys, Cost/Budget Limits, and use Rollback. These are the settings where a mistake has the highest blast radius (e.g. accidentally widening `ai_caller` permissions, or disabling escalation entirely — which `03_` §3.2.9 already says must be impossible to do silently).

## 2.4 Prompt Management — Operational Detail

`03_` establishes that clinical/policy *content* lives in the Knowledge Base, never hard-coded into prompts (§5.2). Prompt Management in this operations center is therefore narrower in scope than it might sound — it manages the **conversational behavior layer** (tone, turn-taking style, how the AI asks clarifying questions), not facts. A prompt edit screen should make this boundary visible to the admin editing it: a warning if free text resembling a phone number, price, or medical instruction is typed directly into a prompt field, suggesting "this looks like it belongs in the Knowledge Base instead."

## 2.5 Conversation Policies (New Addendum)

`03_` did not explicitly design configurable conversation-level limits beyond per-API rate limits (§3.2). This document adds:

- **Max turns per conversation** before forced escalation (protects against a patient or a malfunctioning AI looping indefinitely — distinct from the per-API rate limits, which protect the backend; this protects the *patient experience*).
- **Off-topic handling policy** — configurable response when a patient asks something entirely outside clinic scope (e.g. general medical advice unrelated to any service the clinic offers): redirect to Knowledge Base topics, or escalate, configurable by admin rather than hardcoded.

## 2.6 API Keys — Security Note

This screen must **never display a stored API key in plaintext** after initial entry (write-only field, same pattern likely already used for any existing third-party credentials elsewhere in the ERP — e.g. WhatsApp's `access_token` per `01_` §2.4 is described as a settings field, and the existing pattern for such fields in this codebase should be followed, not reinvented). Key rotation should be supported without downtime (enter new key, verify, then retire old key — not edit-in-place).

## 2.7 Version History, Prompt Versioning, Rollback (New Addendum)

Not scoped in `03_`. Addendum design:

- Every change to Prompt Management, Knowledge Base entries (already versioned per `03_` §5.2 point 4), Escalation Rules, and Provider Selection is recorded with who/when/what-changed/previous-value.
- **Rollback** restores a previous version of a *single* setting category (e.g. "revert WhatsApp greeting to yesterday's version") — not a whole-system snapshot rollback, which would be far riskier to reason about and isn't needed for the realistic failure mode (a bad prompt edit, not a catastrophic multi-setting failure).
- Rollback itself is logged as a change, with the same who/when record — a rollback is not exempt from the audit trail it's restoring.

## 2.8 Testing Sandbox (New Addendum)

Not scoped in `03_`. Addendum design:

- A conversation interface, visually similar to the live chat widget, but explicitly watermarked "TEST MODE — no real patient data, no real bookings created."
- Runs against the same Conversation Manager and Provider Manager as production, but all adapter calls (Booking, Payment, Queue, Notification — `03_` §3.2) are routed to a **mock mode** that returns realistic sample responses without writing to any real table. This reuses the real conversation logic (so testing is meaningful) while guaranteeing zero risk to production data — the same idempotency/permission infrastructure doesn't need a parallel "test" implementation, it needs a flag the adapters respect.
- Used by Admin/Super Admin before publishing any Prompt Management or Knowledge Base change to production — recommended as a soft gate (a "test this first" prompt), not a hard-blocking requirement, since over-gating routine small edits (e.g. fixing a typo) would slow down legitimate Knowledge Base maintenance (Section 6 of this document).

## 2.9 Cost Limits, Usage Limits, Daily/Monthly Budgets (New Addendum)

Not scoped in `03_` (which designed the Provider Manager's vendor-swapping capability, but not cost governance). Addendum design:

- **Daily Budget** and **Monthly Budget** — configurable spend ceilings per provider (LLM token costs, telephony per-minute costs, SMS per-message costs once wired). On approaching threshold (e.g. 80%), Admin receives an alert (see Section 7's notification design). On reaching 100%, behavior is **configurable**, not automatically destructive: options should include "alert only, continue serving patients" (recommended default — a diagnostic center should not silently stop helping patients because of a budget number) or "fall back to Offline Mode" (`03_` §4.17) for genuinely cost-constrained deployments. The choice is the clinic's, not an architectural default this document imposes.
- **Usage Limits** — per-channel or per-patient caps (e.g. max AI-handled conversations per patient per day), primarily an abuse-prevention control rather than a cost control, though it serves both.
- Cost data sourced from Provider Manager driver responses (most LLM/telephony/SMS providers report token/minute/message usage in their API responses) — aggregated, not separately metered by this system, avoiding a second source of truth for spend that could drift from the vendor's own billing.

---

# SECTION 3 — Hospital Workflow Integration

## 3.1 Method

For each department, this section states: **Current workflow** (as established by `01_`/`02_`'s code review, not assumed), **Future AI workflow**, **Human responsibility**, **AI responsibility**, **Escalation point**. Where `01_`/`02_` did not directly examine a department's existing workflow, that gap is stated rather than invented.

## 3.2 Reception

| | |
|---|---|
| **Current workflow** | Walk-in registration via `patients`/`patient_counter` (Exists, `01_` §2.1); phone/WhatsApp enquiries handled manually by staff today. |
| **Future AI workflow** | New-patient and existing-patient identification flows (`03_` 4.1/4.2), routine enquiry answering via Knowledge Base, booking creation via Booking Engine Adapter. |
| **Human responsibility** | Walk-in physical registration (AI does not replace in-person desk interaction); identity disambiguation beyond 2 failed attempts (`03_` §6.3); all final judgment calls on ambiguous patient situations. |
| **AI responsibility** | Pre-qualifying remote enquiries before they reach a human; routine booking/rescheduling/cancellation (`03_` 4.3–4.5); first-line FAQ/price/prep answers. |
| **Escalation point** | Any flow's defined escalation triggers (`03_` §6.3 table) — explicit request, emergency, refund, ambiguous match, provider failure. |

## 3.3 Billing

| | |
|---|---|
| **Current workflow** | Bill creation/payment tied to bookings (Exists — `billsTable`, `paymentsTable`, confirmed in `02_`'s schema review). |
| **Future AI workflow** | AI can state prices (`03_` 4.6 Price Enquiry), initiate payment for AI-originated bookings (`03_` §3.2.6), and explain refund *policy* from the Knowledge Base. |
| **Human responsibility** | All refund **execution** — `03_` §3.2.6 explicitly excludes refund permission from the `ai_caller` role; this is a hard boundary, not a current limitation to be lifted later, because refunds touch accounting/commission logic gated by existing `requireStaffPermission` (`01_` §2.6). |
| **AI responsibility** | Payment initiation, payment status communication, normalized failure explanation (`03_` §3.2.6's `CARD_DECLINED`/`TIMEOUT`/etc. categories). |
| **Escalation point** | Any refund request (`03_` 4.10, unconditional); payment failure beyond the configured retry limit (`03_` §3.2.6). |

## 3.4 Radiology

| | |
|---|---|
| **Current workflow** | Per `02_`'s audit, radiology already has the most extensive existing AI-adjacent schema in the ERP (`aiDicomFindings`, `aiPromptLibrary` structured around imaging modalities, `radiologyWorklist`, etc.) — this is clinical-AI infrastructure, distinct from the receptionist's patient-facing scope. |
| **Future AI workflow** | The AI Receptionist's involvement with Radiology is **scheduling and prep-instruction delivery only** (`03_` 4.11) — it does not touch reporting, findings, or the existing radiology-AI tooling. This boundary is deliberate: conflating "AI Receptionist" with "AI radiology reporting" would violate `03_`'s core "single source of truth, no parallel system" principle by blurring two genuinely different AI subsystems with different risk profiles. |
| **Human responsibility** | All clinical reporting workflow (entirely outside this document's scope — owned by existing radiology-AI tooling per `02_`). |
| **AI responsibility** | Booking MRI/CT/USG slots; delivering prep instructions (`03_` 4.11) verbatim from Knowledge Base; report-ready status checks (`03_` 4.8) without revealing findings content beyond what the existing patient-facing report delivery mechanism already exposes. |
| **Escalation point** | Any question that strays from scheduling/prep into clinical interpretation — see Section 4 of this document for the explicit boundary. |

## 3.5 Laboratory

| | |
|---|---|
| **Current workflow** | Sample collection tied to orders (`samples` table exists per schema review); not deeply audited in `01_`/`02_` beyond confirming the table exists. |
| **Future AI workflow** | Booking lab tests (same Booking Engine Adapter as any other test type — `03_` does not distinguish lab from imaging tests at the booking-API level, correctly, since `tests`/`packages` tables are modality-agnostic per `02_`); fasting/prep instructions (`03_` 4.11's pattern, lab-specific Knowledge Base content per `03_` §5.1's table). |
| **Human responsibility** | Sample collection itself; any result-interpretation question. |
| **AI responsibility** | Scheduling, fasting-instruction delivery, report-ready status. |
| **Escalation point** | Same pattern as Radiology — any drift from logistics into interpretation. |

## 3.6 MRI / CT / Ultrasound (as distinct operational desks, beyond general Radiology)

| | |
|---|---|
| **Current workflow** | Each modality likely has its own physical scheduling constraint (machine availability, technician shift) — `01_`/`02_` confirm `machines` table exists with department/status fields, but did not audit modality-specific scheduling logic in depth. |
| **Future AI workflow** | Booking availability checks (`03_` §3.2.2 `GET .../availability`) must reflect real machine/slot constraints — this requires the existing booking-availability logic (whatever currently prevents staff from double-booking a single MRI machine) to be the source of truth the AI Receptionist's availability check calls into, **not** a simplified AI-side approximation of capacity. This is a direct application of `03_`'s "adapters never bypass existing business rules" principle, named explicitly here because modality capacity is exactly the kind of rule an under-scoped AI integration could accidentally approximate instead of correctly delegate. |
| **Human responsibility** | Machine-down rescheduling of already-booked patients (a judgment call involving multiple patients' competing needs — not delegated to AI). |
| **AI responsibility** | Standard booking flow once availability is correctly sourced as above; prep instructions (4.11). |
| **Escalation point** | Machine marked down (`machines.status` not equal to `active`) mid-conversation — booking flow must re-check availability live, not rely on a stale cached slot list, and should escalate to human if the AI cannot find an alternative within the conversation. |

## 3.7 Sample Collection

| | |
|---|---|
| **Current workflow** | Tied to orders/samples; home-collection messaging already exists as a clinic-settings field (`homeCollectionMessage`, confirmed in schema review) — meaning home collection is already a recognized service line, not a new concept this project introduces. |
| **Future AI workflow** | AI can offer home collection as an option during booking (4.3) using the existing `homeCollectionMessage` content, and coordinate collection scheduling via the same Booking Engine Adapter. |
| **Human responsibility** | The physical collection visit; any address/access logistics beyond what a structured booking form captures. |
| **AI responsibility** | Informing patients home collection exists and is available for relevant tests; capturing collection address as part of booking. |
| **Escalation point** | Address ambiguity or special access instructions (gated community, specific timing constraints) — handed to human rather than AI attempting free-text address parsing into a structured field. |

## 3.8 Report Delivery

| | |
|---|---|
| **Current workflow** | Fully exists — WhatsApp report delivery via `report_message_template`, `radiology_share_links` (Exists, `01_` §2.5). |
| **Future AI workflow** | AI Receptionist becomes one more *trigger* for the existing delivery mechanism (`03_` 4.8, §3.2.5) — it does not change how reports are delivered, only adds a conversational way to request delivery/re-delivery. |
| **Human responsibility** | None new — this is the department where AI involvement is most purely additive with the least workflow change, because the underlying mechanism is already mature. |
| **AI responsibility** | Status check, share-link minting (idempotent within a window per `03_` §3.2.5), identity verification before any link is sent (`03_` §8.3). |
| **Escalation point** | Report not found (`03_` 4.8's `Not found` branch) — possible patient/record mismatch, handed to human rather than AI guessing. |

## 3.9 Administration

| | |
|---|---|
| **Current workflow** | Existing staff permission/settings administration (Exists, per `01_` §2.6). |
| **Future AI workflow** | The AI Operations Center (Section 2 of this document) is itself the new administrative surface — Administration department staff are the primary users of Section 2, not subjects of AI assistance from a patient-facing AI. |
| **Human responsibility** | All AI Operations Center configuration (Section 2). |
| **AI responsibility** | None directly — though the Internal Staff Assistant (Section 5 of this document, `03_` Phase 11) may eventually serve Administration staff queries about system configuration in natural language, as a read/query convenience layer, not a replacement for the Section 2 control surface. |
| **Escalation point** | N/A for this department in the patient-facing sense. |

## 3.10 Management

| | |
|---|---|
| **Current workflow** | Not directly audited in `01_`/`02_` — assumed to consume existing reporting/analytics (commission reports, audit reports per `02_`'s email-system findings) rather than operate patient-facing workflows directly. |
| **Future AI workflow** | Primary new touchpoint is the Monitoring Dashboard (Section 7 of this document, mapping to `03_` Deliverable 9 Analytics). |
| **Human responsibility** | Strategic decisions informed by AI Receptionist analytics (e.g. staffing adjustments based on Peak Hours data). |
| **AI responsibility** | Surfacing the data; Management retains all decision authority — analytics inform, they do not direct. |
| **Escalation point** | N/A. |

## 3.11 Doctor Reception (distinct from general Reception — visiting/consulting doctor check-in)

| | |
|---|---|
| **Current workflow** | Doctor records exist (`doctors` table); whether a distinct "doctor reception" desk workflow exists separately from general patient reception is **not confirmed** by `01_`/`02_`'s review — flagged as an open question rather than assumed. |
| **Future AI workflow** | If this is a genuinely distinct desk/workflow, the AI Receptionist's involvement (if any) should be scoped during Phase 4 implementation after confirming the actual current workflow — this document does not invent one. |
| **Human responsibility** | TBD, pending confirmation above. |
| **AI responsibility** | TBD. |
| **Escalation point** | TBD. |

## 3.12 Insurance

| | |
|---|---|
| **Current workflow** | Not confirmed present in `01_`/`02_`'s schema review (no `insurance` table was identified in the table inventory `02_` produced). |
| **Future AI workflow** | `03_` §5.1 already flags Insurance as a Knowledge Base category needing **New** content "if applicable to this clinic" — this document inherits that same uncertainty. If insurance processing is a real operational need, it requires its own scoping pass before an AI workflow can be designed against it. Not assumed here. |
| **Human responsibility** | Entire insurance workflow, until/unless scoped. |
| **AI responsibility** | At most, informational answers from Knowledge Base if such content is authored — no claims processing. |
| **Escalation point** | Any insurance question beyond static informational content — immediate handoff. |

## 3.13 Corporate Desk

| | |
|---|---|
| **Current workflow** | Not confirmed present in `01_`/`02_`'s review — no corporate-client-specific table or workflow was identified. |
| **Future AI workflow** | Same treatment as Insurance — not assumed to exist as a distinct workflow; if the clinic operates a corporate-client desk, this needs its own scoping pass before AI involvement is designed. |
| **Human responsibility** | Entire workflow, until/unless scoped. |
| **AI responsibility** | None assumed at this time. |
| **Escalation point** | N/A pending scoping. |

## 3.14 Summary Table

| Department | AI Readiness for this workflow | Confidence |
|---|---|---|
| Reception | High — most-designed flows in `03_` | High |
| Billing | Medium — payment-initiate yes, refund explicitly excluded | High |
| Radiology (scheduling/prep) | Medium — bounded scope, clean boundary from clinical AI | High |
| Laboratory | Medium — same pattern as Radiology | Medium (less granular schema audit) |
| MRI/CT/USG (modality-specific) | Medium — depends on confirming real availability-source delegation | Medium |
| Sample Collection | Medium-High — existing home-collection messaging is a head start | Medium |
| Report Delivery | High — most mature existing mechanism, least new work | High |
| Administration | N/A (AI Ops Center is the interface, not a workflow recipient) | High |
| Management | Low direct AI involvement, high analytics value | High |
| Doctor Reception | Unconfirmed | Low — needs scoping |
| Insurance | Unconfirmed | Low — needs scoping |
| Corporate Desk | Unconfirmed | Low — needs scoping |

---

# SECTION 4 — Clinical Assistance

## 4.1 Governing Principle

**The AI never diagnoses.** This is not a configurable policy — it is a structural constraint expressed the same way `03_` expressed the refund boundary (§3.2.6): not "the AI is instructed not to diagnose" (a prompt-level promise, which `03_` §8.7 already identifies as insufficient against prompt injection) but "the AI has no clinical-interpretation action in its available action schema" (a permission-level fact, validated the same way `03_` §8.7 validates any proposed AI action against real permission/business-rule constraints before execution). A diagnosis isn't a database write the way a refund is, so this boundary is enforced differently — through **conversation flow design and Knowledge Base content boundaries**, detailed below, rather than through the `ai_caller` permission matrix.

## 4.2 The Three-Bucket Question Model

Every patient question the AI might receive falls into one of three buckets. This model is the operational core of this section.

**Bucket 1 — Logistics** (AI answers directly, from Knowledge Base/Booking APIs). "What time do you open?" "How much is an MRI?" "Do I need to fast for this test?"

**Bucket 2 — Guidance toward the right service** (AI may ask clarifying questions, then route to booking or escalation — never interprets symptoms). "I have a headache, what test do you recommend?" The AI does not diagnose the headache. It may ask clarifying logistics questions and then either state that the clinic offers a relevant pre-approved package (sourced from Knowledge Base content a doctor has approved as a standard offering), or, if no such pre-approved mapping exists, escalate rather than improvise a recommendation.

**Bucket 3 — Clinical interpretation** (always escalate, no AI response beyond escalation). "Is this finding serious?" "What does my report mean?" "Should I be worried about X result?"

## 4.3 Per-Topic Design

For each topic: **Questions AI may ask**, **Questions AI must never ask**, **When to escalate**, **When to recommend emergency consultation**, **When to stop the conversation**.

### Pregnancy
- **May ask:** Which trimester (routing to correct USG package/prep instructions only); whether this is a routine scheduled scan or an urgent concern.
- **Must never ask:** Anything resembling clinical risk-assessment (bleeding, pain severity, fetal movement) — these are triage questions a doctor asks, not a receptionist.
- **Escalate when:** Any mention of pain, bleeding, or urgent/emergency language — immediately, per Emergency Call flow (`03_` 4.12).
- **Emergency consultation recommended when:** Above triggers fire — AI states the clinic's emergency contact (Knowledge Base content) and stops attempting to book a routine scan.
- **Stop conversation when:** Patient describes acute symptoms.

### Trauma
- **May ask:** Logistics only — has a doctor referred you for this scan (routing question).
- **Must never ask:** Mechanism of injury, pain scale, neurological symptoms.
- **Escalate when:** Any trauma-related enquiry at all, immediately — inherently time-sensitive, outside safe AI scope by default.
- **Emergency consultation recommended when:** Always, for trauma.
- **Stop conversation when:** Immediately upon trauma being mentioned, after stating emergency contact info.

### Stroke
- **May ask:** Nothing clinical — this topic should never reach a clarifying-question stage.
- **Must never ask:** Any symptom question whatsoever — stroke is the canonical "every minute matters, AI must not delay" case.
- **Escalate when:** Immediately, unconditionally, on any stroke-related keyword/intent.
- **Emergency consultation recommended when:** Always, immediately, as the first response — bypasses even the standard Emergency Call framing and goes straight to "call emergency services now."
- **Stop conversation when:** Immediately.

### Headache
- **May ask:** Whether this is for a routine/scheduled scan vs. a new concern (logistics routing only).
- **Must never ask:** Severity, duration as a diagnostic signal, associated symptoms.
- **Escalate when:** Patient volunteers "worst headache of my life," sudden onset, or stroke-adjacent language — should trigger the Stroke pathway above.
- **Emergency consultation recommended when:** Red-flag language per above.
- **Stop conversation when:** Red-flag language detected.

### Fever
- **May ask:** Logistics — which test/package is being booked, fasting requirements if relevant.
- **Must never ask:** Temperature, duration as a triage signal, associated symptoms.
- **Escalate when:** High fever with confusion/breathing difficulty or similar severe-illness language.
- **Emergency consultation recommended when:** Above triggers fire.
- **Stop conversation when:** Severe-illness language detected.

### Diabetes
- **May ask:** Logistics for fasting-blood-sugar-test booking (have you fasted today — a scheduling question, not clinical).
- **Must never ask:** Current readings, medication questions, symptom questions.
- **Escalate when:** Acute symptoms (hypo/hyperglycemic crisis language).
- **Emergency consultation recommended when:** Above triggers fire.
- **Stop conversation when:** Acute symptom language detected.

### Hypertension
- **May ask:** Logistics only, same pattern as Diabetes.
- **Must never ask:** Current BP readings, medication questions.
- **Escalate when:** Severe symptom language (chest pain, severe headache, vision changes).
- **Emergency consultation recommended when:** Above triggers fire.
- **Stop conversation when:** Same triggers.

### Emergency
- This is `03_` 4.12 directly. Operationally: the AI's job here is to be fast and minimal, not conversationally thorough — stating the emergency number and escalating beats any attempt at a warm, extended response.

### Health Packages
- **May ask:** Standard logistics — age, gender, which package category interests them.
- **Must never ask:** Symptom-based questions to "recommend" a package beyond pre-approved Knowledge-Base package-to-concern mappings — package recommendation (`03_` 4.7) must stay within doctor-approved definitions, never an AI-improvised bundle.
- **Escalate when:** Patient describes symptoms while asking about packages — redirect to the relevant clinical bucket instead.
- **Stop conversation when:** N/A under normal package enquiry.

### Vaccination
- **May ask:** Which vaccine (if the clinic offers vaccination services — **not confirmed** as an existing service line in `01_`/`02_`'s audit; flagged as needing confirmation before this pathway is built), age (logistics only).
- **Must never ask:** Medical history, allergy screening.
- **Escalate when:** Any medical-history-adjacent question arises.
- **Stop conversation when:** N/A under normal flow.

### Executive Health Check
- **May ask:** Standard logistics, package selection.
- **Must never ask:** Health-status pre-screening beyond what a structured booking form already captures.
- **Escalate when:** Patient volunteers a specific health concern motivating the check.
- **Stop conversation when:** N/A under normal flow.

### MRI / CT / Ultrasound / Laboratory Preparation
- Operationally identical; already designed at the conversation-flow level in `03_` 4.11. Prep instructions are relayed **verbatim** from Knowledge Base, never paraphrased or extended with AI-generated medical advice — this is where the consequence of violating that rule becomes concrete: an AI that "helpfully" adds beyond the doctor-approved prep text has crossed from logistics into clinical guidance.
- **May ask:** Which scan/test, confirming patient has received prep instructions.
- **Must never ask:** Anything eliciting a clinical reason requiring prep modification (e.g. "I'm diabetic, should I still fast?") — this specific question must escalate, not be answered by AI improvisation.
- **Escalate when:** Any prep-modification question tied to a health condition.

## 4.4 Red-Flag Language — Operational List

Escalation triggers above depend on a maintained list of red-flag phrases/intents ("worst headache of my life," "chest pain," "can't breathe," "bleeding," "unconscious"). This list:

- Lives in the **Knowledge Base** (a specialized category, "Clinical Escalation Triggers," per `03_` §5.1's structure), not hard-coded into the AI's prompt — same editability/audit reasoning `03_` §5.2 already established.
- Should be **clinically authored/reviewed**, not engineering-authored — same treatment `03_` §5.1 gives PCPNDT FAQs and prep instructions.
- Triggers immediate escalation **regardless of conversation flow state** — interrupts a routine booking flow exactly like Emergency Call (`03_` 4.12) interrupts any other flow.

## 4.5 Why "Duration" Questions Are Singled Out

Several topics above note a duration question may be asked for logistics only, never as a diagnostic signal. Named explicitly because it's the most likely place a well-intentioned design could drift into clinical triage without anyone deciding it should — "how long have you had this" feels like an innocuous follow-up, but it's also the first question a doctor asks when triaging severity. The operational rule: if the AI's next action based on the answer would differ in a clinically meaningful way, it has crossed the line.

---

# SECTION 5 — Internal Staff AI Assistant

## 5.1 Relationship to `03_` Phase 11

`03_` Deliverable 10 Phase 11 already establishes the core design: same Provider Manager and Knowledge Base infrastructure as the patient-facing AI, authenticated via existing staff login (not the `ai_caller` credential, since this is human-operated), and constrained so "a staff member using this assistant can only see/do what their existing role already permits, full stop." This section operationalizes that — what it looks like day to day, per role.

## 5.2 One Engine, Role-Scoped Views — Not Seven Engines

The brief asks to design "one AI engine serving multiple staff roles." The operational implication: there is a single Internal Staff Assistant conversation interface, and the **permission matrix already governing staff actions throughout the ERP** (per `01_` §2.6, extended for `ai_caller` in `03_` §8.2) is reused unmodified to filter what each logged-in staff member's queries can retrieve or trigger. A Reception-role staff member and a Billing-role staff member see the same chat interface; they simply get different answers to the same question, exactly as they would get different menu options in the existing staff UI today.

## 5.3 Per-Role Design

### Reception
- **Allowed commands (examples):** "What's today's queue look like?" "Find patient by phone [number]." "Is Dr. Sharma in today?" "How many WhatsApp conversations are unread?"
- **Restricted commands:** Any financial query ("what's today's revenue") — blocked the same way the existing UI would block a Reception-role staff member from opening a Billing report.
- **Conversation example:**
  > Staff: "Any patients waiting more than 20 minutes?"
  > Assistant: "Token #14 (Counter 1) — 24 min. Token #9 (Counter 2) — 8 min."
- **Audit logging:** Logged under the staff member's own identity (not `ai_receptionist`), consistent with `03_` §3.3 rule 4's distinction between AI-originated and human-originated actions — this assistant is a *tool a human uses*, so its actions are attributed to that human, the same as if they'd clicked through the UI manually.

### Billing
- **Allowed commands:** "Show pending payments over ₹1000." "Has booking [ref] been paid?" "What's the refund policy for cancellations within 24 hours?" (Knowledge Base query — informational, not an action).
- **Restricted commands:** Cannot *execute* a refund through the assistant — same as the patient-facing AI's restriction (`03_` §3.2.6), but for a different reason: even though Billing staff *do* have refund permission in the existing system, refund execution should go through the existing, audited Billing UI flow, not a conversational shortcut, to avoid creating a second, less-deliberate path to the same high-stakes action. The assistant can retrieve information to *support* a refund decision; it should not become the action surface for performing one.
- **Conversation example:**
  > Staff: "Which AI-originated bookings from yesterday are still unpaid?"
  > Assistant: [list, sourced from the same Booking API data underlying Deliverable 9's Analytics]

### Radiology
- **Allowed commands:** "What's today's MRI schedule?" "Is the report for patient [ID] finalized?" Explicitly **not** clinical-content queries ("what does this finding mean") — the Internal Staff Assistant has the same Bucket 3 boundary as the patient-facing AI (Section 4) when it comes to clinical interpretation, because a junior radiology staff member using natural language to get an AI's opinion on a finding is exactly the kind of unintended clinical-AI surface this document must not casually create.
- **Restricted commands:** Any attempt to get the assistant to interpret/summarize clinical findings — redirected to existing radiology-AI tooling (per `02_`'s audit) if such interpretation assistance is in scope there, never improvised by this assistant.
- **Conversation example:**
  > Staff: "How many CT studies are pending report today?"
  > Assistant: [count, sourced from existing `radiologyWorklist` data]

### Laboratory
- **Allowed commands:** Similar pattern to Radiology — scheduling/status queries, not result-interpretation.
- **Restricted commands:** Same clinical-interpretation boundary.

### Report Delivery
- **Allowed commands:** "Which reports were sent via WhatsApp today but not yet viewed?" "Resend report [ref] to patient." (This *is* an allowed action — it's the same Report API the patient-facing AI uses, §3.2.5 — but triggered by staff, audited under the staff member's identity.)
- **Restricted commands:** N/A beyond standard PII access rules already governing this role.

### Doctors
- **Allowed commands:** "What's my schedule today?" "How many patients are waiting for me?" Clinical content queries about *their own* patients' existing records (governed by whatever clinical-record access the doctor already has in the existing system — the assistant is a retrieval convenience, not an expanded access grant).
- **Restricted commands:** Nothing beyond the doctor's existing record-access permissions — the assistant must not become an access-expansion vector (e.g. a doctor asking about a patient outside their own caseload, if the existing system would normally block that view).

### Managers
- **Allowed commands:** Analytics/summary queries ("how did AI-originated bookings perform this week") — natural-language front-end onto `03_` Deliverable 9's Analytics APIs.
- **Restricted commands:** None beyond existing Manager-role permission scope.

### Administrator
- **Allowed commands:** Can query AI Operations Center state ("what's the current daily LLM budget usage") — but per Section 2 of this document, cannot *change* configuration through the conversational assistant; configuration changes go through the Section 2 control surface, where they're versioned (`03_` §5.2's "no hard-coded prompts" pattern, but applied to the principle "no conversational shortcut around a structured, audited config change either"). This mirrors the Billing refund boundary above: read freely via the assistant, write through the proper structured surface.

## 5.4 Permission Matrix (Summary)

| Role | Read: own-department data | Read: cross-department data | Write/Action via assistant |
|---|---|---|---|
| Reception | Yes | No (beyond what existing UI already permits) | Limited (e.g. re-send a notification — not creating bookings on a patient's behalf without the patient present) |
| Billing | Yes | No | No (refunds/financial actions route to existing UI) |
| Radiology | Yes | No | Status queries only |
| Laboratory | Yes | No | Status queries only |
| Report Delivery | Yes | No | Yes — resend actions (same API patient-facing AI uses) |
| Doctors | Own patients only | No | No |
| Managers | Yes (aggregate/analytics) | Yes (aggregate/analytics, not record-level) | No |
| Administrator | Yes (system config state) | Yes | No (config changes via Section 2 UI, not conversationally) |

This table is a direct extension of the existing `rolePermissions`-style matrix structure (`01_` §2.6) — implementation should add `ai_assistant` as a new module column in that same matrix, not build a parallel permission table.

## 5.5 Audit Logging

Every Internal Staff Assistant interaction is logged under the requesting staff member's own identity, with the query text and the data scope returned — this is the same audit discipline as any other staff action, extended to cover a new interface rather than exempted from it because the interface happens to be conversational.

---

# SECTION 6 — Knowledge Management

## 6.1 Governing Principle

`03_` §5.2 already establishes the core rule: the AI never automatically modifies the Knowledge Base. This section designs the **human workflow** around that rule — how knowledge actually gets created, updated, and kept current in daily operation, since a Knowledge Base that's accurate on launch day and stale six months later has failed at its purpose regardless of how well it was designed architecturally.

## 6.2 Knowledge Sources and Their Operational Owners

| Source | Operational owner | Update trigger |
|---|---|---|
| FAQs | Reception supervisor (day-to-day), Admin (approval) | Recurring patient questions not yet in KB (detected per §6.4) |
| Doctor instructions | The doctor themselves, or a designated clinical liaison | Doctor-initiated, e.g. a new prep protocol |
| Preparation instructions | Clinical staff (per `03_` §5.1's explicit requirement that this category is clinically-authored, never AI-generated) | Equipment/protocol changes |
| Policies | Admin/Management | Policy decisions made outside this system, then reflected in KB |
| Management notices | Management | As needed |
| Holiday notices | Admin (feeds the Holiday Calendar in Section 2) | Calendar-driven, ideally entered in advance |
| Price changes | Billing/Admin | **Must be reconciled with the actual `tests`/`packages` pricing tables** — KB content should ideally reference live pricing data rather than duplicate it as static text, to avoid the exact "two sources of truth that drift" failure `03_` warns against throughout; where KB *must* state a price in prose (e.g. inside a package description), this should be flagged for review whenever the underlying `tests`/`packages` price changes, not left to manual memory. |
| Equipment downtime | Radiology/Lab supervisor, ideally **wired directly from `machines.status`** (confirmed real field, Section 1 §1.6) rather than manually duplicated into KB text — this is the cleanest available case of the same single-source-of-truth principle. |
| New services | Management/Admin | Service-line decisions made outside this system |
| Health packages | Billing/Admin, reconciled with `packages` table same as Price changes above |

## 6.3 The Knowledge Lifecycle

```
1. Knowledge gap detected (§6.4)
        │
        ▼
2. AI suggests addition/correction — NEVER applies it
   (suggestion includes: the patient question that triggered it,
    proposed content, and which existing KB entry it might relate to)
        │
        ▼
3. Routed to the operational owner (§6.2 table) for that content category
        │
        ▼
4. Owner reviews — edits, approves, or rejects
        │
        ▼
5. Approved change goes live, versioned (per `03_` §5.2 point 4 / this
   document's §2.7 Version History design)
        │
        ▼
6. Future AI responses use the updated content immediately
   (retrieval is always-fresh per `03_` §5.2 point 2 — no redeploy needed)
```

## 6.4 Detecting Missing Knowledge — Operational Design

This is the one genuinely new mechanism this section adds beyond what `03_` scoped (which designed *that* the AI suggests improvements, per the brief, but not *how* gaps are detected). Three concrete detection signals, all sourced from data the architecture already logs:

1. **Knowledge API "no match" events** — `03_` §3.2.7 already specifies that a no-KB-hit search returns an explicit signal rather than letting the AI improvise. Every such event is itself a knowledge-gap signal, automatically logged (no new tracking needed — this is the existing `03_` §9.1 "Top FAQs" search-query log, read from the opposite direction: not "what's searched most," but "what's searched and *not found*").
2. **Escalation reason `other`/uncategorized** (per `03_` §6.3's escalation reason taxonomy) — a pattern of escalations that don't fit the defined categories (explicit-request, emergency, refund, etc.) suggests a recurring conversational need the flow design and Knowledge Base haven't anticipated yet.
3. **Staff-flagged corrections** — a manual "this answer was wrong/outdated" action available to any staff member reviewing a transcript (Human Handoff context, per `03_` §6.2, or general transcript review) — the simplest and most direct signal, since staff catch real-world mismatches (e.g. AI quoting an old price) faster than any automated detection.

## 6.5 Suggestion Routing — Who Sees What

Suggestions are routed to the **operational owner** for that content category (§6.2 table), not to a single generic "KB inbox" — a prep-instruction gap should reach clinical staff, not Billing, and vice versa. This routing uses the same category structure `03_` §5.1 already defined for the Knowledge Base itself, so no new categorization scheme is needed — the routing table *is* the content-category table, read as an assignment list.

## 6.6 Version History and Revision Tracking

Directly reuses this document's §2.7 design (Version History, Rollback) — Knowledge Management is the primary day-to-day consumer of that capability, more so than Prompt Management, since KB content changes far more frequently in normal operation than conversational-behavior prompts do.

## 6.7 What This Section Deliberately Does Not Design

Per the brief's explicit instruction ("the AI should never automatically modify knowledge"), this document does not design any auto-apply pathway, confidence-threshold-based auto-approval, or "AI learns from corrections" mechanism beyond surfacing suggestions for human review. A future roadmap item *could* explore higher-confidence auto-suggestions reducing owner review time, but auto-*application* of AI-suggested clinical or policy content is out of scope for this design, not merely deferred — it would conflict with the same authored-not-generated principle `03_` established for PCPNDT/prep content (§5.1) and that Section 4 of this document depends on for clinical safety.

---

# SECTION 7 — Monitoring Dashboard

## 7.1 Relationship to `03_` Deliverable 9

`03_` already defines the metric list and source mapping (Deliverable 9 table). This section designs the dashboard operationally — daily/weekly/monthly views, who looks at what, and a small number of metrics `03_` didn't explicitly cover (System uptime, Provider uptime, Token usage, Cost analysis) added here as addenda, consistent with how Section 2 of this document already flagged Cost Limits as a `03_`-addendum.

## 7.2 Three Time Horizons, Three Audiences

| View | Primary audience | Refresh | Purpose |
|---|---|---|---|
| **Daily** | Reception supervisor, on-shift Admin | Real-time / hourly | Operational — is today going well, does anything need attention right now |
| **Weekly** | Admin, Department supervisors | Daily rollup | Tactical — are we trending in the right direction, any emerging pattern |
| **Monthly** | Management | Weekly rollup | Strategic — is this delivering value, where should investment go next (feeds directly into the ROI question `03_` Deliverable 12 explicitly declined to estimate without live data — this dashboard is what eventually answers it) |

## 7.3 Daily View — Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TODAY — [Date]                              Last updated: now │
├───────────────────────┬───────────────────────────────────────┤
│  Calls: 42             │  WhatsApp conversations: 67            │
│  Avg response: 2.1s    │  AI resolution: 71%                    │
├───────────────────────┼───────────────────────────────────────┤
│  Appointments booked: 18│  Revenue generated (AI-originated): Rs.X│
│  Human handoffs: 19 (28%)│ Dropped/missed: 3                     │
├───────────────────────┴───────────────────────────────────────┤
│  TOP QUESTIONS TODAY                                            │
│  1. "MRI preparation" (14)   2. "Report status" (11)  ...        │
├───────────────────────────────────────────────────────────────┤
│  KNOWLEDGE GAPS DETECTED TODAY (links to Section 6 workflow)      │
│  - "Do you accept [specific insurance]?" -- no KB match (3x)      │
├───────────────────────────────────────────────────────────────┤
│  SYSTEM HEALTH                                                  │
│  LLM Provider: OK   WhatsApp: OK   Voice: OK                     │
│  Today's spend: Rs.X / Rs.[Daily Budget]                          │
└─────────────────────────────────────────────────────────────┘
```

This daily view deliberately surfaces Knowledge Gaps (Section 6 detection design) directly on the operational dashboard, not buried in a separate report — the people most likely to glance at this daily are also well-positioned to immediately route a gap to the right owner.

## 7.4 Weekly and Monthly Views

Same metric set as Daily, presented as trend lines rather than single numbers — the operationally important addition at this horizon is week-over-week / month-over-month comparison, since a single day's resolution rate means little without knowing whether that's improving, stable, or declining. Weekly view adds a per-department breakdown (using the Section 3 department mapping) so a supervisor can see, for example, that radiology-related bookings have a lower AI resolution rate than general reception queries — directly actionable for prioritizing Knowledge Base improvement effort (Section 6).

## 7.5 Metrics — Additions Beyond `03_`'s List

Restating `03_` Deliverable 9's table is unnecessary here; this section adds only what `03_` did not already specify a source for.

| Metric (new in this document) | Source | Notes |
|---|---|---|
| System uptime | Standard application/infrastructure monitoring — not specific to this project; tracked the same way any other ERP service's uptime already is, not via a bespoke new monitoring system |
| Provider uptime | Provider Manager driver health checks (`03_` §7.2/§7.3 interfaces) — each driver reports its own availability; aggregated per-provider, not as one undifferentiated "AI is down" signal, since `03_`'s fallback-provider design means one provider's downtime shouldn't always mean total system downtime |
| LLM usage / Token usage | Provider Manager driver responses (same data source as Section 2's Cost Limits design) — read once, used for both cost governance and monitoring, not metered twice |
| Cost analysis | Same source as above, presented here as a trend (spend over time, spend per booking/conversation) rather than the real-time budget-ceiling view Section 2 already covers |

## 7.6 Alerting

Threshold-based alerts (AI Resolution Rate drops below a configured floor, Dropped Calls spike, Daily Budget approaching limit per Section 2) route to the same notification mechanism already governing Emergency/VIP alerts in Section 1's Reception Command Center. Admin/Supervisor roles receive these, not general Reception staff, consistent with the permission tiering established in Section 2.

---

# SECTION 8 — Business Continuity

## 8.1 Governing Principle

`03_` already designed one specific failure mode in depth — Offline Mode (§4.17), for "all LLM providers unavailable or ERP API Gateway unreachable." This section generalizes that same fail-safe philosophy (never attempt a booking/queue/payment action under uncertain conditions; degrade to static, pre-approved messaging) across every other dependency, rather than re-deriving a different failure philosophy per dependency.

## 8.2 Failure Mode Table

| Failure | Detection | Fallback behaviour | Recovery workflow | Administrator alert |
|---|---|---|---|---|
| Internet failure (clinic-side) | Channel Gateways lose connectivity to ERP API Gateway | Voice/WhatsApp/Web Chat channels cannot reach the backend at all — if the clinic's own internet is down, the existing ERP is also unreachable to staff, so this is not a new risk this project introduces, but it should be explicitly acknowledged rather than assumed away | Standard ERP-wide internet recovery, outside this project's scope | Same alerting as any existing ERP-wide outage |
| LLM unavailable | Provider Manager health check fails for primary provider | `03_` fallback provider engages automatically; if fallback also fails, Offline Mode | Automatic — provider health-checked continuously, primary resumed when healthy | Admin alerted on fallback engagement, not just total failure — early warning before Offline Mode is reached |
| WhatsApp unavailable (Meta API outage) | Webhook/send failures from WhatsApp Gateway | Per `03_`'s defined notification fallback order (WhatsApp to SMS to email); for inbound conversation, patients simply cannot reach the AI via WhatsApp during the outage — voice/web chat remain available as alternatives if live | Automatic — Meta-side outages resolve independently; no clinic-side recovery action needed beyond monitoring | Admin alerted |
| Telephony unavailable | Telephony Provider driver health check fails | Voice channel unavailable; per the Missed Call Callback pattern, consider an automatic WhatsApp message to any patient whose call attempt failed during the outage, if technically detectable | Provider-dependent; may require provider-side support escalation | Admin alerted, high priority — voice failure has no AI-side workaround, unlike WhatsApp/web chat redundancy |
| Payment gateway failure | Payment API receives consistent failures from the existing gateway integration | AI states a normalized failure message and offers to complete booking now, pay later at the counter/portal if the existing booking flow already supports pay-later (do not assume; confirm during implementation), or defers to Human Handoff | Gateway-side; clinic has no direct recovery lever beyond contacting the payment provider | Admin alerted |
| Database failure | ERP API Gateway calls fail at the data layer | Full Offline Mode — the most severe failure mode, since almost every AI Receptionist function ultimately reads/writes the database; no partial degraded mode is safe to attempt | Standard ERP database recovery, outside this project's scope — the AI Receptionist has no special recovery role here | Same alerting as any existing ERP-wide database incident, escalated as Critical |
| ERP unavailable (API Gateway down, DB fine) | Health check on the Gateway layer specifically | Offline Mode | Standard service restart/redeploy recovery | Admin alerted, Critical |
| Knowledge Base unavailable | Knowledge API health check fails | Per `03_`'s existing rule that no KB hit means escalate, not improvise — if the entire KB is unreachable, every query is effectively a no-hit, so the AI should escalate far more aggressively than normal, while still answering only the most basic hardcoded-safe fallback (e.g. clinic phone number, cached locally by each Channel Gateway specifically for this scenario, not solely sourced live from KB) | Service-level recovery | Admin alerted |
| Voice provider unavailable | Same dependency as Telephony unavailable in this architecture | See Telephony row | See Telephony row | See Telephony row |

## 8.3 The One Universal Rule

Across every row above, the same constraint recurs: when uncertain, do not write. A booking, payment, or queue action taken during a degraded or uncertain state risks creating exactly the kind of orphaned or duplicate record `01_` and `03_` already flag as a real, named risk in this system. Business continuity design for an AI Receptionist is therefore less about keeping functioning at all costs and more about failing toward silence and human handoff, never toward an uncertain write.

## 8.4 Recovery Workflow — General Pattern

For every failure mode above where recovery is not already fully automatic, the operational pattern is the same three steps, and should not need a different runbook per dependency:

1. Health check confirms the dependency is healthy again — automatic, continuous, not a manual check someone has to remember to run.
2. System automatically exits the corresponding fallback/Offline Mode — no manual "turn it back on" step required, since requiring a human to remember to do that is itself a reliability risk.
3. Admin is notified of recovery, not just failure — closing the loop, so a Daily View glance (Section 7) accurately reflects current state, not a stale Offline Mode indicator someone forgot was already resolved.

---

# SECTION 9 — Training & SOPs

## 9.1 Design Principle

SOPs below are written as checklists/runbooks a real staff member could follow without engineering support, consistent with the brief's instruction to think operationally. Each SOP references the specific Section of this document (or `03_`) it operationalizes, rather than restating that design.

## 9.2 Receptionist SOP

**Starting the day**
1. Open Reception Command Center (Section 1) — confirm overnight AI activity (after-hours conversations, missed calls) has no unresolved emergency or VIP items still flagged.
2. Check System Health panel (Section 7 §7.3) — confirm LLM/WhatsApp/Voice all show healthy before relying on the AI for the day's volume.

**Monitoring AI**
3. Periodically glance at the Live Feed (Section 1 §1.2) — not continuous supervision of every conversation, but enough to notice aging/escalation indicators (Section 1 §1.5).
4. Respond to Human Handoff queue items promptly — Context Packager (`03_` §6.2) means no re-asking the patient what they already told the AI; read the summary, open transcript only if needed.

**Taking over a conversation**
5. Click into the handoff item — patient identity, in-progress action, and escalation reason are pre-loaded (`03_` §6.2 payload shape).
6. Continue in the same channel thread (WhatsApp) or same chat window (Web Chat) — patient should not perceive a jarring handoff, per `03_` §6.1's "no repeated questions" requirement.

**Correcting an AI mistake**
7. If an AI response was wrong (wrong price, outdated info), use the "flag this answer" action on the transcript (Section 6 §6.4, detection signal 3) — this routes to the correct Knowledge Base owner, the receptionist does not need to fix content themselves unless they are also the KB owner for that category.

**Escalation**
8. Follow Section 1's priority indicators — Emergency and VIP items are visually distinct and should be handled ahead of Normal-priority handoff items, per `03_` §6.3's routing table.

**Emergency handling**
9. Per `03_` 4.12 — emergency conversations route to staff immediately and bypass any queue; a receptionist seeing an Emergency-flagged item should treat it with the same urgency as a walk-in emergency, not as "just another chat to get to."

**Daily checklist**
- [ ] Morning: System Health green, no unresolved overnight escalations
- [ ] Throughout shift: Handoff queue cleared within target response time (clinic-defined)
- [ ] End of shift: No Emergency/VIP items left unacknowledged for the next shift

## 9.3 Supervisor SOP

**Starting the day**
1. Review Daily View (Section 7 §7.3) — AI Resolution Rate, handoff volume, Knowledge Gaps detected.

**Monitoring AI**
2. Weekly: review Weekly View (Section 7 §7.4) per-department breakdown — identify which department's AI flows need Knowledge Base attention.

**Knowledge updates**
3. Triage Knowledge Gap suggestions routed to your department category (Section 6 §6.5) — approve, edit, or reject; this is the single most important recurring supervisor task for keeping the AI accurate.

**Performance review**
4. Monthly: cross-reference Monthly View trends with staff feedback — is AI Resolution Rate improving, is Human Handoff volume sustainable for current staffing.

**Weekly checklist**
- [ ] Knowledge Gap queue reviewed and cleared (or explicitly deferred with reason)
- [ ] Per-department resolution-rate trend reviewed
- [ ] Any recurring Human Handoff escalation reason discussed with Admin if it suggests a flow design gap

## 9.4 Administrator SOP

**Starting the day**
1. Same System Health check as Receptionist, plus Section 2's Cost/Budget panel — confirm spend trajectory is on track for the Daily Budget.

**Prompt updates**
2. Any Prompt Management change (Section 2 §2.4) — use Testing Sandbox (Section 2 §2.8) first for any non-trivial change; document the change reason (captured automatically via Version History, Section 2 §2.7).

**Knowledge updates**
3. Approve high-sensitivity category changes (PCPNDT, prep instructions — per `03_` §5.1/§5.2's stricter-permission categories) personally or via designated clinical liaison, never delegate to general staff.

**Performance review**
4. Monthly: review Monthly View (Section 7 §7.4) with Management — this is the input to the ROI conversation `03_` Deliverable 12 deferred to live data.

**Escalation rule maintenance**
5. Periodically review Escalation Rules (Section 2 §2.2, `03_` §6.3) — are VIP/Emergency routing rules still matching actual clinic staffing/structure, especially after staff changes.

**Monthly checklist**
- [ ] Cost/budget trend reviewed against actual value delivered (bookings, revenue per Section 7 §7.5)
- [ ] Escalation rules confirmed still correct
- [ ] Provider health/uptime reviewed — any recurring fallback engagement (Section 8 §8.2) investigated
- [ ] Knowledge Base completeness spot-checked (especially after any new service/package/price change, per Section 6 §6.2)

## 9.5 IT SOP

**Starting the day**
1. Confirm Provider Manager driver health checks (Section 7 §7.5) are reporting correctly — this is infrastructure monitoring, not content/conversation monitoring, and is IT's specific responsibility distinct from Admin's.

**Business continuity**
2. Familiarize with the Section 8 failure-mode table — IT is the team executing "Recovery workflow" for infrastructure-level failures (Database, ERP Gateway, Telephony provider-side issues), while Admin handles content/configuration-level concerns.

**Daily checklist**
- [ ] All Provider Manager drivers (LLM, Telephony, WhatsApp) reporting healthy
- [ ] No unresolved Critical alerts from Section 8's failure-mode detection

## 9.6 Management SOP

**Performance review**
1. Monthly View (Section 7 §7.4) is the primary artifact — review trends, not daily noise.
2. Use Monthly View data to inform staffing/investment decisions per Section 3 §3.10's stated boundary — Management retains all decision authority, the dashboard informs, it does not recommend a specific staffing action.

**Monthly checklist**
- [ ] Monthly trends reviewed
- [ ] ROI conversation revisited with Admin using accumulated cost/revenue data (Section 7 §7.5)

## 9.7 Doctors SOP

**Daily**
1. Internal Staff Assistant (Section 5) available for schedule/queue queries specific to their own patients — optional convenience tool, not a required daily workflow step.

**Knowledge updates**
2. Doctor-initiated prep-instruction or clinical-guidance updates route through the Knowledge Management lifecycle (Section 6 §6.3) — a doctor updating, say, MRI contrast prep guidance is the "operational owner" for that content category per Section 6 §6.2's table, and their update goes through the same suggest-then-approve lifecycle as any other source (self-approving, since they are also the relevant clinical authority, but still versioned per Section 6 §6.6).

---

# SECTION 10 — Future Expansion

## 10.1 Relationship to `03_` Deliverable 11

`03_` already designed a 1/3/5-year *feature* roadmap (Multilingual Voice, Doctor AI Assistant, Teleconsultation, etc.) with an explicit epistemic-status caveat distinguishing confident near-term items from speculative long-term ones. This section is **operational**, not feature-based — it asks how the *organization running this system* scales, which is a different question from what the system *does*.

## 10.2 AI Call Centre (Centralized, Multi-Channel Operations)

Once Voice (Phase 5) and the Reception Command Center (Section 1) are both mature, the natural operational evolution is a dedicated AI-supervision function distinct from front-desk reception — staff whose job is specifically monitoring AI Resolution Rate, handling escalations across all branches (§10.3), and maintaining the Knowledge Base centrally, rather than this being a part-time addition to each branch's existing reception duties. This is an organizational change, not a technical one — `03_`'s architecture already supports it (the Reception Command Center and AI Operations Center are both designed as views into shared backend state, not branch-local tools).

## 10.3 Multiple Branches / Multi-Location Deployment

The architecture in `03_` is largely branch-agnostic already where it matters most:
- The ERP API Gateway, Booking/Queue/Payment Adapters — all operate against whichever ERP instance/database serves a given branch; multi-branch deployment is primarily a question of **whether the underlying ERP itself is single-tenant-per-branch or multi-tenant**, which is outside this project's scope to redesign.
- The Knowledge Base (Section 6) would need a **branch-scoping concept** — some content is universal (general policies), some is branch-specific (location, hours, which modalities a specific branch offers). This is a real, new design need for multi-branch operation, not something `03_`/this document already covers, and should be scoped explicitly when multi-branch becomes a real near-term plan rather than assumed solvable by the current single-branch Knowledge Base category structure.
- Analytics (Section 7) would need per-branch + cross-branch rollup views — directly extends the existing per-department breakdown pattern (Section 7 §7.4) to an additional dimension (branch), not a redesign.

## 10.4 Franchise Model

If the clinic's growth model is franchising (independently-operated locations under shared branding) rather than centrally-operated branches, the operational design shifts further — each franchise likely needs its **own** AI Operations Center instance (its own budget limits, its own Knowledge Base content, possibly its own provider selection) rather than a shared central one, since franchise operators are independent businesses, not staff of a single organization. This is a meaningfully different operational model from §10.3's multi-branch case and should not be conflated with it during future planning — flagged here specifically so it isn't accidentally assumed to be "the same thing, just more locations."

## 10.5 Corporate Clients

Connects to Section 3 §3.13's flagged-but-unscoped Corporate Desk workflow — if corporate-client bulk-booking/billing becomes a real service line, the operational design would need: a corporate-client identity concept (distinct from individual patient identity), bulk-booking flow variants, and likely a different Knowledge Base category (corporate package offerings, billing-to-employer terms) — none of which this document invents, consistent with Section 3's treatment.

## 10.6 Doctor Referral Portal

A doctor (external to the clinic, referring patients in) needing their own interface to check referred-patient status, book on a patient's behalf, or view report delivery — this is architecturally closest to a specialized variant of the Patient Portal pattern (`01_` §2.1) or the Internal Staff Assistant pattern (Section 5), depending on whether referring doctors are treated as a patient-adjacent identity or a constrained staff-adjacent identity. Worth scoping which model fits before building, rather than assuming either by default.

## 10.7 Telemedicine

Connects to `03_` Deliverable 11's 5-year "Teleconsultation" roadmap item — operationally, this would introduce an entirely new conversation-flow category (consultation booking, possibly video-call-link delivery via the existing Notification Adapter pattern) and a new clinical-boundary question for Section 4 of this document (what can the AI ask/not-ask when booking a *consultation* specifically, as distinct from booking a *diagnostic test* — likely a stricter boundary, since a consultation booking conversation is closer to clinical intake than a test booking is).

## 10.8 Mobile App

Per `03_` Deliverable 1's "Future Mobile App" channel and Deliverable 11's 1-year roadmap note — operationally low-incremental-cost once Web Chat (Phase 6) and the Conversation API (`03_` §3.2.10) are proven, since a mobile app is mostly a new thin client of the same API, as `03_` already states. The operational addition here: push notifications (a new Notification Adapter channel, extending `03_` §3.2.8's existing WhatsApp/SMS/email pattern) become available, which directly improves Section 9's Follow-up Automation (`03_` Phase 10) reach.

## 10.9 Home Collection

Already a recognized existing service line (Section 3 §3.7) — future expansion here is about **AI-assisted logistics optimization** (e.g. routing/scheduling home-collection visits efficiently across a day) rather than a new patient-facing capability; this is closer to an Internal Staff Assistant (Section 5) use case for whichever staff role manages home-collection logistics, than a patient-facing conversation-flow addition.

## 10.10 Remote Reporting

Connects to existing `radiology_share_links` infrastructure (`01_` §2.5) already supporting a `radiologist` audience distinct from `patient` audience — remote reporting (a radiologist reviewing/reporting from outside the clinic) is largely already architecturally supported per that existing design; future expansion is about workflow/UX around it, not new core infrastructure this document needs to design.

## 10.11 Hospital Network / Central AI Control Room

The long-horizon convergence of §10.2 (AI Call Centre) and §10.3 (Multi-Branch) — a single operations team supervising AI Receptionist performance across an entire network of locations, using the same Reception Command Center / AI Operations Center / Monitoring Dashboard designs from Sections 1, 2, and 7 of this document, scaled to a cross-branch view (Section 7's "Analytics would need per-branch + cross-branch rollup" note, §10.3). Named here as the natural end-state these earlier sections are already compatible with, not a separate system to design from scratch when the time comes.

---

# SECTION 11 — Operational Risk Assessment

## 11.1 Single Points of Failure

| SPOF | Where it lives in this design | Mitigation already designed | Residual risk |
|---|---|---|---|
| Single LLM provider | Provider Manager (`03_` §7.2) | Fallback provider config already designed | Low, if fallback is actually configured and tested — an unconfigured fallback is a paper mitigation, not a real one; Admin SOP (Section 9 §9.4) includes periodic provider-health review specifically to catch this |
| Single Knowledge Base service | Section 5/6, `03_` §5.2 | None beyond Offline-Mode-style degraded escalation (Section 8 §8.2 KB-unavailable row) | Medium — there is no "fallback Knowledge Base," only graceful degradation to heavier escalation; acceptable given the alternative (a duplicate KB) would violate the single-source-of-truth principle this entire project is built around |
| The ERP database itself | Underlies almost everything | None new — this is an existing ERP-wide SPOF this project did not introduce and is out of scope to fix | High in absolute terms, but **not a risk this project added** — important to state precisely so this project isn't blamed for a pre-existing architectural fact |
| Single Telephony provider | Provider Manager (`03_` §7.3) | Capability-flag design allows graceful degradation per-feature (e.g. warm transfer unsupported) but does not include a second telephony vendor failover by default | Medium-High — voice has the weakest redundancy story of any channel in this design, named explicitly in Section 8 §8.2's Telephony row as "no AI-side workaround" |

## 11.2 Workflow Bottlenecks

- **Human Handoff queue depth during peak hours** — if AI Resolution Rate is lower than hoped and Reception staffing doesn't scale with AI-originated conversation volume, the Handoff queue (Section 1) becomes the new bottleneck, potentially worse than the pre-AI baseline if patients now expect AI-speed response and instead wait in a queue. Mitigation: Section 7's Daily/Weekly monitoring is specifically designed to surface this early (Human Handoff % trend), and Section 9's Supervisor SOP includes reviewing this metric as a recurring task, not an afterthought.
- **Knowledge Base approval bottleneck** — if an operational owner (Section 6 §6.2) is slow to review suggested KB changes, the AI continues giving outdated/incomplete answers in the meantime. Mitigation: Section 6 §6.4's gap-detection is continuous, but the human review step is inherently rate-limited by owner availability — this is a real, not fully solvable, bottleneck, named rather than hidden.

## 11.3 Staff Dependency

- **Clinical content authorship dependency** — prep instructions, PCPNDT FAQs, and red-flag language lists (Section 4 §4.4) all require clinical authorship, not general staff or AI generation, per `03_` §5.1's explicit requirement. If the clinic has limited clinical-staff bandwidth for this authorship work, Knowledge Base completeness (a stated precondition in `03_` Phase 3's success criteria) is gated on that bandwidth, not on engineering effort — a genuine dependency this document should not understate.
- **Admin/Super Admin concentration of control** — Section 2 §2.3's permission tiering deliberately concentrates the highest-impact settings (Escalation Rules, Provider Selection, Allowed/Blocked Actions) in a small number of Super Admin accounts. This is the correct security posture (per `03_` §3.2.9/§8.2) but creates an operational dependency: if the sole Super Admin is unavailable during an incident requiring a configuration change (e.g. disabling a malfunctioning flow), response time suffers. Mitigation recommendation: at least two Super Admin-capable staff at all times, not a single point of administrative failure mirroring §11.1's technical SPOFs.

## 11.4 Knowledge Dependency

Already covered in depth in Section 6 and §11.2/§11.3 above — restated briefly here for completeness of the risk inventory the brief requests: the entire system's perceived quality is gated on Knowledge Base completeness and currency, which is a continuous human-staffed process, not a one-time setup task. This is the risk most likely to be underestimated in initial planning, since it doesn't show up as an engineering line-item the way Provider Manager or Channel Gateway work does.

## 11.5 Security Risks

Covered in depth in `03_` §8 (Security Architecture) — not duplicated here. The operational addition: `03_` §8.17's "Must-fix before any external channel goes live" item (the two unresolved CRITICAL findings from the prior ERP security audit) should be tracked as a literal go-live blocker in whatever project-management process governs Phase 4 (`03_` Deliverable 10) execution, not merely noted in a design document and then forgotten under schedule pressure.

## 11.6 Privacy Risks

Covered in `03_` §8.3/§8.12/§8.16 — operational addition: the identity-verification gate (`03_` §8.3, "confirm DOB before revealing booking/report details") is exactly the kind of control that's easy to design correctly and then erode in practice under the pressure of "just answer the patient's question, it's slowing things down." Section 9's SOPs should include this as an explicit, named non-negotiable in initial staff training, not assumed self-evident from the architecture document alone.

## 11.7 Operational Risks

- **Alert fatigue** — if threshold-based alerting (Section 7 §7.6) is poorly tuned (too sensitive), Admin/Supervisor staff may begin ignoring alerts generally, defeating the purpose of the Emergency/VIP visual distinction Section 1 §1.4/§1.5 carefully designed. Recommendation: alert thresholds should be reviewed and tuned during the Phase 4 pilot (per `03_` Deliverable 10) based on real false-positive rates, not set once and assumed correct.
- **Over-reliance on AI Resolution Rate as the sole success metric** — Section 7 design explicitly includes Patient Satisfaction and Knowledge Gap metrics alongside Resolution Rate specifically to avoid a single, easily-gamed metric (e.g. an AI that resolves conversations by being unhelpfully brief would show a misleadingly high "resolution" rate) becoming the only signal Management reviews monthly (Section 9 §9.6).

## 11.8 Vendor Risks

Covered architecturally in `03_` §7 (Vendor Abstraction) — operational addition: vendor abstraction reduces *switching* cost but does not eliminate the *initial* dependency on whichever vendor is actively selected at any given time (Section 11 §11.1's Provider SPOF entries). Vendor pricing changes, API deprecations, or policy changes (e.g. an LLM vendor changing content policies in a way that affects clinical-adjacent conversation) are real operational risks that Provider uptime monitoring (Section 7 §7.5) only partially surfaces — a periodic (e.g. quarterly) manual vendor-relationship review is recommended as an Admin/Management joint task, not currently captured in any SOP checklist above, named here as a gap rather than silently added to a checklist without flagging it as new.

## 11.9 Scaling Risks

- **Cost scaling non-linearly with conversation volume** — Section 2 §2.9's budget controls are designed for governance, not for guaranteeing cost stays proportional as channels (Phases 4-6 in `03_`) and eventually branches (Section 10 §10.3) are added. Monthly cost-trend review (Section 7 §7.5/Section 9 §9.6) is the detection mechanism; this is named as a risk specifically because budget *alerts* (Section 2) are reactive, not predictive — there is no capacity-planning/forecasting capability designed anywhere in this document or `03_`, and one may be worth adding once real usage data exists.
- **Knowledge Base scaling with content volume** — `03_` §5.3 already names this precisely: keyword retrieval is the recommended starting point, with a defined trigger (real usage data showing missed queries) for graduating to the existing RAG infrastructure. This is a risk with an already-designed mitigation path, not an open gap — included here for risk-inventory completeness, not because it's unaddressed.

## 11.10 Risk Summary Table

| Risk category | Severity (current design) | Mitigation status |
|---|---|---|
| Single points of failure | Medium-High (voice channel specifically) | Partially mitigated (LLM fallback yes, telephony fallback no) |
| Workflow bottlenecks | Medium | Monitored, not eliminated — inherent to any human-in-the-loop design |
| Staff/clinical dependency | Medium-High | Acknowledged, requires organizational commitment beyond this document's scope |
| Knowledge dependency | Medium-High | Process designed (Section 6), execution-dependent |
| Security | Per `03_` §8 — Critical until prior-audit findings closed | Tracked, blocking |
| Privacy | Medium | Designed control exists; erosion-under-pressure is the real risk |
| Operational (alert fatigue, metric gaming) | Low-Medium | Designed against, needs real-world tuning |
| Vendor | Medium | Abstraction reduces switching cost, not initial dependency; review cadence recommended as new |
| Scaling | Medium | Detection mechanisms exist; forecasting capability does not yet |

---

# SECTION 12 — Executive Recommendations

## 12.1 Current Operational Readiness

Per `02_`'s component-level scoring (carried forward as the authoritative figure, not re-derived here) and `03_`'s confirmation: approximately 70% at the infrastructure/data layer. This document's contribution is the **operational layer** on top of that — and the honest assessment is that the operational layer (Sections 1-9 of this document) is currently **0% built**, because it was, correctly, design-only through Phases 1-4. The 70% figure describes how much of the underlying capability already exists; it does not describe how ready the organization is to *run* an AI Receptionist day to day, which is a separate readiness dimension this document exists to define, not to claim is already met.

## 12.2 Operational Gaps

In priority order, the gaps most likely to undermine a pilot if unaddressed:

1. **No Knowledge Base content exists yet** (Section 6) — this is the single most consequential gap, since `03_` Phase 3's own success criteria require a minimum content checklist before any patient-facing channel goes live, and that checklist is entirely human-authorship work, not engineering work.
2. **No designated operational owners per content category** (Section 6 §6.2) — the *roles* (Reception supervisor, clinical liaison, Billing/Admin) are named in this document, but actual staff have not been assigned to them; this is an organizational decision, not a technical one, and should not be left implicit.
3. **Unresolved security findings** (Section 11 §11.5, `03_` §8.17) — a hard blocker for any external channel, not yet confirmed closed.
4. **No Super Admin redundancy** (Section 11 §11.3) — currently a recommendation, not a confirmed staffing plan.
5. **No vendor selection made yet** — Provider Manager (`03_` §7) is designed to be vendor-agnostic, but a first vendor still has to be chosen before Phase 4 (`03_` Deliverable 10) implementation can begin in earnest.

## 12.3 Recommended Implementation Sequence

This document does not propose a different sequence than `03_` Deliverable 10 (Foundation through Internal Staff Assistant) — that sequence remains correct. This document's sequencing contribution is **operational readiness gates that should sit alongside each technical phase**, not replace its order:

| `03_` Phase | Operational readiness gate (this document) |
|---|---|
| Foundation | Super Admin staffing confirmed (Section 11 §11.3); security findings closure tracked as blocker (Section 11 §11.5) |
| Internal APIs | N/A — purely technical phase |
| Knowledge Base | Operational owners assigned per category (Section 6 §6.2); minimum content checklist authored, not just the *service* built |
| WhatsApp AI | Reception SOP (Section 9 §9.2) trained and rehearsed; Reception Command Center (Section 1) usable, not just designed |
| Voice AI | Telephony fallback risk (Section 11 §11.1) explicitly accepted or mitigated before launch, given its weaker redundancy story |
| Website AI | Lower-incremental gate — mostly reuses WhatsApp-phase readiness |
| Queue Integration | N/A — mostly technical |
| Payments | Payment-failure SOP rehearsed (ties to Section 8 §8.2's payment-gateway-failure row) |
| Report Delivery | Identity-verification discipline (Section 11 §11.6) explicitly trained, not assumed |
| Follow-up Automation | Opt-out handling confirmed designed and tested (per `03_` Phase 10's own stated risk) |
| Internal Staff Assistant | Per-role permission matrix (Section 5 §5.4) validated against real role assignments, not the document's illustrative table |

## 12.4 Training Requirements

Per Section 9's SOPs: every staff role (Receptionist, Supervisor, Administrator, IT, Management, Doctors) has a distinct SOP and checklist. Training should be role-specific, not a single all-staff session — a Receptionist does not need Section 2's AI Operations Center training, and an Administrator's training must go beyond what a Receptionist needs. Recommended minimum: one hands-on session per role using the Testing Sandbox (Section 2 §2.8) before any live patient-facing exposure, so staff experience the system risk-free before supervising it with real patients.

## 12.5 Staffing Impact

This document does not recommend headcount changes — that is a clinic business decision outside its scope, consistent with `03_` Deliverable 12 declining to estimate ROI without live data. What this document does state: AI Receptionist adoption changes the **shape** of Reception work (less routine-query handling, more handoff-queue triage and Knowledge Base maintenance input) before it changes the **amount** — Section 11 §11.2's bottleneck risk specifically warns against assuming reduced headcount need before AI Resolution Rate is proven in practice, not in this design document.

## 12.6 Expected Efficiency Gains

Directly tied to `03_` Deliverable 9's metrics, once live: AI Resolution Rate (conversations fully handled without staff time), Queue Reduction, and reduced average time-to-booking for routine requests. This document adds one operational efficiency claim `03_` did not make: **Knowledge Base centralization itself** (Section 6) is likely to produce a smaller but real efficiency gain independent of the AI — a single, versioned, staff-editable source of clinic facts/policies is useful even before/aside from AI consumption of it, since today (per `01_`/`02_`'s audit) this information appears to live only in individual staff knowledge or scattered settings fields.

## 12.7 Estimated Operational Savings

Not quantified, for the same reason `03_` Deliverable 12 declined to quantify development effort and ROI: no current call/WhatsApp volume or current staff-time-per-query baseline has been supplied to this document. Section 7's Monthly View is explicitly designed to generate that baseline going forward — this document's honest position is that the *capability* to calculate operational savings is being built (Section 7), not that savings can be estimated today.

## 12.8 Operational Maturity Score

**Current: approximately 10–15%.** This reflects that the *design* for operations is now complete (this document), while the *organizational execution* of that design — assigned KB owners, trained staff, a chosen vendor, closed security findings, rehearsed SOPs — has not yet begun. This is a deliberately low number relative to `02_`'s 70% infrastructure-readiness figure, and the gap between them is the entire point of this document: infrastructure readiness and operational readiness are different axes, and conflating them would overstate how close the clinic actually is to a safe, well-run pilot.

## 12.9 Readiness for Pilot

**Not yet ready.** Per §12.2's gap list, items 1–4 (Knowledge Base content, operational owners, security findings, Super Admin redundancy) are realistic preconditions for even a limited pilot (e.g. WhatsApp-only, allowlisted phone numbers, per `03_` Phase 4's own suggested limited-launch approach) — not full production readiness, but the minimum bar below which a pilot risks teaching the wrong lessons (e.g. a pilot that fails due to missing Knowledge Base content looks like an AI-quality failure, when it's actually a content-authorship gap).

## 12.10 Readiness for Production

**Significantly further away**, gated on: a successful pilot per §12.9 generating real Section 7 metrics; Voice channel's weaker redundancy story (Section 11 §11.1) being explicitly accepted or mitigated; multi-branch/franchise operational model (Section 10) being out of scope unless and until the clinic's actual growth plans call for it; and the full Section 9 SOP set being trained and exercised under real (not sandbox) conditions for at least one complete operational cycle (suggested: one month) before being considered production-stable.

---

**Status:** Operational design phase complete. No code, migrations, routes, or APIs were created or modified as part of this document. All references to `01_`, `02_`, and `03_` are citations confirming this document builds on, rather than duplicates, prior work.

**Next step (same one-step-at-a-time discipline as Phases 1-4):** Before Phase 4 implementation work (`03_` Deliverable 10's "Foundation" phase) begins, the concrete, non-technical first action implied by this document is §12.2 item 2 — assigning real staff names to the operational-owner roles this document has so far only described structurally (Section 6 §6.2's table). Everything else in this document's readiness gates (§12.3) depends on that assignment existing before it can be exercised.
