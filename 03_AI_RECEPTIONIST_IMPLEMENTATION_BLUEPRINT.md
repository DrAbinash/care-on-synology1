# AI Receptionist — Phase 3: Implementation Blueprint

**Project:** Care Diagnostics ERP / RIS / PACS
**Status:** Design only. No code, migrations, or routes created.
**Builds on:** `01_CURRENT_ARCHITECTURE_AUDIT.md`, `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`
**Principle:** The ERP is the single source of truth. The AI Receptionist is a new *interface* to it — never a parallel system.

This document is the master architectural reference for every future AI Receptionist task. Every later implementation ticket should be traceable to a section here.

---

## How to Read This Document

Three numbers appear next to almost every component: **Exists / Extend / New**.

- **Exists** — a working table, route, or service already does this. Reuse it as-is.
- **Extend** — something exists but is partial (e.g. `waChatbot.ts`, `ai_assistant_enabled`). Add to it.
- **New** — nothing exists. This is genuinely new surface area, and is flagged so scope doesn't silently grow.

Per the Phase 1 audit, more falls into Exists/Extend than a green-field plan would assume. This blueprint is written to protect that — it is far easier to accidentally rebuild `online_bookings` as `ai_bookings` than to remember not to.

---

# Deliverable 1 — Complete Architecture

## 1.1 Top-Level Flow

```
                                   PATIENT
                                      │
        ┌──────────┬──────────┬──────┴──────┬───────────┬──────────────┐
        │          │          │             │           │              │
      Phone     WhatsApp   Website        QR Code      Kiosk      Future Mobile App
   (Voice Gw)  (WA Gw)    (Web Chat Gw)   (QR Gw)     (Kiosk Gw)      (App Gw)
        │          │          │             │           │              │
        └──────────┴──────────┴──────┬──────┴───────────┴──────────────┘
                                      │
                                      ▼
                         ┌────────────────────────┐
                         │   AI RECEPTIONIST        │
                         │   (Conversation Manager)  │
                         └────────────┬────────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
                 ▼                    ▼                    ▼
        ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐
        │ Knowledge Base   │  │  Provider Manager  │  │  Audit Logger    │
        │ (FAQ, prep, etc.)│  │ (LLM/Voice/SMS swap)│  │ (every turn)     │
        └────────────────┘  └──────────────────┘  └─────────────────┘
                                      │
                                      ▼
                         ┌────────────────────────┐
                         │   ERP API GATEWAY        │
                         │  (new, narrow-scoped)     │
                         └────────────┬────────────┘
                                      │
        ┌──────────┬──────────┬──────┼───────┬───────────┬─────────────┐
        ▼          ▼          ▼      ▼       ▼           ▼             ▼
  Registration Appointments Queue  Billing Payments    RIS/PACS    Reports
   (Exists)     (Exists)   (Exists)(Exists)(Exists)    (Exists)    (Exists)
        │          │          │      │       │           │             │
        └──────────┴──────────┴──────┴───────┴───────────┴─────────────┘
                                      │
                                      ▼
                         ┌────────────────────────┐
                         │  Notifications & Analytics│
                         │  (Exist — extend targets)  │
                         └────────────────────────┘
```

**Reading this diagram against Phase 1 findings:**
- The bottom row (Registration → Reports) is **all Exists**. The AI Receptionist adds nothing here; it calls what's there.
- "ERP API Gateway" is the one genuinely **New** box in the core path — see Deliverable 3. Today, public routes are narrow-scoped for anonymous users and staff routes are broad for authenticated staff. The AI Receptionist is neither, and needs its own gateway layer rather than being bolted onto either existing auth model.
- WhatsApp Gateway is **Extend**, not New — `waChatbot.ts` + `whatsapp_settings.ai_assistant_enabled` already exist (Phase 1, §2.4).
- Voice, Web Chat, QR, Kiosk, and Mobile Gateways are **New** as channels, but they all terminate in the same Conversation Manager and ERP API Gateway — so each new channel is thin (auth + transport translation), not a reimplementation of booking/queue/billing logic.

## 1.2 Data Flow (Single Booking, Traced End-to-End)

```
Patient (WhatsApp): "Book me a fasting blood sugar test tomorrow morning"
        │
        ▼
WhatsApp Gateway — receives webhook, identifies phone number
        │
        ▼
Conversation Manager — loads/creates conversation session
        │  (session keyed by phone+channel; backed by portal_sessions
        │   pattern per Phase 1 §2.1 — not a new session table)
        ▼
Knowledge Base lookup — "fasting blood sugar" → test_id, prep instructions
        │
        ▼
Provider Manager — sends turn to configured LLM provider
        │  (provider is swappable; conversation logic does not know which)
        ▼
LLM proposes: "Confirm: FBS test, tomorrow 8:00 AM, ₹150. Shall I book it?"
        │
        ▼
Patient confirms
        │
        ▼
Booking Engine Adapter — calls existing online-booking creation logic
        │  (writes to `online_bookings`, NOT a new table — Phase 1 §2.2)
        ▼
Queue Adapter — token created with source = 'whatsapp'
        │  (writes to existing `tokens.source` enum value — Phase 1 §2.3,
        │   zero schema migration required)
        ▼
Payment Adapter — if prepayment required, reuses existing payment flow
        ▼
Notification Adapter — confirmation sent back via WhatsApp Gateway
        │  (reuses existing `report_message_template` / send mechanism)
        ▼
Audit Logger — full turn-by-turn transcript + the resulting booking_ref
        │  written to whatsapp_conversations.ai_handled = true
        ▼
Analytics — booking counted, conversion funnel updated
```

Every box marked "existing logic" / "NOT a new table" is a hard constraint, not a suggestion — see Design Principles compliance in §1.4.

## 1.3 Request Flow (Synchronous API Call Shape)

```
Channel Gateway
   │  POST /ai-receptionist/v1/turn
   │  { channel, sessionToken, patientPhone?, message, attachments? }
   ▼
AI Receptionist Service (stateless)
   │  1. Resolve/create session (Conversation Manager)
   │  2. Resolve patient identity if known (calls Patient API, read-only)
   │  3. Build context (Knowledge Base + booking/queue/report state)
   │  4. Call Provider Manager → LLM
   │  5. Parse LLM intent → map to one or more ERP API calls
   │  6. Execute ERP API calls (idempotent, see Deliverable 3)
   │  7. Log full turn to Audit Logger
   │  8. Return response text + structured actions to Gateway
   ▼
Channel Gateway renders/speaks/sends response to patient
```

The AI Receptionist service itself is **stateless between turns** — all state (conversation, booking-in-progress, patient identity) lives in the database, not in the LLM provider or in server memory. This is required so that:
- A WhatsApp conversation interrupted for 2 hours resumes correctly.
- A human handoff (Deliverable 6) can pick up mid-conversation with zero data loss.
- The system survives a service restart or deploy without losing in-flight conversations.

## 1.4 Design Principles — Compliance Check

| Principle | How this architecture satisfies it |
|---|---|
| No duplicate patient registration | Patient API Gateway endpoint wraps existing `patients` table + `patient_counter`. No second patient table. |
| No duplicate appointment system | Booking Engine Adapter calls existing `online_bookings` / `appointments` write paths. |
| No duplicate queue system | Queue Adapter writes to existing `tokens` / `test_tokens`, using the existing `source` column. |
| No duplicate billing | Billing Adapter calls existing bill creation/lookup — never computes prices independently. |
| No duplicate report delivery | Report Adapter reuses `radiology_share_links` + existing WhatsApp report template (Phase 1 §2.5). |
| Vendor independent | Provider Manager is the only layer that knows vendor SDKs (Deliverable 7). |
| API-first | Every adapter is a thin client of a documented internal API (Deliverable 3) — no adapter touches the database directly except via those APIs. |
| Event-driven where appropriate | Payment confirmation, report-ready, and queue-called events publish to a shared event bus consumed by Notification Adapter and Analytics — avoids polling. |
| Easily testable | Conversation Manager and Provider Manager are pure functions of (session state, input) → (new state, output) — testable without a live LLM or live WhatsApp account. |
| Future-proof | New channel = new thin Gateway; new vendor = new Provider Manager driver. Core conversation/booking logic never changes for either. |
| Healthcare-grade security | See Deliverable 8 — built on existing `requireStaffAuth`/`requireStaffPermission` pattern, extended with a new constrained AI-caller class (Phase 1 §2.6). |

---

# Deliverable 2 — Module Hierarchy

```
AI Receptionist
│
├── Channel Gateways                         [New, except WhatsApp = Extend]
│   ├── Voice Gateway                        [New]
│   ├── WhatsApp Gateway                     [Extend — waChatbot.ts already exists]
│   ├── Web Chat Gateway                     [New]
│   ├── QR Gateway                           [Extend — barcode-resolver.ts pattern reused]
│   ├── Kiosk Gateway                        [New]
│   └── Mobile Gateway (future)              [New, deferred to Year 1+ roadmap]
│
├── Conversation Manager                     [New]
│   ├── Session Store (backed by portal_sessions pattern)   [Extend]
│   ├── Intent Resolver
│   ├── Slot Filling (collects booking details across turns)
│   ├── Context Builder (assembles patient + booking + KB context)
│   └── State Machine (per conversation-flow in Deliverable 4)
│
├── Knowledge Base                           [New service; Extend underlying data]
│   ├── Content Store (ERP-admin-editable — Deliverable 5)
│   ├── Retrieval Layer (keyword first; vector optional later)
│   └── Versioning & Audit (who edited what, when)
│
├── Booking Engine Adapter                   [New thin layer; Exists underneath]
│   → calls existing online-booking + appointment write paths
│
├── Queue Adapter                            [New thin layer; Exists underneath]
│   → calls existing token issuance; uses existing `source` column
│
├── Report Adapter                           [New thin layer; Exists underneath]
│   → calls existing report status lookup + radiology_share_links issuance
│
├── Payment Adapter                          [New thin layer; Exists underneath]
│   → calls existing payment initiation/verification (Razorpay per Phase 1 §2.2)
│
├── Notification Adapter                     [New thin layer; Exists underneath]
│   → calls existing WhatsApp send + (future) SMS/voice callback
│
├── Human Handoff                            [New — Deliverable 6]
│   ├── Escalation Trigger
│   ├── Context Packager (conversation + booking + identity)
│   └── Staff Inbox Bridge (new, surfaces into existing staff UI permission model)
│
├── Audit Logger                             [Extend — whatsapp_conversations.ai_handled
│                                              already exists; generalize to all channels]
│
├── Analytics                                [New — Deliverable 9]
│
└── Provider Manager                         [New — Deliverable 7]
    ├── LLM Driver Interface (OpenAI / Anthropic / Google / Azure)
    ├── Voice/Telephony Driver Interface (Twilio / Exotel / Knowlarity / Superfone / MyOperator)
    └── Config-Driven Provider Selection (no business logic depends on a specific vendor)
```

