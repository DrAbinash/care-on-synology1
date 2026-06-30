# Website Style Guide — Care Diagnostics

**Status:** Design plan, written before implementation. Extends the existing runtime CSS-variable system (see WEBSITE_MODERNIZATION_AUDIT.md section 5) — does not replace it. Admin-configured branding via the Website Builder continues to work exactly as before; this guide adds a new layer on top for the parts the admin doesn't control.

---

## Design Thesis

Care Diagnostics is a precision diagnostic centre — 3T MRI, CT, ultrasound, mammography, pathology. The person on this site is usually anxious: booking a scan for themselves or a worried family member. The job of the design is to convert that anxiety into confidence quickly, then get them to a booked slot. The aesthetic is clinical precision — the visual language of a radiology reading room and a precision instrument, not a generic friendly-healthcare template of soft pastels and smiling stock photos. Cool, exact, calm, fast.

Signature element: a horizontal scan-line sweep, echoing how an MRI or CT actually images a body in sequential slices. This motif appears in exactly three places: the hero panel, the loading/transition state, and a hover micro-interaction on modality cards. One idea, used with restraint.

This deliberately avoids the three current AI-design defaults: cream-background-serif-terracotta, near-black-neon-accent, broadsheet-hairline-newspaper. It is built from what this business actually does.

---

## Color

Six named values, layered as new CSS custom properties (cd- prefix) alongside the existing site- variables. The admin's primaryColor setting continues to drive anything already wired to it.

| Token | Hex | Use |
|---|---|---|
| cd-navy | #0B2545 | Dark panels (hero background, footer), headline color on light backgrounds |
| cd-teal | #0E7C86 | Secondary accent — icons, hover states, the scan-line motif itself |
| cd-amber | #F2A93B | CTA buttons and highlight moments only, used sparingly, never as a large background fill |
| cd-scan-white | #F7FAFC | Light section backgrounds — cooler than pure white |
| cd-slate | #1C2733 | Body text on light backgrounds |
| cd-hairline | #D8E1E8 | 1px dividers between sections, card borders |

Admin override behavior preserved: if the admin sets a custom primary color, that still changes the elements already wired to it. The new palette governs the structural and atmospheric color choices this redesign introduces — the two systems coexist.

---

## Typography

Three roles, deliberately not the same fonts every other healthcare site reaches for.

- Display: Fraunces, a serif with real structural personality, used at large sizes only for the hero headline and major section headings. Conveys established trust without tipping into stuffy.
- Body: Inter, already the existing default, kept for continuity and because it's excellent for dense informational content.
- Utility/Mono: IBM Plex Mono, used specifically for data-like elements: test codes, prices, turnaround times, booking reference numbers. A price set in mono reads like a measurement, signaling precision instrument rather than marketing site.

Admin font choice preserved: the existing heading-font system remains wired exactly as before, and continues to apply wherever it already applies. Fraunces and IBM Plex Mono are additive variables the new section components use specifically for the new hero and data treatments this redesign introduces.

Type scale, mobile-first, scaling at the medium breakpoint:
- Hero headline: 2.75rem to 4.5rem, Fraunces, 600 weight, line-height 1.05
- Section headline: 1.875rem to 2.75rem, Fraunces, 600
- Card headline: 1.25rem to 1.5rem, Inter, 600
- Body: 1rem to 1.0625rem, Inter, 400, line-height 1.65
- Caption/label: 0.8125rem, Inter, 500, letter-spacing 0.02em, uppercase for eyebrows
- Data/mono: 0.9375rem, IBM Plex Mono, 500

---

## Layout and Spacing

- Section vertical rhythm: 5rem mobile, 7.5rem desktop padding between major sections.
- A single 1px hairline rule between sections where a hard visual break is wanted, used as a precision-instrument device, not decoratively everywhere.
- Cards: keep the existing site-radius for continuity, add a 1px hairline border, and on hover a soft inset glow in teal at low opacity plus a 2px lift, suggesting the card is becoming active.
- Grid: 12-column, generous gutters, modality cards in a responsive 2-up mobile, 3-up tablet, 6-up desktop grid.

---

## The Scan-Line Signature — Exact Specification

A single horizontal line, 2px tall, teal at full opacity with a soft blur-glow trailing behind it, animating left to right across a dark navy panel over 3.5 seconds, looping with a pause at each end, not a constant frantic loop.

Where it appears:
1. Hero panel background, behind the headline and CTA, sweeping across an abstract geometric anatomical-silhouette graphic, not a literal medical illustration.
2. Loading state, replacing a generic spinner.
3. Modality card hover, a faster single-pass version sweeping top to bottom on hover only, never auto-looping on cards.

Reduced motion: all three instances respect prefers-reduced-motion — the hero shows a static soft gradient instead of the sweep, the loading state becomes a simple pulse, and the card hover becomes a static border-glow with no movement.

---

## Iconography

lucide-react, already a dependency, for all functional icons. For the six modality cards, custom simple line-art glyphs will be built in the same geometric style, since lucide doesn't have medical-modality-specific icons.

---

## Motion Principles Beyond the Signature

- Section entry: a single restrained fadeInUp, already defined in index.css, on scroll into view, staggered slightly across child cards within a section.
- No parallax, no auto-playing carousels for serious content, except a user-pausable testimonial carousel.
- Buttons: subtle scale plus shadow-lift on hover, no color-shift-only states.

---

## Accessibility Floor

- All interactive elements keyboard-navigable with a visible focus ring.
- Color contrast meeting WCAG AA at minimum for normal text.
- prefers-reduced-motion respected everywhere motion is used.
- All images have meaningful alt text, empty alt only for confirmed-decorative graphics.
- Forms have proper label association, visible error states with text not color alone, and screen-reader announced errors.

---

## What This Style Guide Deliberately Does Not Do

It does not introduce a new component library, does not replace Tailwind, does not discard the existing CSS variable system, and does not remove any admin-configurable branding capability. It is additive, coexisting with what the Website Builder already lets a non-technical admin control.
