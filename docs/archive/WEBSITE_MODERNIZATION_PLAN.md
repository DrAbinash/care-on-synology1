# Website Modernization — Plan

**Status:** Reference document, written to record the plan that was followed and any deviations from it, per the deliverables list in the original brief.

---

## Sequencing Principle

Lowest-risk, highest-visual-impact first; protected-logic-bearing files last and with the most scrutiny. This order was chosen so that if something needed to stop partway through, the highest-value, lowest-risk work would already be complete, and the riskiest files would only be touched once the new design system's patterns were already proven across a dozen other components.

## Actual Sequence Followed

1. Audit — full read of the codebase before any code change, to locate every ICICI-touching file precisely rather than assuming.
2. Style Guide — design tokens, typography, the scan-line signature motif, decided before implementation so every component pulls from one consistent system rather than inventing styling ad hoc per component.
3. Core section library, sections.tsx, 15 reusable section-type components — highest leverage, since every page on the site (CMS-driven, see the audit) is composed from these. No payment logic anywhere in this file.
4. Standalone section files with no payment logic — FaqSection, ContactSection, GallerySection, CustomHtmlSection — same design system applied, each file's existing business logic read in full before any edit, never altered.
5. AppointmentSection.tsx — the first protected-logic-bearing file. Styling-only pass, no JSX tree restructuring, with handleICICI and every gateway handler diffed against the pre-change version to confirm zero logic drift before committing.
6. book.tsx — the second, larger protected-logic-bearing file, the standalone /book page, including VIP surcharge calculation. Same discipline as step 5, with content-based diffing since this file's size meant line numbers were not a reliable verification method.
7. App-shell states, widgets, SEO — 404/error/loading states, the WhatsApp FAB and popup engine, meta tags — lowest-risk remaining surface, done last as cleanup plus the SEO additions the brief specifically requested.
8. Final sweep — repo-wide grep for any remaining old class names, to catch anything missed in the per-file passes. Found and fixed one leftover class reference in AppointmentSection.tsx.
9. Testing and remaining documentation.

## Deliberate Scope Exclusion

scan-mobile.tsx, a self-contained QR-scanning utility page, was deliberately left untouched. It uses essentially no shared design-system classes — it's Tailwind-utility-driven and largely independent of the rest of the site's styling — and has no payment logic. Restyling it would have been purely cosmetic risk against a working camera and QR flow, for a page that isn't part of the brief's explicit page list. Noted here as a conscious decision, not an oversight.

## Architectural Constraint Discovered and Respected Throughout

This is a CMS-driven site — pages are database rows composed of typed sections, edited via an admin Website Builder not visible in this codebase. "Redesign the MRI page" was therefore implemented as "redesign the section-type component library" rather than writing per-page files that don't exist in the source tree — any MRI-specific page content, if and where it exists, is admin-authored data that automatically inherits the new component styling without needing a code change.

## Design System Constraint Respected Throughout

The pre-existing CSS variable system is driven at runtime by admin-configured Website Builder settings — primary color, background color, font choice, button style. Every new component was built to either continue using that system where it was already wired to admin settings, or to use the new design-token layer for structural and atmospheric choices the admin doesn't control — never to hardcode a replacement for an admin-configurable value. This was verified by keeping theme.ts itself completely untouched throughout the entire project.

## Protected-Logic Discipline Applied

As stated in the audit and reconfirmed in every relevant commit message: ICICI's handleICICI function, and by extension every other live payment gateway handler in the same files — PayU, Razorpay, PhonePe, BharatPe, QR/UPI — plus the VIP surcharge calculation, were treated as read-only except for the styling of their surrounding JSX wrapper. Every commit touching a protected file includes a diff-based verification statement in its commit message, not just a claim of care.
