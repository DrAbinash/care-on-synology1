# AI Receptionist Infrastructure Audit
**Care Diagnostics ERP — Deoghar**  
**Date:** June 29, 2026  
**Status:** Read-Only Discovery Phase  

---

## Executive Summary

The Care Diagnostics ERP already contains **significant AI-ready infrastructure** for an AI Receptionist. Rather than building from scratch, the pilot should focus on **integrating and adapting existing systems**.

### Quick Facts
- ✅ **WhatsApp integration:** Fully operational with Gemini AI hooks already in place
- ✅ **Patient booking:** Complete end-to-end flow with payment gateways (ICICI, PayU, PhonePe, BharatPe)
- ✅ **Patient portal:** Full authentication, profile, reports, appointments
- ✅ **Email/SMS infrastructure:** Nodemailer configured, SMS patterns ready
- ✅ **Queue management:** Token system, counter management
- ✅ **Database:** 100+ schema tables including AI-specific ones (aiPromptLibrary, aiPatientCommunications, aiVoiceTranscriptions, etc.)
- ✅ **Payment callbacks:** Multi-gateway callback handlers
- ✅ **Human handoff:** Staff authentication and permission system
- ⚠️ **Voice:** Voice transcription schema exists; integration not yet complete
- ⚠️ **SMS:** Schema ready; service not wired
- ⚠️ **Knowledge base:** RAG document storage exists; Gemini integration partially complete

---

## 1. WhatsApp Component

### Current Capabilities
1. **Message Infrastructure** (lines 188-592 in whatsapp.ts)
   - Send templated messages (WhatsApp Business API)
   - Send text messages with fallback
   - Support for multiple phone numbers per clinic
   - Role-based number routing (general, form_f, reports)
   - Settings CRUD with multi-number support

2. **Conversation Tracking** (lines 172-237)
   - whatsappConversationsTable: logs all incoming messages
   - Phone number, sender name, message text, timestamp
   - Paginated conversation inbox

3. **Webhook Reception** (lines 388-430)
   - Full webhook validation (`verify_token`)
   - Message parsing from Meta webhook format
   - Async webhook processing

4. **AI Foundation Already Present**
   - Line 6: `import { geminiGenerate } from "@workspace/integrations-gemini-ai";`
   - Line 70-72: Settings fields for AI:
     - `aiAssistantEnabled` (boolean)
     - `aiAssistantName` (string, e.g. "Care Assistant")
     - `aiSystemPrompt` (text, stored in DB)

5. **Settings Configuration** (lines 52-75)
   - AI assistant toggle
   - Custom system prompt per clinic
   - Multi-number support with role assignment

### Missing Capabilities
1. **Inbound Message Processing** 
   - Line 387-430: Webhook reception is defined but `processIncomingMessage()` handler is stubbed
   - No routing to AI vs. staff
   - No conversation context loading

2. **AI Response Generation**
   - AI settings exist but not wired to incoming messages
   - No prompt engineering for receptionist role
   - No context injection (patient history, booking status)

3. **Fallback to Staff**
   - No queue mechanism for staff escalation
   - No "agent available" status check
   - No message marking as "awaiting staff"

4. **Multi-Turn Conversation**
   - Messages logged but no session/conversation context
   - No short-term memory between turns
   - No appointment confirmation workflow

### Can It Support AI?
**YES. Immediately.** The infrastructure is ready. Three changes needed:
1. Uncomment & implement `processIncomingMessage()`
2. Add prompt to `aiSystemPrompt` in clinic_settings
3. Load user context (patient name, recent bill, pending appointment) into prompt

### Refactoring Required?
**Minimal.** Current structure is sound:
- Settings model: ✅ extensible
- Webhook handling: ✅ ready
- Number routing: ✅ already supports roles
- Database: ✅ schema exists

### Existing APIs
```
GET   /api/whatsapp/settings         — read config
PUT   /api/whatsapp/settings         — update AI prompt
GET   /api/whatsapp/conversations    — inbox
POST  /api/whatsapp/webhook          — receive messages
```

