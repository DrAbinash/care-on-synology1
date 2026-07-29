# CARE OCR Worker — Windows 11 install (PowerShell, run as Administrator)
# Target: Intel i9 + RTX 3050 8GB — Ollama on :11434, this worker on :8090
#
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   cd C:\care\ocr-worker
#   .\install-windows.ps1
#
# Security:
#   - Generates OCR_WORKER_TOKEN (required). Set the SAME value on Synology CARE API.
#   - Never expose port 8090 to the public internet — LAN / Private firewall only.
#   - Registers a Task Scheduler job so the worker starts after reboot.

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
  Write-Host "    Production still defaults OCR_DEVICE=cpu so Ollama can own the GPU." -ForegroundColor Yellow
  Invoke-Expression "$pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/"
} else {
  Write-Host "==> No nvidia-smi — installing CPU paddlepaddle" -ForegroundColor Yellow
  Invoke-Expression "$pip install paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/"
}

Write-Host "==> Installing paddleocr + FastAPI stack"
Invoke-Expression "$pip install -r requirements.txt"

function New-OcrWorkerToken {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
}

Write-Host "==> Writing default .env (if missing) / ensuring OCR_WORKER_TOKEN"
$envPath = Join-Path $Root ".env"
if (-not (Test-Path $envPath)) {
  $token = New-OcrWorkerToken
  @"
# LAN bind — do NOT publish 8090 to the internet / router WAN.
OCR_WORKER_HOST=0.0.0.0
OCR_WORKER_PORT=8090
OCR_PROFILE=fast
OCR_DEVICE=cpu
OCR_LOW_CONFIDENCE_THRESHOLD=0.80
OCR_RETRY_ACCURATE=true
OCR_WORKER_CONCURRENCY=1
OCR_WARMUP_ON_START=true
OCR_WORKER_REQUIRE_AUTH=true
OCR_WORKER_TOKEN=$token
"@ | Set-Content -Path $envPath -Encoding UTF8
  Write-Host "Generated OCR_WORKER_TOKEN — copy into Synology CARE .env as OCR_WORKER_TOKEN" -ForegroundColor Green
  Write-Host "TOKEN=$token" -ForegroundColor Yellow
} else {
  $raw = Get-Content $envPath -Raw
  if ($raw -notmatch '(?m)^\s*OCR_WORKER_TOKEN\s*=\s*\S+') {
    $token = New-OcrWorkerToken
    Add-Content -Path $envPath -Value "`nOCR_WORKER_REQUIRE_AUTH=true`nOCR_WORKER_TOKEN=$token`n"
    Write-Host "Appended OCR_WORKER_TOKEN to existing .env" -ForegroundColor Green
    Write-Host "TOKEN=$token" -ForegroundColor Yellow
  }
  if ($raw -notmatch '(?m)^\s*OCR_DEVICE\s*=') {
    Add-Content -Path $envPath -Value "`nOCR_DEVICE=cpu`n"
  }
}

# Firewall: allow inbound 8090 on Private (LAN) profile only — never Public.
Write-Host "==> Configuring Windows Firewall (Private profile only)"
$port = 8090
try {
  $existing = Get-Content $envPath | Where-Object { $_ -match '^\s*OCR_WORKER_PORT\s*=' } | Select-Object -First 1
  if ($existing -match '=\s*(\d+)') { $port = [int]$Matches[1] }
} catch {}
$ruleName = "CARE OCR Worker (LAN only)"
try {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $ruleName `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
    -Profile Private `
    -Description "CARE PaddleOCR worker — trusted LAN only. Do not enable on Public profile." | Out-Null
  Write-Host "Firewall rule '$ruleName' allows TCP $port on Private profile only." -ForegroundColor Green
} catch {
  Write-Host "Firewall rule skipped (run as Administrator): $_" -ForegroundColor Yellow
}

# Task Scheduler — start after reboot / at logon
Write-Host "==> Installing Task Scheduler job"
& "$Root\install-task-scheduler.ps1"

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Start now:     .\start-windows.ps1"
Write-Host "Or reboot — Task Scheduler starts CARE-OCR-Worker at logon."
Write-Host "Health:        http://127.0.0.1:$port/health"
Write-Host "Synology CARE: OCR_WORKER_URL=http://<this-pc-lan-ip>:$port"
Write-Host "               OCR_WORKER_TOKEN=<same token as worker .env>"
Write-Host "SECURITY: Never port-forward 8090. Keep OCR + Ollama on trusted LAN only." -ForegroundColor Yellow
