# WALKTHROUGH: Phase 2 — Neuro AI Prompt Library

**Date:** June 27, 2026  
**Commit:** 94e26115  
**Tag:** phase2/neuro-prompt-library-v1  
**Restore point:** checkpoint/before-phase2-ai-prompts  

---

## What Was Inspected Before Writing Code

1. **`aiPromptLibrary.ts` schema** — 9 prompt types in `promptsJson` JSONB. `uniqueIndex` on `(name, library_owner)`. `VALID_OWNERS` includes `"dr_abinash"`. Already has version history table.
2. **`aiPromptLibrary.ts` route** — Full CRUD at `/api/ai-prompt-library`. Import, export, clone, restore-version, test, compare all exist. No duplication needed.
3. **`RadiologyCommandCenter.tsx`** — 8-tab grid (`grid-cols-8`). Tab 7 (`local-ai`) contains `LocalAiPanel`. `generateAiDraft` uses `/api/ai-reporting/query` with `provider: "gemini"`. `onInsertImpression` and `onInsertFindings` callbacks wired.
4. **`LocalAiPanel.tsx`** — Calls `/api/radiology/ollama/*` endpoints. 5 fixed actions (Ollama only). No prompt library integration. Self-contained.
5. **`AiPromptManager.tsx`** — Full admin CRUD UI for prompt library. Already handles the 16 categories × 9 types. Not modified — used as admin interface.

**Decision:** Insert `NeuroPromptPanel` inside the existing `local-ai` tab (upper half), preserving `LocalAiPanel` below. No new tab = no grid-cols change. No new backend routes = zero backend risk.

---

## Files Changed

### 1. `migrations/seed_neuro_prompt_library.sql` (NEW)

Seeds 5 prompt library entries into `ai_prompt_library` for `dr_abinash`:

| Entry name | Modality | Prompt types seeded |
|---|---|---|
| MRI Brain | MRI | system, impression, findings, differential, followup, quality, polish, formatting, image_review |
| MRI Brain Stroke | MRI | All 9 — includes ASPECTS, DWI-FLAIR mismatch, LVO detection |
| MRI Brain Tumour | MRI | All 9 — WHO CNS 2021 terminology, enhancement patterns |
| MRI Brain White Matter | MRI | All 9 — Fazekas scale, McDonald criteria |
| MRI Spine | MRI | All 9 — Modic, Pfirrmann, NASS/RSNA disc nomenclature |

Also mirrors each to `care_diagnostics` as shared system prompts.

**Safety:** `ON CONFLICT (name, library_owner) DO NOTHING` — re-runnable. Version history recorded in `ai_prompt_library_versions`.

**Run to deploy:**
```bash
psql $DATABASE_URL -f migrations/seed_neuro_prompt_library.sql
# Expected: NOTICE: Phase 2 prompt seed complete — dr_abinash and care_diagnostics libraries updated
```

---

### 2. `artifacts/diagnostic-erp/src/components/NeuroPromptPanel.tsx` (NEW — 395 lines)

Self-contained React component. Reuses existing endpoints only.

**Data flow:**
```
Component mounts
    ↓
GET /api/ai-prompt-library?modality=MRI
    ↓ returns: [MRI Brain, MRI Brain Stroke, MRI Brain Tumour, MRI Brain White Matter, MRI Spine]
Radiologist clicks a category
    ↓ entry selected, prompts.system + prompts.impression loaded
Radiologist clicks action type (Impression / Findings / Differential / etc.)
    ↓ selectedPromptText = entry.prompts[activeType]
Radiologist clicks "Generate"
    ↓
POST /api/ai-reporting/query
    body: {
      promptText: [ROLE: system] + [PATIENT CONTEXT: modality/age/sex] + [selectedPromptText] + [currentFindings],
      provider: "gemini",
      maxImages: 0
    }
    ↓ returns: { aiResponse: "..." }
AI output shown with "Requires review" badge
    ↓
Radiologist clicks "Insert into Impression/Findings Draft"
    ↓ onInsertImpression() or onInsertFindings() called
```

**5 action types:**
| Action | Output target | Use case |
|---|---|---|
| Impression | Impression field | Main report impression |
| Extract Findings | Findings field | Structure raw dictation |
| Differential Dx | Impression field | Append differential list |
| Follow-Up Rec. | Impression field | Append recommendations |
| Polish Language | Findings field | Improve terminology |

**Empty state:** If no MRI prompts in DB, shows migration command to run.

**Safety:** "AI output must be verified and edited by radiologist. Never auto-finalized." visible at bottom.

---

### 3. `artifacts/diagnostic-erp/src/pages/RadiologyCommandCenter.tsx` (MODIFIED)

**Changes:**
- Added: `import NeuroPromptPanel from "@/components/NeuroPromptPanel";`
- `local-ai` tab restructured into two stacked sections:

```
┌─────────────────────────────┐
│  Tab 7: local-ai            │
│  ┌──────────────────────┐   │
│  │  NeuroPromptPanel    │   │ ← NEW (upper, scrollable)
│  │  (cloud AI + neuro   │   │   Fetches ai_prompt_library
│  │   prompt categories) │   │   Calls ai-reporting/query
│  └──────────────────────┘   │
│     ── divider ──            │
│  ┌──────────────────────┐   │
│  │  LocalAiPanel        │   │ ← UNCHANGED (lower)
│  │  (Ollama local AI)   │   │   Calls radiology/ollama/*
│  └──────────────────────┘   │
└─────────────────────────────┘
```

**What didn't change:**
- 8 tabs, `grid-cols-8` — unchanged
- `LocalAiPanel` — fully preserved with identical props
- `onInsertImpression` and `onInsertFindings` callbacks — same logic

