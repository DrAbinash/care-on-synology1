# WhatsApp AI System — Real Audit (Correcting 01_/02_)

**Status:** Read-then-fix audit, performed after discovering during Milestone 1 implementation that the existing WhatsApp infrastructure is materially more built than 01_CURRENT_ARCHITECTURE_AUDIT.md and 02_EXISTING_AI_INFRASTRUCTURE_AUDIT.md characterized it. One real vulnerability found during this audit was fixed in the same pass — the software is confirmed not live, so the usual audit-fully-before-any-fix caution was relaxed for this one item, see section 3.

---

## 1. What the Prior Documents Claimed

01_ described WhatsApp as having an AI assistant skeleton — ai_assistant_enabled/ai_system_prompt fields present, waChatbot.ts route file existing, but scope and maturity unaudited beyond that. 02_ rated WhatsApp at 75% readiness, with the specific gap named as AI hooks defined in schema, not yet wired to conversation logic. Both documents recommended a full read of waChatbot.ts/whatsapp.ts before any further design — which never happened, because the planning phases proceeded directly to architecture, blueprint, and roadmap work built on the unverified summary instead.

## 2. What's Actually There — File Inventory

Beyond the two files 01_ named, a full services/whatsapp/ directory exists, 2,602 lines total, not counted in any prior document.

| File | Lines | What it is |
|---|---|---|
| WhatsAppProvider.ts | 114 | Vendor-agnostic interface — sendTextMessage, sendInteractiveButtons, sendTemplateMessage, verifyWebhook, parseIncomingMessages. This is, in substance, the Provider Manager abstraction the implementation blueprint called for, already built. |
| WhatsAppProviderFactory.ts | 52 | Env-driven vendor registry: mock, meta, twilio, gupshup, wati, interakt. Six real provider implementations, not a stub. |
| MetaWhatsAppCloudProvider.ts | 179 | Meta WhatsApp Cloud API implementation. |
| TwilioWhatsAppProvider.ts, GupshupProvider.ts, WATIProvider.ts, InteraktProvider.ts | 106-127 each | Four more real, working provider implementations. |
| MockWhatsAppProvider.ts | 108 | Safe local-testing provider, defaulted to when WHATSAPP_PROVIDER is unset. |
| WhatsAppService.ts | 245 | Orchestration layer: contact identity resolution (phone to patient/doctor/staff lookup), conversation and session management with 30-minute expiry, message logging, audit logging, bill/report/appointment lookups. This is, in substance, the Patient API plus Booking/Report API design for this channel. |
| WhatsAppBotEngine.ts | 370, 417 after this audit's fix | Menu/button-driven conversation flows: main menu, appointment booking, report status, bill/dues check, location, human handover. Session-state-machine based, not LLM-driven. |
| routes/waChatbot.ts | 287 | Routes wiring the bot engine to inbound webhooks. |
| routes/whatsapp.ts | 778 | Settings CRUD, conversation inbox, and a separate free-text Gemini AI path, see section 2.1, layered alongside the menu bot. |

## 2.1 The Gemini AI Path — A Separate Webhook System, Not a Fallback Inside the Menu Bot

This was an open question in the first draft of this audit; resolved by reading routes/index.ts directly.

These are two entirely independent webhook endpoints, mounted at two different URLs, not one dispatching to the other:

- `POST /api/whatsapp/webhook` → whatsappWebhookRouter (routes/whatsapp.ts) → calls geminiGenerate directly with a constructed system prompt including clinic name, hours, address, the configured aiSystemPrompt, and an explicit don't-invent-prices-or-diagnose instruction.
- `POST /api/wa-chatbot/webhook` → waChatbotWebhookRouter (routes/waChatbot.ts) → calls WhatsAppBotEngine.processMessage, the menu/button-driven flow this audit's section 3 fix applies to.

There is no code path connecting the two — a message arriving at one webhook never reaches the other's logic. In a real deployment, only one of these two webhook URLs would actually be registered with Meta/the chosen provider for a given WhatsApp Business number; which one is "live" is a deployment/configuration decision (which webhook URL is registered with the provider), not something visible from source code alone. Both are fully wired and functional independently.

**This materially changes the picture from the first draft of this audit.** There are not two integrated layers of one system — there are two separate, complete, independently-built WhatsApp AI implementations, built at different times, never unified. The Gemini path is genuinely closer to a free-text "AI receptionist" in spirit; the bot-engine path is a reliable, structured menu system with the (now-fixed) identity gate. Neither currently queries the new Knowledge Base.

## 3. Vulnerability Found and Fixed in This Pass

Finding: WhatsAppBotEngine's report-status and bill/dues flows allowed any WhatsApp user to type in any other person's registered phone number and immediately receive that patient's report status and outstanding bill amounts — no second factor was checked. This is exactly the risk the implementation blueprint named: phone number alone is not enough to authorize PII disclosure.

Fix applied, in WhatsAppBotEngine.ts, this same pass, since the software is confirmed not live and the usual extra caution around live-system audits doesn't apply: both flows now insert a date-of-birth confirmation step between locating a candidate patient by phone and revealing any data. A shared verification helper compares the typed DOB against the patient record. Wrong DOB produces an explicit privacy-preserving refusal, never a partial reveal.

What was deliberately left alone: the case where the contact's patientId is already linked — meaning the sending WhatsApp number is itself the patient's own registered number — skips the DOB gate and reveals data immediately. This is the legitimate case, a patient texting from their own registered number, and matches the intended identity-resolution design; only the search-by-a-different-typed-in-phone-number path needed the new gate.