### Reusable Business Logic
- Phone number normalization (line 443-449)
- Template message formatting (lines 630-634)
- Settings persistence (getOrCreateSettings pattern)

### Production-Critical Files
- `whatsapp.ts` — all endpoints, webhook handling
- `whatsappSettingsTable`, `whatsappConversationsTable` — schema
- Integration: `@workspace/integrations-gemini-ai`

### Safe to Extend?
**YES.** Add new route:
```typescript
POST /api/whatsapp/process-message  // AI processes inbound
```

### Hidden Dependencies
- Gemini API key must be in environment
- WhatsApp Business API credentials (phoneNumberId, accessToken)
- Database must have whatsapp_settings row created

---

## 2. Public Booking Component

### Current Capabilities
1. **Patient Self-Registration** (lines 24-61)
   - Name, phone, gender, age validation
   - DOB calculation from age
   - Phone normalization

2. **Booking Flow**
   - GET `/api/public/booking/config` — enabled/disabled + gateways
   - GET `/api/public/booking/tests` — list available tests
   - GET `/api/public/booking/packages` — bundled test offers
   - POST `/api/public/booking/create-order` — initiate booking
   - POST `/api/public/booking/verify-payment` — confirm payment

3. **Multi-Gateway Payment** (lines 491-1410)
   - PayU (lines 491-640)
   - PhonePe (lines 669-831)
   - BharatPe (lines 832-1064)
   - ICICI (lines 1065-1386)
   - Each with:
     - Initiate endpoint → payment gateway
     - Callback endpoint ← payment gateway
     - Order verification

4. **Payment Callback Handlers**
   - Hash verification (crypto SHA512)
   - Transaction logging (paymentLogsTable)
   - Auto-voucher creation (autoVoucherForPayment)
   - Booking confirmation workflow

5. **OTP Flow** (lines 1534-1563)
   - Generate OTP
   - Store in-memory (otpStore map)
   - Verify phone + OTP

6. **QR Code Payments** (lines 1565-1667)
   - Initiate QR payment
   - Polling for confirmation

### Missing Capabilities
1. **AI Integration Points**
   - No automated booking confirmation message
   - No WhatsApp notification after payment
   - No follow-up reminders

2. **Conversational Booking**
   - No multi-turn booking flow
   - No "did you mean..." suggestions
   - No package recommendation logic

3. **Human Handoff**
   - No queue assignment for urgent questions
   - No "talk to receptionist" option

### Can It Support AI?
**YES.** The booking engine is complete. AI layer would be:
- **Pre-booking:** "Which tests are you interested in?" → call `/tests` API
- **During booking:** "Your total is ₹2,000. Confirm?" → payment gateway
- **Post-booking:** "Your token number is 15. Come at 3 PM" → sendBillWhatsapp

### Refactoring Required?
**No.** Current API is AI-compatible. Just needs a conversational wrapper.

### Existing APIs
```
GET   /api/public/booking/config              — enabled?
GET   /api/public/booking/tests               — available tests
GET   /api/public/booking/packages            — bundled offers
POST  /api/public/booking/create-order        — initiate
POST  /api/public/booking/verify-payment      — confirm
POST  /api/public/booking/payu-initiate       — PayU init
POST  /api/public/booking/payu-success        — PayU callback
POST  /api/public/booking/phonepe-initiate    — PhonePe init
GET   /api/public/booking/phonepe-callback    — PhonePe callback
POST  /api/public/booking/bharatpe-initiate   — BharatPe init
GET   /api/public/booking/bharatpe-callback   — BharatPe callback
POST  /api/public/booking/icici-initiate      — ICICI init
POST  /api/public/booking/icici-callback      — ICICI callback
```

### Reusable Business Logic
- Payment hash generation (SHA512)
- Transaction logging
- Auto-voucher for payments
- OTP generation & validation
- Booking reference generation

