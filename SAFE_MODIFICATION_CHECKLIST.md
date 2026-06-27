# Production Modification Safety Checklist

**System:** Care-on-Synology Hospital ERP  
**Purpose:** Prevent breaking critical systems during enhancements  
**Read Time:** 5 minutes  

---

## PRE-MODIFICATION CHECKLIST

Before making ANY changes to production code:

### 1. Git Checkpoint ✅
```bash
# Current state
git status  # Ensure clean working tree

# Tag current release
git tag -a checkpoint/before-mri-enhancement-v1 \
  -m "Safe restore point before MRI enhancement"

# Verify tag created
git tag -l | grep checkpoint
```

### 2. Database Backup ✅
```bash
# Inside Synology container
docker exec postgres pg_dump -U postgres care_erp \
  > /backup/care_erp_$(date +%Y%m%d_%H%M%S).sql

# Verify backup file exists and has size > 100MB
ls -lh /backup/*.sql | tail -1

# Test restore capability (optional, ~5 min)
# docker exec postgres psql -U postgres < /backup/backup.sql
```

### 3. Test Environment ✅
```bash
# Create feature branch
git checkout -b feature/mri-protocol-enhancement

# Install dependencies
pnpm install

# Run TypeScript check
npm run typecheck

# Run existing tests
npm run test

# Note: Don't push to main until tested
```

### 4. Read Protected Files ✅
- [ ] Read: `FINANCIAL_FREEZE_RULEBOOK.md`
- [ ] Read: `FINANCIAL_CODE_REVIEW_CHECKLIST.md`
- [ ] Understand: What you CAN'T touch (billing, accounting)
- [ ] Read: `PACS_DICOM_INTEGRATION.md` if touching PACS

### 5. System Health Check ✅
```bash
# Verify critical systems running
curl http://localhost:8080/api/health                 # API
curl http://localhost:4242/dicom-web/studies         # Orthanc
curl http://localhost:5432 # PostgreSQL

# Verify status
# All should return 200 OK or connection success
```

---

## MODIFICATION RULES

### ✅ SAFE TO MODIFY

These are low-risk, isolated components:

**1. Add New Radiology Templates**
```typescript
// File: artifacts/api-server/src/routes/radiology-report-generator.ts
// ✅ SAFE: Additive change, no schema change required

export const RADIOLOGY_TEMPLATES: Record<string, ReportTemplate> = {
  // ... existing templates
  
  MRI_BRAIN_NEURO_PROTOCOL: {  // NEW
    templateId: "MRI_BRAIN_NEURO_PROTOCOL",
    modality: "MRI",
    studyName: "MRI BRAIN - NEURO PROTOCOL",
    technique: "...",
    sections: ["...", "..."]
  }
};
```

**2. Add Database Schema (New Tables)**
```typescript
// File: lib/db/src/schema/mriProtocolSpecs.ts
// ✅ SAFE: New file, no existing data migration

export const mriProtocolSpecsTable = pgTable("mri_protocol_specs", {
  id: serial("id").primaryKey(),
  protocolName: text("protocol_name"),
  // ... new columns
});
```

**3. Add API Route (New Endpoint)**
```typescript
// File: artifacts/api-server/src/routes/radiologyMeasurements.ts
// ✅ SAFE: New endpoint, no existing code change

router.post("/measurements", requireStaffAuth, async (req, res) => {
  // new handler
});
```

**4. Add React Component (New Feature)**
```typescript
// File: artifacts/diagnostic-erp/src/components/MRIBrainMeasurements.tsx
// ✅ SAFE: New file, imported only where used

export const MRIBrainMeasurements = () => {
  // new component
};
```

**5. Update AI Prompts Library**
```typescript
// File: lib/db/src/schema/radiologyPromptsTable.ts
// ✅ SAFE: Add new rows to radiology_prompts table
// No existing functionality changes
```

---

### ⚠️ REQUIRES CAREFUL TESTING

