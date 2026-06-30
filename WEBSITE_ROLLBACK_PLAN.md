# Website Rollback Plan

**Status:** Reference document for reverting any or all of the modernization work.

---

## Git Restore Point

Tag: checkpoint/before-website-modernization
Commit: 869eace2

This tag marks the exact state of the entire repository immediately before any website modernization work began.

## Full Rollback (revert everything)

```bash
git checkout feature/website-login-redirection
git revert --no-commit 869eace2..HEAD -- artifacts/clinic-site/
git commit -m "revert: roll back website modernization to checkpoint/before-website-modernization"
```

This reverts only the artifacts/clinic-site/ directory — no backend code, no other ERP module, no database changes are touched by this rollback, since none were made by the modernization work in the first place.

## Partial Rollback (revert one commit)

Each modernization commit is scoped to a specific area, so a partial rollback is straightforward.

| Commit | Scope | Revert command |
|---|---|---|
| a1d696cb | Core section library, sections.tsx | git revert a1d696cb |
| 32b6585a | FAQ, Contact, Gallery, CustomHtml | git revert 32b6585a |
| 22f0f165 | AppointmentSection.tsx, homepage booking | git revert 22f0f165 |
| caeb8e15 | book.tsx, standalone booking page | git revert caeb8e15 |
| c9fb129e | App shell states, widgets, SEO | git revert c9fb129e |

Reverting 22f0f165 or caeb8e15 individually is the lowest-risk partial rollback if any payment-flow-adjacent visual regression is suspected — both commits are scoped to exactly one file plus index.css additions, and both have been diff-verified to touch zero protected logic.

## Why Rollback Risk Is Low

1. No backend changes. Nothing in artifacts/api-server/ was touched. The ICICI payment routes, all gateway integrations, and every API contract are exactly as they were before this work began.
2. No database changes. No migrations were created.
3. No removed functionality. Every interactive feature, including the booking flow, VIP surcharge, payment gateways, FAQ accordion, gallery lightbox, popup engine, and contact form, was preserved — only visual presentation changed.
4. CSS is additive. The new cd- classes were appended to index.css; the original site- variable system and its consumers in theme.ts were never removed, only extended. A rollback of index.css alone, without reverting the .tsx files, would not break anything currently using site- variables, though it would leave the new cd- classes referenced by unreverted components without their styles — for this reason, always revert .tsx and .css changes together, in the commit groupings above, not separately.

## Emergency Note on Payment Gateway Configuration

ICICI's enable/disable is an existing admin-configurable setting (the gateway field in Online Booking config, stored in clinic_settings) — entirely unrelated to and unaffected by this modernization work. No code change is needed to disable ICICI specifically if a configuration-level issue is suspected.

If a genuine code-level issue is suspected, not just a configuration issue, revert commit 22f0f165 and/or caeb8e15 per the table above before investigating further — both are single-file-scoped and known to compile cleanly both before and after.

## Verification After Any Rollback

```bash
cd artifacts/clinic-site
npx tsc -p tsconfig.json --noEmit
npx vite build --config vite.config.ts
```

Both must complete with zero errors. Then manually confirm: homepage loads, the /book page loads, the booking flow reaches the payment-method screen, and handleICICI's network call still targets /api/public/booking/icici-initiate — check browser dev tools Network tab during a test booking, or grep the built JS bundle for that string.
