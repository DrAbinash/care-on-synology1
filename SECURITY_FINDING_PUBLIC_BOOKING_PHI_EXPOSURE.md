# Security Finding — Public Booking "My Bookings/Reports" Exposes PHI to Anyone Who Knows a Phone Number

**Status:** Open. Not fixed. Deliberately out of scope for the service-worker
hardening pass this document was written alongside — this finding is a
pre-existing authorization design gap, not a caching bug, and needs its own
scoped decision before any fix is written. This document is intended to
become its own tracked issue.

**Endpoints in scope:**
- `GET /api/public/booking/my-bookings`
- `GET /api/public/booking/my-reports`

Both defined in `artifacts/api-server/src/routes/public-booking.ts`, mounted
at `router.use("/public/booking", publicBookingRouter)` in `routes/index.ts`
with **no authentication middleware at all** — this is the intentionally
public booking site, reachable by anyone on the internet.

---

## What the code actually does

```
publicBookingRouter.get("/my-bookings", async (req, res) => {
  const phone = String(req.query.phone || "");
  if (!phone) { res.json({ bookings: [] }); return; }
  const rows = await db.select()
    .from(onlineBookingsTable)
    .where(eq(onlineBookingsTable.phone, phone))
    .orderBy(onlineBookingsTable.id)
    .limit(50);
  res.json({ bookings: rows });
});
```

The **entire row** is returned (`db.select()` with no column projection).
`onlineBookingsTable` (`lib/db/src/schema/onlineBookings.ts`) includes:
patient `name`, `phone`, `email`, `ageValue`/`ageUnit`, `gender`, `testIds`/
`packageIds` (which tests/packages were booked — this can reveal suspected
conditions, e.g. a pregnancy panel or an STD screen), `notes` (free text),
`isVip`, booking `status`, and payment-gateway transaction identifiers
(`razorpayPaymentId`, `payuTxnId`, `phonepeTransactionId`,
`bharatpeTransactionId`, `iciciTransactionId`, `razorpaySignature`, etc.).

The only "authorization" check is: *does the caller know a 10-digit phone
number.* There is no OTP check, no session, no rate-limit specific to this
route, and no way to prove the caller is the phone's actual owner.

`/my-reports` has the same phone-only gate; its handler is presently a stub
(`// Stub: return empty for now`) — not a live data leak today, but it
inherits the identical authorization design, so it becomes one automatically
the moment the "reports table integration" work lands, unless this finding
is resolved first.

## Directly relevant, connected finding: the existing OTP mechanism is non-functional

This same file defines a `send-otp` / `verify-otp` pair (`otpStore`,
`generateOtp()`) intended for "mobile login." It looks, at first read, like
the natural fix for this finding — require OTP verification before returning
booking data. It is not usable as-is:

```
publicBookingRouter.post("/send-otp", bookingLimiter, async (req, res) => {
  ...
  const code = generateOtp();
  otpStore.set(phone, { code, name: name || "", expiresAt: Date.now() + 5 * 60 * 1000 });
  res.json({ sent: true, phone, code });   // <-- the OTP is echoed back in the API response
});
```

There is no SMS/Twilio/any out-of-band delivery call anywhere in this file
(confirmed by grep: `sendSms|twilio|Twilio` → zero matches). The generated
code is written directly into the JSON response with no environment gate.
Any caller can `POST /send-otp` for any phone number and read the valid code
straight out of that response, then immediately `POST /verify-otp` with it —
this proves nothing about phone ownership. **Any recommendation to gate
`/my-bookings`/`/my-reports` behind "the existing OTP flow" is contingent on
fixing OTP delivery first** (wiring a real SMS provider and removing `code`
from the `/send-otp` response); recommending OTP-gating alone, without
noting this, would be recommending a fix built on a currently broken
foundation.

---

## Attack scenario

1. An attacker (no login, no special access — this is the public marketing/
   booking website, `caredeoghar.com`-style) has, or can generate, a set of
   10-digit Indian mobile numbers — plausible via a wordlist of common
   prefixes, a data broker list, a phone book, or simply knowing a target's
   number socially.
2. For each candidate number: `GET /api/public/booking/my-bookings?phone=<number>`.
3. `bookingLimiter`/`createOrderLimiter` (the two rate limiters defined in
   this file) are applied only to `/send-otp`, `/verify-otp`, and
   `/qr-initiate` — **`/my-bookings` and `/my-reports` have no rate limiter
   attached at all**, only the router-wide `generalLimiter` applied to all of
   `/api/*` in `app.ts`. This makes bulk enumeration across many phone
   numbers materially easier than it would be against a per-route limiter.
4. Any number with a booking history returns full name, email, age, gender,
   which tests/packages were booked, VIP status, free-text notes, and
   payment transaction IDs — no proof of ownership required.
5. Because a booking's `phone` is exactly the number a person gives at
   checkout, this attack directly targets real, identifiable individuals —
   not random accounts.

## Impact

- **PHI/PII exposure**: name + phone + email + age + gender + which medical
  tests/packages were booked, for any phone number an attacker chooses to
  query. In a diagnostics/pathology context, "which tests were booked" is
  itself sensitive clinical information (e.g., a booked test panel can imply
  a suspected diagnosis).
- **Enumerable at scale**: no per-route rate limit, no CAPTCHA, no OTP —
  nothing prevents scripted enumeration across a phone-number range.
- **Regulatory exposure**: this is patient health information handled by an
  Indian diagnostics/pathology provider; unauthenticated bulk access to it is
  the kind of finding that matters directly under India's DPDP Act (and any
  future HIPAA-equivalent obligations if this platform ever serves
  international patients), independent of whether it is ever actually
  exploited.