These changes need thorough verification:

**1. Modify Existing Schema**
```typescript
// ❌ DO NOT do this without testing:
- Drop columns
- Rename columns
- Change column type
- Add NOT NULL constraint to existing column

// ✅ DO THIS instead:
- Add new nullable column
- Run migration on staging first
- Verify no data loss
- Run financial regression tests (42/42)
```

**2. Change API Route Handler**
```typescript
// ❌ Risky:
router.get("/api/radiology/worklist", (req, res) => {
  // Completely rewrite existing handler
});

// ✅ Safe:
// Create new endpoint: /api/radiology/worklist-v2
// Keep old endpoint working
// Gradual migration over 2 weeks
```

**3. Modify Billing/Payment Code**
```typescript
// ❌ FORBIDDEN:
// Any modification to:
// - Bill calculation
// - Payment processing
// - Refund logic
// - Accounting vouchers

// ✅ ONLY via:
// - FINANCIAL_CHANGE_CONTROL.md process
// - Full impact analysis
// - Regression tests (42/42)
// - Finance team approval
```

**4. Change PACS/DICOM Integration**
```typescript
// ❌ High risk:
// Modifying Orthanc polling
// Changing DICOM routing
// Altering study ingestion

// ✅ Safe approach:
// Only add new query types
// Create abstraction layer
// Test with test modality
// Run DICOM_BILLING_MATCH_AUDIT
```

---

### 🚫 NEVER MODIFY

**These systems are absolutely protected:**

1. **Financial Calculations**
   ```typescript
   // Files that must NEVER be modified:
   - lib/integrations/**/payment*
   - lib/integrations/**/billing*
   - artifacts/api-server/src/routes/*accounting*
   - artifacts/api-server/src/routes/*payment*
   - artifacts/api-server/src/routes/*refund*
   
   // Exception: Only via FINANCIAL_CHANGE_CONTROL.md
   ```

2. **Payment Gateway**
   ```typescript
   // Forbidden:
   - IciciPaymentProvider.ts (unless webhook update)
   - PaymentEngine.ts (unless new provider)
   - Webhook signature verification
   - Refund totalAmount semantics
   
   // Why: Losing transactions = business shutdown
   ```

3. **Orthanc/PACS Core**
   ```bash
   # Never:
   - Restart Orthanc without backup
   - Delete DICOM store directory
   - Modify database schema for Orthanc
   - Disconnect modalities mid-sync
   
   # Impact: Patients lose imaging records
   ```

4. **PostgreSQL Core**
   ```sql
   -- Forbidden:
   DROP TABLE patients;
   DROP TABLE radiologyStudies;
   ALTER TABLE accounting_ledger DROP COLUMN amount;
   
   -- Reason: Irreversible data loss
   ```

---

## TESTING REQUIREMENTS BY CHANGE TYPE

### New Templates (MRI Enhancement)
```bash
# Minimal testing required:
npm run typecheck          # ✅ Must pass
npm run lint               # ✅ Should pass
npm run test               # ✅ Unit tests

# Manual testing:
- Load template in UI
- Generate report with template
- Verify all sections display
- Export PDF and check formatting
```

### New Database Schema
```bash
# Required testing:
npm run typecheck          # ✅ Must pass

# Database testing:
- Create migration file
- Test forward migration: npm run migrate:up
- Test backward migration: npm run migrate:down
- Verify no data loss

# Application testing:
- npm run test
- Manual: Create/read/update new table
- Verify foreign key constraints
- Check indexes are efficient
```

### Billing/Accounting Changes
```bash
# MANDATORY:
npm run typecheck          # ✅ Must pass
npm run financial:tests    # ✅ 42/42 must pass
npm run regression:suite   # ✅ All green

# Manual verification:
- Create test bill
- Create test payment
- Test refund flow
- Verify GL entries created
- Check audit trail

# Approval required:
- Finance team lead
- Accounting manager
- QA lead
```