Not fixed in this pass: the prompt text says "enter your registered mobile number or bill number," but only phone lookup is ever called — bill-number search isn't implemented. This is a pre-existing UX inconsistency, not a security issue, and out of scope for this pass; flagged for whoever next touches this flow.

## 4. Corrected Readiness Assessment

| Component | 02_'s figure | Corrected assessment |
|---|---|---|
| WhatsApp provider/vendor abstraction | Not separately assessed | Effectively complete — six working providers, clean interface, matches the originally-envisioned Provider Manager design |
| WhatsApp identity resolution (phone to patient/doctor/staff) | AI hooks defined, not wired | Already implemented, and as of this pass, with a real identity-verification gate on the two PII-revealing flows |
| WhatsApp conversational flows (booking, report status, bills) | Implied not built | Already implemented, menu/button-driven, not LLM natural-language |
| WhatsApp plus Knowledge Base integration | Not applicable, KB didn't exist | Not yet connected — today's new Knowledge Base has no caller wiring it into either the menu bot or the Gemini path yet |
| WhatsApp plus free-text LLM (Gemini) path | AI hooks defined, not wired | Partially wired — a real Gemini call exists with clinic context and a safety instruction; relationship to the menu bot not fully traced this pass |

Overall correction: WhatsApp readiness is closer to 85-90% for the menu-driven booking/status/bills functionality specifically, now including the identity gate this pass added, and genuinely lower, closer to the original 75% figure or possibly lower, for the natural-language AI receptionist experience the blueprint and operational design envisioned — the menu bot works but isn't AI-conversational, and the Gemini path's integration depth is still an open question.

## 5. What This Means for the Roadmap's Epic 2/3

The master roadmap's Epic 2, AI Receptionist Foundation and Internal APIs, rated High complexity and the single largest body of work in the original estimate, should be substantially re-scoped down, not built from scratch. The roadmap's ai_caller permission-matrix design is still worth doing — it's a real, missing piece, since no machine-credential concept exists anywhere in this codebase, confirmed in the prior session. But the API wrapper work the roadmap scoped under Patient API, Booking API, Report API is, for the WhatsApp channel specifically, already done via WhatsAppService — and used by both of the two separate webhook systems found in section 2.1.

Recommendation, revised after resolving section 2.1: connect the Knowledge Base to the Gemini path (routes/whatsapp.ts's webhook) specifically, since that is the one already doing free-text natural-language AI and is the closest existing thing to the conversational AI receptionist the implementation blueprint and operational design envisioned. Building a third, separate Conversation Manager — which is what naively following the roadmap's original Epic 3 design would produce — would create a third unintegrated WhatsApp AI system in a codebase that already has two. Extending the Gemini path is lower-risk, faster, and is the one already closest to done.

## 7. Critical Correction — A Real, Multi-Provider AI System Already Exists

This was discovered after the first version of this audit was written, and changes a major assumption made earlier in this session (that "no LLM vendor has been selected" was a blocking gap). It is not a gap.

`lib/ai-providers/src/index.ts` (542 lines) is a complete, already-built Provider Manager: four real providers (OpenAI, Gemini, Anthropic, Ollama — including a working OpenAI-compatible Ollama client with multimodal/image support and a `/api/tags` connection test), API keys encrypted via `@workspace/crypto` (a separate, real encryption library — not the plaintext gap found in WhatsApp tokens), and a task-keyed routing system (`ai_model_routes` table) with a sensible fallback chain: explicit override, then a configured task-specific route, then a global default provider, then a hardcoded `gemini` floor if nothing else is configured. Full admin CRUD for both provider settings and task routes already exists and is mounted at `/api/ai-model-routing` behind staff auth.

This session's WhatsApp-to-Knowledge-Base integration originally called Gemini directly, bypassing this entire system — exactly the kind of build-against-assumed-simplicity mistake this project keeps catching. **Fixed in the same pass**: `routes/whatsapp.ts`'s AI reply handler now calls `generateAiForTask("whatsapp_ai_receptionist", ...)` instead of `geminiGenerate` directly. WhatsApp AI replies are now routed through the same provider-selection system as every other AI feature in this ERP (radiology reporting, etc.), and can be pointed at Ollama, or any other configured provider, purely by an admin setting a task route — no further code change required.

**This means Ollama is not "added, maybe" — it is a fully-implemented, selectable provider today**, on equal footing with OpenAI/Gemini/Anthropic in this system's architecture. Whether it is *currently active* for any given task depends on deployment-time configuration (`ai_provider_settings`/`ai_model_routes` table contents), which this environment cannot inspect without a live database connection — that is the one piece that remains a genuine "ask the person running the deployment" question, not a code gap.

## 8. Still Open — Not Done in This Pass

- The menu-driven bot path (`WhatsAppBotEngine`, separate from the Gemini/provider-routed webhook covered above) still has no Knowledge Base connection and still calls no LLM at all — it is purely button/menu-driven by design, so this may be intentional rather than a gap, but it was not evaluated for whether it should also gain AI-grounded free-text fallback.
- WhatsApp access-token plaintext storage, the security re-audit's Finding 3 — not fixed in this pass, since it touches the same provider-credential files this audit just reviewed and deserves its own focused pass rather than being bundled in.
- The `ai_caller` permission-matrix scaffolding — not built yet; now correctly scoped as smaller than the roadmap originally estimated, given how much of the underlying API-wrapper and provider-routing work already exists.
- No `ai_model_routes` row exists yet for `whatsapp_ai_receptionist` specifically — not added in this pass, deliberately, since choosing which provider WhatsApp AI should default to (Ollama vs. a hosted vendor) is a real operational/cost/quality decision for whoever runs this deployment, not something this session should silently decide. The system already falls back gracefully (global default, then `gemini`) with no route configured.