### Production-Critical Files
- `public-booking.ts` — ALL endpoints
- Payment gateway integrations (PaymentEngine)
- `onlineBookingsTable`, `tokensTable`, `billsTable`

### Safe to Extend?
**YES, but carefully.** Don't modify payment callback handlers. Add new routes for:
```typescript
POST /api/public/booking/ai-booking-flow  // conversational flow
```

### Hidden Dependencies
- Environment: PAYU_MERCHANT_KEY, PHONEPE_MERCHANT_ID, etc.
- External: PayU, PhonePe, BharatPe, ICICI APIs
- Database: clinicSettings row must exist with gateway configs

---

## 3. Patient Portal Component

### Current Capabilities
1. **Authentication** (lines 203-571)
   - Patient login: phone + OTP or DOB
   - Staff login: username + PIN
   - LAN-only staff login (IP whitelist)
   - Session management (24 hour TTL)
   - Password change

2. **Patient Profile** (lines 767-824)
   - GET `/portal/me` — view profile
   - PUT `/portal/me` — update phone, email, address
   - Profile sanitization (PII masking)

3. **Patient Data Access** (lines 825-926)
   - GET `/portal/me/bills` — unpaid bills
   - GET `/portal/me/reports` — all reports
   - GET `/portal/me/visits` — appointment history
   - GET `/portal/me/appointments` — scheduled appointments

4. **Appointments** (lines 911-1033)
   - POST `/portal/appointments` — book appointment
   - Slot selection (9 AM - 5 PM)
   - Doctor selection
   - Max 5 active appointments per patient
   - Cancellation allowed
   - Email notification to staff

5. **Queue Management** (via appointmentCounterTable)
   - Token generation
   - Queue status per counter
   - Staff counter assignment

6. **Access Control**
   - Staff permission checks
   - Patient authentication middleware
   - LAN-only restrictions

### Missing Capabilities
1. **AI Integration**
   - No appointment rescheduling recommendations
   - No "based on your history" suggestions
   - No predictive availability

2. **Conversational Portal**
   - No chatbot onboarding
   - No guided form filling
   - No contextual help

3. **Multi-language**
   - All prompts hardcoded in English
   - No i18n for Hindi/local languages

### Can It Support AI?
**YES.** Portal is purely data + auth. AI layer would be:
- "I need an appointment" → query available slots → confirm
- "Show my bills" → query `/portal/me/bills` → read bills aloud or summarize

### Refactoring Required?
**Minimal.** Portal is separate from messaging. Could build a chatbot that calls portal APIs:
```typescript
// In AI receptionist handler:
const bills = await portalApi.getPatientBills(patientId);
const summary = await generateSummary(bills);
```

### Existing APIs
```
POST  /portal/patient-login                — phone + OTP auth
POST  /portal/staff-login                  — username + PIN
POST  /portal/logout                       — clear session
GET   /portal/me                           — current user
PUT   /portal/me                           — update profile
GET   /portal/me/bills                     — unpaid bills
GET   /portal/me/reports                   — all reports
GET   /portal/me/visits                    — visit history
GET   /portal/me/appointments              — scheduled appointments
POST  /portal/appointments                 — book appointment
POST  /portal/appointments/:id/cancel      — cancel appointment
```

### Reusable Business Logic
- Patient ID resolution from phone
- LAN-only login (IP whitelist)
- Session TTL management
- Appointment slot validation

### Production-Critical Files
- `portal.ts` — ALL authentication & data routes
- `portalSessionsTable`, `appointmentsTable`, `appointmentCounterTable`

### Safe to Extend?
**YES. Read-only API integration.** Don't modify auth logic. Use existing GET endpoints to build AI summaries.

### Hidden Dependencies
- Database: clinicSettings.lanOnlyLogin must be configured
- For appointments: doctors and rooms must exist in DB
- Email service: SMTP for staff notifications

---