- **Payment transaction IDs** returned alongside patient identity could aid
  payment-gateway-side fraud/correlation attacks, though the gateways
  themselves are the primary control there.

## Recommended solution

Do not implement without a scoped decision — options, roughly in order of
engineering cost:

1. **Minimal, fastest**: require a *verified* OTP before either endpoint
   returns data, reusing the existing `otpStore`/`verify-otp` mechanism —
   but only after fixing OTP delivery (wire a real SMS provider such as the
   Twilio MCP connector already available in this environment, or an
   existing SMS gateway if one is already integrated elsewhere in this repo;
   remove `code` from the `/send-otp` response body unconditionally, not
   just in production, since a "dev convenience" that ships to prod by
   accident is exactly how this gap likely originated). Issue a short-lived,
   single-use token from `/verify-otp` and require it as a header/query
   param on `/my-bookings`/`/my-reports`, rather than trusting the bare
   phone number as it does today.
2. **Add a route-specific rate limiter** to `/my-bookings` and `/my-reports`
   (matching the `bookingLimiter` pattern already used elsewhere in this
   same file) as defense-in-depth regardless of which option above is taken
   — this alone does not close the finding, since a determined attacker can
   still enumerate slowly, but it materially raises the cost of bulk
   scraping.
3. **Reduce the response payload** to only what the booking-status UI
   actually needs (booking ref, date, time slot, status) rather than the
   full row — removes payment transaction IDs and free-text notes from the
   exposure surface even if the authorization gap is not immediately closed.
   This is a good idea independent of the OTP fix and cheap to do.

## Migration strategy

- This is a **public, unauthenticated** surface — there is no "existing
  session" to preserve, so there's no backward-compatibility concern with
  currently logged-in users. The compatibility concern is entirely
  **frontend**: whichever public booking-status page currently calls these
  endpoints with just `?phone=` needs to be updated in lockstep to first call
  `/send-otp` → `/verify-otp` → then pass the resulting token to
  `/my-bookings`/`/my-reports`. Ship both sides together; do not ship the
  backend gate first (would break the existing public page for every
  patient) or the frontend change first (the token would have nothing to
  validate against yet).
- Fix OTP delivery **before** relying on it as a security boundary anywhere —
  today, gating on "OTP verified" is gating on nothing.
- Consider whether `/my-reports`, still a stub, should ship its real
  implementation gated correctly from day one, rather than shipping the
  data-returning version first and retrofitting auth later (the exact
  sequencing mistake `/my-bookings` appears to have made).

---

**Recommended next step:** open this document as its own GitHub issue,
tagged security + PHI, and get an explicit decision from the product/security
owner on which of the three recommended-solution options (or a combination)
to implement, before any code changes are made here.

---

## Resolution — Patient portal (implemented)

The finding is **closed** by the patient-portal auth boundary in
`artifacts/api-server/src/routes/patientPortal.ts` (mounted at `/api/patient`).
All three original recommendations were adopted, and the legacy surface was
retired rather than left in place:

- **Real auth boundary.** `POST /api/patient/send-otp` generates a
  `crypto.randomInt` code, stores only its SHA-256 hash (never echoed), and
  delivers it out-of-band via WhatsApp. `POST /api/patient/verify-otp` does a
  timing-safe compare, consumes attempts via a single atomic conditional
  `UPDATE` (concurrency-safe 5-try cap), and mints a **server-side session
  token** (`patient_sessions`, 7-day TTL). Every data endpoint requires that
  token — a bare phone number no longer unlocks anything.
- **Rate limiting.** `send-otp` / `verify-otp` are rate-limited keyed on
  **ip + phone** (so rotating IPs can't multiply the budget for one target),
  plus a per-phone resend cooldown. `send-otp` only messages a number already
  known to the clinic (a patient record or prior booking) and returns an
  identical response either way — no patient enumeration, no arbitrary-number
  WhatsApp abuse.
- **Minimal payloads.** `GET /api/patient/my-bookings` returns a reduced
  projection (no email, notes, test lists, or gateway txn IDs).
  `GET /api/patient/my-reports` returns metadata only; the PDF is fetched via
  a short-lived, ownership-checked token (`POST /api/patient/reports/:id/link`
  → the existing `/api/p/r/:token/pdf` route). Phone matching is on normalized
  last-10-digits so stored `+91`/spaced numbers resolve correctly.
- **Legacy surface retired.** The old `send-otp`, `verify-otp`, `my-bookings`
  and `my-reports` on `/api/public/booking` now return **410 Gone**; the
  in-memory `otpStore` and the code-echo are deleted. `GET /by-ref` no longer
  returns the Razorpay HMAC signature.
- **Cache safety.** `/api/patient/` is network-only in the service worker
  (`public/sw.js`), so one patient's identity-scoped responses are never
  cache-served to another on a shared device (enforced by
  `personalEndpointCacheGuard.test.ts`).

### Accepted residual risk — phone as identity (product decision)

Reports/bookings are scoped to the **verified phone number**, and a patient
record's `phone` is a contact field, not a per-person identity. If the **same
number is placed on multiple patient records** — a family member's phone, or
(the case to avoid) a shared front-desk or agent number — whoever verifies
that number sees every report filed under it. This is intended behaviour for a
genuine personal/family number and is **not mitigated in code by design**.

**Operational guard:** never put a shared or clinic-owned number on a patient
record. Use each patient's own mobile number. Staff creating walk-in records
under a placeholder/front-desk number would expose those records to anyone who
controls that number.