### PACS/DICOM Changes
```bash
# Required:
npm run typecheck          # ✅ Must pass
npm run test               # ✅ Must pass

# DICOM-specific:
- Test with Conquest emulator
- Run C-ECHO test on modalities
- Verify study ingestion
- Check PDF generation
- Audit trail verification

# Approval:
- Radiology lead
- IT ops
```

---

## PRE-DEPLOYMENT VERIFICATION

Before pushing to production:

### Code Quality ✅
```bash
# TypeScript compilation
npm run typecheck
# ✅ Result: No errors

# Lint check
npm run lint
# ✅ Result: No critical issues

# Unit tests
npm run test
# ✅ Result: All passing
```

### Database Integrity ✅
```bash
# Migration test
npm run migrate:status
# ✅ Result: All migrations applied

# Data consistency
npm run validate:database
# ✅ Result: No orphaned records

# Financial audit (if applicable)
npm run audit:financial
# ✅ Result: 42/42 tests passing
```

### PACS/DICOM Health ✅
```bash
# Orthanc connectivity
curl -s http://localhost:8042/instances | jq '.length'
# ✅ Result: Returns count > 0

# Modality polling
curl http://localhost:8080/api/radiology/pacs-dashboard
# ✅ Result: All modalities online

# Study ingestion
# Verify last ingestion < 5 minutes ago
```

### Backup/Restore ✅
```bash
# Database backup exists
ls -lh /backup/care_erp_*.sql
# ✅ Result: Recent backup file present

# Backup size > 100MB
stat /backup/care_erp_*.sql
# ✅ Result: File size acceptable

# Git checkpoint created
git tag -l | grep checkpoint
# ✅ Result: Current checkpoint visible
```

### Documentation ✅
```bash
# Walkthrough file created
ls -l WALKTHROUGH_*.md
# ✅ Result: File exists with clear steps

# Change logged
git log --oneline -5
# ✅ Result: Descriptive commit messages

# Test results documented
ls -l TEST_RESULTS_*.md
# ✅ Result: Evidence of testing
```

---

## DEPLOYMENT PROCESS

### Step-by-Step Deployment

```bash
# 1. Final checkpoint
git tag -a deployment/mri-v1 -m "Ready for production deployment"
git push origin deployment/mri-v1

# 2. Merge to main (with approval)
git checkout main
git pull origin main
git merge --no-ff feature/mri-protocol-enhancement
git push origin main

# 3. Deploy to production
# (Synology Docker service restarts)
docker-compose -f docker-compose.yml up -d --build

# 4. Health check
curl http://localhost:8080/api/health
# Should return: { "status": "ok" }

# 5. Smoke test
# Radiologist logs in
# Creates test report with new template
# Verifies report generates PDF
# Checks audit log captured action

# 6. Monitor logs
docker logs -f $(docker ps | grep api-server | awk '{print $1}')
# Watch for 30 minutes, ensure no errors

# 7. Rollback procedure (if needed)
git checkout main
git revert -n deployment/mri-v1~1..deployment/mri-v1
git commit -m "Rollback MRI deployment"
git push origin main
docker-compose -f docker-compose.yml up -d --build
```

---

## ROLLBACK PROCEDURES

If something breaks:

### Immediate Actions (First 5 Minutes)

1. **Identify the issue**
   ```bash
   docker logs -f api-server 2>&1 | grep -i error
   # Look for stack trace
   ```

2. **Check what changed**
   ```bash
   git diff main feature/mri-enhancement
   # Review changes
   ```

3. **Assess impact**
   - Can patients still book?
   - Can reports still be signed?
   - Is billing functional?
   - Are DICOM images accessible?

### Rollback (If Critical)