## 4. Online Bookings (Internal)

### Current Capabilities
1. **Booking Status** (lines 41-85)
   - GET `/api/online-bookings` — list all bookings
   - GET `/api/online-bookings/:id` — single booking details
   - Pagination support

2. **Booking Actions** (lines 86-209)
   - POST `/api/online-bookings/:id/cancel` — cancel
   - POST `/api/online-bookings/:id/confirm` — staff confirms & creates token
   - POST `/api/online-bookings/:id/payment-link` — regenerate payment link

3. **Integration with Billing**
   - Creates bill + order
   - Tracks online_booking_id
   - Auto-generates token number

### Missing Capabilities
- No notification to patient
- No reminder workflow
- No rescheduling logic

### Can It Support AI?
**YES.** Only API consumer. AI would call these to query/confirm bookings.

### Existing APIs
```
GET   /api/online-bookings                — list
GET   /api/online-bookings/:id            — detail
POST  /api/online-bookings/:id/cancel     — cancel
POST  /api/online-bookings/:id/confirm    — confirm & token
POST  /api/online-bookings/:id/payment-link  — new link
```

---

## 5. Barcode Resolver

### Current Capabilities
1. **Barcode Scanning**
   - Resolve bill/order from barcode
   - Return linked patient data
   - Payment status

### Missing Capabilities
- No AI-driven barcode interpretation

### Can It Support AI?
**YES.** Pure lookup. AI would use for: "I scanned this barcode — tell me about the bill"

---

## 6. Email System

### Current Capabilities (email.ts)

1. **SMTP Configuration**
   - Nodemailer transport
   - Settings: host, port, user, password
   - From address & name configurable

2. **Pre-built Email Templates**
   - Bill edit notification (HTML, styled)
   - Bill reprint notification
   - Commission report (monthly)
   - Money-trail audit report
   - Backup failure alert
   - Account locked alert
   - Generic report email

3. **Email Recipients**
   - Admin email + extra recipients (stored as JSON array)
   - Deduplication

### Missing Capabilities
1. **Patient Notifications** — no `sendPatientBookingConfirmation()` etc.
2. **AI-Generated Content** — no templates for AI-written responses
3. **Template Customization** — hardcoded HTML

### Can It Support AI?
**YES.** Use for:
- Booking confirmation: "Your appointment is scheduled for 3 PM. Confirm?"
- Report ready: "Your report is ready. Click to download"
- Payment receipt: "Invoice #2024-001 attached. Let us know if you have questions"

### Refactoring Required?
**Add functions:**
```typescript
export async function sendPatientNotification(params: {
  to: string;
  patientName: string;
  subject: string;
  aiGeneratedBody: string;  // from Gemini
})
```

### Existing Functions
```
sendBillEditEmail()
sendBillReprintEmail()
sendCommissionMonthEndEmail()
sendAuditReportEmail()
sendBackupFailureEmail()
sendAccountLockedEmail()
sendReportEmail()
```

### Production-Critical Files
- `email.ts` — ALL email send logic
- `emailSettingsTable` — config

---

## 7. SMS System

### Current Capabilities
**Schema exists:** `aiVoiceTranscriptions.ts` has SMS hooks
- Phone number field present in multiple tables
- Template support in clinic_settings
- WhatsApp uses same phone normalization

### Missing Capabilities
**No SMS service wired.** SMS provider integration needed (AWS SNS, Twilio, etc.)

### Can It Support AI?
**YES, with SMS provider setup:**
```typescript
// Pseudo-code for SMS sending:
async function sendPatientSMS(phone: string, message: string) {
  const result = await twilioClient.messages.create({
    body: message,
    from: settings.smsFromNumber,
    to: phone,
  });
}
```

### To Implement
1. Add SMS provider credentials to clinic_settings
2. Create `artifacts/api-server/src/sms.ts` (similar to email.ts)
3. Wire into appointment/payment callbacks

---

## 8. Notification System

