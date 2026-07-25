<#
  Care Diagnostics — Scan Bridge one-click installer (Windows)
  ---------------------------------------------------------------
  Run this from INSIDE the scan-bridge folder on the reception PC:
     Right-click install-windows.ps1  ->  "Run with PowerShell"

  It installs dependencies, configures the bridge for your ERP, registers it to
  start automatically at logon, starts it, and verifies it responds. No admin
  rights required (the auto-start task is per-user).
#>
#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Pause-Exit($code) { Read-Host "Press Enter to close"; exit $code }

Write-Host ""
Write-Host "==  Care Diagnostics  -  Scan Bridge setup  ==" -ForegroundColor Cyan
Write-Host ""

# 0. Must run from the scan-bridge folder
if (-not (Test-Path (Join-Path $here "package.json"))) {
  Write-Host "Run this from inside the 'scan-bridge' folder (package.json was not found here)." -ForegroundColor Red
  Pause-Exit 1
}

# 1. Node.js present?
$nodeV = $null
try { $nodeV = (& node --version) 2>$null } catch { $nodeV = $null }
if (-not $nodeV) {
  Write-Host "Node.js is not installed." -ForegroundColor Red
  Write-Host "Install the LTS version from https://nodejs.org, then run this script again."
  Start-Process "https://nodejs.org/en/download"
  Pause-Exit 1
}
Write-Host "Node.js $nodeV found." -ForegroundColor Green

# 2. Configuration
$defaultErp = "https://caredeoghar.com"
$erp = Read-Host "ERP web address (must match the browser URL) [$defaultErp]"
if ([string]::IsNullOrWhiteSpace($erp)) { $erp = $defaultErp }
$erp = $erp.TrimEnd('/')

Write-Host ""
Write-Host "Scanner type:"
Write-Host "  1) WIA          - any scanner listed in Windows 'Fax and Scan' (recommended)"
Write-Host "  2) folder-watch - your scanner's own software saves images to a folder"
$choice = Read-Host "Choose 1 or 2 [1]"
if ($choice -eq "2") {
  $vendor = "folder-watch"
  $watch = Read-Host "Folder your scanner software saves scans to (e.g. C:\Scans)"
} else {
  $vendor = "wia"
  $watch = ""
}

# 3. Dependencies
Write-Host ""
Write-Host "Installing dependencies (npm install)..." -ForegroundColor Cyan
& npm install --omit=dev
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm install failed. Check your internet connection and try again." -ForegroundColor Red
  Pause-Exit 1
}

# 4. Write a start script with the chosen config baked in
$startCmd = Join-Path $here "start-scan-bridge.cmd"
$lines = @(
  "@echo off",
  "cd /d ""%~dp0""",
  "set ERP_BASE_URL=$erp",
  "set BRIDGE_SCAN_VENDOR=$vendor"
)
if ($vendor -eq "folder-watch") { $lines += "set SCAN_WATCH_FOLDER=$watch" }
$lines += "node src\index.js"
($lines -join "`r`n") | Set-Content -Path $startCmd -Encoding ASCII
Write-Host "Wrote start script: $startCmd"

# 5. Register auto-start at logon (per-user; no admin needed)
$taskName = "CareScanBridge"
$arg = '/c "' + $startCmd + '"'
try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  $action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $arg
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Care Diagnostics document scan bridge" | Out-Null
  Write-Host "Registered auto-start task '$taskName' (starts at each logon)." -ForegroundColor Green
  Start-ScheduledTask -TaskName $taskName
} catch {
  Write-Host "Could not register the auto-start task: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Starting the bridge directly instead (it won't auto-start after reboot)."
  Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WindowStyle Hidden
}

# 6. Verify
Write-Host ""
Write-Host "Verifying the bridge is responding..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 6 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/health" -TimeoutSec 4
    if ($health.ok) { $ok = $true; $vendorReported = $health.vendor }
  } catch { }
}
Write-Host ""
if ($ok) {
  Write-Host "SUCCESS - scan bridge is running (vendor: $vendorReported)." -ForegroundColor Green
  Write-Host "Open Form F in the browser and the 'Existing Scanner' tab will show Online." -ForegroundColor Green
} else {
  Write-Host "The bridge did not answer on http://127.0.0.1:8766 yet." -ForegroundColor Yellow
  Write-Host "Give it a few seconds and refresh Form F. If it stays offline, check that Node.js is on PATH."
}
Pause-Exit 0