### Review Notes on the Hierarchy (as requested)

1. **Booking/Queue/Report/Payment/Notification Adapters are deliberately "thin."** Per Phase 1, the actual logic (booking creation, token minting, payment hash verification, report template rendering) already exists and is production-tested. Each adapter's only job is: validate input from the Conversation Manager, call the existing internal API, translate the result back into conversation-friendly language. An adapter must never contain business rules that duplicate what the underlying ERP module already enforces (e.g. it must not re-implement "max 1 booking per slot" — it asks the Booking API and obeys the answer).

2. **Knowledge Base is its own top-level module, not folded into Conversation Manager.** It needs independent admin editing (Deliverable 5) and its own audit trail, so it has a different lifecycle than conversation logic and should not be deployed/versioned together.

3. **Human Handoff is promoted to a top-level module**, not a sub-feature of Conversation Manager, because it has its own state machine, its own staff-facing surface, and its own escalation rules (Deliverable 6) — bundling it in would make Conversation Manager too large to test in isolation.

4. **Provider Manager covers both LLM and telephony vendors** in one module, since both have the same shape of problem (config-driven swap, vendor SDK isolated from business logic) — see Deliverable 7.

---

# Deliverable 3 — API Architecture

## 3.1 Why a New API Layer (and not reusing staff/public routes directly)

Per Phase 1 §2.6: staff routes assume a logged-in human with module permissions; public routes assume an anonymous person filling a form, and are deliberately narrow. The AI Receptionist is neither — it is a **semi-trusted automated caller acting on behalf of an unauthenticated-but-identifying patient**. It needs:

- Broader read access than a public route (e.g. "has this patient booked before") for context-building.
- Narrower write access than a staff route (it should never be able to do what an Admin or Accountant can do).
- A caller identity (the AI Receptionist itself) that is distinct from "patient" and "staff" in every audit log row.

This is why Deliverable 1 places a dedicated **ERP API Gateway** between the AI Receptionist and the database — it is a new, thin, additive layer, not a modification of the existing two auth models.

## 3.2 API Categories

For every category: Purpose, Request shape, Response shape, Authentication, Permissions, Expected caller, Idempotency, Rate limiting, Error handling. None of this is implemented — it is the contract the future implementation phases must follow.

---

### 3.2.1 Patient APIs

**Purpose:** Resolve or create patient identity from a phone number; never duplicate `patients`/`patient_counter`.

| Endpoint (design) | Purpose |
|---|---|
| `GET /ai-gw/v1/patient/lookup?phone=` | Find existing patient(s) by phone. Read-only. |
| `POST /ai-gw/v1/patient/identify` | Confirm which patient (if multiple share a phone) the conversation is about; does not create a record. |
| `POST /ai-gw/v1/patient/register` | Create a new patient — internally calls the **existing** patient creation path (same `patient_counter` sequence used by staff UI). |

- **Request:** `{ phone, name?, dob?, gender? }`
- **Response:** `{ patientId, patientCode, isNewPatient, matchConfidence }`
- **Authentication:** AI Receptionist service credential (machine-to-machine), not patient, not staff.
- **Permissions:** `ai_caller` role, scoped to `patient:read`, `patient:create` only — no `patient:edit`, no `patient:delete`.
- **Expected caller:** AI Receptionist backend only. Never called directly from a channel gateway.
- **Idempotency:** `register` must accept an idempotency key (conversation turn ID) — a repeated LLM tool-call on retry must not create two patients. This directly addresses the missing-FK risk flagged in Phase 1 §2.7: tightening idempotency here reduces the chance of orphaned `online_bookings.patient_id` rows.
- **Rate limiting:** Per phone number — e.g. max 5 lookups/minute — to slow down phone-number enumeration attempts.
- **Error handling:** Ambiguous match (2+ patients, same phone, different names) must return a disambiguation response, never silently pick one.

---

### 3.2.2 Booking APIs

**Purpose:** Wrap the existing `online_bookings` pipeline (Phase 1 §2.2). This is the highest-value, lowest-risk integration point because the underlying pipeline is already complete and payment-tested.

| Endpoint (design) | Purpose |
|---|---|
| `GET /ai-gw/v1/booking/availability` | Check slot/test/package availability for a date. Read-only passthrough to existing availability logic. |
| `POST /ai-gw/v1/booking/quote` | Price a proposed set of tests/packages before commit. Read-only. |
| `POST /ai-gw/v1/booking/create` | Create the booking — internally is the same write as the public website booking form. |
| `GET /ai-gw/v1/booking/:bookingRef/status` | Check status of a booking made through any channel. |

- **Request (`create`):** `{ patientId, testIds[]/packageIds[], preferredDate, preferredSlot, channel, conversationSessionId }`
- **Response:** `{ bookingRef, amountDue, paymentRequired, status }`
- **Authentication:** AI Receptionist service credential.
- **Permissions:** `booking:create`, `booking:read` only.
- **Expected caller:** Booking Engine Adapter only.
- **Idempotency:** **Mandatory** — `create` must take an idempotency key. This is the single most important idempotency requirement in the whole API surface, since a flaky voice/WhatsApp connection retrying a booking request must never create two bookings for one patient intent.
- **Rate limiting:** Per session — e.g. max 3 booking attempts per conversation, to contain a misbehaving LLM loop.
- **Error handling:** Slot-taken-between-quote-and-create must return a specific `SLOT_NO_LONGER_AVAILABLE` code so the Conversation Manager can re-offer options, not just show a generic error to the patient.

---

### 3.2.3 Appointment APIs

**Purpose:** Reschedule/cancel — distinct from creation because the business rules differ (cancellation windows, rebooking limits).

| Endpoint (design) | Purpose |
|---|---|
| `POST /ai-gw/v1/appointment/:id/reschedule` | Move to new date/slot. |
| `POST /ai-gw/v1/appointment/:id/cancel` | Cancel with reason code. |

- **Authentication/Permissions:** Same service credential; `appointment:reschedule`, `appointment:cancel`.
- **Expected caller:** Booking Engine Adapter.
- **Idempotency:** Required (same reasoning as booking create).
- **Rate limiting:** Per patient — e.g. max 3 reschedules per booking, to prevent abuse loops; mirrors a sane staff-desk policy.
- **Error handling:** Must surface existing cancellation-window business rules (if any exist in the ERP) as structured reasons, not free text, so the LLM can explain *why* in natural language without inventing a policy.

---

### 3.2.4 Queue APIs

**Purpose:** Issue tokens through the existing `tokens`/`test_tokens` tables, using the existing `source` field (Phase 1 §2.3) — zero migration required.

| Endpoint (design) | Purpose |
|---|---|
| `POST /ai-gw/v1/queue/token` | Issue a token for a checked-in/walk-in-equivalent AI-originated visit. |
| `GET /ai-gw/v1/queue/:tokenId/position` | Current position/estimated wait. |

- **Request (`token`):** `{ patientId, serviceType, channel }` → internally sets `source = channel` (e.g. `'whatsapp'`, `'voice'`, `'qr'`).
- **Authentication/Permissions:** `queue:create`, `queue:read`.
- **Expected caller:** Queue Adapter only.
- **Idempotency:** Required — duplicate token issuance for one visit is a real-world operational nuisance (confuses the physical queue display), not just a data-quality issue.
- **Rate limiting:** Per patient per day — prevents accidental multi-token issuance from a confused conversation retry.
- **Error handling:** If counter/queue is closed (after hours), must return a structured `QUEUE_CLOSED` reason — feeds directly into the After Hours conversation flow (Deliverable 4).

---

### 3.2.5 Report APIs

**Purpose:** Status lookup and secure delivery, reusing `radiology_share_links` (Phase 1 §2.5) — never expose direct file paths.

| Endpoint (design) | Purpose |
|---|---|
| `GET /ai-gw/v1/report/status?patientId=&ref=` | Is the report ready? Read-only. |
| `POST /ai-gw/v1/report/share-link` | Mint a time-limited `radiology_share_links` token, audience=`patient`. |

- **Authentication/Permissions:** `report:read`, `report:share-create`. Explicitly **no** `report:share-create` for `audience=radiologist` — the AI Receptionist must never be able to mint a radiologist-audience link.
- **Expected caller:** Report Adapter only.
- **Idempotency:** `share-link` should be idempotent within a short window (e.g. re-asking "send my report again" within 5 minutes returns the same still-valid link rather than minting a new one) — keeps `radiology_share_links` from accumulating noise.
- **Rate limiting:** Per patient — e.g. max 5 share-link mints per day, to limit exposure if a phone is compromised mid-conversation.
- **Error handling:** Report not ready → structured `NOT_READY` + expected ready date if known, never a guess.

---

### 3.2.6 Payment APIs

**Purpose:** Initiate/verify payment for AI-originated bookings, reusing the existing payment gateway integration (Razorpay, per Phase 1 §2.2) — never re-implement hash verification.

| Endpoint (design) | Purpose |
|---|---|
| `POST /ai-gw/v1/payment/initiate` | Start payment for a booking created via `booking/create`. |
| `GET /ai-gw/v1/payment/:id/status` | Poll/confirm payment status. |