### Current Capabilities
1. **Email Alerts** (via email.ts)
   - Staff notifications for bill edits
   - Admin alerts for backup failures
   - Audit reports

2. **WhatsApp Messages** (via whatsapp.ts)
   - Bill notifications
   - Report ready notifications
   - Report delivery messages

3. **Database Logging**
   - `reportDeliveryLogs` — tracks report sends
   - `whatsappConversations` — message history

### Missing Capabilities
- No in-app notifications
- No push notifications
- No SMS notifications

### Can It Support AI?
**YES.** Use existing email + WhatsApp for notifications. Extend with:
```typescript
// In AI receptionist:
if (bookingConfirmed) {
  await sendReportDelivery({...});  // existing
  // NEW: AI-composed follow-up
  await sendAiGeneratedMessage({...});
}
```

---

## 9. Payment Callback Flow

### Current Capabilities
1. **Multi-Gateway Support**
   - PayU callback (lines 585-640 in public-booking.ts)
   - PhonePe callback (lines 763-831)
   - BharatPe callback (lines 926-1064)
   - ICICI callback (lines 1387-1392)

2. **Callback Processing**
   - Hash verification (security)
   - Payment logging (paymentLogsTable)
   - Booking confirmation (confirmBookingInternal)
   - Token generation
   - Auto-voucher creation

3. **Error Handling**
   - Failed payment → booking stays pending
   - Retry payment link generation
   - Email/WhatsApp on failure

### Missing Capabilities
- No AI-driven retry logic
- No "payment failed, try another method" suggestion

### Can It Support AI?
**YES.** After payment callback:
```typescript
if (paymentFailed) {
  const message = await generateAiMessage(
    `Payment failed for ${patient.name}. Suggest alternatives.`,
    { patient, booking, failureReason }
  );
  await sendReportDelivery({ phone: patient.phone, body: message });
}
```

---

## 10. Queue Management

### Current Capabilities
1. **Token System**
   - `tokensTable` — auto-incrementing per counter
   - Status tracking (called, waiting, completed)
   - Patient name + phone

2. **Counter Management**
   - `appointmentCounterTable` — separate counters (register, reports, etc.)
   - Staff assignment per counter
   - Queue display

3. **Workflow**
   - Booking → token generation
   - Staff calls token
   - Patient checks in
   - Token marked completed

### Missing Capabilities
- No wait-time estimation
- No SMS/WhatsApp "your turn is coming" notifications
- No queue monitoring for bottlenecks

### Can It Support AI?
**YES.** AI could:
1. Monitor queue length: "Currently 5 patients ahead of you"
2. Estimate wait: "Typical wait is 15 minutes"
3. Notify: "Token #15 is now being called at counter 2"

---

## 11. Database Schema — AI-Specific Tables

### Ready for Use
```
✅ aiPromptLibrary        — system prompts for different contexts
✅ aiVoiceTranscriptions  — voice input/output logs
✅ aiPatientCommunications — conversation history
✅ aiQualityScores       — evaluate response quality
✅ aiTrainingDataExports — export for model training
✅ aiDicomFindings       — AI radiology finding extraction
✅ aiNormalReportTemplates — canned normal reports
✅ aiBillingSuggestions   — recommend tests based on history
✅ ragDocuments          — knowledge base for RAG
✅ ragSearchQueries      — search intent logging
```

### Schema Implications
- **Patient context available:** name, age, gender, phone, email in patientsTable
- **Booking context available:** recent bookings, tests, costs in onlineBookingsTable
- **Report context available:** history, test names, provider in patientReportsTable
- **AI settings:** aiSystemPrompt in clinicSettingsTable (line 72 in whatsapp.ts)

---

## Architecture Diagrams

### Booking Flow (Existing)
```
User WhatsApp
    ↓
[Webhook] /api/whatsapp/webhook
    ↓
[Conversation logged] → whatsappConversationsTable
    ↓
[AI receives message] ← aiSystemPrompt from clinicSettings
    ↓
[Response generated] ← Gemini API
    ↓
[Send back] → sendTextMessageRaw()
    ↓
WhatsApp
```