---

## How to Use (Dr. Abinash Workflow)

1. Open a study in the Radiology Command Center
2. Type findings in the report workspace (or dictate via voice)
3. Click the **AI** tab (Tab 7)
4. **Top panel — Neuro Prompt Library:**
   - Select category: e.g. "MRI Brain Stroke"
   - Select action: "Impression"
   - Click "Generate Impression"
   - Review AI output (badge shows "Requires review")
   - Click "Insert into Impression Draft"
5. **Bottom panel — Ollama:**
   - Use existing Ollama actions (Grammar Cleanup, Improve Report, etc.)

---

## Prompt Clinical Content Summary

### MRI Brain — Standard
- **System role:** Senior neuroradiologist, RSNA/ACR terminology
- **Impression:** 5-point structure (primary finding → differential → negatives → follow-up)
- **Quality:** 7 checks (technique, all regions, DWI, Fazekas, impression consistency, measurements, correlation)

### MRI Brain Stroke (Time-Critical)
- **System role:** Stroke specialist, thrombolysis/thrombectomy guidance
- **Impression:** ASPECTS score + DWI-FLAIR mismatch + haemorrhage + LVO + thrombolysis eligibility
- **Critical flags:** LVO → [LVO — URGENT], haemorrhage → [CONTRAINDICATION], basilar → [EMERGENCY]
- **Quality:** 7 checks including ASPECTS, onset window, LVO documentation

### MRI Brain Tumour
- **System role:** Neuro-oncologist, WHO CNS 2021 classification
- **Impression:** Mass characterisation → grade inference → primary vs metastatic → mass effect → MDT recommendation
- **Quality:** 8 checks including pre/post-contrast, DWI/ADC, 3-plane measurement, MDT recommendation

### MRI Brain White Matter
- **System role:** Demyelinating disease specialist
- **Impression:** Fazekas grade (periventricular + subcortical) → aetiology → active vs chronic → Neurology referral
- **Differential:** Ischaemic vs MS vs NMOSD vs migraine vs CADASIL
- **Quality:** 7 checks including Fazekas grading, juxtacortical/infratentorial, black holes, referral

### MRI Spine
- **System role:** Musculoskeletal/spine neuroradiologist
- **Impression:** Level-by-level disc (NASS nomenclature) + canal stenosis + cord myelopathy grade + Modic + alignment
- **Urgent flag:** Cord compression + myelopathy → [CORD COMPRESSION — URGENT NEUROSURGICAL REFERRAL]
- **Quality:** 8 checks including all disc levels, conus, canal grading, myelopathy

---

## Existing Infrastructure Reused (No Duplication)

| Existing | What Phase 2 uses |
|---|---|
| `ai_prompt_library` table | All 5 seeded categories live here |
| `ai_prompt_library_versions` | Version history recorded on seed |
| `GET /api/ai-prompt-library` | NeuroPromptPanel fetches categories |
| `POST /api/ai-reporting/query` | NeuroPromptPanel sends generation request |
| `onInsertImpression` callback | NeuroPromptPanel inserts impression text |
| `onInsertFindings` callback | NeuroPromptPanel inserts findings text |
| `AiPromptManager` page | Admin can edit/version/clone prompts |

---

## Validation Checklist

- [x] `NeuroPromptPanel` import added to RadiologyCommandCenter
- [x] `NeuroPromptPanel` rendered in local-ai tab
- [x] `LocalAiPanel` preserved unchanged below
- [x] Tab count unchanged: still 8 (`grid-cols-8`)
- [x] No new API routes added (reuses existing)
- [x] No schema changes (uses existing `ai_prompt_library`)
- [x] SQL seed is idempotent (`ON CONFLICT DO NOTHING`)
- [x] Version history recorded in `ai_prompt_library_versions`
- [x] Safety warning visible on every AI output
- [x] Empty-state shows migration instructions
- [x] Financial/billing/PACS systems untouched
- [x] TypeScript imports clean (no `any` except for extended study type)

---

## Deployment Steps

```bash
# 1. Seed prompt library
psql $DATABASE_URL -f migrations/seed_neuro_prompt_library.sql

# 2. Build and deploy (standard flow)
docker compose build --no-cache
docker compose up -d

# 3. Verify prompts loaded in UI
# Open any MRI study → Radiology Command Center → AI tab
# NeuroPromptPanel should show: MRI Brain, MRI Brain Stroke, MRI Brain Tumour, etc.
```

---

## Rollback

```bash
# Code rollback
git checkout checkpoint/before-phase2-ai-prompts

# DB rollback (remove seeded prompts)
psql $DATABASE_URL << SQL
DELETE FROM ai_prompt_library
WHERE created_by = 'phase2-seed'
  AND library_owner IN ('dr_abinash', 'care_diagnostics');
-- Note: versions will remain (harmless)
SQL
```

---

## Phase 3 Preparation

Phase 3 (Measurement Integration — 2 weeks) entry points:
- **File to create:** `artifacts/diagnostic-erp/src/components/MRIBrainMeasurements.tsx`
- **File to create:** `artifacts/api-server/src/routes/radiologyBrainMeasurements.ts`  
- **Table to use:** `usgMeasurementsTable` (existing) — or new `brainMeasurementsTable`
- **Protocol data:** `mriProtocolSpecsTable.qualityChecklist` (created Phase 1) — drives QA checklist UI
- **UI entry point:** Add to `measurements` tab (already in RCC — Tab 4)

---

**Phase 2 Status: ✅ COMPLETE**  
**Next:** Phase 3 — Measurement Assistant Integration  
