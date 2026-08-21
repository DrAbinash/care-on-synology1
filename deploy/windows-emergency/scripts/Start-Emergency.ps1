#Requires -Version 5.1
<#
.SYNOPSIS
  One-command start for Windows Emergency CARE (Docker Desktop).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
Set-Location $Root

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.windows.example") {
    Copy-Item ".env.windows.example" ".env"
    Write-Host "Created .env from .env.windows.example — edit secrets before production use." -ForegroundColor Yellow
  } else {
    throw "Missing .env — copy .env.windows.example to .env and set EMERGENCY_FETCH_TOKEN + PRIMARY_CARE_URL"
  }
}

Write-Host "Starting Windows Emergency CARE stack..." -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.windows.yml --env-file .env up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }

$port = "8080"
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*EMERGENCY_HTTP_PORT\s*=\s*(.+)\s*$') { $port = $Matches[1].Trim() }
}

Write-Host ""
Write-Host "Waiting for health..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw "Health check failed on http://127.0.0.1:$port/health" }

Write-Host "Emergency CARE is UP" -ForegroundColor Green
Write-Host "Open: http://127.0.0.1:$port/  (or http://<this-pc-lan-ip>:$port/)"
Write-Host "UI: CARE Billing Desk layout + EMERGENCY MODE banner"
