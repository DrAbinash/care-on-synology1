# Care Diagnostics ERP — Zero-Touch Deployment Guide

## TL;DR — Every future deployment is exactly two commands

```bash
git pull
docker compose up -d --build
```

Nothing else is ever required. Schema migrations run automatically.

---

## How it works

### Startup order (enforced by `docker-compose depends_on`)

```
care-db (PostgreSQL)
    │  healthcheck: pg_isready (every 5s, up to 30 retries)
    ▼
care-db-patch-v2  ← THE ONLY SCHEMA MIGRATION STEP
    │  Runs docker/db-patch-entrypoint.sh
    │  Exits 0 on success, non-zero on any failure
    │  condition: service_completed_successfully
    ▼
care-api  (Express.js)
    │  Only starts after care-db-patch-v2 exits 0
    │  healthcheck: GET /api/health/schema (every 10s, up to 15 retries)
    │  condition: service_healthy
    ▼
care-web  (nginx)
    Only starts after care-api passes schema health check
```

If **any step fails**, everything downstream does NOT start. You will never have
an API running against an old schema.

---

### What `care-db-patch-v2` does (automatically, on every deployment)

**Step 1 — Wait for PostgreSQL**
Polls `pg_isready` every 2 seconds. Fails after 60 seconds.

**Step 2 — Bootstrap migration tracking**
Creates `drizzle.__drizzle_migrations` and `public.schema_migrations_log` tables.
Both are idempotent — safe to run when they already exist.

**Step 3 — Apply Drizzle migrations (auto-detected)**
Reads `lib/db/drizzle/meta/_journal.json` and applies every migration in journal
order. Skips migrations already in `drizzle.__drizzle_migrations` by SHA-256 hash.

**No hardcoded list.** Adding a new Drizzle migration file and updating the journal
is all that is needed — it will be applied on the next deployment automatically.

**Step 4 — Apply feature migrations (auto-discovered)**
Scans `migrations/*.sql` in alphabetical order. Applies files that haven't been
recorded in `schema_migrations_log`. Skips already-applied files by SHA-256 hash.

**No registration required.** Drop a new `.sql` file in `migrations/` and it will
be applied on the next deployment.

**Step 5 — Schema verification**
Checks that critical columns exist after all migrations run. If any column is
missing, the script exits non-zero → `care-api` never starts → `care-web` never
starts. You get a hard failure instead of a silent runtime error.

Columns checked:
- `radiology_worklist.ai_feedback` (caused "column does not exist" in prod)
- `radiology_worklist.source_pacs`
- `radiology_worklist.ai_draft_status`
- `clinic_settings.ollama_enabled`
- `clinic_settings.active_payment_gateway`
- `clinic_settings.icici_enabled`
- `bills.client_ref`
- `orders.client_ref`

**Step 6 — Schema fingerprint**
Records deployment metadata in `schema_deploy_state`:
- `db_patch_ok = 'true'`
- `total_migrations = N`
- `patch_version = YYYYMMDDHHMMSS`

---

### What `care-api` does on startup

The API's `runStartupMigrations()` function applies a second set of idempotent
`ADD COLUMN IF NOT EXISTS` patches (belt-and-suspenders). These are non-fatal
because `care-db-patch-v2` already guaranteed the schema.

The API exposes two health endpoints:

```
GET /health
→ 200 { ok: true }  always (liveness check)

GET /api/health/schema
→ 200 { ok: true, state: { db_patch_ok, total_migrations, patch_version } }
→ 503 { ok: false, error: "...", missing: [...] }  if schema is behind
```

Docker uses `/api/health/schema` as the readiness probe before allowing
`care-web` to start.

---

## Adding new migrations

### New Drizzle migration

```bash
# On your development machine:
cd lib/db
pnpm drizzle-kit generate

# This creates:
#   lib/db/drizzle/0006_your_description.sql
#   (and updates meta/_journal.json automatically)

git add lib/db/drizzle/0006_your_description.sql lib/db/drizzle/meta/_journal.json
git commit -m "db: add migration 0006_your_description"
git push
```

On the next `docker compose up -d --build`, the migration is applied automatically.

### New feature migration (ADD COLUMN, seed data, indexes)

```bash
# Create a new file in migrations/ with a descriptive name
# Prefix with a number to control order (alphabetical sort)
cat > migrations/0010_add_referral_pacs_profile.sql << 'SQL'
-- Adds pacs_network_profile column that was missing in production
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS pacs_network_profile TEXT;
SQL

git add migrations/0010_add_referral_pacs_profile.sql
git commit -m "db: add pacs_network_profile column migration"
git push
```

