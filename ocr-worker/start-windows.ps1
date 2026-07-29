# Start CARE OCR Worker on Windows (foreground).
# Production: use install-task-scheduler.ps1 so this starts after reboot.
# SECURITY: Port 8090 must stay on trusted LAN only — never expose publicly.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Error "venv missing — run .\install-windows.ps1 first"
}

# Load .env into process env
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $k, $v = $_.Split('=', 2)
    if ($k -and $v -ne $null) {
      [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), "Process")
    }
  }
}

if (-not $env:OCR_DEVICE) { $env:OCR_DEVICE = "cpu" }
if (-not $env:OCR_PROFILE) { $env:OCR_PROFILE = "fast" }
if (-not $env:OCR_WORKER_REQUIRE_AUTH) { $env:OCR_WORKER_REQUIRE_AUTH = "true" }

$requireAuth = ($env:OCR_WORKER_REQUIRE_AUTH -as [string]).ToLower() -notin @("0", "false", "no", "off")
if ($requireAuth -and -not $env:OCR_WORKER_TOKEN) {
  Write-Error "OCR_WORKER_TOKEN required. Re-run .\install-windows.ps1 or set token in .env (and matching Synology OCR_WORKER_TOKEN)."
}

$HostAddr = if ($env:OCR_WORKER_HOST) { $env:OCR_WORKER_HOST } else { "0.0.0.0" }
$Port = if ($env:OCR_WORKER_PORT) { $env:OCR_WORKER_PORT } else { "8090" }

Write-Host "Starting CARE OCR Worker on ${HostAddr}:${Port} (device=$($env:OCR_DEVICE) profile=$($env:OCR_PROFILE) auth=required)" -ForegroundColor Cyan
Write-Host "LAN-only: do not port-forward ${Port}." -ForegroundColor Yellow
# Single worker process — models stay resident; concurrency controlled in-app
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host $HostAddr --port $Port --workers 1
