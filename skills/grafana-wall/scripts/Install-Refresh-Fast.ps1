# Registers the GrafanaWallRefreshFast scheduled task (per-user, no admin): runs wall-refresh-fast.ps1, a loop that refreshes the projects
# marked "fastSec" in ~/.grafana-wall/projects.json every N seconds. Triggers: at logon, and every 5 minutes as a watchdog (the loop's own
# mutex and -MultipleInstances IgnoreNew keep it to one copy). Safe to re-run. Remove: Unregister-ScheduledTask GrafanaWallRefreshFast -Confirm:$false
$script = Join-Path $PSScriptRoot 'wall-refresh-fast.ps1'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"; $logon.Delay = 'PT1M'
$tick = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'GrafanaWallRefreshFast' -Action $action -Trigger @($logon, $tick) -Settings $set -Force | Out-Null
Write-Host 'Registered scheduled task GrafanaWallRefreshFast (loop; watchdog every 5 min).'
