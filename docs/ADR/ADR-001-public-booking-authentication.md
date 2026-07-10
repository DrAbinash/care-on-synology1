# ADR-001: Public Booking Authentication Strategy

## Status
Accepted (Temporary)

## Date
2026-07-10

## Context

CARE ERP was initially designed and built for a small, single-centre
diagnostic operation. The public booking site (`/api/public/booking/*`)
lets a patient look up their own bookings and reports using the mobile
number they registered at the time of booking.

At the time of development we intentionally chose **not** to implement SMS
OTP, WhatsApp OTP, or full patient accounts for this surface, because:

- SMS/WhatsApp providers add recurring cost.
- They increase operational complexity.
- They require additional infrastructure and compliance overhead.
- Our patient volume at the time did not justify the expense.
- The goal was rapid deployment for a single-centre diagnostic workflow.

This was an intentional product decision made under those constraints — it
was **not** an accidental omission, and it is not a software defect or
security bug. It reflects a deliberate trade-off appropriate to the scale
and budget of the initial deployment.

## Decision

- Patients may currently retrieve their own booking information by
  supplying their registered mobile number, with no additional identity
  verification step.
- This behaviour is intentional, not a bug.
- It is considered acceptable for the current, single-centre deployment.
- This decision was approved by the project owner.

## Trade-offs

**Advantages:**
- Lower operating cost — no SMS/WhatsApp gateway fees.
- Simpler deployment — no third-party OTP provider integration to
  configure, monitor, or keep credentials for.
- Better patient usability — no OTP round-trip, no account creation, no
  password to remember.
- No dependency on SMS gateways or their uptime/delivery reliability.
- Faster implementation, appropriate for the initial go-live timeline.

**Disadvantages:**
- Anyone who knows (or can guess/enumerate) another patient's registered
  mobile number could potentially retrieve that patient's booking
  information.
- Not appropriate as-is for future expansion into richer patient portal
  functionality (reports, images, payment history, profile data), where
  the sensitivity and volume of exposed data would be significantly
  higher.

## Future Review

This ADR **must be revisited** before implementing any of the following:

- Online report download
- Radiology images
- Laboratory reports
- Payment history
- Patient profile
- Multi-centre deployment
- Large-scale deployment

At that point, the authentication model for public/patient-facing booking
and portal endpoints should be upgraded to one of:

- SMS OTP
- WhatsApp OTP
- Patient account login
- Verified identity provider

## Notes

This is an accepted business decision made during the initial
implementation of CARE ERP. It should not be treated as a software defect
or regression. Future security improvements should be implemented as part
of patient portal evolution rather than considered blockers for the
current release.
