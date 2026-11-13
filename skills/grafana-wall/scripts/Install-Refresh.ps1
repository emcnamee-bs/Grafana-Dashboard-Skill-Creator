# Registers the GrafanaWallRefresh scheduled task (per-user, no admin): at logon and every 2 minutes it runs wall-refresh.ps1.
# Safe to re-run. Remove with: Unregister-ScheduledTask GrafanaWallRefresh -Confirm:$false
$script = Join-Path $PSScriptRoot 'wall-refresh.ps1'
# conhost --headless: no console window at all. Plain `powershell.exe -WindowStyle Hidden` flashes a Windows Terminal window (and steals focus) on every run.
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"; $logon.Delay = 'PT1M'
$tick = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'GrafanaWallRefresh' -Action $action -Trigger @($logon, $tick) -Settings $set -Force | Out-Null
Write-Host 'Registered scheduled task GrafanaWallRefresh (every 2 min).'
