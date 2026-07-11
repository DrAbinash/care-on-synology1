# Website Modernization — Audit

**Status:** Pre-implementation audit. Read-only findings. No code changed yet.
**Scope:** artifacts/clinic-site, the public-facing Care Diagnostics website.
**Git restore point:** tag checkpoint/before-website-modernization at commit 869eace2.

---

## 1. Architecture — Important Correction to Assumptions

This is not a conventional multi-page React site with one file per page. It is a CMS-driven site:

- pages (a database-backed entity, fetched via api.pages()) each have a slug and a JSON sections array.
- Every page — Home, Services, MRI, CT, About, Contact, whatever exists — is composed at runtime from a sequence of typed sections (hero, services, stats, why_choose_us, technology, health_packages, reviews, faq, gallery, contact, connect, subscribe, header, footer, custom_html), rendered by a single SectionRenderer in sections.tsx, 1070 lines.
- An admin Website Builder, elsewhere in the staff ERP, not audited here, is presumably how pages/sections/content are actually authored and published today.
- book.tsx, scan-mobile.tsx, and policies.tsx are the only genuinely standalone, non-CMS pages, routed directly by slug in App.tsx.

Implication for this project: "redesign the MRI page" does not mean writing a new MRI.tsx file, since no such file exists. It means redesigning the shared section-type components in sections.tsx that any page is built from. The actual page content, copy, and section choice is a CMS-data concern outside this codebase's source files, not something I can audit or change here.

This audit treats the reusable section-type component library as the real, correct lever for the homepage and per-modality page requests in the brief. I have not located and have not assumed the existence of separate static content for the MRI page versus the CT page — if such per-page content exists, it lives in the database, set up through the Website Builder, and a redesign of the section components will automatically apply to it without needing per-page code changes.

## 2. Protected Files — ICICI Orange Pay

Confirmed by direct code read, not assumption.

### Real protected logic, backend, entirely out of this project's touch
artifacts/api-server/src/routes/public-booking.ts lines 1064-1392: icici-initiate and icici-callback routes, hash signing, ICICI environment variables, transaction logging. Not part of clinic-site and not touched by this modernization project at all.

### Frontend files containing protected logic, UI changes allowed, logic boundary marked

| File | Protected function | Lines | What it does |
|---|---|---|---|
| src/pages/book.tsx | handleICICI() | 422-436 | Calls POST /api/public/booking/icici-initiate with name, phone, email, selectedDate, timeSlot, testIds, packageIds, totalAmount, notes, isVip; receives bookingRef, redirectUrl, tranCtx; sets successRef; navigates via window.location.href |
| src/pages/book.tsx | Gateway dispatch | line 413 | Routes to handleICICI when gateway is icici or hdfc — must stay |
| src/pages/book.tsx | Payment confirmation detection | lines 231-247 | Reads iciciTransactionId from booking-status response to detect a completed ICICI payment |
| src/sections/AppointmentSection.tsx | handleICICI() | approx 207-220 | Identical pattern to book.tsx — a second, near-duplicate booking widget, the homepage quick-booking section |
| src/sections/AppointmentSection.tsx | Gateway dispatch and confirmation detection | approx 100, 313 | Same pattern as above |

Everything else touching the icici gateway condition in both files is pure UI: banner image src, button background color, bank logo, label text. These are explicitly allowed to change per the brief.

### The exact rule I will follow
I will not rename, reorder, inline, or refactor handleICICI's internal logic — not the endpoint string, not the request body shape, not the response field names, not the redirect mechanism. I will only change what wraps around the function call and the function's surrounding visual presentation. If a redesign requires restructuring component layout such that handleICICI needs to move to a different file or be lifted into a shared hook, I will stop and flag that before doing it, rather than treating it as a routine refactor.

### Public asset files referenced by protected logic
public/icici-orange-pay.jpeg and public/icici-bank-logo.jpeg are referenced by hardcoded path strings inside the protected gateway-branding logic. I may restyle how they're displayed but will not rename or remove the files without updating every reference, and any such change is logged in the test report.

## 3. Other Payment Gateways — Also Live Production Logic

The brief names ICICI specifically as protected, but book.tsx and AppointmentSection.tsx also contain live, working logic for PayU, Razorpay, PhonePe, BharatPe, and a QR/UPI fallback. The brief's protection instruction names only ICICI explicitly. I am treating all gateway-handler functions with the same care as ICICI's, same boundary discipline, same wrap-don't-refactor rule, because they follow an identical, recognizable pattern, and breaking a different live payment gateway because it wasn't the one named in the brief would be a worse outcome than being more conservative than strictly instructed.

I am noting this as an assumption, not a unilateral scope change: if a different gateway's logic, not just its UI, needs to change, I will flag it before proceeding, the same as I would for ICICI.

