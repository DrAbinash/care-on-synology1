# Phased Deployment Strategy

## Current State
- Production: Reserved VM (always-on for node-cron schedulers)
- URL layout: / = clinic-site, /erp = diagnostic-erp, /api = api-server
- Database: PostgreSQL on Replit

## Deployment Phases

### Phase A: Pre-Deploy Validation (DONE)
- [x] All new endpoints return 401 for unauthenticated requests
- [x] Staff-only endpoints require `requireStaffAuth`
- [x] No `/orders` permission gates on radiology routes
- [x] Frontend typecheck passes
- [x] Backend typecheck passes

### Phase B: Database Migration
```sql
-- Ensure enterprise tables exist (from schema migration)
-- radiologist_performance_stats, critical_findings_alerts,
-- ai_server_health_log, pacs_archive_lifecycle, watchdog_status, ris_sync_status
-- All already exist in the schema
```

### Phase C: Backend Deploy
1. Deploy api-server changes first (new endpoints are additive)
2. Verify `/api/radiology/archive-lifecycle` returns empty array (no data yet)
3. Verify `/api/radiology/watchdog` returns empty services list
4. Verify `/api/radiology/ai-inference-config` returns defaults

### Phase D: Frontend Deploy
1. Deploy diagnostic-erp build (new pages are lazy-loaded)
2. Sidebar auto-shows new menu items (no permission gates)
3. Users see Archive Lifecycle, Watchdog, GPU Inference in Radiology group

### Phase E: Seed Data
- Insert sample watchdog services into `watchdog_status` for display
- Run first archive lifecycle scan to populate `pacs_archive_lifecycle`
- Seed `radiologist_performance_stats` with today's baseline

### Phase F: Background Jobs
- Enable `ENABLE_SCHEDULERS=1` on production
- Archive lifecycle cron: nightly at 2 AM
- Performance stats cron: daily at 6 AM
- AI health ping cron: every 5 minutes
- Watchdog monitor: every 1 minute

### Rollback Plan
- Frontend: revert build to previous artifact
- Backend: endpoints are additive; no breaking changes
- Database: tables are new; no migration risk
