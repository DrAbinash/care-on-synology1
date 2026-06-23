# Care Diagnostics — Clinic Website Structure & Integration Guide

## Project Overview
This is a **React + Vite + Wouter** single-page public clinic website with a **section-based page builder** backend. The site loads dynamically from an API (theme, pages, sections, popups, FAQs, photos). It supports multiple pages with slug-based routing, has a full online test/package booking flow with payment gateway integration, and is fully editable by staff via an internal Website Builder.

**Business Details to Use:**
- **Name:** Care Diagnostics
- **Address:** Subhash Chowk, Castairs Town, Deoghar, Jharkhand PIN 814112
- **Phone:** 9973497200
- **Email:** care.deoghar@gmail.com

---

## CRITICAL: Do NOT Change These Integrations

### 1. Razorpay Integration (Online Booking)
- Script loaded dynamically: `https://checkout.razorpay.com/v1/checkout.js`
- API calls: `POST /api/public/booking/create-order` and `POST /api/public/booking/verify-payment`
- Razorpay checkout config object uses: `key`, `amount` (INR paise), `currency: "INR"`, `order_id`, `name`, `description`, `prefill`, `theme.color: "#6366f1"`
- Handler callback sends: `razorpayOrderId`, `razorpayPaymentId`, `razorpaySignature` to verify endpoint

### 2. PayU Integration (Online Booking)
- Form POST to `https://secure.payu.in/_payment` (production) or `https://test.payu.in/_payment` (test)
- Fields: `key`, `txnid`, `amount`, `productinfo`, `firstname`, `lastname`, `email`, `phone`, `surl`, `furl`, `hash`
- Redirects back to: `/api/public/booking/payu-success` and `/api/public/booking/payu-failure`
- Hash calculation server-side using SHA512

### 3. Online Booking Flow (Must Stay Exactly As Is)
- Step 1: Patient details form (name, phone, email, date, time slot)
- Step 2: Test/package selection from API catalog (`/api/public/booking/tests` and `/api/public/booking/packages`)
- Step 3: Order summary with total, then pay via configured gateway
- Time slots: Morning (7–10 AM), Late Morning (10 AM–1 PM), Afternoon (1–4 PM), Evening (4–7 PM), Night (7–9 PM)
- WhatsApp fallback: `https://wa.me/<phone>` with pre-filled message

### 4. Booking Config API
- `GET /api/public/booking/config` returns: `{ enabled, keyId, vipEnabled, gateway: "payu" | "razorpay" | null, payuMerchantKey }`
- `GET /api/public/booking/tests` returns catalog of active tests with id, code, name, category, price
- `GET /api/public/booking/packages` returns active packages with id, code, name, price, description

