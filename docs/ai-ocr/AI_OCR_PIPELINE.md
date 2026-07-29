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
.\install-windows.ps1
.\start-windows.ps1
# Health:
Invoke-RestMethod http://127.0.0.1:8090/health

# 3) Firewall (LAN only — Synology NAS IP)
New-NetFirewallRule -DisplayName "CARE OCR Worker" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow -RemoteAddress 192.168.1.0/24
New-NetFirewallRule -DisplayName "CARE Ollama" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow -RemoteAddress 192.168.1.0/24
```

## Synology CARE API environment

```bash
OCR_ENGINE=paddle
OCR_PROFILE=fast
OCR_DEVICE=auto
OCR_LOW_CONFIDENCE_THRESHOLD=0.80
OCR_RETRY_ACCURATE=true
OCR_TESSERACT_FALLBACK=true
OCR_WORKER_URL=http://192.168.1.250:8090
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