- **Authentication/Permissions:** `payment:initiate`, `payment:read`. **No** refund permission at all in this category — see Refund flow note below.
- **Expected caller:** Payment Adapter only.
- **Idempotency:** Mandatory — payment initiation is the single highest-stakes idempotency case in the entire system (duplicate charge risk). Must reuse the exact same idempotency mechanism the existing payment gateway integration already uses internally, not a new one.
- **Rate limiting:** Per booking — e.g. max 5 initiation attempts, after which auto-handoff to human (ties into Deliverable 6 escalation rules).
- **Error handling:** Gateway-specific failures must be normalized into a small set of conversational categories (`CARD_DECLINED`, `TIMEOUT`, `CANCELLED_BY_USER`, `UNKNOWN`) so the LLM has a finite set of things to say, never raw gateway error text.

**Refunds are explicitly out of scope for AI-direct execution.** A refund request detected in conversation should always route to Human Handoff (Deliverable 6) with the booking/payment context pre-attached — refunds touch accounting/commission logic that should remain staff-authorized per the existing `requireStaffPermission` model (Phase 1 §2.6). The AI Receptionist may *explain* refund policy (from the Knowledge Base) but must not *execute* one.

---

### 3.2.7 Knowledge APIs

**Purpose:** Serve and (for staff) edit the centralized Knowledge Base (Deliverable 5).

| Endpoint (design) | Purpose |
|---|---|
| `GET /ai-gw/v1/knowledge/search?q=` | Retrieve relevant KB entries for a query (used by Conversation Manager). |
| `GET /admin/ai-gw/v1/knowledge` (staff-facing, separate from ai_gw prefix) | List/edit KB entries. |
| `POST /admin/ai-gw/v1/knowledge` | Create/update KB entry. |

- **Authentication:** `search` uses the AI service credential; the admin CRUD endpoints use **existing** `requireStaffAuth` + `requireStaffPermission` — this is the one API category that intentionally reuses staff auth wholesale, since editing the Knowledge Base is a staff function, not an AI-caller function.
- **Permissions:** Admin CRUD gated by a new `knowledge_base` module entry in the existing staff permission matrix (additive, not a new auth system).
- **Idempotency:** Not required for `search` (read-only); standard `If-Match`/version check recommended for `update` to prevent two staff overwriting each other silently.
- **Rate limiting:** `search` rate-limited per conversation session, not globally, since it's called every turn.
- **Error handling:** No-match search must return an explicit "no KB hit" signal so the Conversation Manager can decide whether to escalate rather than letting the LLM improvise medical/policy information.

---

### 3.2.8 Notification APIs

**Purpose:** Send confirmations/reminders, reusing the existing WhatsApp send mechanism (Phase 1 §2.5) and extending to SMS/voice callback in later phases (per `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`, SMS is schema-ready but not wired).

| Endpoint (design) | Purpose |
|---|---|
| `POST /ai-gw/v1/notify/send` | Send a templated confirmation/reminder via the appropriate channel. |

- **Request:** `{ patientId, channel, templateKey, variables }` — **templateKey, never free-form AI-generated text for transactional messages** (booking confirmations, payment receipts). Free-form AI text is reserved for conversational replies, not transactional records.
- **Authentication/Permissions:** `notify:send`, scoped to template-based sends only.
- **Expected caller:** Notification Adapter.
- **Idempotency:** Required per (patientId, templateKey, bookingRef) — prevents duplicate confirmation spam on retry.
- **Rate limiting:** Per patient per day, to prevent notification flooding from a conversational loop bug.
- **Error handling:** Channel-down (e.g. WhatsApp API outage) must fall back per a defined priority order (WhatsApp → SMS → email) rather than silently failing.

---

### 3.2.9 Administration APIs

**Purpose:** Staff configuration of the AI Receptionist itself — provider selection, system prompts, escalation rules, business hours.

| Endpoint (design) | Purpose |
|---|---|
| `GET/PUT /admin/ai-gw/v1/settings` | AI assistant config — extends existing `whatsapp_settings.ai_*` fields (Phase 1 §2.4) into a channel-agnostic settings table. |
| `GET/PUT /admin/ai-gw/v1/escalation-rules` | Configure VIP/emergency/after-hours routing (Deliverable 6). |
| `GET /admin/ai-gw/v1/providers` | List configured LLM/voice providers and active selection (Deliverable 7). |

- **Authentication/Permissions:** Existing `requireStaffAuth` + `requireStaffPermission`, new `ai_receptionist_settings` module, restricted to Admin/Super Admin roles only — this is deliberately not given to Reception-level staff, since misconfiguration here (e.g. disabling escalation) is a patient-safety-adjacent risk.
- **Idempotency:** Standard PUT semantics (full replace) sufficient.
- **Rate limiting:** Low-volume, staff-only — standard staff-route limits apply, no special treatment needed.
- **Error handling:** Validation must reject configurations that would leave the system with no Human Handoff path at all (e.g. cannot disable escalation entirely without an explicit, separately-confirmed override).

---

### 3.2.10 Conversation APIs

