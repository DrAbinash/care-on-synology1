# Start CARE OCR Worker on Windows (foreground). For a service, use NSSM or Task Scheduler.
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

$HostAddr = if ($env:OCR_WORKER_HOST) { $env:OCR_WORKER_HOST } else { "0.0.0.0" }
$Port = if ($env:OCR_WORKER_PORT) { $env:OCR_WORKER_PORT } else { "8090" }

Write-Host "Starting CARE OCR Worker on ${HostAddr}:${Port} (device=$($env:OCR_DEVICE) profile=$($env:OCR_PROFILE))" -ForegroundColor Cyan
# Single worker process — models stay resident; concurrency controlled in-app
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host $HostAddr --port $Port --workers 1
