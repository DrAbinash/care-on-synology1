# CARE OCR Worker
#
# Runs on the Windows AI PC (alongside Ollama :11434). Synology CARE API
# calls this service for PaddleOCR document/ID text extraction.
#
# Endpoints:
#   GET  /health     (no auth — liveness only)
#   POST /ocr        requires X-OCR-Token or Authorization: Bearer <token>
#   POST /warmup     requires token
#
# Install (PowerShell, Administrator):
#   .\install-windows.ps1          # venv + deps + token + firewall + Task Scheduler
#   .\install-task-scheduler.ps1   # re-register boot/logon start only
#   .\start-windows.ps1            # foreground start
#
# Production defaults:
#   OCR_DEVICE=cpu
#   OCR_PROFILE=fast
#   OCR_RETRY_ACCURATE=true
#   OCR_WORKER_REQUIRE_AUTH=true
#   OCR_WORKER_TOKEN=<generated>
#
# Security:
#   - Copy OCR_WORKER_TOKEN into Synology CARE `.env` as OCR_WORKER_TOKEN=
#   - Firewall rule allows TCP 8090 on **Private** profile only
#   - Never expose / port-forward 8090 (or Ollama 11434) to the public internet
#
# Default port: 8090
