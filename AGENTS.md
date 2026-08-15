# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
Care Diagnostics — a pnpm monorepo for an on-premise diagnostic-center / radiology ERP.
Core services for local development (the minimum to exercise the product end to end):

| Service | Package | Port | Run (dev) |
| --- | --- | --- | --- |
| PostgreSQL 16 | (system) | 5432 | `sudo pg_ctlcluster 16 main start` |
| API server | `@workspace/api-server` | 8080 | `pnpm --filter @workspace/api-server run dev` |
| Diagnostic ERP (Vite SPA) | `@workspace/diagnostic-erp` | 5173 | `pnpm --filter @workspace/diagnostic-erp run dev` |

The ERP proxies `/api` → `http://localhost:8080` (see `artifacts/diagnostic-erp/vite.config.ts`), so start the API first. Everything else (PACS/Orthanc, OHIF, AI providers, WhatsApp, payments, LAN hardware bridges, the mobile app, clinic-site) is optional and degrades gracefully when unconfigured.

### Non-obvious gotchas
- **The API needs env vars EXPORTED into the shell, not just present in `.env`.** The server is bundled with esbuild and evaluates the `@workspace/db` module (which reads `DATABASE_URL`) before `dotenv` loads the root `.env`, so a bare `.env` alone makes it crash with `DATABASE_URL must be set`. Launch it with the env sourced, e.g.:
  `set -a; source /workspace/.env; set +a; pnpm --filter @workspace/api-server run dev`
  (`pnpm db:push` does NOT need this — `lib/db/drizzle.config.ts` loads dotenv before it reads the value.)
- **Do not use the root `pnpm dev` as-is.** It also runs `@workspace/super-admin-portal`, which lives in `__super_admin_quarantine/` and is NOT in the pnpm workspace, so that leg errors out. Run `api-server` and `diagnostic-erp` individually (commands above), or use `pnpm dev:erp-local` to start only those two with root `.env` exported into both processes.
- **Run `pnpm dev:doctor` before debugging local startup.** It checks Node/pnpm, `DATABASE_URL`, PostgreSQL reachability, and the required API/ERP dev scripts.
- **Schedulers now have a worker entrypoint.** `pnpm --filter @workspace/api-server run worker:dev` starts cron/integration schedulers without serving HTTP; keep `ENABLE_SCHEDULERS` enabled on only one API/worker process.
- **PostgreSQL is not auto-started** on boot; start the cluster with `sudo pg_ctlcluster 16 main start`. Local dev DB: database `diagnostic_erp`, role `erp`. `DATABASE_URL` lives in the gitignored root `.env`.
- **Apply schema with `pnpm db:push`** (Drizzle) after the DB is up. On first API boot it seeds a bootstrap admin and logs a harmless warning about `pacs_settings` ON CONFLICT / `system_database_identity` (these come from `db:push` not running the full Docker migration+verify pipeline). `GET /api/health/schema` returns 503 for the same reason; `GET /health` and `GET /api/healthz` return 200 and are the useful liveness checks.

### Logging in
A bootstrap super-admin is auto-seeded when the `users` table is empty: username `abinashsingh@gmail.com`, PIN `1234`. Staff login endpoint is `POST /api/portal/staff-login` `{ "username", "pin" }`; in the UI use the Staff Login form at `/login`.

### Lint / test / build
- Tests: `pnpm test` (Vitest). ~4800 pass. Remaining failures are environmental, not code: `migration-bootstrap-smoke`, `reportPdfGenerator.letterpad` (needs the `pdftotext` binary), and `ai/onArrivalSchedule.smoke` (dev DB built by `db:push` lacks `ai_scheduler_config.draft_timing`). The old `uuid`/`gaxios` ESM cycle is fixed — `lib/objectStorage.ts` now imports `@google-cloud/storage` lazily.
- **Request-level route tests need a DB.** `*.request.test.ts` files boot the real API router over supertest via `src/testSupport/apiTestApp.ts` and hit PostgreSQL. They `describe.skipIf(!hasDatabaseUrl())`, so they silently skip unless `DATABASE_URL` is exported — start Postgres and `set -a; source /workspace/.env; set +a` before `pnpm test` if you need them to actually run. Fixtures in `src/testSupport/billingFixtures.ts` create marker-scoped rows and clean up after themselves.
- **Prefer request-level tests over source-text greps for route behaviour.** Several billing tests assert on file contents (`readFileSync` + `toContain`). Those cannot catch runtime faults: the grep test for `POST /api/billing/save` stayed green while the endpoint returned HTTP 500 on every call (`TypeError: Cannot set property query` — Express 5 makes `req.query` getter-only). Add or extend a `*.request.test.ts` when you touch a route.
- Typecheck: `pnpm typecheck`. `api-server` and the shared `lib/*` are clean. The React frontends (`diagnostic-erp`, `clinic-site`) fail typecheck only in shared UI (`components/ui/calendar.tsx`, `spinner.tsx`) due to a duplicate `@types/react` in the tree — pre-existing and does not affect Vite dev/build.
- There is no ESLint config; formatting is Prettier (`prettier`). Full build is `pnpm build` (runs grounding-check → typecheck → per-package build).
