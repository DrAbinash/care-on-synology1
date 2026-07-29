# Implementation Report — PaddleOCR + Local AI Pipeline Upgrade

**Branch:** `cursor/paddleocr-ai-pipeline-cb41`  
**Date:** 2026-07-29  
**Cloud agent:** verified on Linux CPU (not the clinic RTX 3050)

## Current architecture discovered

- Form F ID OCR: vision LLM first (Ollama → Gemini), browser Tesseract.js last resort
- Images always sent to vision models; no traditional OCR→text→LLM path
- Defaults in code were `qwen3:14b`; Local AI UI still referenced nonexistent `medgemma:27b` / `gemma4:12b`
- Dual Ollama config (`clinic_settings` vs `ai_provider_settings`)
- Sync HTTP OCR (no queue); no PaddleOCR anywhere

## Final architecture implemented

```
Upload → sharp preprocess → OCR_ENGINE=paddle → Windows :8090 PaddleOCR
         (fast → quality → accurate retry; empty rejected)
       → deterministic parse (sections / ID fields)
       → AI_MODE router (OCR_ONLY | gemma3:4b text | DEEP gemma3:12b)
       → DRAFT only (human review required)
Rollback: OCR_ENGINE=tesseract|vision
```

## Files changed / added

### New
- `ocr-worker/` — FastAPI PaddleOCR 3.x worker (PP-OCRv5 EN fast/accurate)
- `artifacts/api-server/src/lib/aiPipeline/*` — config, registry, router, prompts, parser, PHI log, schema
- `artifacts/api-server/src/lib/ocr/paddleOcrClient.ts`, `ocrOrchestrator.ts`, `ocrQuality.ts`, `idCardTextFromOcr.ts`
- `artifacts/api-server/src/routes/aiPipelineHealth.ts` — `/api/ai-pipeline/health|test|models`
- `docs/ai-ocr/AI_OCR_PIPELINE.md`, `BENCHMARK_RESULTS.json`
- `scripts/benchmark-ocr-ai.mjs`
- Tests: `aiPipeline.test.ts`, `ocrOrchestrator.test.ts`, `ocr-worker/tests/test_quality.py`

### Modified
- `idCardPipeline.ts` — Paddle-first, vision/Tesseract fallback
- `routes/index.ts` — mount ai-pipeline routes
- `lib/ai-providers` — default models lead with `gemma3:4b`
- `AiReportingSettings.tsx` — model picker + pipeline diagnostics panel
- `.env.example` — full OCR/AI env block
- `IdCardOcrResult.ocrProvider` — allows `paddle` | `tesseract`

## Tests run (actually executed)

| Suite | Result |
|-------|--------|
| `aiPipeline.test.ts` | PASS |
| `ocrOrchestrator.test.ts` | PASS |
| `idCardPipeline.test.ts` | PASS |
| `providerModel.test.ts` | PASS |
| `ocr-worker/tests/test_quality.py` | PASS (4) |
| `api-server` tsc --noEmit | PASS (new code clean) |
| Live Paddle worker `/health` | `paddle_loaded:true`, profiles `fast`+`accurate`, device `cpu` |
| Live OCR non-PHI sample | **PASS** — conf **0.994**, **397 ms**, path `paddle:fast`, full text recovered |
| Ollama gemma3:4b / RTX 3050 | **NOT RUN** — no Ollama / no NVIDIA in cloud agent |
| Live OCR→draft with Gemma | **NOT RUN** — same reason |

### Measured OCR (cloud CPU)

| Sample | Profile | OCR ms | Mean conf | Path |
|--------|---------|--------|-----------|------|
| clean-printed-id.png | fast | ~397 | 0.994 | paddle:fast |
| clean-printed-id.png | accurate | ~830 | (same sample) | paddle:accurate |

## Remaining limitations / unresolved risks

1. **GPU / Gemma timings** must be measured on the Windows i9 + RTX 3050 PC after deploy.
2. **Dual Ollama stores** still exist; Local AI save does not auto-sync Form F `ai_provider_settings`.
3. **WhatsApp ID OCR** still Gemini-only (out of this change’s Form F `/upload-id` path).
4. **PIL/default-font samples** OCR poorly — use real scans or TTF-rendered text for benchmarks.
5. **Background job queue** for Form F OCR not added (still request-scoped); concurrency bounded via worker semaphore + `AI_CONCURRENCY`.
6. Existing clinics with stored `qwen3:14b` keep that model until admins change settings.

## Exact Windows deployment steps

See `docs/ai-ocr/AI_OCR_PIPELINE.md` and `ocr-worker/install-windows.ps1`.

```powershell
# Ollama
winget install Ollama.Ollama
ollama pull gemma3:4b
# ollama pull gemma3:12b   # Deep only — warn: slow on 8GB

# OCR worker
cd C:\care\ocr-worker
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1
.\start-windows.ps1
Invoke-RestMethod http://127.0.0.1:8090/health
```

### Synology API env (source of truth)

```
OCR_ENGINE=paddle
OCR_PROFILE=fast
OCR_DEVICE=auto
OCR_LOW_CONFIDENCE_THRESHOLD=0.80
OCR_RETRY_ACCURATE=true
OCR_TESSERACT_FALLBACK=true
OCR_WORKER_URL=http://<windows-lan-ip>:8090
OCR_WORKER_CONCURRENCY=1
OLLAMA_BASE_URL=http://<windows-lan-ip>:11434
AI_MODE=AUTO
AI_MODEL_FAST=gemma3:4b
AI_MODEL_STANDARD=gemma3:4b
AI_MODEL_LARGE=gemma3:12b
AI_MODEL_VISION=gemma3:4b
AI_CONCURRENCY=1
AI_TEMPERATURE_EXTRACTION=0
AI_TEMPERATURE_DRAFT=0.1
```

### Rollback

```
OCR_ENGINE=tesseract
# or
OCR_ENGINE=vision
```

## Safety confirmation

AI output remains **DRAFT**; Form F still requires staff verification before save. Routine path does **not** send images to the LLM when Paddle text is sufficient.