On the next `docker compose up -d --build`, the migration is applied automatically.
No other file needs to be changed.

---

## Deployment commands

### Normal deployment (code + schema changes)

```bash
# SSH into Synology NAS
ssh admin@192.168.1.137

# Navigate to project
cd /volume1/care-erp  # or wherever the repo is

# Pull and deploy
git pull
docker compose up -d --build
```

### Monitor the deployment

```bash
# Watch migration logs (runs in db-patch-v2)
docker compose logs -f care-db-patch-v2

# Watch API startup
docker compose logs -f care-api --tail 100

# Check schema health after deployment
curl http://localhost:8080/api/health/schema
# → { "ok": true, "state": { "db_patch_ok": "true", "total_migrations": "42", ... } }

# Check all services
docker compose ps
```

### If a migration fails

```bash
# See the exact error
docker compose logs care-db-patch-v2

# care-api will NOT have started — confirm:
docker compose ps
# care-db-patch-v2   Exited (1)   ← migration failed
# care-api           Created      ← never started

# Fix the failing SQL file, then redeploy:
git pull
docker compose up -d --build
```

### Rollback (if needed)

```bash
# Rollback to previous image (images are cached by Docker)
docker compose down
git checkout HEAD~1  # or specific tag
docker compose up -d --build

# If data was changed: restore from the daily backup
# Backup location: configured in docker-compose OBJECT_STORAGE_DIR
```

---

## Production verification checklist

After every deployment, verify:

```bash
# 1. All containers running
docker compose ps

# 2. Schema is current
curl http://localhost:8080/api/health/schema

# 3. API is responding
curl http://localhost:8080/health

# 4. ERP login works
curl -s http://localhost:8888/erp/ | grep -q "Care Diagnostics" && echo "ERP OK"

# 5. Migration log (how many applied)
docker compose logs care-db-patch-v2 | tail -20
```

Expected output:
```
✓ Database connected
✓ Migration tracking ready
▸ [skip] 0000_dear_forge (already applied)
▸ [skip] 0001_warm_leopardon (already applied)
...
✓ Drizzle migrations: 0 applied, 6 already current
✓ Feature migrations: 0 applied, 9 already current
✓ Schema fingerprint recorded
✓ Schema verification passed — all critical columns present
✓ All migrations complete — API may start
```

---

## Environment variables (.env)

Required — deployment fails if missing or placeholder:

```bash
JWT_SECRET=<64-char random string>      # openssl rand -hex 32
SESSION_SECRET=<64-char random string>  # openssl rand -hex 32
ICICI_SECRET_KEY=<from ICICI dashboard>
```

Optional but important:

```bash
DB_USER=erp
DB_PASSWORD=changeme        # change in production
DB_NAME=diagnostic_erp
DB_HOST_PORT=5400           # host port for PostgreSQL (access from Windows PC)
HOST_PORT=8888              # host port for the ERP web interface
PUBLIC_BASE_URL=https://caredeoghar.com
ORTHANC_URL=http://192.168.1.137:8042
ENABLE_SCHEDULERS=1         # enable cron jobs (billing, PACS watchdog, etc.)
```

---

## Architecture overview

```
Synology NAS (192.168.1.137)
├── care-db          PostgreSQL 16           port 5400 (host)
├── care-db-patch-v2 Migration runner        (runs once per deploy, exits)
├── care-api         Express.js API          port 8080 (internal)
└── care-web         nginx (SPA + proxy)     port 8888 (host → Cloudflare)

Windows AI PC (192.168.1.250)
└── Ollama           LLM inference           port 11434 (LAN only, NOT public)

Cloudflare Tunnel
├── caredeoghar.com       → Synology:8888 (ERP)
└── webui.caredeoghar.com → Synology:3000 (Open WebUI)

Orthanc PACS:  http://192.168.1.137:8042
OHIF Viewer:   http://192.168.1.137:3010
```

---

## What NOT to do

| Don't | Why |
|---|---|
| `pnpm db:push` or `drizzle-kit push` in production | Not needed. db-patch-v2 handles it. |
| `pnpm db:migrate` manually | Not needed. db-patch-v2 handles it. |
| Edit hardcoded migration lists | Not needed. Migration detection is automatic. |
| `docker compose down -v` | Deletes the database volume. Use `docker compose down` only. |
| Touch db-patch-entrypoint.sh for new migrations | Not needed. Just add .sql files. |

