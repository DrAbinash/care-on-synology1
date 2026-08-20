#Requires -Version 5.1
<#
.SYNOPSIS
  Restore Emergency CARE Postgres from a plain SQL dump.
  WARNING: replaces the emergency database contents. Does NOT touch Main CARE.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SqlFile,
  [switch]$Confirm
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
Set-Location $Root

if (-not (Test-Path $SqlFile)) { throw "SQL file not found: $SqlFile" }
if (-not $Confirm) {
  throw "Refusing to restore without -Confirm. Example: .\Restore-Emergency.ps1 -SqlFile .\backups\dump.sql -Confirm"
}

Write-Host "Restoring $SqlFile into care-emergency-db (DESTRUCTIVE to emergency DB only)..." -ForegroundColor Yellow
Get-Content -Raw $SqlFile | docker compose -f docker-compose.yml -f docker-compose.windows.yml --env-file .env exec -T care-emergency-db `
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if ($LASTEXITCODE -ne 0) { throw "Restore failed" }
Write-Host "Restore complete. Restart API if needed:" -ForegroundColor Green
Write-Host "  docker compose -f docker-compose.yml -f docker-compose.windows.yml --env-file .env restart care-emergency-api"
