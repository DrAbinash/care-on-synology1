# CARE OCR Worker — Windows 11 install (PowerShell, run as Administrator recommended)
# Target: Intel i9 + RTX 3050 8GB — Ollama on :11434, this worker on :8090
#
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   cd C:\care\ocr-worker
#   .\install-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "==> CARE OCR Worker install" -ForegroundColor Cyan

# Prefer Python 3.11/3.12
$pyCmd = $null
$pyArgs = @()
foreach ($pair in @(
  @{ Cmd = "py"; Args = @("-3.12") },
  @{ Cmd = "py"; Args = @("-3.11") },
  @{ Cmd = "python"; Args = @() }
)) {
  try {
    $out = & $pair.Cmd @($pair.Args + "--version") 2>&1 | Out-String
    if ($out -match "Python 3\.(1[012])") {
      $pyCmd = $pair.Cmd
      $pyArgs = $pair.Args
      Write-Host "Using: $out"
      break
    }
  } catch {}
}
if (-not $pyCmd) {
  Write-Error "Python 3.10–3.12 required. Install from https://www.python.org/downloads/ and re-run."
}

if (-not (Test-Path ".venv")) {
  Write-Host "==> Creating venv .venv"
  & $pyCmd @($pyArgs + @("-m", "venv", ".venv"))
}

$pip = ".\.venv\Scripts\python.exe -m pip"
$python = ".\.venv\Scripts\python.exe"

Write-Host "==> Upgrading pip"
Invoke-Expression "$pip install --upgrade pip wheel setuptools"

# Detect NVIDIA GPU for PaddlePaddle CUDA wheel selection
$hasNvidia = $false
try {
  $null = & nvidia-smi 2>$null
  if ($LASTEXITCODE -eq 0) { $hasNvidia = $true }
} catch {}

if ($hasNvidia) {
  Write-Host "==> NVIDIA GPU detected — installing paddlepaddle-gpu (CUDA 11.8 wheel family)" -ForegroundColor Green
  # Official CUDA 11.8 index commonly used with RTX 30-series on Windows
  Invoke-Expression "$pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/"
} else {
  Write-Host "==> No nvidia-smi — installing CPU paddlepaddle" -ForegroundColor Yellow
  Invoke-Expression "$pip install paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/"
}

Write-Host "==> Installing paddleocr + FastAPI stack"
Invoke-Expression "$pip install -r requirements.txt"

Write-Host "==> Writing default .env (if missing)"
$envPath = Join-Path $Root ".env"
if (-not (Test-Path $envPath)) {
  @"
OCR_WORKER_HOST=0.0.0.0
OCR_WORKER_PORT=8090
OCR_PROFILE=fast
OCR_DEVICE=auto
OCR_LOW_CONFIDENCE_THRESHOLD=0.80
OCR_RETRY_ACCURATE=true
OCR_WORKER_CONCURRENCY=1
OCR_WARMUP_ON_START=true
# Optional shared secret (also set OCR_WORKER_TOKEN on Synology CARE API)
# OCR_WORKER_TOKEN=
"@ | Set-Content -Path $envPath -Encoding UTF8
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Start with:  .\start-windows.ps1"
Write-Host "Health:      http://127.0.0.1:8090/health"
Write-Host "From Synology CARE API set: OCR_WORKER_URL=http://<this-pc-lan-ip>:8090"
