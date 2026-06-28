# Versioning Architecture — Care Diagnostics ERP
## Semantic Versioning · Build Numbers · Release Names · Git Integration

---

## Version Format

```
Care Diagnostics ERP  v2.0.0  build 128  "Radiology Stability"
                       │       │           │
                       │       │           └── Optional release name (manual)
                       │       └── Auto-incremented on every deployment
                       └── Major.Minor.Patch (changed manually)
```

### When to change each component

| Component | Changed by | When |
|---|---|---|
| Major | Dr. Abinash manually | Breaking changes, platform redesign |
| Minor | Dr. Abinash manually | New modules (radiology, PACS, AI), major features |
| Patch | Dr. Abinash manually | Bug fixes, UI improvements, minor features |
| Build | **Automatically** | Every `docker compose up --build` |
| Release Name | Dr. Abinash optionally | Named milestones ("Radiology Stability", "PACS Launch") |

---

## `version.json`

The single source of truth for version metadata. Committed to git.

```json
{
  "version": "2.0.0",
  "releaseName": "Radiology Stability",
  "buildNumber": 42,
  "notes": "Release notes for this version."
}
```

The build number is auto-incremented by `scripts/bump-build.cjs` on every deployment. The version and release name are changed manually before committing.

---

## How Version Flows Through the System

```
version.json (committed to git)
     │
     ├── scripts/bump-build.cjs (run by deploy-synology.sh)
     │   └── increments buildNumber, exports ERP_VERSION, BUILD_NUMBER
     │
     ├── docker-compose build args
     │   └── ERP_VERSION, BUILD_NUMBER, RELEASE_NAME, GIT_COMMIT,
     │       GIT_BRANCH, GIT_TAG, BUILD_DATE
     │
     ├── Dockerfile ARG → ENV (baked into api image)
     │   └── Available as process.env.ERP_VERSION etc. at runtime
     │
     ├── version.json copied into /app/version.json in api image
     │
     ├── db-patch-v2 → schema_deploy_state table in PostgreSQL
     │   └── erp_version, build_number, git_commit, git_branch, git_tag…
     │
     └── GET /api/system/version
         └── reads env vars + version.json + schema_deploy_state
```

---

## Changing the Version

### Bump version only (no build number change)

```bash
# On any machine with Node.js:
node scripts/bump-build.cjs --set 2.1.0
git add version.json
git commit -m "version: bump to 2.1.0"
git push

# Tag the release:
git tag -a v2.1.0 -m "Version 2.1.0 — New feature"
git push origin v2.1.0
```

### Set release name

Edit `version.json` directly:
```json
{
  "version": "2.1.0",
  "releaseName": "PACS Launch",
  "buildNumber": 128
}
```

### Full release workflow

```bash
# 1. Update version and release name in version.json
node scripts/bump-build.cjs --set 2.1.0
# (edit releaseName and notes in version.json)
git add version.json
git commit -m "release: v2.1.0 PACS Launch"

# 2. Tag
git tag -a v2.1.0 -m "Care ERP v2.1.0 — PACS Launch"

# 3. Push
git push && git push origin v2.1.0

# 4. Deploy (build number auto-increments)
./deploy-synology.sh
```

---

## API Endpoints

### `GET /api/system/version`

Full version information. Used by Settings → About.

```json
{
  "name": "Care Diagnostics ERP",
  "version": "2.0.0",
  "build": 42,
  "releaseName": "Radiology Stability",
  "gitCommit": "b63f4b92...",
  "gitBranch": "feature/website-login-redirection",
  "gitTag": "v2.0.0",
  "buildDate": "2026-06-28T12:00:00Z",
  "deployedAt": "2026-06-28T12:05:00Z",
  "pgVersion": "PostgreSQL 16.x",
  "drizzleMigrations": "6",
  "featureMigrations": "9",
  "schemaVerifyStatus": "full_pass",
  "liveTableCount": "95",
  "nodeVersion": "v22.x",
  "environment": "production",
  "uptime": 3600,
  "ts": "2026-06-28T13:00:00Z"
}
```

### `GET /api/system/version/short`

Lightweight response for polling / login footer.

```json
{
  "version": "2.0.0",
  "build": 42,
  "release": "Radiology Stability",
  "commit": "b63f4b92"
}
```

### `GET /health`

```json
{
  "ok": true,
  "version": "2.0.0",
  "build": "42",
  "commit": "b63f4b92",
  "ts": "2026-06-28T13:00:00Z"
}
```

### `GET /api/health/schema`

```json
{
  "ok": true,
  "version": "2.0.0",
  "build": "42",
  "release": "Radiology Stability",
  "commit": "b63f4b92",
  "state": { "db_patch_ok": "true", "schema_verify_status": "full_pass", ... },
  "migrationCounts": { "drizzle": 6, "feature": 9 }
}
```

---

## UI Surfaces

| Location | Content |
|---|---|
| Settings → About / Version | Full version panel with all metadata |
| Login page footer | Minimal: `Care ERP v2.0.0 · build 42 · b63f4b92` |
| `/api/system/version` | Full JSON for integrations |
| `/api/health/schema` | Version + schema status combined |

---

## `schema_deploy_state` Version Keys

| Key | Value |
|---|---|
| `erp_version` | `2.0.0` |
| `build_number` | `42` |
| `release_name` | `Radiology Stability` |
| `git_commit` | `b63f4b92...` |
| `git_branch` | `feature/website-login-redirection` |
| `git_tag` | `v2.0.0` |
| `build_date` | `2026-06-28T12:00:00Z` |

---

## Rollback

```bash
# 1. Find the previous working commit
git log --oneline -10

# 2. Roll back
docker compose down
git checkout <previous-commit-or-tag>
docker compose up -d --build

# The build number will increment again (one step forward in the sequence).
# The version will match what was in version.json at that commit.

# 3. Verify
curl http://localhost:8080/api/system/version | python3 -m json.tool
```

---

_Care Diagnostics ERP · Hospital RIS/PACS · Deoghar, Jharkhand_