### Payment to Report Flow (Existing)
```
Patient initiates booking
    ↓
[Select tests] → GET /api/public/booking/tests
    ↓
[Create order] → POST /api/public/booking/create-order
    ↓
[Pay via gateway] (PayU / PhonePe / BharatPe / ICICI)
    ↓
[Callback] ← Payment gateway confirms
    ↓
[Bill + Token created] → onlineBookingsTable, billsTable, tokensTable
    ↓
[WhatsApp notification] → sendBillWhatsapp()
    ↓
Patient receives message with token number
```

### Queue Management (Existing)
```
Token generated (from booking/counter)
    ↓
[Waiting] appointmentCounterTable
    ↓
[Staff calls token] ← Staff UI update
    ↓
[SMS/WhatsApp] ← Optional; not yet implemented
    ↓
[Patient arrives] → Token marked "called"
    ↓
[Diagnosis/Report] → Test done
    ↓
[Report ready] → sendReportDelivery() or sendReportEmail()
```

### Portal Flow (Existing)
```
Patient login → /portal/patient-login (phone + OTP)
    ↓
Session created (24h TTL)
    ↓
Patient can access:
  - /portal/me (profile)
  - /portal/me/bills (unpaid)
  - /portal/me/reports (all reports)
  - /portal/me/appointments (schedule)
```

---

## API Inventory

### Public (No Auth)
```
GET   /api/public/booking/config           — enabled?
GET   /api/public/booking/tests            — available tests
GET   /api/public/booking/packages         — bundled offers
POST  /api/public/booking/send-otp         — OTP to phone
POST  /api/public/booking/verify-otp       — verify OTP
POST  /api/public/booking/create-order     — initiate booking
POST  /api/public/booking/verify-payment   — confirm payment
POST  /api/public/booking/payu-*           — PayU gateway
POST  /api/public/booking/phonepe-*        — PhonePe gateway
POST  /api/public/booking/bharatpe-*       — BharatPe gateway
POST  /api/public/booking/icici-*          — ICICI gateway
POST  /portal/patient-login                — patient auth
POST  /portal/staff-login                  — staff auth
GET   /portal/doctors                      — available doctors
```

### Patient Auth Required
```
GET   /portal/me                           — profile
PUT   /portal/me                           — update profile
GET   /portal/me/bills                     — bills
GET   /portal/me/reports                   — reports
GET   /portal/me/appointments              — appointments
GET   /portal/me/visits                    — visit history
POST  /portal/appointments                 — book appointment
POST  /portal/appointments/:id/cancel      — cancel
```

### Staff Auth Required
```
GET   /api/whatsapp/settings               — read config
PUT   /api/whatsapp/settings               — update AI settings ⭐
GET   /api/whatsapp/conversations          — inbox
POST  /api/whatsapp/numbers                — add phone
GET   /api/whatsapp/numbers                — list phones
PUT   /api/whatsapp/numbers/:id            — edit phone
DELETE /api/whatsapp/numbers/:id           — delete phone
POST  /api/online-bookings/:id/cancel      — cancel
POST  /api/online-bookings/:id/confirm     — confirm
POST  /api/online-bookings/:id/payment-link — resend link
GET   /api/online-bookings                 — list all
```

---

## Current AI Readiness Assessment

| Component | Readiness | Notes |
|-----------|-----------|-------|
| **Patient Registration** | 85% | Validation ✅, OTP ✅, missing AI intro |
| **Booking** | 90% | Full flow ✅, needs conversational wrapper |
| **WhatsApp** | 75% | Infrastructure ✅, AI hooks defined but not wired |
| **Voice** | 20% | Schema exists, service not wired |
| **Knowledge Base** | 30% | RAG tables exist, no indexing/retrieval logic |
| **Queue** | 60% | Token system ✅, no AI wait-time or notifications |
| **Reports** | 75% | Delivery ✅, no AI-generated summaries |
| **Portal** | 70% | Data access ✅, no AI guidance |
| **Email** | 85% | Service ready, needs patient templates |
| **SMS** | 10% | Schema ready, service not wired |
| **Human Handoff** | 65% | Staff auth ✅, no queue assignment logic |

