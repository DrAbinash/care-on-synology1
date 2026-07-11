# Website Component Map

**Status:** Reference document. Maps every redesigned component to its old/new class names and confirms protected-boundary status per file.

---

## sections.tsx (core section library)

| Component | Old root class | New root class | Protected logic? |
|---|---|---|---|
| HeaderSection | `site-header` | `cd-header` | No |
| HeroSection | `hero-section` | `cd-hero` | No |
| StatsSection | `stats-strip` | `cd-stats-strip` | No |
| ServicesSection | `section` | `cd-section cd-section-light` | No |
| WhyChooseUsSection | `section muted-bg` | `cd-section cd-section-light` | No |
| TechnologySection | `section` | `cd-section cd-section-light` | No |
| HealthPackagesSection | `section muted-bg` | `cd-section cd-section-light` | No |
| ReviewsSection | `section muted-bg` | `cd-section cd-section-light` | No |
| ConnectSection | `section` | `cd-section cd-section-light` | No |
| SubscribeSection | `section` | `cd-section cd-section-navy` | No |
| FooterSection | `premium-footer` | `cd-footer` | No |

## sections/ (standalone files)

| File | Old root class | New root class | Protected logic? |
|---|---|---|---|
| FaqSection.tsx | `section` | `cd-section cd-section-light` | No |
| ContactSection.tsx | `section` | `cd-section cd-section-light` | No |
| GallerySection.tsx | `section muted-bg` | `cd-section cd-section-light` | No |
| CustomHtmlSection.tsx | `section` | `cd-section cd-section-light` | No — only wrapper class changed, DOMPurify sanitization untouched |
| **AppointmentSection.tsx** | `section` | `cd-section cd-section-light` | **Yes** — `handleICICI()`, VIP surcharge calculation, all gateway handlers (lines 1-379 of the file have zero diff vs. pre-redesign) |

## pages/

| File | Status | Protected logic? |
|---|---|---|
| book.tsx | Restyled (commit `caeb8e15`) | **Yes** — second `handleICICI()` implementation, VIP `vipCharge` calculation, all gateway handlers verified byte-identical |
| policies.tsx | Restyled | No |
| not-found.tsx | Restyled | No |
| scan-mobile.tsx | **Not touched** — self-contained QR-scan utility, no shared design-system classes used, no payment logic; left as-is to avoid destabilizing a working camera flow for a cosmetic-only change | No |

## App-level files

| File | What changed | Protected logic? |
|---|---|---|
| App.tsx | 404/error/loading/preview states restyled; structured data extended (`sameAs`, `priceRange`) | No |
| widgets.tsx | WhatsAppFab, PopupHost visual classes only | No — trigger logic, sessionStorage dismissal, safe-URL validation untouched |
| head.tsx | Added Twitter Card tags + canonical URL (additive only) | No — existing tracking-ID validation and XSS-safe injection untouched |
| theme.ts | Untouched | No |
| index.css | Extended with `~700` new lines of `cd-*` utility classes; original `--site-*` variables and their consumers (theme.ts) unchanged | No |

## New CSS Token Reference

| Old token | New equivalent | Notes |
|---|---|---|
| `hsl(var(--site-primary))` (in new components) | `hsl(var(--cd-teal))` or `hsl(var(--cd-navy))` | Context-dependent; `--site-primary` still works and still drives admin-configured branding where originally wired |
| `.section` | `.cd-section` | Adds responsive padding (5rem mobile / 7.5rem desktop) |
| `.card-soft` | `.cd-card` | Adds hover lift + scan-line sweep on hover |
| `.h-section` | `.cd-display .cd-h2` | Fraunces display font, new type scale |
| `.subtle` | `.cd-section-sub` | Same role, new color token |
| `.input-soft` | Form-specific classes (`.cd-appt-input`, `.cd-contact-form input`, etc.) | No longer one generic class — each form context has its own scoped input style |
| `.btn-primary` | `.cd-btn-primary` | Amber CTA, scale+shadow hover instead of color-shift |

## Protected-File Verification Method (for future reference)

For both `book.tsx` and `AppointmentSection.tsx`, the verification was content-based (regex-extracting each handler function and diffing its body directly), not line-number-based, since line numbers shift as surrounding JSX changes. Anyone modifying these files in the future should use the same method:

```bash
# Extract a function body and diff against the committed version
git show HEAD:path/to/file.tsx | sed -n '/^async function handleICICI/,/^}/p' > /tmp/before.txt
sed -n '/^async function handleICICI/,/^}/p' path/to/file.tsx > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

Functions that must always diff empty against any prior commit unless a deliberate, flagged backend-contract change is being made: `handleICICI`, `handlePay` (gateway dispatch), `handlePayU`, `handlePhonePe`, `handleBharatPe`, `handleQrPay`, `checkQrPayment`, `handleRazorpay`, and (in `book.tsx` specifically) the `vipCharge` useMemo block.
