<#
  wall.ps1 - tiny client for the Grafana wall's slot-writer (PowerShell 5.1+ / pwsh).
  Connection: env WALL_URL + WALL_KEY, else ~/.grafana-wall.json {"url": "...", "key": "..."}. The key is never printed.

  wall.ps1 slots                                  show all 18 slots (vacant / occupied by whom)
  wall.ps1 snapshot -File tile.json [-Dry]        claim/refresh this project's slot; -Dry validates + reports the layout only
  wall.ps1 series -Project slug name=value ...    push live values for chart series without redrawing the tile
  wall.ps1 release -Slot N                        put the vacant tile back (and stop auto-refreshing that project)
  wall.ps1 register [-Dir path]                   add a project (needs .grafana-wall/tile.json) to the auto-refresh list
  wall.ps1 unregister -Project slug               remove a project from the auto-refresh list
  wall.ps1 projects                               list auto-refreshed projects
  wall.ps1 refresh                                run the auto-refresh now (same thing the scheduled task does)
#>
param(
  [Parameter(Position = 0, Mandatory)][ValidateSet('slots', 'snapshot', 'series', 'release', 'register', 'unregister', 'projects', 'refresh')][string]$Command,
  [string]$File, [switch]$Dry, [string]$Project, [int]$Slot, [string]$Dir,
  [Parameter(ValueFromRemainingArguments)][string[]]$Pairs
)
$ErrorActionPreference = 'Stop'
$regDir = Join-Path $HOME '.grafana-wall'; $regFile = Join-Path $regDir 'projects.json'
function Get-Reg { if (Test-Path $regFile) { @((Get-Content $regFile -Raw | ConvertFrom-Json).projects) | Where-Object { $_ } } else { @() } }
function Save-Reg($list) { New-Item -ItemType Directory -Force $regDir | Out-Null; @{ projects = @($list) } | ConvertTo-Json -Depth 4 | Set-Content $regFile -Encoding UTF8 }

if ($Command -eq 'projects') { Get-Reg | ForEach-Object { '{0,-24} {1}' -f $_.project, $_.dir }; return }
if ($Command -eq 'unregister') { if (-not $Project) { throw 'unregister needs -Project slug' }; Save-Reg @(Get-Reg | Where-Object { $_.project -ne $Project }); "unregistered $Project"; return }
if ($Command -eq 'register') {
  if (-not $Dir) { $Dir = (Get-Location).Path }
  $Dir = (Resolve-Path $Dir).Path
  $tilePath = Join-Path $Dir '.grafana-wall\tile.json'
  if (-not (Test-Path $tilePath)) { throw "No $tilePath - publish a tile first (see the skill)." }
  $slug = (Get-Content $tilePath -Raw | ConvertFrom-Json).project
  $entry = [pscustomobject]@{ project = $slug; dir = $Dir }
  $prev = @(Get-Reg | Where-Object { $_.project -eq $slug }) | Select-Object -First 1
  if ($prev -and $prev.PSObject.Properties['fastSec'] -and $prev.fastSec) { $entry | Add-Member -NotePropertyName fastSec -NotePropertyValue $prev.fastSec }   # keep a fast-lane setting across re-register
  Save-Reg (@(Get-Reg | Where-Object { $_.project -ne $slug }) + $entry)
  "registered $slug ($Dir) for auto-refresh"; return
}
if ($Command -eq 'refresh') { & (Join-Path $PSScriptRoot 'wall-refresh.ps1'); return }

$url = $env:WALL_URL; $key = $env:WALL_KEY
if (-not $url -or -not $key) {
  $cfgFile = Join-Path $HOME '.grafana-wall.json'
  if (Test-Path $cfgFile) { $c = Get-Content $cfgFile -Raw | ConvertFrom-Json; if (-not $url) { $url = $c.url }; if (-not $key) { $key = $c.key } }
}
if (-not $url -or -not $key) { throw "No wall connection. Set WALL_URL/WALL_KEY or create ~/.grafana-wall.json with url and key." }
$h = @{ 'X-Wall-Key' = $key }

function Call($method, $path, $body) {
  try {
    if ($null -ne $body) { Invoke-RestMethod -Uri "$url$path" -Method $method -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' }
    else { Invoke-RestMethod -Uri "$url$path" -Method $method -Headers $h }
  } catch {
    $resp = $_.Exception.Response; $detail = ''
    if ($resp) { try { $detail = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    throw "wall $method $path failed: $($_.Exception.Message) $detail"
  }
}

switch ($Command) {
  'slots' { $s = Call GET '/slots' $null; $s.PSObject.Properties | ForEach-Object { '{0,2}  {1,-9} {2}' -f $_.Name, $_.Value.state, $_.Value.project } }
  'snapshot' {
    if (-not $File) { throw 'snapshot needs -File tile.json' }
    $spec = Get-Content $File -Raw | ConvertFrom-Json
    # Convenience: if the tile says activity is happening but gives no label, stamp the local time (the server has no timezone).
    if ($spec.activity -and -not $spec.activity.label) { $spec.activity | Add-Member -NotePropertyName label -NotePropertyValue (Get-Date -Format 'MMM d HH:mm') -Force }
    Call POST ($(if ($Dry) { '/snapshot?dry=1' } else { '/snapshot' })) ($spec | ConvertTo-Json -Depth 10) | ConvertTo-Json -Depth 6
  }
  'series' {
    if (-not $Project -or -not $Pairs) { throw 'series needs -Project slug and name=value pairs' }
    $o = [ordered]@{}; foreach ($p in $Pairs) { $k, $v = $p -split '=', 2; $o[$k] = [double]::Parse($v, [Globalization.CultureInfo]::InvariantCulture) }
    Call POST '/series' (@{ project = $Project; series = $o } | ConvertTo-Json -Depth 4) | ConvertTo-Json
  }
  'release' {
    if (-not $Slot) { throw 'release needs -Slot N' }
    $who = ((Call GET '/slots' $null).PSObject.Properties | Where-Object { $_.Name -eq "$Slot" }).Value.project
    Call POST "/release/$Slot" $null | Out-Null
    # a released project must not be redrawn by the auto-refresh a few minutes later
    if ($who) { Save-Reg @(Get-Reg | Where-Object { $_.project -ne $who }) }
    "slot $Slot released" + $(if ($who) { " ($who removed from auto-refresh)" } else { '' })
  }
}