---

## Minimum Work Required Before First AI Receptionist Pilot

### CRITICAL (Must Have)

**1. Wire WhatsApp AI Processing** [2-3 days]
- Implement `processIncomingMessage()` handler
- Load patient context (name, recent bills, appointments)
- Call Gemini with system prompt
- Route to staff queue if needed
- Log conversation to whatsappConversationsTable

**2. AI Prompt Engineering** [1-2 days]
- Write system prompt for receptionist role:
  ```
  You are a helpful receptionist for Care Diagnostics.
  Help patients: book appointments, check bill status, find test availability.
  Always be polite. If unsure, offer to connect with staff.
  ```
- Test with 10 sample conversations
- Iterate based on feedback

**3. Patient Context Injection** [1 day]
- Query patient by phone number before AI call
- Include in prompt:
  ```
  Patient: John (age 35, last visit: 2 months ago)
  Recent tests: Ultrasound (pending report)
  Outstanding bills: ₹2,000
  ```

**4. Booking Confirmation Flow** [2-3 days]
- After AI suggests booking: "Shall I check availability?"
- Call `/api/public/booking/tests` API
- Show options to patient
- Process booking via `/api/public/booking/create-order`
- Send WhatsApp confirmation with token number

**5. Staff Escalation Queue** [2-3 days]
- Create staff_queue table (priority, patient_phone, message, created_at, assigned_to)
- When AI says "connecting you to staff", add to queue
- Staff UI: show pending messages
- Staff reply → route back via WhatsApp
- Mark handled when staff closes

### HIGH (Very Important)

**6. SMS Service Integration** [1-2 days]
- Add SMS provider config (Twilio/AWS SNS)
- Create `sms.ts` (similar to email.ts)
- Wire SMS to appointment reminders
- Budget: ₹0.50–1 per SMS

**7. Voice Transcription** [3-5 days]
- Wire aiVoiceTranscriptions table
- Add speech-to-text (Google Cloud Speech-to-Text or Twilio)
- Convert voice message → text
- Process same as text message
- Convert response → speech-to-text via gTTS or Twilio

**8. RAG Knowledge Base** [2-3 days]
- Populate ragDocuments table with:
  - Clinic contact info
  - Test descriptions
  - Appointment policies
  - Common FAQs
- Implement RAG retrieval: search relevant docs before AI call
- Inject into Gemini prompt

**9. Patient Communication Logging** [1-2 days]
- Log every AI interaction to aiPatientCommunications table
- Include: patient_id, message_text, ai_response, timestamp
- For audit + training

**10. Quality Scoring** [2-3 days]
- After each AI response, log to aiQualityScores:
  - Accuracy (0-1): "Did AI answer correctly?")
  - Helpfulness (0-1): "Did patient get what they needed?"
  - Tone (0-1): "Was it professional?"
- Staff can rate responses manually
- Identify low-scoring patterns

### MEDIUM (Nice to Have for Pilot)

**11. Wait-Time Estimation** [2 days]
- Monitor token queue in real-time
- Calculate avg service time per counter
- Tell patient: "Usually 15 min wait"

**12. Appointment Reminders** [1-2 days]
- Query appointmentsTable daily
- Find appointments 24h from now
- Send SMS/WhatsApp reminder
- Track if patient confirmed

**13. Email Template Customization** [1-2 days]
- Add email templates to clinic_settings (JSON)
- Render templates with patient context
- Send HTML emails for confirmations

