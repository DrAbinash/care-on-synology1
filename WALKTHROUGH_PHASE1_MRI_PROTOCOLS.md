# WALKTHROUGH: Phase 1 — MRI Protocol Specification Documentation

**Date:** June 27, 2026  
**Branch:** feature/website-login-redirection  
**Commit:** 3cf1122c  
**Tag:** phase1/mri-protocol-specs-v1  
**Restore Point:** checkpoint/before-phase1-mri-protocols  

---

## What Was Implemented

Phase 1 adds machine-readable MRI acquisition protocol specifications to the system. Instead of technique descriptions being free-text strings buried inside template definitions, they are now structured data that can be queried, displayed, and used for QA enforcement.

---

## Files Changed

### 1. `lib/db/src/schema/mriProtocolSpecs.ts` (NEW — 155 lines)

Two new tables:

**`mriProtocolSpecsTable`**
Stores one row per MRI protocol. Key columns:
- `protocolKey` — unique key matching `RADIOLOGY_TEMPLATES` templateId (e.g. `"MRI_BRAIN_PLAIN"`)
- `indications` (JSONB) — clinical indications as string array
- `sequences` (JSONB) — ordered array of `MriSequenceSpec` objects, each with name, technique, TR/TE/TI, slice thickness, b-value, purpose, and findings sensitivity list
- `qualityChecklist` (JSONB) — ordered array of `MriQaChecklistItem` objects, each with id, label, description, and failAction (`reject | warn | note`)
- `radiologistNotes` — clinical interpretation guidance (radiologist-level)
- `techNotes` — acquisition instructions for MRI technologist
- `estimatedScanTimeMin` — scan time budget

**`mriProtocolQualityResultsTable`**  
One row per study per QA assessment:
- `results` (JSONB) — `{ [checklistItemId]: "pass" | "fail" | "na" }`
- `overallGrade` — `acceptable | suboptimal | non-diagnostic`
- `completedBy` — staff username from session

TypeScript interfaces exported: `MriSequenceSpec`, `MriQaChecklistItem`, `MriProtocolSpec`, `NewMriProtocolSpec`

---

### 2. `lib/db/src/schema/index.ts` (MODIFIED)

Added at the end:
```typescript
export * from "./mriProtocolSpecs";
```

---

### 3. `artifacts/api-server/src/routes/radiology-report-generator.ts` (MODIFIED)

**Interface extended:**
```typescript
export interface ReportTemplate {
  templateId: string;
  modality: string;
  studyName: string;
  technique: string;
  sections: string[];
  protocolId?: string;        // NEW — links to mri_protocol_specs.protocol_key
  qualityChecklist?: string[]; // NEW — QA item IDs to tick before signing
}
```

**7 MRI templates enhanced:**

| Template | Old sections | New sections | QA items | New technique detail |
|----------|-------------|-------------|----------|---------------------|
| MRI_BRAIN_PLAIN | 8 | 10 | 7 | T1/T2/FLAIR/DWI/SWI/MRA-TOF with TR/TE/TI/b-value |
| MRI_BRAIN_CONTRAST | 8 | 11 | 8 | Pre + post-Gd timing, fat-sat, Gd dose |
| MRI_STROKE_PROTOCOL | 7 | 8 | 6 | DWI-first order, door-to-image ≤ 20 min |
| MRI_LS_SPINE | 8 | 10 | 6 | Individual disc axial angulation, STIR parameters |
| MRI_CERVICAL_SPINE | 7 | 8 | 6 | Craniocervical junction mandate, GRE for trauma |
| MRI_DORSAL_SPINE | 6 | 7 | 4 | Cardiac gating note, conus level documentation |
| MRI_KNEE | 10 (unchanged) | 10 | 5 | PD-FS sequences specified, 10–15° external rotation |

**New API endpoints added (immediately after GET /templates):**

```
GET  /api/radiology/report-generator/protocols
     → Returns all active protocols from mri_protocol_specs table
     → Graceful fallback to [] if table not yet migrated

GET  /api/radiology/report-generator/protocols/:key
     → Returns one protocol by protocol_key (e.g. "MRI_BRAIN_PLAIN")
     → 404 if not found

POST /api/radiology/report-generator/protocols/quality-result
     → Body: { studyId, draftId?, protocolId, results, overallGrade, qualityNotes? }
     → Saves per-study QA checklist results
     → completedBy set from staff session
```

All three endpoints follow the same auth pattern as existing routes (requireStaffAuth applied at router mount).

---