## 4. Site Structure Inventory

```
src/
  App.tsx                  routing shell, CMS page resolution, structured data, mobile CTA bar
  sections.tsx (1070 ln)   the redesign lever: all 15 reusable section-type components
  sections/                a few sections broken out as standalone files
    AppointmentSection.tsx  contains 2nd ICICI handler, protected, see section 2
    ContactSection.tsx
    CustomHtmlSection.tsx
    FaqSection.tsx
    GallerySection.tsx
  pages/
    book.tsx (1270 ln)     standalone full booking page, contains ICICI handler, protected
    policies.tsx           standalone static page
    scan-mobile.tsx        standalone QR-scan utility page, unrelated to payments
    not-found.tsx
  widgets.tsx               WhatsApp FAB, popup host
  theme.ts                  runtime CSS-variable theming from admin-configured SiteSettings
  index.css (1214 ln)       Tailwind plus custom properties plus existing keyframe animations
  types.ts                  SiteSettings, Page, Popup, Section types
  api.ts                    thin fetch wrapper to backend CMS/booking endpoints
  head.tsx                  meta tag and SEO management
  components/ui/            full shadcn/Radix component library
```

### Inconsistency worth flagging
There appear to be two parallel patterns for sections: most section types are defined inline inside the monolithic sections.tsx, while five have been broken out into their own files. This looks like an incomplete migration rather than an intentional split. I will not fix this architectural inconsistency as part of a visual redesign — refactoring file organization is a separate concern from UI modernization and carries its own regression risk for no visual benefit. Noted here so it isn't mistaken for an oversight later.

## 5. Existing Design System — What's Already There

Contrary to a from-scratch assumption, there is a real foundation already in place.

- Runtime theming: theme.ts converts admin-configured hex colors and font choice into CSS custom properties applied to root. This must be preserved — hardcoding new colors directly into components instead of using these CSS variables would break the admin's ability to rebrand the live site through the Website Builder, a real, currently-working feature I must not silently remove.
- Existing CSS variables: primary, background, foreground, muted, border colors, a radius variable, three tiers of box-shadow, already defined.
- Existing keyframe animations: fadeInUp, fadeInLeft, fadeInRight, floatY, shimmer, pulseGlow, spin already defined.
- Full available component and animation stack, confirmed in package.json, not assumed: complete Radix UI primitive set, framer-motion, embla-carousel-react, recharts, react-hook-form plus zod, sonner, lucide-react plus react-icons, tw-animate-css.

Implication: this redesign should be understood as evolving an existing, reasonably modern design system, not building one from zero. The brief's framing suggests the execution — visual polish, content hierarchy, section design quality — is the problem, not the absence of a technical foundation to build on.

## 6. Backend API Surface the Frontend Depends On

From api.ts and usage throughout — contracts I must not change the shape of, since the backend is out of scope entirely for this project: api.settings, api.pages, api.popups, api.verifyPreview, plus bookingGet/bookingPost calls to various public booking endpoints, all backend-owned, all out of scope per the brief except for ICICI-specific UI wrapping already covered in section 2.

## 7. What I Will NOT Touch

- Anything under artifacts/api-server, all backend code, all payment gateway logic.
- handleICICI internals in both files.
- Request/response shapes for any backend API call.
- Environment variables of any kind.
- Database schema or any migration.
- The CMS data model itself — I may add new section-type renderers if genuinely needed for a new homepage section, but will not change the shape of existing types without flagging it first.

## 8. What I Will Redesign

- All 15 section-type components in sections.tsx and the 5 already-broken-out section files.
- book.tsx's and AppointmentSection.tsx's UI, layout, and styling, wrapping the protected payment functions.
- policies.tsx, scan-mobile.tsx, not-found.tsx visual treatment.
- widgets.tsx, theme.ts extending not replacing the runtime theming system, index.css extending the existing variable and animation system, not discarding it.
- head.tsx for SEO and meta improvements.

## 9. Immediate Next Steps

1. Produce WEBSITE_ROLLBACK_PLAN.md — the UI rollback snapshot/procedure.
2. Produce WEBSITE_MODERNIZATION_PLAN.md — the actual design plan, informed by this audit.
3. Produce WEBSITE_STYLE_GUIDE.md — the new visual language, built as an extension of the existing CSS variable system, not a replacement.
4. Produce WEBSITE_COMPONENT_MAP.md — old component to new component mapping, with explicit protected-boundary annotations carried over from section 2.
5. Begin implementation, section-type by section-type, starting with hero and header — highest visual impact, lowest payment-adjacency risk.
6. book.tsx and AppointmentSection.tsx UI work happens last and gets the most careful, isolated testing, given the protected logic they contain.
