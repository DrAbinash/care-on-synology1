# CARE AI / OCR Pipeline — Architecture & Windows Deployment

## Current → Final architecture

### Before
- Form F ID OCR: vision LLM (Ollama → Gemini) with browser **Tesseract.js** last resort
- Images always sent to the vision model
- Default model lists centered on `qwen3:14b` / stale UI `medgemma:27b`
- No PaddleOCR; no unified health panel for OCR+AI

### After
```
[Scan / Upload] → CARE API (Synology)
                    ├─ preprocess (sharp)
                    ├─ OCR_ENGINE=paddle → HTTP → Windows :8090 PaddleOCR worker
                    │     fast → quality gate → accurate retry
                    │     empty rejected; technical fail → Tesseract/vision fallback
                    ├─ deterministic parse (sections / ID fields)
                    ├─ AI_MODE router → gemma3:4b text (no image) | OCR_ONLY | DEEP=12b
                    └─ result labeled DRAFT — human review required
Windows PC: Ollama :11434 + ocr-worker :8090 (RTX 3050)
```

Rollback without code changes: set `OCR_ENGINE=tesseract` or `OCR_ENGINE=vision` on the API.

## Canonical Local AI runtime

All modules (Local AI UI, Form F OCR, radiology Ollama, `/api/ai-pipeline/*`) resolve
**one** runtime via `resolveLocalAiRuntime()`:

| Field | Source of truth |
| --- | --- |
| Ollama URL | `clinic_settings.ollamaBaseUrl` (overlay) ← env `OLLAMA_BASE_URL` default |
| AI mode | env `AI_MODE` |
| Fast / Standard model | `clinic_settings.ollamaModel` (overlay) ← env `AI_MODEL_*` |
| Deep / Vision models | env `AI_MODEL_LARGE` / `AI_MODEL_VISION` |

Saving Local AI settings also syncs `ai_provider_settings.ollama` so legacy
`generateAiForTask` stays aligned. Do not maintain a second Ollama URL in the UI.

## PowerShell — Windows 11 AI PC

```powershell
# 1) Ollama
winget install Ollama.Ollama
ollama pull gemma3:4b
# Optional Deep model (slow on 8GB):
# ollama pull gemma3:12b
ollama list
# Confirm GPU: while generating, Task Manager → GPU / or `nvidia-smi`

# 2) CARE OCR worker
cd C:\care\ocr-worker   # copy this repo's ocr-worker/ folder
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1   # generates OCR_WORKER_TOKEN, Private firewall, Task Scheduler
# Copy printed TOKEN into Synology CARE .env as OCR_WORKER_TOKEN=
.\start-windows.ps1     # or reboot — CARE-OCR-Worker task starts at logon
# Health:
Invoke-RestMethod http://127.0.0.1:8090/health
# Never port-forward 8090 / 11434 to the public internet.
```

## Synology CARE API environment

```bash
OCR_ENGINE=paddle
OCR_PROFILE=fast
OCR_DEVICE=cpu
OCR_LOW_CONFIDENCE_THRESHOLD=0.80
OCR_RETRY_ACCURATE=true
OCR_TESSERACT_FALLBACK=true
OCR_VISION_FALLBACK=false
OCR_WORKER_URL=http://192.168.1.250:8090
OCR_WORKER_TOKEN=<same as Windows ocr-worker/.env>
OCR_WORKER_CONCURRENCY=1
OLLAMA_BASE_URL=http://192.168.1.250:11434
AI_MODE=AUTO
AI_MODEL_FAST=gemma3:4b
AI_MODEL_STANDARD=gemma3:4b
AI_MODEL_LARGE=gemma3:12b
AI_MODEL_VISION=gemma3:4b
AI_CONCURRENCY=1
AI_TEMPERATURE_EXTRACTION=0
AI_TEMPERATURE_DRAFT=0.1
```

Admin UI: **Settings → AI → Local AI** → Pipeline Diagnostics (`GET /api/ai-pipeline/health`, `POST /api/ai-pipeline/test`).

## Safety
- AI output is always **DRAFT**; never auto-finalized as a verified medical report.
- Routine path sends **OCR text only** to the LLM (no source images).
- Ordinary logs redact / omit PHI (see `phiSafeLog.ts`).

## Benchmark
```bash
node scripts/benchmark-ocr-ai.mjs --paddle-url=http://192.168.1.250:8090
```
Does not invent accuracy percentages without labelled ground truth.

## Production acceptance
```bash
# From a host that can reach Windows OCR/Ollama + CARE API (staff login required)
node scripts/production-acceptance-ocr-ai.mjs
```
Checks worker reachability, Paddle loaded, `gemma3:4b`, OCR→Draft, DRAFT label, model selection, and prints phase timings.
