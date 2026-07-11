# AI Receptionist — Phase 1: Current Architecture Audit

**Project:** Care Diagnostics ERP / RIS / PACS
**Scope of this document:** Read-only audit. No code changed.
**Purpose:** Understand exactly what exists today, so the AI Receptionist reuses it instead of duplicating it.

---

## 1. What "AI Receptionist" Actually Means Here

A receptionist's job, stripped to its core, is four things:

1. Answer questions (timings, prices, prep instructions, report status)
2. Create or modify a booking/appointment
3. Collect or confirm patient identity details
4. Hand off to a human when something is outside its authority

None of these are new capabilities for the ERP. The ERP already has a registration desk, a booking engine, a token/queue system, and patient records. The AI Receptionist is a **new front door**, not a new building. Every channel (voice, WhatsApp, web chat, QR, app) should ultimately call the *same* booking/registration logic the front desk staff already use — it should never write to the database independently.

---

## 2. Existing Building Blocks Relevant to the AI Receptionist

### 2.1 Patient Identity
- `patients` table is the single source of truth for patient identity (`patient_id`, name, phone, dob, gender).
- `patient_counter` generates sequential patient IDs atomically — this must remain the only place patient IDs are minted.
- `portal_sessions` already provides a patient-facing self-service session mechanism (used today for the patient portal). This is a strong candidate for reuse as the identity/session layer behind WhatsApp and web chat, rather than building a parallel "AI session" table.

### 2.2 Bookings & Appointments (already public-facing)
- `appointments` table: `appointment_id`, `patient_id`, `doctor_id`, `package_id`, date, time slot, status, **`type` field already distinguishes `walk-in` from other origins**.
- `online_bookings` table: a complete public booking pipeline already exists — `booking_ref`, name, phone, email, selected date, `test_ids`/`package_ids`, amount, payment fields (Razorpay), status (`pending_payment` → confirmed), and links to `patient_id`/`bill_id` once confirmed.
- This is the **most important reusable asset** for the AI Receptionist. A voice call or WhatsApp message that results in "book me a test" should create a row here — exactly the same record a person filling the website form would create. No new booking table should be created.

### 2.3 Queue / Token System (already source-aware)
- `tokens` and `test_tokens` tables already have a `source` column (`'walkin'` by default). This field is the designed extension point: today it knows about walk-ins; tomorrow it can carry `'voice'`, `'whatsapp'`, `'webchat'`, `'qr'`, `'app'` with **zero schema change** — only a new allowed value.
- This tells us the original architects anticipated multi-channel entry. The AI Receptionist should write into this existing `source` field, not invent a parallel queue.

### 2.4 WhatsApp — Partially Already Built
This is the most critical finding and changes the shape of the roadmap:

- `whatsapp_settings` table **already contains**: `ai_assistant_enabled` (boolean), `ai_assistant_name` (default `'DiagnoCenter Assistant'`), `ai_system_prompt` (text), plus standard WhatsApp Business API config (`phone_number_id`, `access_token`, `waba_id`, `webhook_verify_token`).
- `whatsapp_conversations` table **already logs** inbound/outbound messages with `phone`, `direction`, `message_body`, `wa_message_id`, **`ai_handled` (boolean)**, and `status`.
- Route file `waChatbot.ts` already implements a WhatsApp chatbot.
- **Conclusion: an AI WhatsApp assistant skeleton already exists in this codebase.** Before any new WhatsApp work is designed, Phase 2 must include a full read of `waChatbot.ts`, `whatsapp.ts`, and `email-settings.ts` to determine: (a) what it currently does, (b) why `ai_assistant_enabled` might be off, (c) whether it already calls an LLM, and (d) what's missing versus the full receptionist scope (booking creation, report status, human handoff). This may shrink the WhatsApp phase to "finish/extend" rather than "build."

### 2.5 Report Delivery & Status Lookup
- Barcode/QR resolution already exists (`barcode-resolver.ts`, `VerifyReceipt.tsx`) — relevant for "QR Entry" channel.
- WhatsApp report delivery already exists (`report_message_template`, `include_viewer_link`, `auto_send_on_verify` in `whatsapp_settings`). A "where is my report" voice/chat query can reuse this exact delivery mechanism rather than building new report-sending logic.
- `radiology_share_links` (token-gated, expiring) is the existing secure pattern for sharing a report/study link — the AI Receptionist should generate links through this mechanism, never by exposing direct file paths.

### 2.6 Authentication & Authorization Model
- Staff-facing routes are protected by `requireStaffAuth` + `requireStaffPermission` (per-module permission gates) + `requireSuperAdminUsb` for the most sensitive actions.
- Public-facing routes (online booking, report verification) are **intentionally unauthenticated but scoped** — they only allow specific, narrow actions (create a booking, verify a receipt) and never expose the staff API surface.
- **Design implication:** the AI Receptionist must be modeled as a new class of caller — not staff, not anonymous-public — with its own constrained permission scope (see Phase 4, "Identifying Missing APIs / Security").

### 2.7 Known Existing Weaknesses (from prior audits) Relevant to This Project
- `online_bookings.patient_id` and `.bill_id` have no FK constraints — data integrity risk if the AI Receptionist starts writing here at higher volume.
- `tokens.order_id` / `tokens.patient_id` have no FK constraints — same risk for queue entries.
- Default JWT/session secrets and DB password were flagged as critical in the last full ERP audit — these **must** be confirmed fixed before any externally-reachable AI Receptionist channel (voice, WhatsApp, web chat) goes live, since each new channel is a new attack surface pointing at the same backend.

---

## 3. What This Means for the Roadmap (preview — full roadmap in a separate document)

| Finding | Implication |
|---|---|
| Online booking pipeline already complete | AI Receptionist should call it via API, not reinvent it |
| Token `source` field already multi-channel-aware | Just add new enum values, no schema migration needed |
| WhatsApp AI assistant skeleton already exists | Phase 2 must audit `waChatbot.ts` in depth before any new WhatsApp design |
| Patient portal sessions already exist | Reuse as the identity layer for chat/voice instead of a new session table |
| Public routes are deliberately narrow-scoped | AI Receptionist needs its own narrow, audited permission scope — not staff auth, not raw public auth |
| Some core tables lack FKs | Higher AI-driven write volume increases the cost of these gaps — worth fixing before scale-up, not after |
| Security audit had 2 unresolved CRITICAL items | Must be verified closed before exposing new external channels |

---

## 4. What I Have NOT Done

- No code has been modified.
- No new tables, routes, or files have been created in the application source.
- This document and its companions live only under `/workspace/AI_Receptionist/` as planning material.

---

## Next Step (requires your go-ahead)

The next document will be a **deep read of `waChatbot.ts`, `whatsapp.ts`, `public-booking.ts`, and `barcode-resolver.ts`** — the four files that already do most of what an "AI Receptionist" needs — so we know precisely what's reusable versus what's missing, before designing anything new.

Tell me to proceed and I will do that next, one step at a time.
