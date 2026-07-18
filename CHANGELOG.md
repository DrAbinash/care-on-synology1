# Changelog

Notable, reviewable changes to CARE ERP. Newest first.

## [Unreleased]

### Radiology AI Platform — Phase P0 (Foundation) — 2026-07-18

Backend foundation for the Radiology AI Platform (gates G1–G3 of
`docs/architecture/radiology-ai/V1.1_IMPLEMENTATION_CONSTITUTION.md`). **No clinical-workflow change,
no radiologist-facing UI, no AI features** — this phase only strengthens the backend so later AI phases
have a reliable foundation.

**Added**
- **Canonical Study crosswalk** (`canonical_study` table + `lib/db/src/schema/canonicalStudy.ts`) keyed on
  `studyInstanceUID`, backfilled from `radiology_studies`. (G3)
- **Server-side study-id resolution** (`artifacts/api-server/src/lib/canonicalStudy.ts`): `POST /ai-jobs`
  now resolves/validates the study server-side and accepts the canonical `studyInstanceUid`; client-supplied
  ids are never trusted verbatim. (G3)
- **`ai_job_queue.study_id → radiology_studies.id` foreign key** (Drizzle `.references()` + a `NOT VALID`
  migration). (G3)
- **Grounding CI** (`scripts/grounding-check.cjs` + `scripts/grounding.manifest.json` + vitest gate):
  mechanically validates that documentation's table/column/function claims match the code; wired into
  `build` and `pnpm test` so the build fails on documentation↔code drift. (G1)
- **Exact-endpoint egress allowlist** via `AI_EGRESS_ALLOWLIST` (authoritative when set, even in LAN mode). (G2)
- Migration `migrations/add_canonical_study_crosswalk.sql` (idempotent, forward/backward compatible, `NOT VALID` FK).
- Docs: `P0_IMPLEMENTATION_REPORT.md`, `IMPLEMENTATION_TRACKER.md`, `ARCHITECTURE_CHECKLIST.md`, `P0_MIGRATION_GUIDE.md`.

**Fixed (security — G2)**
- **SSRF guard** (`radiologyOllama.ts`): the `100.64.0.0/10` CGNAT/Tailscale tailnet range is now blocked
  outside Local/LAN mode (previously reachable), cloud-metadata hosts (`169.254.169.254`, `metadata.google.internal`)
  are blocked unconditionally (even in Local/LAN mode), and IPv6 unique-local is covered.
- **Audit-log retention** (`cron.ts`): retention is now **archive-before-purge in batches**, deleting only the
  ids durably written to a checksummed archive — eliminating the prior path that archived at most 5,000 rows
  but deleted every row past the cutoff (unarchived data loss on any backlog > 5,000).

**Verification**
- `pnpm typecheck:libs` ✅, `pnpm --filter @workspace/api-server typecheck` ✅, `pnpm test` → 2513 pass
  (7 pre-existing test files error only on missing `DATABASE_URL`), grounding + migration-order checks ✅.