### 5. WhatsApp Floating Button
- Conditionally shown based on `settings.whatsappEnabled` and `settings.whatsappNumber`
- Links to: `https://wa.me/<number>?text=<greeting>`
- Fixed position bottom-right, green (#25D366)

---

## Architecture

### Tech Stack
- React 19, TypeScript, Vite, Wouter (routing)
- CSS: Tailwind v4 + custom CSS classes
- Icons: Lucide React
- No CSS-in-JS library — everything uses inline `style` props or Tailwind classes

### Data Flow
1. App fetches: `/api/website/settings`, `/api/website/pages`, `/api/website/popups`
2. Theme applied to CSS custom properties (HSL values)
3. Page slug resolved from URL via wouter `useLocation`
4. Sections parsed from `page.sections` JSON string
5. Each section rendered by `SectionRenderer` dispatcher

### URL Routing
- `/` → home page (slug "home", or first page if no home)
- `/<slug>` → any other page (e.g., `/about`, `/services`)
- Staff login link: `/erp/portal` (hardcoded, always visible)

---

## Section System (Page Builder)

Each page has a JSON array of sections. Every section has: `id`, `type`, `enabled` (boolean), `config` (object). The `SectionRenderer` dispatches by `type`.

### Available Section Types

#### 1. `header`
- Config: `showLogo` (boolean), `ctaLabel` (string), `ctaUrl` (string)
- Shows logo image or site title, navigation links to published pages, CTA button, staff login link
- Mobile: hamburger menu, desktop: horizontal nav
- Logo: `settings.logoUrl` resolved via `resolveAssetUrl()`

#### 2. `hero`
- Config: `heading` (string), `subheading` (string), `imageUrl` (string), `ctaLabel` (string), `ctaUrl` (string)
- Full-width section with gradient or background image overlay
- Dark text on image, primary-colored text on gradient
- Min height: 55vh

#### 3. `services`
- Config: `heading` (string), `items` (array of `{title, desc}`)
- Auto-fit grid, min 240px cards
- Cards have soft background, rounded corners

#### 4. `appointment` — THIS IS THE BOOKING SECTION (CRITICAL — see above)
- Config: `heading` (string), `subheading` (string)
- Multi-step form: details → test/package selection → payment → success/failure
- Supports category filtering on tests
- Sticky bottom bar showing selection count + total
- Shows WhatsApp QR code if phone configured
- Fallback to WhatsApp form if booking disabled

#### 5. `reviews`
- Config: `heading` (string), `items` (array of `{name, rating, text}`)
- 5-star display using Lucide Star icon
- Auto-fit grid, min 260px cards

#### 6. `contact`
- Config: `heading` (string), `mapEmbed` (string — iframe src), `showForm` (boolean)
- Left: address, phone, email with icons
- Right: either map iframe OR contact form (name, email/phone, message)
- Form is client-side only (no backend submission endpoint)

#### 7. `connect` (Social Media)
- Config: `heading` (string)
- Reads social links from `settings.socialLinks` (JSON string)
- Supports: facebook, instagram, twitter, youtube, linkedin
- Circular icon buttons, primary color background

#### 8. `subscribe`
- Config: `heading`, `subheading`, `placeholder`, `submitLabel`
- Email input + submit button
- Client-side only (no backend), shows "Thanks" on submit

#### 9. `faq`
- Lazy-loaded component
- Fetches `GET /api/website/faqs` dynamically
- Accordion-style FAQ list

#### 10. `gallery`
- Lazy-loaded component
- Fetches `GET /api/website/photos` dynamically
- Photo grid with lightbox

#### 11. `custom_html`
- Config: `html` (string)
- Renders arbitrary HTML (admin-only, XSS-safe via CSP)

#### 12. `footer`
- Config: `text` (string), `links` (array of `{label, url}`)
- Dark background, copyright text, footer links
- Default text: `© {year} {siteTitle}`

---

## Theme System

### Theme Application
Themes are applied via CSS custom properties on `:root`:
- `--site-primary`: HSL of primary color
- `--site-primary-fg`: white
- `--site-bg`: HSL of background color
- `--site-fg`: auto-calculated (dark on light bg, white on dark bg)
- `--site-muted`: `210 40% 96%`
- `--site-muted-fg`: `215 16% 47%`
- `--site-border`: `214 32% 91%`
- `--site-radius`: `10px`
- `--site-font`: loaded from Google Fonts dynamically

### Pre-built Themes (staff can pick from these)
1. **modern-clinical**: `#7c3aed` (violet) + `#06b6d4` (cyan) + `#ffffff`
2. **warm-care**: `#f59e0b` (amber) + `#84cc16` (lime) + `#fffbeb`
3. **trust-blue**: `#1e40af` (navy) + `#06b6d4` (cyan) + `#f8fafc`
4. **fresh-mint**: `#10b981` (mint) + `#fb7185` (coral) + `#f0fdfa`
5. **premium-dark**: `#fbbf24` (gold) + `#a855f7` (purple) + `#0f172a`
6. **minimal-mono**: `#111827` (black) + `#6b7280` (gray) + `#ffffff`

### Fonts Available
Inter, Roboto, Lato, Poppins, Open Sans, Montserrat, Source Sans Pro, Nunito, Merriweather, Playfair Display

### Button Styles
- `rounded`: radius 0.5rem
- `pill`: radius 9999px
- `square`: radius 0
- `soft`: radius 1rem

---

## CSS Utility Classes (Available Site-Wide)

These are defined in `index.css` and used across sections:

```css
.btn-primary      — primary color bg, white text, rounded, padding .65rem 1.15rem
.btn-outline      — transparent bg, border, same padding
.btn-rounded      — pill shape (9999px)
.btn-square       — no border radius
.section          — responsive padding (clamp)
.container-narrow — max-width 1100px, centered
.muted-bg         — light gray background
.h-display        — large heading (clamp 1.75–2.75rem, weight 800)
.h-section        — section heading (clamp 1.4–2rem, weight 700)
.subtle           — muted text color
.card-soft        — white bg, border, rounded, padding 1.25rem
.input-soft       — full-width input with border, rounded, padding
```

Responsive breakpoints:
- Mobile: `< 768px` — hamburger nav, stacked layouts
- Desktop: `≥ 768px` — horizontal nav, side-by-side layouts

---

## Site Settings Data Model

The site loads settings from `/api/website/settings`. Key fields:

```typescript
{
  siteTitle: string,
  tagline: string,
  about: string,
  contactEmail: string,
  contactPhone: string,
  whatsappNumber: string,
  whatsappEnabled: boolean,
  whatsappGreeting: string,
  address: string,
  logoUrl: string,
  faviconUrl: string,
  themeId: string,
  primaryColor: string,      // e.g., "#7c3aed"
  secondaryColor: string,
  accentColor: string,
  backgroundColor: string,   // e.g., "#ffffff"
  fontHeading: string,
  fontBody: string,
  buttonStyle: string,       // "rounded" | "pill" | "square" | "soft"
  isPublished: boolean,
  publishedRevision: number,
  // SEO
  seoMetaTitle: string,
  seoMetaDescription: string,
  seoKeywords: string,
  seoOgImage: string,
  // Analytics (validated against vendor format patterns)
  googleAnalyticsId: string,  // G-XXXXXXXXXX
  googleTagManagerId: string, // GTM-XXXXXXX
  metaPixelId: string,        // 123456789012345
  googleAdsenseId: string,    // ca-pub-XXXXXXXXXXXXXXXX
  // Social links (JSON string)
  socialLinks: string,        // {"facebook":"...","instagram":"..."}
}
```

---

## API Endpoints (Public, No Auth Required)

| Endpoint | Returns |
|----------|---------|
| `GET /api/website/settings` | SiteSettings object |
| `GET /api/website/pages` | `{ pages: Page[] }` |
| `GET /api/website/faqs` | `{ faqs: Faq[] }` |
| `GET /api/website/photos` | `{ photos: Photo[] }` |
| `GET /api/website/popups` | `{ popups: Popup[] }` |
| `GET /api/website/verify-preview?token=...` | `{ valid: boolean }` |
| `GET /api/public/booking/config` | `{ enabled, keyId, vipEnabled, gateway, payuMerchantKey }` |
| `GET /api/public/booking/tests` | `{ tests: TestItem[] }` |
| `GET /api/public/booking/packages` | `{ packages: PkgItem[] }` |
| `POST /api/public/booking/create-order` | `{ bookingRef, razorpayOrderId, amountPaise, keyId }` |
| `POST /api/public/booking/verify-payment` | `{ success, bookingRef }` |
| `POST /api/public/booking/payu-initiate` | `{ payuUrl, fields }` |

---

## SEO / Head Management

The `HeadManager` component updates `<head>` dynamically:
- `<title>`: `{pageTitle} | {siteTitle}`
- `<meta name="description">`
- Open Graph tags (title, description, image)
- Google Analytics 4, GTM, Meta Pixel scripts (with ID validation)
- Favicon link
- Facebook/Pinterest verification meta tags
- Custom head HTML (admin-only, rendered as-is)

---

## Popup System

- Popups fetched from API, filtered by page slug
- Trigger types: `time_delay` (seconds), `scroll` (%), `exit_intent`, `manual`
- Modal with backdrop, close button, optional CTA link
- Dismissed state stored in sessionStorage

---

## File Structure

```
clinic-site/src/
├── App.tsx           — Router, page view, preview mode
├── api.ts            — API client for public endpoints
├── config.ts         — BASE_URL, resolveAssetUrl()
├── theme.ts          — applyTheme(), buttonClass(), font loading
├── types.ts          — TypeScript types + parseSections()
├── head.tsx          — HeadManager (SEO, tracking scripts)
├── sections.tsx      — SectionRenderer dispatcher + built-in sections
├── widgets.tsx       — WhatsAppFab, PopupHost
├── index.css         — Tailwind import + all custom CSS classes
└── sections/
    ├── AppointmentSection.tsx  — Online booking (CRITICAL — DO NOT CHANGE)
    ├── ContactSection.tsx      — Contact info + map + form
    ├── FaqSection.tsx          — FAQ accordion
    ├── GallerySection.tsx      — Photo gallery
    └── CustomHtmlSection.tsx   — Raw HTML renderer
```

---

## What ChatGPT Should Do

1. **Create a stunning, modern professional design** for Care Diagnostics using the section system above.
2. **Keep ALL booking and payment code exactly as-is** — the Razorpay and PayU integration, the test/package catalog loading, the multi-step booking flow, time slot selection, and the WhatsApp fallback must remain unchanged.
3. **Use the existing section types** (header, hero, services, appointment, reviews, contact, connect, footer, etc.) — do not invent new section types unless they are purely presentational.
4. **Use the theme system** — CSS custom properties (`--site-primary`, `--site-bg`, etc.) and utility classes (`btn-primary`, `card-soft`, `section`, etc.) so the staff can still customize colors/fonts via the Website Builder.
5. **Make it responsive** — mobile-first, good on all screen sizes.
6. **Use the business details provided** throughout — address, phone, email in contact section, footer, etc.
7. **Keep the lazy-loaded sections pattern** for FAQ, Gallery, Contact, Custom HTML.
8. **Keep the popup system intact**.
9. **Keep the WhatsApp floating button**.
10. **Make the hero impactful** for a diagnostic center — trust, care, accuracy, modern technology.
11. **Add professional imagery placeholders** — staff will upload real photos via the Photo Library.
12. **Services section should list realistic diagnostic services** — pathology, ultrasound, X-ray, CT, MRI, health packages, home collection, same-day reports.
13. **Reviews section should have realistic placeholder testimonials**.
14. **Contact section should embed a Google Maps iframe** with the Deoghar location.

## What ChatGPT Should NOT Do

1. Do not change any API endpoint URLs.
2. Do not modify the Razorpay checkout script loading or config.
3. Do not modify the PayU form submission logic.
4. Do not change the booking step flow or data structures.
5. Do not remove or rename existing section types.
6. Do not change the `resolveAssetUrl()` or `api.ts` patterns.
7. Do not change the `HeadManager` or tracking ID validation.
8. Do not change the `buttonClass()` or `applyTheme()` functions.
9. Do not remove the staff login link (`/erp/portal`).
10. Do not change the preview token system.