### 4. `migrations/seed_mri_protocols.sql` (NEW — 248 lines)

DDL + seed in one file. Safe to re-run (`ON CONFLICT DO NOTHING`).

**Creates:**
- `mri_protocol_specs` table with indexes
- `mri_protocol_quality_results` table with indexes
- `updated_at` trigger on both tables

**Seeds 7 factory protocols** (marked `is_system = TRUE`):

| protocol_key | name | est. scan time |
|---|---|---|
| MRI_BRAIN_PLAIN | MRI Brain Plain | 35 min |
| MRI_BRAIN_CONTRAST | MRI Brain with Gadolinium Contrast | 50 min |
| MRI_STROKE_PROTOCOL | MRI Brain Stroke Protocol | 20 min |
| MRI_LS_SPINE | MRI Lumbosacral Spine | 30 min |
| MRI_CERVICAL_SPINE | MRI Cervical Spine | 30 min |
| MRI_DORSAL_SPINE | MRI Dorsal (Thoracic) Spine | 30 min |
| MRI_KNEE | MRI Knee | 25 min |

Each seed row includes full `sequences` JSONB (with TR/TE/TI, slice thickness, b-values, clinical purpose, findings sensitivity) and `quality_checklist` JSONB (with id, label, description, failAction).

---

## How to Deploy to Production

### Step 1: Git checkout (already committed)
```bash
git log --oneline -3
# Should show: 3cf1122c feat: Phase 1 — MRI Protocol Specification Documentation
```

### Step 2: Run SQL migration
```bash
# On Synology via docker exec:
docker exec -it postgres psql -U postgres -d care_erp \
  -f /path/to/migrations/seed_mri_protocols.sql

# Or directly:
psql $DATABASE_URL -f migrations/seed_mri_protocols.sql

# Expected output:
# NOTICE:  mri_protocol_specs: 7 system protocols seeded
```

### Step 3: Restart API server
```bash
docker-compose restart api-server
# Or: supervisorctl restart api-server
```

### Step 4: Smoke test new endpoints
```bash
# List protocols
curl -H "Cookie: staffSession=..." \
  http://localhost:8080/api/radiology/report-generator/protocols

# Expected: { "success": true, "protocols": [ ... 7 rows ... ] }

# Fetch MRI Brain Plain protocol
curl -H "Cookie: staffSession=..." \
  http://localhost:8080/api/radiology/report-generator/protocols/MRI_BRAIN_PLAIN

# Expected: { "success": true, "protocol": { "protocolKey": "MRI_BRAIN_PLAIN", "sequences": [...], ... } }

# Fetch templates (unchanged — verify no regression)
curl -H "Cookie: staffSession=..." \
  http://localhost:8080/api/radiology/report-generator/templates

# Expected: { "success": true, "templates": [...] }
# Templates should now include protocolId and qualityChecklist fields on MRI entries
```

### Step 5: Verify in ERP UI
1. Open any MRI study in the Radiology Command Center
2. Click "Report" to open the reporting workspace
3. Select an MRI template (e.g. MRI Brain Plain)
4. The technique field should now show the full sequence specification
5. Sections should include "QUALITY ASSESSMENT" as the first section

---

## What the Radiologist (Dr. Abinash) Gets

### In the Reporting UI

When loading MRI Brain Plain template, the **technique field** now reads:

> MRI of brain has been performed on a 1.5T / 3T scanner without intravenous contrast. Sequences acquired: T1-weighted sagittal (localiser, TR ~500 ms / TE ~20 ms, 5 mm), T2-weighted axial FSE (TR 4000–5000 ms / TE 100–120 ms, 5 mm / 1 mm gap, foramen magnum to vertex), FLAIR axial (TR ~8500 ms / TE ~120 ms / TI ~2300 ms, 5 mm — CSF-suppressed), DWI axial echo-planar (b = 0 & 1000 s/mm²) with corresponding ADC map, GRE / SWI axial (susceptibility-weighted for haemorrhage, calcification, iron deposition), and MR angiography TOF (non-contrast, Circle of Willis and major intracranial branches).

**Sections** now include:
1. QUALITY ASSESSMENT ← new
2. BRAIN PARENCHYMA
3. WHITE MATTER
4. VENTRICULAR SYSTEM / CSF SPACES
5. POSTERIOR FOSSA
6. MIDLINE STRUCTURES
7. SELLAR / PARASELLAR REGION
8. ORBITS / PNS / MASTOIDS
9. VASCULAR FLOW VOIDS / MRA ← new
10. MENINGES & EXTRAAXIAL SPACES ← new

