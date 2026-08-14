# Overnight MRI AI drafts — tonight (CARE)

Server-side. Chrome does **not** need to stay open. CARE API cron + job runner + Windows Ollama.

## What shipped

- Vision model: `qwen3-vl:8b` via `AI_MODEL_VISION`
- Ollama `/api/chat`: `options.num_ctx = 16384`, `think = false`
- Concurrency: `AI_CONCURRENCY=1` ∩ `ai_scheduler_config.max_concurrent_jobs=1`
- Window: **17:00–10:00 Asia/Kolkata** (cron every 15 min; window check is in `runNightBatch`)
- MRI only (`MR` = `night_batch`; CT/CR/US/MG/Doppler = `disabled`)
- AI cannot write `patient_reports` / `radiology_report_drafts` / sign

## NAS (CARE container)

1. Pull this branch on `/volume1/docker/care-on-synology1` and rebuild `care-api` (Container Manager **Build**).
2. Merge `deploy/synology/NAS_OVERNIGHT_ENV_PATCH.env` into the live `.env`. Compose does **not** auto-inject `.env` keys — `docker-compose.yml` must list `TZ`, `AI_MODEL_VISION`, `OLLAMA_NUM_CTX`, and `OLLAMA_THINK` (this branch does). Recreate `care-api` after editing compose/env.
3. In `.env` (do **not** leave `AI_MODEL_VISION=gemma3:4b`):

```
ENABLE_SCHEDULERS=1
TZ=Asia/Kolkata
OLLAMA_PRIMARY_URL=http://192.168.1.250:11434
OLLAMA_BASE_URL=http://192.168.1.250:11434
AI_MODEL_VISION=qwen3-vl:8b
OLLAMA_NUM_CTX=16384
OLLAMA_THINK=0
AI_CONCURRENCY=1
AI_TEMPERATURE_DRAFT=0.1
```

4. Confirm migration `overnight_mri_qwen3vl_defaults.sql` applied (startup / db:bootstrap).
5. CARE UI → **Settings → Radiology → AI → Draft automation**:
   - When: **At scheduled time**
   - Window: **17:00 – 10:00**
   - Modalities: **MRI only**
   - Enable master flag
   - Save
6. Optional smoke (2–3 cases): **Run batch now** (explicit override).

## Windows PC (Ollama)

```
ollama pull qwen3-vl:8b
ollama list   # confirm qwen3-vl:8b
# keep Ollama running; GPU should be free of other large models
```

## Acceptance test (2–3 MRI cases)

For each case record:

| Field | Where |
|-------|--------|
| StudyInstanceUID | Worklist / PACS |
| modality | must be MR/MRI |
| selected series/images count | pipeline max ~20 JPEGs |
| model | `qwen3-vl:8b` (draft provenance) |
| num_ctx | 16384 |
| think | false |
| duration | job `inference_time_ms` / started–completed |
| queue status | PENDING → READY or ERROR |
| retry count | `dicom_retry_queue.retry_count` |
| JSON validated | READY + findings JSON, no `<think>` |
| human report untouched | Reporting Workspace findings unchanged until Accept |

Verify:

- CT/XR do not enqueue
- Only one `ai_shadow_pipeline` job `running` at a time
- Failed case releases the worker; next MRI starts
- Restart `care-api`: stale `running` requeues; queue survives
- Re-running night batch does not duplicate drafts (idempotency key)
- AI cannot Finalize/Sign/WhatsApp
- Opening Patient B never shows Patient A’s images/draft
- Manual text is never overwritten (`chooseReportPrefill` human-first)

Morning: Worklist → **Overnight AI Drafts** → `AI Drafts: N READY | E ERROR | P PROCESSING` → open Reporting Workspace → Accept/Edit → human Sign.

## Rollback

1. Settings: uncheck MRI / disable master flag `ff_radiology_ai`.
2. Env: `AI_MODEL_VISION=gemma3:4b` (or previous) and rebuild.
3. SQL:

```
UPDATE ai_modality_policies SET mode='disabled';
UPDATE feature_flags SET enabled=false WHERE key='ff_radiology_ai';
```

Queued jobs: cancel via `/api/ai/jobs/:id/cancel` or leave them abandoned.
