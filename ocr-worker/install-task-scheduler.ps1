# Register Task Scheduler job so CARE OCR Worker starts after reboot / at logon.
# Run as Administrator. Safe to re-run (replaces existing task).
#
#   .\install-task-scheduler.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $Root "start-windows.ps1"
$TaskName = "CARE-OCR-Worker"

if (-not (Test-Path $StartScript)) {
  Write-Error "Missing start-windows.ps1 at $StartScript"
}

$ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""

$action = New-ScheduledTaskAction -Execute $ps -Argument $arg -WorkingDirectory $Root
# At logon of the installing user — worker needs GPU/user session context for some drivers.
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

Write-Host "Scheduled task '$TaskName' registered (AtLogOn). Start now with: Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Green
