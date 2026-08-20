#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
Set-Location $Root

Write-Host "Creating logical SQL backup..." -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.windows.yml --env-file .env exec -T care-emergency-api /bin/sh /app/backup.sh
if ($LASTEXITCODE -ne 0) { throw "Backup failed" }
Write-Host "Backup complete (see care_emergency_backups volume or EMERGENCY_BACKUP_DIR)." -ForegroundColor Green