### Via the Protocol API

The frontend can now call `GET /protocols/MRI_BRAIN_PLAIN` and render a full protocol card showing:

- Sequence list (T1, T2, FLAIR, DWI+ADC, SWI, MRA-TOF) with TR/TE/TI/b-values
- Clinical indications
- QA checklist items with pass/fail/na buttons
- Radiologist notes (clinical interpretation guidance)
- Technologist notes (acquisition tips)
- Estimated scan time (35 min)

This enables Phase 2's QA checklist UI — the radiologist ticks each item before signing.

---

## Clinical Content Summary (Radiologist Level)

### MRI Brain Plain — 7 QA items enforced:
| Item | Fail action |
|------|------------|
| No significant motion artifact | REJECT |
| SNR adequate (grey-white differentiation) | WARN |
| Coverage foramen magnum to vertex | REJECT |
| All 6 sequences present | WARN |
| FLAIR CSF suppression adequate | REJECT |
| DWI + ADC pair both present | REJECT |
| SWI assessable (not blurred at skull base) | NOTE |

**Radiologist notes seeded:**
- DWI-FLAIR mismatch interpretation (< 4.5 h thrombolysis window)
- Fazekas scale (0–3) for white matter
- SWI susceptibility vessel sign = large vessel thrombosis
- Posterior fossa inspection recommendation

### MRI Stroke Protocol — time-critical protocol:
- DWI sequence explicitly first (acute restriction detection)
- FLAIR-DWI mismatch: FLAIR negative = onset < 4.5 h
- LVO on MRA = immediate Neurology call trigger
- ASPECTS score documentation on DWI
- SWI microbleed count before thrombolysis
- Door-to-image ≤ 20 min target enforced in QA

### MRI Brain Contrast — 8 QA items:
- Fat saturation validation on all post-Gd sequences
- Contrast timing validation (5–10 min delay)
- Enhancement pattern classification seeded in radiologist notes

### MRI Spine (LS, Cervical, Dorsal):
- STIR fat suppression validation
- Axial disc angulation requirement (individual per level)
- Conus medullaris documentation enforced
- Disc herniation nomenclature in radiologist notes (Bulge/Protrusion/Extrusion/Sequestration)
- Canal stenosis grading criteria (mild > 100 mm², moderate 75–100 mm², severe < 75 mm²)
- Cervical myelopathy grading (Grade 0–3)
- Modic change classification (I/II/III)

---

## No Breaking Changes

- `ReportTemplate.protocolId` and `qualityChecklist` are `?` optional — no existing code breaks
- `/templates` endpoint unchanged in URL and response format (new fields additive)
- 3 new endpoints are additive routes
- SQL migration uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`
- No financial, billing, PACS, DICOM, or payment code touched

---

## Rollback (if needed)

```bash
# Code rollback
git checkout checkpoint/before-phase1-mri-protocols

# DB rollback (if migration was run)
psql $DATABASE_URL << SQL
  DROP TABLE IF EXISTS mri_protocol_quality_results;
  DROP TABLE IF EXISTS mri_protocol_specs;
SQL
```

---

## Phase 2 Preparation

Phase 1 establishes the protocol data layer. Phase 2 (AI Prompt Library) will:

1. Use `mri_protocol_specs.protocolKey` to select the right AI prompt category
2. Add neuro-specific prompt templates to `ai_prompt_library` table (already exists):
   - Standard Brain Impression
   - Acute Stroke Protocol
   - Tumor Assessment
   - White Matter Disease
   - Normal Study Variants
3. Wire a prompt-selector dropdown in `RadiologyCommandCenter.tsx`

**Phase 2 entry point:**
- File: `artifacts/api-server/src/routes/radiologyCopilot.ts`
- Table: `aiPromptLibraryTable` (already exists in schema)
- Frontend: `artifacts/diagnostic-erp/src/pages/RadiologyCommandCenter.tsx`

---

## Git Reference

```bash
# See what was changed
git show 3cf1122c --stat

# View the new schema
git show 3cf1122c -- lib/db/src/schema/mriProtocolSpecs.ts

# Restore point before Phase 1
git show checkpoint/before-phase1-mri-protocols

# Phase 1 completion tag
git show phase1/mri-protocol-specs-v1
```

---

**Phase 1 Status: ✅ COMPLETE**  
**Next:** Phase 2 — AI Prompt Library  
**Estimated time:** 1 week  