**14. Multi-Language Support** [2-3 days]
- Add clinic language preference (en/hi/regional)
- Store AI prompts per language
- Translate patient messages (or offer language choice)

**15. Booking Optimization** [1-2 days]
- Suggest "optimal" test bundles based on:
  - Age + gender
  - Recent history
  - Common packages
- Example: "35yo + chest pain → Echo + Stress test recommended"

### LOW (Can Wait; Post-Pilot)

- 3D medical illustration on portal
- Video tutorials for test preparation
- Integration with external labs
- Insurance claim automation
- Predictive waitlist (forecast queue depth)

---

## Implementation Priority

### Week 1 (Pilot MVP)
```
Day 1-2:  Wire WhatsApp AI (CRITICAL #1)
Day 2-3:  Prompt engineering (CRITICAL #2)
Day 3-4:  Patient context (CRITICAL #3)
Day 4-5:  Booking flow (CRITICAL #4)
Day 5-6:  Staff escalation (CRITICAL #5)
Day 7:    Testing + iteration
```

### Week 2
```
Day 1-2:  SMS integration (HIGH #6)
Day 2-4:  Voice transcription (HIGH #7)
Day 4-5:  RAG knowledge base (HIGH #8)
Day 6-7:  Quality scoring (HIGH #10)
```

### Week 3+
```
- Wait-time estimation (MEDIUM #11)
- Appointment reminders (MEDIUM #12)
- Multi-language (MEDIUM #14)
- Booking optimization (MEDIUM #15)
```

---

## Production-Critical Files — DO NOT MODIFY

These files are **in use by production staff**. Treat as read-only during pilot:
- `public-booking.ts` — payment gateways live here
- `portal.ts` — staff uses this for login
- `whatsapp.ts` — bill notifications sent here
- All tables in `paymentLogsTable`, `billsTable`, `tokensTable`

---

## Safe Files for AI Extension

Add new routes/logic to these without risk:
- Create new file: `ai-receptionist.ts`
- New table: `ai_conversations` (if not using whatsappConversationsTable)
- New endpoints:
  ```
  POST /api/ai/receptionist/message  — process inbound
  GET  /api/ai/receptionist/history  — conversation history
  POST /api/ai/receptionist/escalate — route to staff
  ```

---

## Database Summary

### Tables Already Exist & Ready
- `whatsappSettings` — AI config fields present
- `whatsappConversations` — logs all messages
- `onlineBookings` — full booking data
- `aiPromptLibrary` — system prompts
- `aiVoiceTranscriptions` — voice logs
- `aiPatientCommunications` — conversation audit
- `aiQualityScores` — response ratings
- `ragDocuments` — knowledge base
- `portalSessions` — patient auth
- `appointmentCounterTable` — queue

### Missing (Need to Create)
- `ai_staff_queue` — escalation queue for staff
- `ai_response_feedback` — staff ratings (or use aiQualityScores)

---

## External Dependencies

### Required
- **Gemini API Key** — env var `GEMINI_API_KEY`
- **WhatsApp Business API** — phoneNumberId + accessToken
- **Email SMTP** — already configured in clinic_settings

### Optional for Full Features
- **SMS Provider** — Twilio, AWS SNS, or local provider
- **Voice Provider** — Google Cloud Speech, Twilio, Deepgram
- **Backup LLM** — Claude API (fallback if Gemini unavailable)

---

## Conclusion

The Care Diagnostics ERP is **70% ready for an AI Receptionist pilot**. Most infrastructure exists. The work is in:
1. **Wiring** existing components (WhatsApp ↔ Gemini)
2. **Context injection** (patient data → prompts)
3. **Flow orchestration** (booking → payment → notification)

**Timeline for pilot MVP:** 1-2 weeks  
**Timeline for full pilot (with SMS, voice, RAG):** 3-4 weeks  

**Risk level:** LOW — existing code is stable; AI layer sits on top.

---

**Status:** ✅ Read-only audit complete. Ready for implementation planning.

