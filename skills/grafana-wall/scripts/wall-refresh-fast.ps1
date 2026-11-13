# wall-refresh-fast.ps1 - fast lane for wall tiles. Loops forever: every N seconds runs wall-refresh.ps1 -Fast, which refreshes ONLY the
# projects whose entry in ~/.grafana-wall/projects.json has "fastSec" (the normal 2-minute task skips those). N = the smallest fastSec,
# re-read every cycle, so editing projects.json takes effect without a restart. Started by task GrafanaWallRefreshFast (Install-Refresh-Fast.ps1).
# Each cycle is a child powershell (a hang or leak dies with it), killed after 60 s. ASCII only (PS 5.1 reads ANSI).
$ErrorActionPreference = 'Stop'
$created = $false
$loopMutex = New-Object System.Threading.Mutex($true, 'Global\GrafanaWallRefreshFastLoop', [ref]$created)
if (-not $created) { return }                      # another loop is already running
$refresh = Join-Path $PSScriptRoot 'wall-refresh.ps1'
$regFile = Join-Path $HOME '.grafana-wall\projects.json'

function Get-Interval {
  $min = 0
  try {
    foreach ($p in @((Get-Content $regFile -Raw | ConvertFrom-Json).projects)) {
      if ($p -and $p.PSObject.Properties['fastSec'] -and $p.fastSec) { $s = [int]$p.fastSec; if ($min -eq 0 -or $s -lt $min) { $min = $s } }
    }
  } catch { }
  if ($min -eq 0) { return 0 }
  [math]::Max(5, $min)                             # floor: a cycle (git + hook + redraw) takes a few seconds
}

while ($true) {
  $t0 = Get-Date
  $iv = Get-Interval
  if ($iv -eq 0) { Start-Sleep -Seconds 30; continue }       # nothing is on the fast lane right now
  try {
    $proc = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$refresh`"", '-Fast' -WindowStyle Hidden -PassThru
    $null = $proc.Handle
    if (-not $proc.WaitForExit(60000)) { & taskkill.exe /PID $proc.Id /T /F *> $null }
  } catch { }
  $left = $iv - ((Get-Date) - $t0).TotalSeconds
  if ($left -gt 0) { Start-Sleep -Milliseconds ([int]($left * 1000)) }
}
