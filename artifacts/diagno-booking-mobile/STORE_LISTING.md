# Play Store / App Store listing — Care Diagnostics Booking

Copy-paste content for the store listings. Character limits noted are Google
Play's; Apple App Store limits are similar or looser.

---

## App name (Play: max 30 chars)

```
Care Diagnostics Booking
```

## Short description (Play: max 80 chars)

```
Book lab tests, pay online, and view your reports from Care Diagnostics, Deoghar.
```

## Full description (Play: max 4000 chars)

```
Care Diagnostics Booking is the official app of Care Diagnostics, Deoghar — book diagnostic tests, pay securely, and get your lab reports on your phone.

BOOK IN MINUTES
• Browse pathology tests, imaging (X-Ray, Ultrasound, CT/MRI, ECG) and health packages.
• Search and filter, pick your tests, choose a date and time slot, and confirm.
• See the price before you pay — no surprises.

PAY SECURELY
• Pay online through trusted, licensed gateways (ICICI Orange Pay, Razorpay, UPI and more, as enabled by the clinic).
• Your card, UPI and bank details are handled directly by the payment gateway — the app never stores them.

YOUR REPORTS, SECURELY
• Log in with a one-time code sent to your mobile number on WhatsApp.
• View your verified lab reports and open the report PDF whenever you need it.
• Only you can see your reports — access requires verifying your own number.

TRACK YOUR BOOKINGS
• See your upcoming and past bookings, their status, and your token number.
• Get directions and call the clinic in one tap.

FOR CLINIC STAFF
• Staff can securely sign in to view the day's collections and bills (permission-controlled).

Care Diagnostics — Subhash Chowk, Castair's Town, Deoghar.
Call us: 9973497200

Privacy policy: https://caredeoghar.com/app-privacy
```

## Listing details

| Field | Value |
| --- | --- |
| Category | Medical |
| Contact email | CARE.DEOGHAR@GMAIL.COM |
| Contact phone | +91 9973497200 |
| Website | https://caredeoghar.com |
| Privacy policy URL | https://caredeoghar.com/app-privacy |
| Contains ads | No |
| In-app purchases | No (payments are for diagnostic services via external gateway, not digital goods) |

## Graphics checklist (prepare before submitting)

- App icon: 512×512 PNG (Play) — derive from `assets/images/icon.png` (1024×1024 source).
- Feature graphic: 1024×500 PNG/JPG (Play, required).
- Phone screenshots: at least 2 (Play requires 2–8), 16:9 or 9:16, min 320px.
  Suggested screens: Home, Book (test selection), Payment, My Reports, Booking detail.
- (Optional) 7"/10" tablet screenshots.

## Data Safety form (Play Console → App content → Data safety)

Declare the following (matches the app's actual behaviour and the privacy policy):

**Collected & linked to the user:**
- Personal info → Name; Phone number. Purpose: App functionality, Account management. Not shared with third parties for advertising. Not sold.
- Health info → Lab test bookings and reports viewed in-app. Purpose: App functionality. Not shared for advertising. Not sold.
- Financial info → handled by the external payment gateway; the app itself does not collect or store card/UPI/bank credentials.

**Security practices:**
- Data is encrypted in transit: Yes.
- Users can request data deletion: Yes (via the contact email/phone in the privacy policy).

**No third-party advertising or tracking SDKs** are included in the app.

## App access instructions (Play Console → App content → App access)

Google's reviewers cannot receive your WhatsApp OTP, so provide guidance:

```
Login uses a one-time code delivered by WhatsApp to the entered mobile number,
so a live phone that can receive WhatsApp is required to sign in. For review,
please contact CARE.DEOGHAR@GMAIL.COM to arrange a demo account / test code, or
review the booking and payment flow which is available without logging in
(the "Book a Test" flow does not require login). "My Bookings" and "My Reports"
require the WhatsApp OTP login.
```

## Notes

- Bump `version` and `android.versionCode` in `app.json` before each new build
  (the EAS production profile auto-increments `versionCode`).
- The privacy-policy URL above assumes the clinic site is served at
  caredeoghar.com; the page lives at `/app-privacy` (clinic-site route). Adjust
  the domain in this file and in the app if the site is hosted elsewhere.
