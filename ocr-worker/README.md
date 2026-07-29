# CARE OCR Worker
#
# Runs on the Windows AI PC (alongside Ollama :11434). Synology CARE API
# calls this service for PaddleOCR document/ID text extraction.
#
# Endpoints:
#   GET  /health
#   POST /ocr       multipart: file, profile=auto|fast|accurate, preprocess=true
#   POST /warmup
#
# Install (PowerShell):
#   .\install-windows.ps1
#   .\start-windows.ps1
#
# Default port: 8090