```bash
# 1. Revert to checkpoint
git checkout deployment/mri-v1~1

# 2. Rebuild and restart
docker-compose -f docker-compose.yml down
docker-compose -f docker-compose.yml up -d --build

# 3. Verify recovery
curl http://localhost:8080/api/health
# Should be healthy

# 4. Restore database if needed
docker exec postgres psql -U postgres care_erp < \
  /backup/care_erp_YYYYMMDD_backup.sql

# 5. Notify team
echo "Rolled back to checkpoint. Investigating issue."

# 6. Post-mortem
# Document what went wrong
# Update testing procedure
# Try again with fixes
```

---

## INCIDENT RESPONSE

### If Billing System Breaks
- ❌ DO NOT attempt fixes
- ✅ Immediately rollback to working version
- ✅ Restore database from backup
- ✅ Contact finance team
- ✅ Review FINANCIAL_CHANGE_CONTROL.md

**Impact:** Potentially $100K+ revenue loss per hour

### If PACS/DICOM Breaks
- ❌ DO NOT restart Orthanc
- ✅ Check PostgreSQL connection first
- ✅ Check disk space
- ✅ Rollback if recent change
- ✅ Contact radiology lead

**Impact:** Radiologists can't see images, reports delayed

### If API Server Breaks
- ✅ Check error logs
- ✅ Rollback recent changes
- ✅ Restart with previous version
- ✅ Run health checks

**Impact:** Users can't access portal, ~30 min acceptable downtime

---

## COMMUNICATION CHECKLIST

Before, during, and after deployment:

### Before (1 day prior)
- [ ] Email to team: "MRI template enhancement deploying tomorrow 2 PM IST"
- [ ] Slack notification: Link to WALKTHROUGH document
- [ ] Backup confirmation: DB backup taken and verified

### During (Deployment window)
- [ ] Slack: "Deployment starting - expect 2 min downtime"
- [ ] Monitor: Watch logs for errors
- [ ] Slack: "Deployment complete - running smoke tests"
- [ ] Slack: "✅ System healthy, new features live"

### After (If issues)
- [ ] Slack: "⚠️ Issue detected, investigating"
- [ ] Slack: "🔄 Rolling back to stable version"
- [ ] Slack: "✅ System restored, impact: ~10 minutes downtime"
- [ ] Email: "Post-incident report attached, changes for next attempt"

---

## QUICK REFERENCE CARD

**Keep this handy during modifications:**

| Situation | Action | Time |
|-----------|--------|------|
| Need to undo last commit | `git reset --soft HEAD~1` | 1 min |
| Need to see what changed | `git diff main feature/branch` | 1 min |
| TypeScript error | Fix, then `npm run typecheck` | 5 min |
| Database migration failed | `git revert` commit, restart | 10 min |
| API not responding | `docker logs api-server`, restart | 5 min |
| DICOM viewer broken | Verify Orthanc health, restart if needed | 10 min |
| Billing system error | **ROLLBACK IMMEDIATELY** | 5 min |
| Need emergency revert | `git reset --hard deployment/tag-before` | 5 min |

---

## FINAL CHECKLIST BEFORE DECLARING "COMPLETE"

```bash
# ✅ All tasks complete
- [ ] Code changes implemented
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] TypeScript compilation: Clean
- [ ] Financial regression tests: 42/42 passing
- [ ] DICOM health check: All online
- [ ] Backup verified: > 100MB, recent
- [ ] Git checkpoint: Tagged and pushed
- [ ] WALKTHROUGH documentation: Written
- [ ] PR submitted: With description
- [ ] Team review: Approved
- [ ] QA sign-off: Confirmed
- [ ] Radiology review: Approved (if radiology changes)
- [ ] Finance approval: Confirmed (if billing changes)
- [ ] Deployed to production: ✅ Live
- [ ] Monitoring: Alerts configured
- [ ] Team notified: Changelog published
- [ ] Follow-up: Scheduled for 1 week

# 🎉 COMPLETE - Ready to announce
```

---

**Document Version:** 1.0  
**Last Updated:** June 27, 2026  
**Prepared for:** Care-on-Synology Production Hospital ERP  