**Purpose:** Internal API between Channel Gateways and the Conversation Manager (Deliverable 1 §1.3's `POST /ai-receptionist/v1/turn`), plus staff-facing transcript retrieval for Human Handoff.

| Endpoint (design) | Purpose |
|---|---|
| `POST /ai-receptionist/v1/turn` | Single conversational turn — the core request from §1.3. |
| `GET /ai-receptionist/v1/session/:id/transcript` | Full transcript — used by Human Handoff and by staff reviewing past conversations. |
| `POST /ai-receptionist/v1/session/:id/escalate` | Explicit escalation trigger (Deliverable 6). |

- **Authentication:** `turn` is called by Channel Gateways using a gateway-specific service credential (so a compromised WhatsApp webhook secret cannot impersonate the Voice Gateway, for example). `transcript` retrieval by staff uses existing `requireStaffAuth`.
- **Permissions:** Each Channel Gateway credential is scoped to only its own channel — Voice Gateway cannot call `turn` claiming `channel: whatsapp`.
- **Idempotency:** `turn` should be idempotent per (sessionId, channel message ID) — WhatsApp/voice infrastructure commonly redelivers webhooks; without this, a redelivered webhook could cause the AI to "respond twice" or double-process an action.
- **Rate limiting:** Per session — protects against a malformed channel integration hammering the endpoint.
- **Error handling:** LLM/provider timeout must return a graceful "let me get someone to help" fallback message, never a raw error to the patient — ties directly into Human Handoff escalation rules.

---

### 3.2.11 Analytics APIs

**Purpose:** Feed the dashboard in Deliverable 9. Read-only, aggregate-only — must never expose patient-identifiable data outside existing PII access controls.

| Endpoint (design) | Purpose |
|---|---|
| `GET /admin/ai-gw/v1/analytics/summary?from=&to=` | Aggregate metrics (Deliverable 9 list). |
| `GET /admin/ai-gw/v1/analytics/conversations?filter=` | Drill-down — staff-only, same PII rules as existing patient data access. |

- **Authentication/Permissions:** Existing `requireStaffAuth` + `requireStaffPermission`, scoped to a new `analytics` permission already present in the existing module list per the rolePermissions matrix structure — extend, don't duplicate the permission model.
- **Idempotency:** N/A (read-only).
- **Rate limiting:** Standard staff-route limits.
- **Error handling:** Standard.

## 3.3 Cross-Cutting API Rules

1. **Every write endpoint requires an idempotency key.** This is the single most repeated requirement in §3.2 deliberately — voice and WhatsApp channels have materially higher retry/redelivery rates than a staff clicking a button once, and the existing missing-FK risk (Phase 1 §2.7) means duplicate writes are more dangerous here than elsewhere in the ERP.
2. **No AI Receptionist endpoint ever returns more PII than the equivalent existing public-facing route already would.** The Gateway is broader than public routes for *context-building reads used internally*, but nothing AI-sourced should leak more patient data back out to the patient than they could already see in the existing patient portal.
3. **Transactional content (confirmations, receipts) is template-based; conversational content is free-form.** This boundary is what keeps the AI's creativity from ever touching a legal/financial document.
4. **Every endpoint in this section logs to Audit Logger by caller identity `ai_receptionist`, never under a patient or staff identity** — so existing audit/compliance tooling can immediately distinguish AI-originated actions from human-originated ones without new tooling.

---

# Deliverable 4 — Conversation Flow Design

Each flow below is written as a decision flowchart in text form (so it can be reviewed without a diagramming tool, and later translated 1:1 into the Conversation Manager's state machine). Every flow explicitly names which existing ERP capability it calls, per Design Principle "no duplicate workflows."

## 4.1 New Patient

```
START
 → AI: "Have you visited us before?"
   ├─ NO  → collect name, phone, dob/age, gender
   │        → Patient API: register (idempotent on conversation turn ID)
   │        → proceed to intent (booking / enquiry / etc.)
   └─ YES → go to "Existing Patient" flow
```

## 4.2 Existing Patient

```
START
 → AI asks for phone (or already has it from channel, e.g. WhatsApp sender)
 → Patient API: lookup
   ├─ 1 match  → Patient API: identify (confirm name) → proceed
   ├─ 0 match  → go to "New Patient" flow
   └─ 2+ match → AI: "I found a few records — can you confirm your date of birth?"
                 → disambiguate → proceed
```

## 4.3 Appointment Booking

```
(requires identified patient — runs after 4.1/4.2)
 → AI: "What test or package would you like, and when?"
 → Knowledge API: search (resolve test/package name → ID, fetch prep info if relevant)
 → Booking API: availability check
   ├─ Available → Booking API: quote → AI states price → confirm?
   │                ├─ Yes → Booking API: create (idempotent)
   │                │         → Payment flow (4.9) if prepayment required
   │                │         → Queue API: token (source=channel)
   │                │         → Notification API: send booking confirmation
   │                │         → END (success)
   │                └─ No  → END (abandoned — logged for Analytics)
   └─ Not available → AI offers next available slot(s) → loop to confirm
```

## 4.4 Appointment Rescheduling

```
(requires identified patient + existing bookingRef)
 → AI: "Which appointment would you like to move?"
 → Appointment API: fetch current booking (via Booking status API)
 → AI: "What new date/time?"
 → Booking API: availability check for new slot
   ├─ Available → Appointment API: reschedule (idempotent)
   │               → Notification API: send updated confirmation
   │               → END
   └─ Not available → offer alternatives → loop
```

## 4.5 Cancellation

```
(requires identified patient + existing bookingRef)
 → AI: "Can you confirm you'd like to cancel [test] on [date]?"
   ├─ Confirms → Appointment API: cancel (with reason code, idempotent)
   │              → AI states cancellation policy from Knowledge Base
   │                (e.g. refund window) — informational only, no refund executed
   │              → if refund implied → Human Handoff (refunds are staff-only, §3.2.6)
   │              → Notification API: send cancellation confirmation
   │              → END
   └─ Declines → END (no action)
```

## 4.6 Price Enquiry

```
 → AI: "Which test/package would you like pricing for?"
 → Knowledge API: search (or Booking API: quote if patient/date context exists)
 → AI states price + any active package suggestion (4.7)
 → offer to book → if yes, go to 4.3
```

## 4.7 Package Recommendation

```
(can be entered from 4.6 or proactively after identifying test interest)
 → Knowledge API: search for packages containing the requested test
 → AI: "We also have a [Package Name] that includes [test] + 3 others for ₹X
        (vs ₹Y individually)"
 → offer to book package instead → go to 4.3 with package_id
```

## 4.8 Report Status

```
(requires identified patient)
 → AI: "Which report are you asking about?" (or infer from most recent if only one pending)
 → Report API: status
   ├─ Ready    → Report API: share-link (idempotent within window)
   │              → AI sends link via Notification API
   │              → END
   ├─ Not ready → AI states expected ready time (if known) from status response
   │               → END
   └─ Not found → AI: "I can't find that — let me connect you with our team."
                  → Human Handoff
```

## 4.9 Payment

```
(entered from 4.3 when prepayment required)
 → Payment API: initiate
 → AI presents payment link/instructions (channel-appropriate — e.g. WhatsApp
    payment link vs. voice channel reading out a short link/OTP-based flow)
 → Payment API: status (poll or webhook-driven)
   ├─ Success → Notification API: send receipt (template-based)
   │             → confirm booking finalized → END
   ├─ Failed/Declined → AI states normalized reason (CARD_DECLINED etc., §3.2.6)
   │                     → offer retry (up to rate limit) → loop or Human Handoff
   └─ Timeout → AI: "I haven't received confirmation — would you like to try again
                     or have our team assist?"
               → retry or Human Handoff
```

## 4.10 Refund

```
(always detected, never executed by AI — see §3.2.6)
 → AI: "I'll connect you with our billing team for refunds — let me pass along
        what I have so you don't need to repeat yourself."
 → Human Handoff (priority: normal, unless patient indicates urgency)
 → Context Packager includes: booking/payment reference, stated reason
 → END (AI side) — staff resumes per Deliverable 6
```

## 4.11 MRI / CT / Ultrasound Preparation

```
(three flows, identical shape — differ only in Knowledge Base content key)
 → AI: "Which scan is this for?" (or already known from booking context)
 → Knowledge API: search (prep instructions for that modality/body part)
 → AI relays prep instructions verbatim from Knowledge Base
   (never paraphrased/invented — see Deliverable 5, "no hard-coded prompts"
    also implies no improvised medical prep instructions)
 → AI: "Would you like this sent to you in writing?" → Notification API: send (if yes)
 → END
```

## 4.12 Emergency Call

```
(highest-priority interrupt — can fire mid-flow from any other flow)
 → Trigger: keyword/intent classifier flags emergency language
 → AI: immediately states emergency contact number from Knowledge Base
        (does NOT attempt booking/triage — out of AI's authority entirely)
 → Human Handoff: priority = EMERGENCY (Deliverable 6 routing)
 → Conversation paused for AI; full context handed to staff instantly
 → END (AI side)
```

## 4.13 Transfer to Human

```
(can be entered explicitly by patient request, or by any flow's escalation path)
 → AI: "Connecting you with our team now — they'll have everything we discussed."
 → Human Handoff: Context Packager runs (Deliverable 6)
 → Staff Inbox Bridge surfaces conversation
 → END (AI side)
```

## 4.14 VIP Patient

```
(detected at identification step, 4.2 — VIP flag is existing patient data,
 not a new field invented for this project — confirm flag location during
 Phase 4 implementation, do not assume schema)
 → If VIP flag present → all subsequent flows run identically, EXCEPT:
    - Human Handoff routing priority is elevated (Deliverable 6)
    - Booking availability checks may consult VIP-reserved slots if that
      concept already exists in the ERP — do not invent VIP slot logic
      if it does not already exist; escalate uncertainty to Phase 4 audit
```

## 4.15 Language Selection

```
START (before any other flow, channel-permitting)
 → AI: "Hi! / नमस्ते! Press/say 1 for English, 2 for Hindi..." (voice/IVR-style)
        or auto-detect from message language (text channels)
 → Selected language stored in session for remainder of conversation
 → Knowledge Base content retrieved in selected language (requires KB entries
   to support multi-language — see Deliverable 5 design, and Year-1 roadmap
   item "Multilingual Voice")
 → proceed to normal flow
```

## 4.16 Missed Call Callback

```
(Voice channel specific)
 → Telephony provider reports missed/unanswered call
 → System auto-triggers outbound callback within configured window (e.g. 5 min)
   OR sends WhatsApp message: "We missed your call — how can we help?"
   (channel choice configurable in Administration API settings)
 → Resulting conversation enters normal flow once patient responds
```

## 4.17 Offline Mode

```
(triggered when Provider Manager reports all LLM providers unavailable,
 or ERP API Gateway is unreachable)
 → Channel Gateway falls back to a static, pre-approved message:
   "We're unable to process automated requests right now. Please call
    [clinic number] or try again shortly."
 → No booking/queue/payment action is attempted in this mode under any
   circumstance — offline mode is fail-safe, not degraded-functionality
 → Logged distinctly in Analytics as "offline mode triggered" (Deliverable 9)
```

## 4.18 Business Hours / After Hours / Holiday Mode

```
(checked at the start of every conversation, sourced from existing clinic
 settings if a business-hours concept already exists there — extend rather
 than invent; confirm exact source field during Phase 4 implementation audit)

 Business Hours:
  → Full flow set available as normal (4.1–4.17 minus 4.16's auto-callback
    which is hours-agnostic)

 After Hours:
  → AI states hours and emergency contact (4.12 content) up front
  → Booking enquiries still answered (informational) but booking CREATE
    may be deferred to next business day if same-day slots require staff
    confirmation — exact rule depends on existing booking-window logic;
    do not invent a new after-hours booking rule, defer to existing rules

 Holiday Mode:
  → Same shape as After Hours, with holiday-specific message from
    Knowledge Base (e.g. "We are closed for [holiday] — reopening [date]")
  → Configurable via Administration API, calendar-driven, not hardcoded
    per-year
```

---

# Deliverable 5 — Knowledge Base Design

## 5.1 Structure

The Knowledge Base is a single, centrally-editable content store. It is **New** as a dedicated service, but should physically extend existing data wherever existing data already represents the same fact — the rule throughout this section is *one fact, one place*.

| Category | Existing source to extend (if any) | New content needed |
|---|---|---|
| Hospital Information | clinic settings (existing, per `clinicSettings.ts` schema) | Conversational phrasing only |
| Doctors | `doctors` table (existing) | None — KB queries existing table |
| Departments | existing ERP structure | Conversational descriptions |
| Tests | `tests` table (existing) | None — KB queries existing table for name/price |
| Packages | `packages`/`packageTests` tables (existing) | None — KB queries existing table |
| Preparation Instructions | — | **New** — does not appear to exist as patient-facing text today; must be authored by clinical staff, not generated by AI |
| FAQs | — | **New** content, staff-authored |
| Policies (cancellation, refund) | `disclaimerText` and related fields already exist in clinic settings (confirmed in schema review) | Extend — KB surfaces these existing fields conversationally rather than duplicating policy text |
| Insurance | — | **New**, if applicable to this clinic |
| Refund Rules | extend `disclaimerRefundPercentage`, `disclaimerCancellationWindowHours` (existing fields, confirmed in schema) | Conversational phrasing only |
| VIP Rules | depends on Phase 4 confirmation of VIP flag/logic | TBD — do not invent |
| PCPNDT FAQs | — | **New**, legally sensitive — must be staff-authored/approved, never AI-generated |
| Radiology FAQs | — | **New** |
| Laboratory FAQs | — | **New** |
| Contact Information | clinic settings (existing) | None |
| Maps | — | **New** (static link/embed) |
| Emergency Contacts | clinic settings (existing, `emergencyMessage` field confirmed) | Extend |

## 5.2 Why "No Hard-Coded Prompts" Matters Operationally

If preparation instructions, PCPNDT FAQs, or policy text are embedded in an LLM system prompt instead of the Knowledge Base, then:
- Updating them requires a code deployment, not a staff edit — unacceptable for a healthcare clinic where prep instructions can change per equipment/protocol update.
- There is no audit trail of *who* changed clinical guidance *when* — a compliance gap, especially for PCPNDT content which has legal sensitivity.
- The same fact can drift out of sync between, say, the WhatsApp prompt and a future Voice prompt, because each channel's prompt is edited independently.

The Knowledge Base design therefore requires:

1. **Single content store**, keyed by category + topic, versioned.
2. **Retrieval layer** that the Conversation Manager queries fresh every relevant turn — content is never baked into a static system prompt at deploy time.
3. **ERP Admin editing surface** — reuses existing staff auth (per §3.2.7), gated to a `knowledge_base` permission, likely restricted to Admin role and designated clinical staff for medically-sensitive categories (prep instructions, PCPNDT FAQs) specifically — these two categories should have a stricter edit-permission than general FAQs.
4. **Versioning & audit** — every edit recorded with who/when/what-changed, consistent with the ERP's existing audit-log philosophy (Phase 1 confirms an existing audit pattern via `ai_handled` flags and similar).

## 5.3 Retrieval Approach (Design-Level, Not Implementation)

Two viable approaches, to be decided in Phase 4 based on actual content volume:

- **Keyword/category-tag retrieval** (simpler, sufficient if KB stays in the low hundreds of entries — likely true for a single-clinic deployment). Recommended starting point.
- **Vector/semantic retrieval** (`ragDocuments`-style, per `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md` which confirms `ragDocuments` tables already exist in schema). This is an **Extend** path, not New, if/when KB content grows large enough that keyword matching misses paraphrased patient questions.

Recommendation: start with keyword/category retrieval (cheaper, more predictable, easier to audit why a given answer was given), and only graduate to the existing RAG tables if real usage data shows keyword retrieval missing genuine queries. This avoids paying vector-infrastructure complexity cost before it's proven necessary.

---

# Deliverable 6 — Human Handoff Design

## 6.1 Requirements Mapping

| Requirement | Design answer |
|---|---|
| Conversation history preserved | Full transcript lives in the session store (backed by `portal_sessions`-pattern, Deliverable 1 §1.3) — Human Handoff reads it, does not re-collect it. |
| Patient identity preserved | Patient API identity resolution (§3.2.1) already ran during the conversation — staff inbox receives `patientId`, not a name the patient must repeat. |
| Booking context preserved | Any in-progress `online_bookings` row (even `pending_payment` status) is linked to the session and surfaced to staff. |
| No repeated questions | Context Packager (below) assembles a single structured handoff payload — staff sees it, doesn't re-ask. |
| Staff can resume immediately | Staff Inbox Bridge surfaces into the **existing** staff UI permission model (Phase 1 §2.6) — not a separate app staff must learn. |
| Voice transfer | Telephony provider's native warm-transfer capability, where available (provider-dependent — see Deliverable 7); falls back to "we'll call you back" + Conversation API transcript if warm transfer unsupported by the active provider. |
| WhatsApp transfer | Conversation continues in the same WhatsApp thread — `ai_handled` flag (existing field, confirmed in `whatsapp_conversations` schema per Phase 1 §2.4) flips to `false`, staff replies from existing WhatsApp inbox UI. |
| Web Chat transfer | Same session, same UI — only the responder identity changes from AI to staff (server-side), patient experience is a continuous single chat window. |
| Escalation rules | See §6.3. |
| Priority routing | See §6.3. |
| VIP routing | See §6.3, ties to Conversation Flow 4.14. |
| Emergency routing | See §6.3, ties to Conversation Flow 4.12. |

## 6.2 Context Packager — Payload Shape (Design)

```
{
  sessionId,
  channel,
  patient: { patientId, patientCode, name, phone, isVip, isNewPatient },
  conversationSummary: <short AI-generated summary, NOT the raw transcript —
                         raw transcript available on demand via link>,
  inProgressAction: {
    type: "booking" | "reschedule" | "cancellation" | "refund" | "report-query" | "other",
    relevantRef: <bookingRef / appointmentId / reportRef, if any>,
    stateAtHandoff: <structured, e.g. "quoted ₹450, awaiting confirmation">
  },
  escalationReason: "explicit-request" | "emergency" | "refund" | "ambiguous-match"
                     | "provider-failure" | "rate-limit-exceeded" | "other",
  priority: "EMERGENCY" | "VIP" | "NORMAL",
  transcriptLink: <link into Conversation API transcript endpoint, §3.2.10>
}
```

This payload is intentionally **summary-first, transcript-on-demand** — a staff member handling a queue of handoffs needs to triage quickly; the full transcript is one click away, not the default view.

## 6.3 Escalation Rules & Priority Routing

| Trigger | Priority | Routing |
|---|---|---|
| Patient explicitly asks for a human | NORMAL | Next available staff in the relevant queue (reception/billing, inferred from `inProgressAction.type`) |
| Emergency keyword/intent detected (4.12) | **EMERGENCY** | Immediate — bypasses any queue, alerts available staff via existing notification mechanism, not just inbox |
| Refund detected (4.10) | NORMAL (unless patient also signals urgency) | Routed to billing-permission staff specifically — reuses existing `requireStaffPermission` module scoping, not a generic inbox |
| VIP patient (4.14) | **VIP** (elevated above NORMAL, below EMERGENCY) | Routed with priority flag; exact staff routing (e.g. specific senior staff) is a clinic policy decision to confirm in Phase 4, not assumed here |
| Provider failure / offline mode (4.17) | NORMAL | Routed generically — this is a system issue, not a patient urgency signal |
| Ambiguous patient match unresolved after 2 attempts | NORMAL | Routed to reception, since identity verification is a front-desk-native task |
| Rate limit exceeded (any API in §3.2) | NORMAL | Routed generically, logged distinctly in Analytics as a possible bug/abuse signal for review |

**Design constraint:** escalation rules are stored via the Administration API (§3.2.9), editable by Admin/Super Admin only, with the explicit safeguard already noted there — the system cannot be configured into a state with zero Human Handoff path.

## 6.4 Staff Inbox Bridge — Integration Principle

This is the one place in the entire blueprint where a genuinely new staff-facing UI surface is implied. To minimize duplication risk:

- It should be a **new tab/section within the existing staff application shell** (same login, same permission system, same look), not a separate deployed app.
- It should reuse the existing WhatsApp inbox UI for WhatsApp-originated handoffs (per Phase 1 confirming `whatsapp_conversations` already has staff-facing inbox precedent) rather than building a second inbox for that channel.
- For channels with no existing staff-facing inbox precedent (Voice, Web Chat, QR, Kiosk), a new unified "AI Handoff Queue" view is needed — but it should be **one queue serving all non-WhatsApp channels**, not one per channel, to avoid staff needing to check five places.

---

# Deliverable 7 — Vendor Abstraction

## 7.1 Principle

No module outside Provider Manager may import or reference a vendor SDK directly. Every other module (Conversation Manager, all Adapters, Knowledge Base) interacts only with Provider Manager's internal interface. This is what makes "switching providers requires configuration changes only" actually true, rather than aspirational.

## 7.2 LLM Provider Interface (Design)

```
interface LlmProvider {
  generateTurn(context: ConversationContext) → { text, proposedActions[], confidence }
  // context includes: conversation history, KB snippets retrieved, patient
  // context (non-sensitive subset), available action schema (§3.2 APIs)
}
```

Drivers implementing this interface: OpenAI, Anthropic, Google, Azure (OpenAI-compatible or native, per Azure's offering at implementation time). Per `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`, a Gemini integration already exists in some form (`@workspace/integrations-gemini-ai` referenced) — this should become **one driver among several** behind this interface, not a special case the rest of the system is coupled to.

**Config-driven selection example (illustrative, not literal schema):**
```
ai_receptionist_settings.llm_provider = "anthropic" | "openai" | "google" | "azure"
ai_receptionist_settings.llm_model = <provider-specific model identifier>
ai_receptionist_settings.llm_fallback_provider = <used if primary times out/errors>
```

Fallback provider support is explicitly designed in from the start — given this is a patient-facing clinical-adjacent system, a single point of LLM-vendor failure is not acceptable; Offline Mode (4.17) should only trigger if *all* configured providers (primary + fallback) fail.

## 7.3 Telephony/Voice Provider Interface (Design)

```
interface TelephonyProvider {
  receiveInboundCall(callEvent) → routes to Conversation API turn endpoint
  initiateOutboundCall(phone, context) → for missed-call callback (4.16)
  warmTransfer(callId, staffExtension) → for Human Handoff voice transfer (6.1)
                                          [optional — provider capability flag]
  textToSpeech(text, language) → audio stream [if not natively bundled by provider]
  speechToText(audio) → text [if not natively bundled by provider]
}
```

Drivers: Twilio, Exotel, Knowlarity, Superfone, MyOperator, future providers. Each provider has different native capabilities (e.g. not all support warm transfer) — the interface exposes capability flags so Conversation Manager can adapt gracefully (e.g. fall back to "we'll call you back" if warm transfer isn't supported, per §6.1) rather than assuming uniform capability.

## 7.4 What Must Never Depend on a Specific Vendor

- Conversation flow logic (Deliverable 4) — written entirely in terms of the `LlmProvider`/`TelephonyProvider` interfaces, never a specific vendor's API shape.
- Knowledge Base retrieval — vendor-agnostic by construction (§5.3).
- All ERP API Gateway endpoints (Deliverable 3) — have zero knowledge of which LLM/telephony vendor triggered the call.
- Audit Logger — logs `provider: <name>` as a field for traceability, but logging logic itself doesn't branch on vendor.

## 7.5 Switching Cost (Design Target)

Switching the primary LLM provider should be: one Administration API config change + verifying the new provider's driver is already implemented (one-time engineering cost per *new* vendor, zero cost per *switch* between already-implemented vendors). This is the concrete, testable definition of "vendor independent" for this project — Phase 4+ implementation should write a test that swaps the configured provider and confirms conversation flows behave identically.

---

# Deliverable 8 — Security Architecture

This section is written as a review against the existing security posture documented in Phase 1 (§2.6, §2.7), not as a generic checklist — each item states what already exists, what the AI Receptionist adds, and what must be fixed first.

## 8.1 Authentication

- **Exists:** `requireStaffAuth` for staff, session-based patient auth via `portal_sessions`.
- **New:** A third caller class — `ai_receptionist` service credential — distinct from both, used by Channel Gateways to call the Conversation API (§3.2.10) and by the AI Receptionist backend to call the ERP API Gateway (§3.2.1–3.2.9). This credential must be a machine credential (rotatable secret or signed service token), never a shared API key embedded in multiple gateway deployments.
- **Per-channel sub-credentials:** Each Channel Gateway (Voice, WhatsApp, Web Chat, QR, Kiosk) should have its *own* credential scoped to its own channel only (§3.2.10) — a compromised WhatsApp webhook secret must not allow calling the Voice Gateway's endpoints.

## 8.2 Authorization

- **Exists:** Granular module/action permission matrix for staff (`rolePermissions`-style structure, confirmed in schema).
- **New:** The `ai_caller` role described throughout Deliverable 3 must be added as a new row-set in the **same** permission matrix structure, not a parallel authorization system. This keeps a single point of truth for "who can do what" across the entire ERP, including the AI.
- **Explicit non-permissions** (must be enforced, not just assumed): `ai_caller` must never have `payment:refund`, `report:share-create[audience=radiologist]`, `patient:delete`, `patient:edit` (beyond what `register`/`identify` requires), or any `*:delete` permission anywhere. This list should be encoded as an automated test against the permission matrix, not just documentation.

## 8.3 Patient Privacy

- **Principle (restated from §3.3):** AI Receptionist endpoints must never return more PII to the patient than the existing patient portal already would.
- **New risk surface:** Voice and WhatsApp are channels where caller identity (phone number) is the *only* initial signal — unlike the web portal which has a deliberate login step. The Patient API's `identify` step (§3.2.1) — confirming a second factor like DOB before revealing booking/report details — is the control that prevents "I have your phone number so I can ask your AI receptionist for your test results" attacks. This must be enforced for every report/booking/billing query, not optional.

## 8.4 Audit Logs

- **Exists:** `ai_handled` flag pattern in `whatsapp_conversations` (Phase 1 §2.4) — precedent for distinguishing AI vs. human action in logs.
- **New:** Generalize this pattern across all channels (Deliverable 1 module hierarchy, Audit Logger) — every AI Receptionist action, on every channel, logged under the `ai_receptionist` caller identity (§3.3, rule 4), with enough structure to answer "what did the AI do, to which patient, via which channel, when" without needing to replay a transcript.

## 8.5 Encryption

- Transport: All Channel Gateway ↔ Conversation API ↔ ERP API Gateway traffic must be TLS — internal-network traffic is not exempted, since voice/WhatsApp webhooks often traverse the public internet before reaching internal services.
- At rest: Conversation transcripts contain PII (names, phone numbers, sometimes health context inferred from test names) — must be encrypted at rest to the same standard as existing patient data, not a lesser standard because it's "just chat logs."

## 8.6 Webhook Validation

- **Exists:** `webhook_verify_token` field already present in `whatsapp_settings` (Phase 1 §2.4) — confirms webhook signature validation is already a recognized requirement in this codebase.
- **New:** Every inbound Channel Gateway webhook (Voice provider, future Web Chat widget, QR scan endpoint) must apply the equivalent pattern — verify the request genuinely originates from the configured provider before processing, not just before responding. This must be checked per-provider during Provider Manager driver implementation (Deliverable 7), since each vendor has a different signature scheme.

## 8.7 Prompt Injection Risks

This is a **new** risk category not addressed by the existing ERP (since it had no LLM-driven user-facing surface at this scale before). Design requirements:

- The LLM must never be given direct tool access to execute ERP API calls without the Conversation Manager validating the proposed action against the actual permission/business-rule constraints first (§3.2's "ERP APIs enforce business rules, adapters never bypass them" principle is also the prompt-injection defense — even if a malicious patient message tricks the LLM into "deciding" to issue a refund, the Payment API simply has no refund permission to grant, per §8.2).
- Knowledge Base content (Deliverable 5) is the only "trusted" text injected into the LLM context as fact; patient messages are always treated as untrusted input, never as instructions that can change the AI's permission scope or system behavior.
- Structured action proposals from the LLM (`proposedActions[]` in the Provider interface, §7.2) should be validated against a strict schema before any adapter executes them — free-text LLM output should never be parsed as if it were a direct API call.

## 8.8 PII Protection

- Covered by §8.3, §8.5. Additionally: conversation summaries sent to staff (Context Packager, §6.2) should avoid restating sensitive test results in the summary field where avoidable — link to the authoritative record (existing report-view permission-gated UI) rather than duplicating clinical content into a second location (the handoff payload).

## 8.9 Role Permissions

- Covered by §8.2. Single sentence restated for emphasis: **one permission matrix, one new role added to it, zero new authorization systems.**

## 8.10 Rate Limiting

- Per-endpoint recommendations given throughout §3.2. General principle: rate limits for AI Receptionist endpoints should be **tighter** than equivalent staff-route limits (machine-speed retry loops are a realistic failure mode for an LLM-driven caller in a way they aren't for a human clicking a UI) and **looser** than fully-anonymous-public limits where the caller has already been identified (§3.2.1) — i.e., rate limit by patientId/sessionId once identity is known, not just by IP.

## 8.11 Replay Protection

- Directly served by the idempotency-key requirement repeated throughout §3.2 — replay protection and idempotency are the same mechanism here: a webhook or LLM tool-call retry with the same idempotency key must be a no-op on the second delivery, full stop.

## 8.12 Consent

- **New requirement, not present in existing public-booking flow per Phase 1 review:** Before an AI Receptionist conversation collects health-adjacent information (e.g. "I need a test because I have [symptom]") or makes a recording (voice channel), a consent notice should be presented — content and legal requirement to be confirmed with the clinic's compliance process, but the *architecture* requirement is: consent state must be a field in the session record, checked before any health-adjacent data is logged or used for Knowledge Base personalization, not assumed.

## 8.13 Session Management

- **Exists:** `portal_sessions` pattern (Phase 1 §2.1), proposed for reuse as the identity layer (Deliverable 1 §1.2).
- **New:** Session TTL/expiry policy for AI Receptionist conversations needs its own definition — a WhatsApp conversation might reasonably stay "open" for days (patients don't always reply immediately), whereas a voice call session should close at call end. This is channel-dependent and must be configurable per channel, not a single global TTL.

## 8.14 Voice Recording

- **New.** If the chosen telephony provider records calls (common default), the architecture must capture: explicit consent flag (§8.12), retention period, and access-control (recordings should be gated by the **same** `requireStaffPermission` scoping as other sensitive patient data — not a separate, looser-controlled storage bucket).

## 8.15 Call Retention

- **New.** Retention period for voice recordings/transcripts should be a configurable Administration API setting (§3.2.9), defaulting to whatever the clinic's existing data-retention policy specifies for patient records generally — extend existing retention policy, do not invent a separate one for AI-channel data specifically.

## 8.16 Compliance Considerations

- PCPNDT: confirmed sensitive category in Knowledge Base design (§5.1) — content must be staff-authored/legally-reviewed, never AI-generated, and the AI must not attempt to answer PCPNDT-adjacent questions from general knowledge if no KB entry exists (ties to §5.2's "no KB hit → escalate, don't improvise" rule).
- General healthcare data handling: every point above (encryption, access control, audit, retention) should be reviewed against whatever formal compliance framework the clinic already operates under (the existing ERP audit documents referenced in the Phase 3 brief presumably establish this — Phase 4 implementation should confirm rather than this document assuming a specific framework it hasn't seen).

## 8.17 Recommended Improvements (Summary, Priority-Tagged)

| Item | Priority | Rationale |
|---|---|---|
| Confirm the two unresolved CRITICAL items from the prior full ERP security audit (Phase 1 §2.7: default JWT/session secrets, DB password) are closed | **Must-fix before any external channel goes live** | Every new channel (voice, WhatsApp, web chat) is a new attack surface pointing at the same backend — unresolved CRITICAL findings make the blast radius of the AI Receptionist project strictly larger, not contained. |
| Add FK constraints to `online_bookings.patient_id`/`.bill_id` and `tokens.order_id`/`.patient_id` | High | Phase 1 §2.7 flags this as an existing weakness; AI-driven write volume is expected to be materially higher than current manual entry, raising the cost of orphaned rows. (Note: per Phase 3 rules, this is a recommendation for a future migration — not something this document or its companions implement.) |
| Build the `ai_caller` permission-matrix tests (§8.2) before Phase 4 begins writing adapters | High | Prevents permission scope creep being discovered after code exists, when it's harder to walk back. |
| Define consent-notice content/flow with clinic compliance input | Medium | Needed before voice/health-adjacent conversation flows go live, but can be finalized in parallel with early WhatsApp-only phases. |

---

# Deliverable 9 — Analytics Dashboard

## 9.1 Metrics

| Metric | Source | Notes |
|---|---|---|
| Calls (volume, by channel) | Audit Logger | Segmented by channel from day one — avoids "AI usage" being a single opaque number. |
| Bookings (created via AI, by channel) | Booking API write log | Cross-referenced against `online_bookings` directly — this number must always reconcile with the source-of-truth table, never tracked independently. |
| Conversion Rate | (Bookings created) / (Booking-intent conversations started) | Booking-intent detection comes from Conversation Manager flow entry into 4.3, not a separate heuristic. |
| Dropped Calls | Telephony Provider driver | Provider-reported, normalized across vendors via the `TelephonyProvider` interface (§7.3). |
| Transferred Calls | Human Handoff trigger log (§6.2 payloads) | Segmented by `escalationReason` (§6.3 table) — turns this into a diagnostic tool, not just a count. |
| Average Call Duration | Telephony Provider driver | Voice channel only; equivalent "average conversation duration" tracked separately for chat channels. |
| Queue Reduction | Compare AI-issued tokens (`source` ≠ `'walkin'`) against historical walk-in-only baseline | Requires a defined "before" baseline period — a Phase 4 implementation detail, not assumed here. |
| Revenue Generated | Sum of completed payments on AI-originated bookings | Joined against existing payment/billing tables — never computed independently of the ledger. |
| AI Resolution Rate | (Conversations completed without Human Handoff) / (Total conversations) | Directly informed by `escalationReason` being null vs. populated. |
| Patient Satisfaction | **New** — requires a post-conversation prompt ("Was this helpful? 1-5") not currently part of any flow in Deliverable 4; should be added as an optional closing step on completed flows, not forced on every interaction. |
| Peak Hours | Conversation start timestamps, by channel | Standard time-bucketed aggregation. |
| Top FAQs | Knowledge Base search query log (§3.2.7's `search` endpoint, logged) | Direct signal for what to expand/clarify in the KB — this is the feedback loop that keeps Deliverable 5 content current. |
| Missed Opportunities | Conversations that entered a booking-intent flow (4.3/4.6/4.7) but ended in abandonment, AND conversations that hit `OFFLINE_MODE` (4.17) or unresolved ambiguous-match (4.2) | Two distinct sub-metrics — "patient changed their mind" vs. "system failed them" must never be conflated into one number, since they require completely different fixes. |

## 9.2 Design Note on Analytics Integrity

Every metric above is explicitly defined in terms of **existing tables as source of truth** (bookings, payments, tokens) joined with **new AI-specific logs** (conversation/escalation/search logs) — never a parallel set of AI-maintained counters that could drift from reality. This directly satisfies the "ERP remains single source of truth" principle for the analytics layer specifically, which is otherwise an easy place for a project like this to accidentally create a second, slightly-wrong version of the truth.

---

# Deliverable 10 — Implementation Phases

Each phase below assumes the previous phase's success criteria are met. "Estimated complexity" is relative (Low/Medium/High/Very High) for a single-clinic deployment, not an absolute time estimate — actual scheduling is a separate planning exercise outside this document's scope.

## Phase 1 — Foundation

- **Objectives:** Stand up the `ai_caller` credential/permission-matrix entry (§8.2); stand up the Audit Logger as a generalized service (extending the existing `ai_handled`-flag pattern, §6.1); confirm session-store reuse of `portal_sessions` pattern (§1.2) is structurally sound for non-portal channels.
- **Dependencies:** None beyond existing ERP (this phase touches no patient-facing surface).
- **Estimated complexity:** Medium.
- **Risk:** Low — no patient-facing change, fully reversible.
- **Rollback strategy:** Disable the new permission-matrix role; no data migration to undo since this phase is additive-only.
- **Testing strategy:** Permission-matrix automated tests (§8.17, "Must-fix" list item) confirming `ai_caller` cannot access any out-of-scope endpoint.
- **Success criteria:** `ai_caller` credential exists, is provably scoped correctly, and zero existing staff/patient flows are touched.

## Phase 2 — Internal APIs

- **Objectives:** Build the ERP API Gateway layer (Deliverable 3) — Patient, Booking, Appointment, Queue, Report, Payment, Notification categories — as thin wrappers calling existing internal logic.
- **Dependencies:** Phase 1 (credential/permission system must exist first).
- **Estimated complexity:** High — largest single phase, but each endpoint is individually low-risk since it wraps tested existing logic rather than writing new business rules.
- **Risk:** Medium — primary risk is accidentally reimplementing logic instead of wrapping it (the failure mode this entire blueprint is designed to prevent); mitigated by requiring each adapter's code review to cite which existing internal function/route it calls.
- **Rollback strategy:** Each API category can be feature-flagged independently; a faulty Booking API wrapper can be disabled without affecting Patient/Report APIs.
- **Testing strategy:** Contract tests per endpoint against §3.2's documented request/response shapes; idempotency-specific tests for every write endpoint (mandatory per §3.3 rule 1).
- **Success criteria:** All APIs in §3.2 callable, idempotent where required, and produce identical downstream results to the equivalent existing staff/public action (e.g. AI-gateway booking creation produces a row indistinguishable from a website-form booking, modulo the `source`/`channel` field).

## Phase 3 — Knowledge Base

- **Objectives:** Build the Knowledge Base service (Deliverable 5) — content store, retrieval layer, admin editing UI extension.
- **Dependencies:** Phase 1 (permission system for admin editing access).
- **Estimated complexity:** Medium.
- **Risk:** Low-Medium — main risk is content quality/completeness at launch (empty KB = AI improvising, which §5.2/§8.16 explicitly forbid), mitigated by requiring a minimum content checklist (hospital info, all active tests/packages, top 20 FAQs, all prep instructions for offered modalities) before Phase 4 can go live with any patient-facing channel.
- **Rollback strategy:** KB service can be disabled; Conversation Manager (once built) falls back to Human Handoff for everything if KB is unavailable, never to AI improvisation.
- **Testing strategy:** Content-completeness checklist (above) + retrieval accuracy spot-checks against a sample query set written by clinic staff.
- **Success criteria:** Staff can create/edit/version KB entries through the admin UI; retrieval returns correct entries for the sample query set.

## Phase 4 — WhatsApp AI

- **Objectives:** Extend the existing `waChatbot.ts` skeleton (Phase 1 §2.4) into the full Conversation Manager + WhatsApp Gateway, wired to Phase 2's APIs and Phase 3's Knowledge Base. **This phase must begin with the deep read of `waChatbot.ts`/`whatsapp.ts` that Phase 1's "Next Step" section calls for** — confirming exactly what's reusable before writing new conversation logic.
- **Dependencies:** Phases 1–3.
- **Estimated complexity:** High — first real channel, first real Conversation Manager implementation, first real Provider Manager LLM driver wiring.
- **Risk:** Medium — first patient-facing exposure of the system; mitigated by launching to a limited phone-number allowlist or low-traffic window first, with Human Handoff readily available throughout.
- **Rollback strategy:** `whatsapp_settings.ai_assistant_enabled` (existing field, Phase 1 §2.4) is the literal kill switch — flipping it off reverts to pre-project WhatsApp behavior instantly, since the underlying send/receive mechanism is unchanged.
- **Testing strategy:** All conversation flows from Deliverable 4 exercised against the WhatsApp channel specifically; load-test webhook redelivery idempotency (§3.2.10).
- **Success criteria:** Flows 4.1–4.10 (the most common patient interactions) function correctly via WhatsApp; AI Resolution Rate (§9.1) and Conversion Rate tracked from day one.

## Phase 5 — Voice AI

- **Objectives:** Build Voice Gateway, wire `TelephonyProvider` interface (§7.3), extend Conversation Manager to handle voice-specific concerns (speech-to-text/text-to-speech, no-visual-confirmation flows, warm transfer where supported).
- **Dependencies:** Phases 1–4 (reuses Conversation Manager core built for WhatsApp).
- **Estimated complexity:** Very High — voice has materially different UX constraints (no buttons, no read-receipts, real-time latency requirements) than text channels.
- **Risk:** Medium-High — voice is the least forgiving channel for a confused AI (a patient can't easily "scroll up" to re-read what was said); mitigated by Offline Mode (4.17) and Emergency flow (4.12) being especially well-tested before launch, and by launching with Human Handoff readily staffed.
- **Rollback strategy:** Telephony provider routing can revert to direct-to-staff (no AI layer) at the provider/PBX configuration level, independent of application code.
- **Testing strategy:** All flows re-tested for voice-specific phrasing (Knowledge Base content may need voice-friendly variants — short, no markdown/links read aloud literally); Missed Call Callback (4.16) specifically tested for timing/double-trigger issues.
- **Success criteria:** Flows 4.1–4.13 function via voice; Dropped Call and Average Call Duration metrics (Deliverable 9) within an acceptable range defined by clinic staff expectations, not an arbitrary target.

## Phase 6 — Website AI

- **Objectives:** Build Web Chat Gateway (text-based, so substantially lower-risk than Phase 5, reusing most of the WhatsApp-proven Conversation Manager).
- **Dependencies:** Phases 1–4.
- **Estimated complexity:** Medium.
- **Risk:** Low — closest channel to WhatsApp in shape; can run in parallel with or even before Phase 5 if voice vendor selection takes longer.
- **Rollback strategy:** Widget can be removed from the website without affecting any other channel.
- **Testing strategy:** Same flow suite as WhatsApp, adapted for chat-widget UX (e.g. quick-reply buttons where the channel supports them).
- **Success criteria:** Equivalent resolution/conversion metrics to WhatsApp within a reasonable margin.

## Phase 7 — Queue Integration

- **Objectives:** Formalize Queue Adapter usage across all live channels — ensure `source` field values are consistently populated (Deliverable 1 §1.4), wait-time estimation logic (if not already present) added to the Queue API.
- **Dependencies:** Phases 2, 4–6 (at least one channel live to generate real queue-adapter traffic).
- **Estimated complexity:** Low — mostly formalizing what earlier phases already exercise.
- **Risk:** Low.
- **Rollback strategy:** N/A — additive metric/field population only.
- **Testing strategy:** Confirm physical queue-display systems (if any exist) correctly render AI-originated tokens identically to walk-in tokens, aside from the `source` label.
- **Success criteria:** Queue Reduction metric (Deliverable 9) becomes measurable.

## Phase 8 — Payments

- **Objectives:** Harden Payment API (§3.2.6) based on real Phase 4–6 traffic; confirm idempotency holds under real-world retry patterns; finalize normalized error-category mapping.
- **Dependencies:** Phases 2, 4–6.
- **Estimated complexity:** Medium — payments are high-stakes even though the underlying gateway integration is existing/tested.
- **Risk:** Medium — duplicate-charge risk is the single highest-severity failure mode in this entire blueprint; this phase exists specifically to harden against it with real traffic data rather than assuming Phase 2's design-time idempotency tests caught everything.
- **Rollback strategy:** AI-originated payment initiation can be disabled per-channel while informational/booking flows continue (patient is told to pay at the counter/portal instead).
- **Testing strategy:** Chaos-style testing — simulated network failures/retries during payment initiation, confirming no duplicate charges.
- **Success criteria:** Zero duplicate-charge incidents across a defined observation window before this phase is considered complete.

## Phase 9 — Report Delivery

- **Objectives:** Harden Report API (§3.2.5) usage; confirm `radiology_share_links` minting rate and access patterns look correct under real AI-originated traffic; verify privacy gate (§8.3 identify-before-reveal) holds in practice.
- **Dependencies:** Phases 2, 4–6.
- **Estimated complexity:** Low-Medium.
- **Risk:** Medium — this is the second-highest PII-exposure-risk flow after Payments, given report content sensitivity.
- **Rollback strategy:** Report-status/share-link AI endpoints can be disabled per-channel; patients redirected to existing patient portal for report access.
- **Testing strategy:** Specifically test the "phone number alone is not enough" identity gate (§8.3) with adversarial test cases.
- **Success criteria:** No report delivered to an unverified identity across a defined observation window.

## Phase 10 — Follow-up Automation

- **Objectives:** Appointment reminders, missed-call callback (4.16) hardening, post-conversation satisfaction prompts (§9.1's new Patient Satisfaction metric) — the proactive/outbound side of the system, as opposed to Phases 4-6's reactive/inbound side.
- **Dependencies:** Phases 1–9 (needs a stable inbound system before adding outbound volume).
- **Estimated complexity:** Medium.
- **Risk:** Low-Medium — primary risk is notification fatigue/opt-out handling, which needs explicit design (a patient must be able to stop receiving automated outbound messages) not assumed.
- **Rollback strategy:** Outbound automation is independently toggleable from inbound conversation handling.
- **Testing strategy:** Confirm opt-out is respected; confirm reminder timing doesn't conflict with Business Hours/After Hours logic (4.18).
- **Success criteria:** Reminder send rate and opt-out rate both within ranges clinic staff consider acceptable.

## Phase 11 — Internal Staff Assistant

- **Objectives:** A staff-facing variant of the Conversation Manager — internal queries like "what's today's queue look like" or "find patient X's last visit" — reusing the same Provider Manager and Knowledge Base infrastructure, but authenticated via existing staff login (not the `ai_caller` credential, since this is a human-operated tool, not an automated channel).
- **Dependencies:** Phases 1–3 minimum; benefits from Phases 4–9 having proven the core infrastructure with patients first.
- **Estimated complexity:** Medium.
- **Risk:** Low — internal-only, no new external attack surface; primary risk is scope creep into staff-permission territory (mitigated by reusing the exact existing `requireStaffPermission` model — a staff member using this assistant can only see/do what their existing role already permits, full stop).
- **Rollback strategy:** Standard internal-tool deprecation; no patient-facing impact.
- **Testing strategy:** Confirm the assistant cannot be used to bypass any existing staff permission boundary (e.g. a Reception-role staff member cannot use natural language to extract Accountant-only financial data through the assistant).
- **Success criteria:** Staff adoption/time-saved is positive per informal staff feedback; zero permission-boundary violations found in testing.

---

# Deliverable 11 — Future Roadmap

## 1 Year

- **Multilingual Voice** — extends the Language Selection flow (4.15) and Knowledge Base multi-language content (noted as a dependency in §4.15) from text channels to voice.
- **Prescription Refill** queries via WhatsApp/Voice, *if* the ERP already has a prescription/medication record to query against — otherwise this is gated behind that data existing first, not invented as a parallel record.
- **Patient Mobile App** — the "Future Mobile App" channel sketched in Deliverable 1; becomes realistic once Web Chat (Phase 6) and the Conversation API (§3.2.10) are proven, since a mobile app is mostly a new thin client of the same API.

## 3 Years

- **Doctor AI Assistant** — a doctor-facing variant of Phase 11's Internal Staff Assistant, scoped to clinical-workflow queries (distinct permission profile from general staff).
- **Radiology AI Assistant / Pathology AI Assistant** — per `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`, the schema already shows extensive radiology-AI-specific tables (`aiDicomFindings`, `aiPromptLibrary` structured around radiology modalities, etc.) — this roadmap item is largely about **connecting the AI Receptionist's Conversation Manager pattern to that already-substantial existing radiology-AI infrastructure**, not building radiology AI from scratch.
- **Bed Availability / Hospital Navigation** — only relevant if/when the clinic's scope expands beyond diagnostics into inpatient services; explicitly not assumed as in-scope for the current single-diagnostic-clinic deployment.
- **Predictive Scheduling** — using Analytics data (Deliverable 9, Peak Hours metric) accumulated over the prior phases to suggest optimal slot offerings proactively.

## 5 Years

- **Teleconsultation** integration — AI Receptionist becomes the booking front-end for a teleconsultation product, if/when the clinic offers one.
- **Wearable Integration / Remote Monitoring** — speculative; depends entirely on clinic service-line expansion, not an extension of current architecture.
- **AI Call Quality Review** — using accumulated Analytics + transcript data to automatically flag conversations for staff review (quality assurance), building on the Patient Satisfaction metric and escalation-reason logging established in Deliverable 9.

**Note on this roadmap's epistemic status:** items in the 1-year horizon are extrapolations of *this* blueprint's own modules and are reasonably confident. Items in the 3–5 year horizon depend on business decisions (does the clinic expand into inpatient care? teleconsultation?) entirely outside this document's knowledge, and are included because the brief requested them — they should be read as illustrative options, not commitments.

---

# Deliverable 12 — Final Executive Summary

## What Already Exists

Per Phase 1 and Phase 2 audits: a complete online booking pipeline with payment integration, a multi-channel-aware queue/token system (the `source` field requires zero schema migration to extend), a patient portal session mechanism reusable as the AI's identity layer, a partially-built WhatsApp AI assistant (`waChatbot.ts`, `ai_assistant_enabled` settings already in the database), an existing staff authentication/permission matrix, secure time-limited report-sharing links, and over 100 database tables — more than 10 of them already AI-specific (prompt libraries, RAG document storage, AI communication logs, AI quality scoring). **This system was not designed AI-naively; it was designed by people who anticipated multi-channel and AI-assisted operation**, even if not every anticipated piece was finished.

## What Must Be Built

A new, thin **ERP API Gateway** layer (Deliverable 3) that gives the AI Receptionist a properly-scoped caller identity distinct from both staff and anonymous-public callers. A **Conversation Manager** with explicit per-flow state machines (Deliverable 4) rather than an unconstrained chatbot. A genuinely centralized, staff-editable **Knowledge Base** (Deliverable 5) so clinical/policy content is never hard-coded into prompts. A **Human Handoff** system (Deliverable 6) that preserves context instead of making patients repeat themselves. A **Provider Manager** (Deliverable 7) so the clinic is never locked into one AI/telephony vendor. And a security review (Deliverable 8) that treats every new channel as a new attack surface on the *same* backend, not a separate system to be secured independently.

## What Should Never Be Changed

The `online_bookings`, `appointments`, `tokens`/`test_tokens`, `patients`, and billing/payment tables and their existing write paths. The existing staff authentication and permission model. The existing WhatsApp send/template mechanism. Every one of these is production-tested infrastructure; the AI Receptionist's entire value proposition is *using* them through a new interface, not replacing them.

## Biggest Risks

1. **Scope creep into reimplementation** — the single most repeated caution throughout this document (every "thin adapter," every "do not invent," every "extend, don't duplicate") exists because the most likely failure mode for a project like this is quietly rebuilding `online_bookings` as `ai_bookings` under schedule pressure, fragmenting the source of truth this blueprint is built to protect.
2. **Two unresolved CRITICAL security findings from the prior full ERP audit** (default JWT/session secrets, DB password — Phase 1 §2.7) — every new channel this project adds is a new entry point into the same backend; these must be closed before Phase 4 exposes any external channel, not after.
3. **Payment idempotency under real-world retry conditions** (Deliverable 10, Phase 8) — design-time idempotency keys are necessary but not sufficient; this needs to be proven under real traffic before being trusted at scale.
4. **Identity-verification gate weakening under product pressure** (§8.3) — the temptation to skip the "confirm DOB" disambiguation step for a smoother conversational UX is a realistic risk that directly threatens patient privacy if not actively guarded against in code review.

## Biggest Opportunities

1. **The WhatsApp channel is closer to done than to "new"** — Phase 1's discovery that `waChatbot.ts` and `ai_assistant_enabled` already exist means the first real patient-facing AI Receptionist capability could plausibly ship faster than a green-field estimate would suggest, simply by finishing what's there.
2. **Queue-channel attribution requires zero migration** — the existing `source` field's design already anticipated this project; Phase 7 is almost pure configuration/wiring work on an already-correct schema.
3. **The existing radiology-AI schema investment** (Deliverable 11's 3-year note) means the clinic's eventual "AI-assisted everything" vision has a real architectural head start most diagnostic clinics would not have.

## Recommended Implementation Order

Exactly as laid out in Deliverable 10: Foundation → Internal APIs → Knowledge Base → WhatsApp AI → Voice AI → Website AI → Queue Integration → Payments (hardening) → Report Delivery (hardening) → Follow-up Automation → Internal Staff Assistant. WhatsApp is correctly prioritized first among patient-facing channels specifically *because* it is the most-already-built, lowest-incremental-risk channel — not because it's inherently the "easiest" channel in the abstract.

## Expected Benefits

Reduced front-desk phone/WhatsApp load for routine queries (price, prep instructions, report status — the bulk of true receptionist volume in most diagnostic clinics). Faster booking conversion for patients who'd otherwise abandon a multi-step phone call. Consistent, audited, never-improvised delivery of policy and clinical-prep information (Deliverable 5's design goal). A queue/analytics data trail (Deliverable 9) that gives clinic management visibility into channel performance that almost certainly doesn't exist today in this granularity.

## Expected ROI

Not quantifiable from this document alone — it depends on current call/WhatsApp volume, current staff cost allocated to routine queries, and conversion-rate assumptions the clinic would need to supply. This blueprint deliberately does not invent a number it has no basis for; Phase 4's Analytics implementation is precisely what would make a real ROI calculation possible after a few months of live data, rather than before.

## Estimated Development Effort

Also not quantified here in person-days/weeks, per the same reasoning — Deliverable 10's per-phase complexity ratings (Low/Medium/High/Very High) are directionally useful for relative planning but converting them to a calendar estimate requires knowing the actual engineering team's size and familiarity with this specific codebase, which is outside this document's knowledge.

## Overall AI Readiness Score

**Consistent with `02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md`'s component-level scoring (which is the more granular and more recently-verified source): approximately 70% at the infrastructure/data layer.** This executive summary's qualitative assessment (extensive reusable booking/queue/portal/WhatsApp infrastructure already in place; the primary remaining work is integration, gateway/permission-layer construction, and conversation-flow design rather than ground-up backend development) supports that figure rather than contradicting it. The gap between 70% and a complete system is concentrated almost entirely in the **new, currently-nonexistent layers** this document designs — the ERP API Gateway, Conversation Manager, Knowledge Base service, and Human Handoff system — none of which require touching or duplicating the substantial existing booking/queue/payment/portal infrastructure that the 70% figure already credits.

---

**Status:** Design phase complete. No code, migrations, routes, or refactors were created in the production codebase as part of this document. All file/table/route references above are read-only citations to confirm grounding in Phase 1 and Phase 2 findings.

**Next step (requires go-ahead, per the same one-step-at-a-time approach as Phase 1):** Phase 4 implementation should begin with the deep read of `waChatbot.ts`/`whatsapp.ts` that this document's Phase 4 entry (Deliverable 10) and the original Phase 1 audit both independently identify as the correct starting point — confirming exactly what the existing WhatsApp AI skeleton does before extending it.
