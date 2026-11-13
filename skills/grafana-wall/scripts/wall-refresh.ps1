<#
  wall-refresh.ps1 - keeps registered projects' wall tiles current. Run by the GrafanaWallRefresh scheduled task every 2 minutes
  (install with Install-Refresh.ps1) or by hand: wall.ps1 refresh.

  For each project in ~/.grafana-wall/projects.json:
    1. start from <project>/.grafana-wall/tile.json (the spec the skill authored)
    2. refresh the facts we can read for free: git branch, activity (git/Claude-session/file recency)
    3. run the project's optional .grafana-wall/refresh.ps1 hook and merge the JSON it prints (status, task, tests, health, stats, series, activity)
    4. redraw the tile ONLY if something visible changed (every redraw reloads that monitor), otherwise just push the live series.
  Log: ~/.grafana-wall/refresh.log

  Fast lane: a project entry in projects.json with "fastSec": N is skipped by the normal 2-minute run and instead refreshed by
  wall-refresh-fast.ps1 (task GrafanaWallRefreshFast), which runs this script with -Fast every N seconds for those projects only.
#>
param([switch]$Fast)
$ErrorActionPreference = 'Stop'
$wall = Join-Path $PSScriptRoot 'wall.ps1'
$home2 = Join-Path $HOME '.grafana-wall'; $stateDir = Join-Path $home2 'state'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$logFile = Join-Path $home2 'refresh.log'
function Log($m) {
  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 512KB) { Move-Item $logFile "$logFile.old" -Force }
  Add-Content $logFile ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $m)
}

$created = $false
$mutex = New-Object System.Threading.Mutex($true, $(if ($Fast) { 'Global\GrafanaWallRefreshFast' } else { 'Global\GrafanaWallRefresh' }), [ref]$created)
if (-not $created) { return }

function Set-Prop($o, $n, $v) { if ($o.PSObject.Properties[$n]) { $o.$n = $v } else { $o | Add-Member -NotePropertyName $n -NotePropertyValue $v } }

function Invoke-GitIn($dir, [string[]]$a) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & git -C $dir @a 2>$null; if ($LASTEXITCODE -eq 0) { return $out } else { return $null } } finally { $ErrorActionPreference = $old }
}

# Minutes since this project last showed signs of life: newest of last commit, a recently edited uncommitted file,
# or the Claude Code session transcript for the folder.
function Get-IdleMinutes($dir) {
  $times = @()
  $ct = Invoke-GitIn $dir @('log', '-1', '--format=%ct')
  if ($ct) { $times += [DateTimeOffset]::FromUnixTimeSeconds([long]$ct).LocalDateTime }
  $st = Invoke-GitIn $dir @('status', '--porcelain')
  foreach ($line in @($st) | Select-Object -First 50) {
    if (-not $line -or $line.Length -lt 4) { continue }
    $rel = $line.Substring(3).Trim('"'); if ($rel -like '.grafana-wall*') { continue }
    $f = Join-Path $dir $rel
    if (Test-Path $f) { $times += (Get-Item $f -Force).LastWriteTime }
  }
  $mangled = $dir -replace '[^A-Za-z0-9]', '-'
  $tdir = Join-Path $HOME ".claude\projects\$mangled"
  if (Test-Path $tdir) { $t = Get-ChildItem $tdir -Filter *.jsonl -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($t) { $times += $t.LastWriteTime } }
  if (-not $times) { return [double]::PositiveInfinity }
  return ((Get-Date) - ($times | Sort-Object -Descending | Select-Object -First 1)).TotalMinutes
}

# Coarse buckets on purpose: a label that changes every minute would redraw (and reload) the monitor every refresh.
function Get-ActivityLabel($min) {
  if ($min -le 15) { return 'now' }
  if ($min -lt 60) { return '<1h' }
  if ($min -lt 180) { return '1h+' }
  if ($min -lt 720) { return '3h+' }
  if ($min -lt 1440) { return '12h+' }
  return ('{0}d+' -f [math]::Floor($min / 1440))
}

$reg = @(); $regFile = Join-Path $home2 'projects.json'
if (Test-Path $regFile) { $reg = @((Get-Content $regFile -Raw | ConvertFrom-Json).projects) | Where-Object { $_ } }
$reg = @($reg | Where-Object { $isFast = [bool]($_.PSObject.Properties['fastSec'] -and $_.fastSec); if ($Fast) { $isFast } else { -not $isFast } })
if (-not $reg) { return }

try { $occupied = @(& $wall slots | ForEach-Object { if ($_ -match '^\s*\d+\s+occupied\s+(\S+)') { $Matches[1] } }) }
catch { Log "wall unreachable: $($_.Exception.Message)"; return }

foreach ($p in $reg) {
  try {
    $dir = $p.dir; $slug = $p.project
    $tilePath = Join-Path $dir '.grafana-wall\tile.json'
    if (-not (Test-Path $tilePath)) { Log "[$slug] skipped: $tilePath missing"; continue }
    $tile = Get-Content $tilePath -Raw | ConvertFrom-Json

    $branch = Invoke-GitIn $dir @('branch', '--show-current')
    if ($branch) { Set-Prop $tile 'branch' ([string]$branch) }
    $idle = Get-IdleMinutes $dir
    $act = [pscustomobject]@{ state = $(if ($idle -le 15) { 'active' } else { 'idle' }); label = (Get-ActivityLabel $idle) }

    $series = $null
    $hook = Join-Path $dir '.grafana-wall\refresh.ps1'
    if (Test-Path $hook) {
      $outFile = Join-Path $stateDir "$slug.hook.out"; Remove-Item $outFile -ErrorAction SilentlyContinue
      $proc = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$hook`"" -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput $outFile -PassThru
      $null = $proc.Handle                     # caching the handle is what makes ExitCode readable later (known Start-Process -PassThru quirk)
      $finished = $proc.WaitForExit(60000)
      if ($finished) { $proc.WaitForExit() }   # the untimed wait flushes redirected output and populates ExitCode (null after only a timed wait)
      # a failing hook means "do not touch the tile this cycle": the wall keeps showing what it last drew
      if (-not $finished) { & taskkill.exe /PID $proc.Id /T /F *> $null; Log "[$slug] hook timed out (60s); tile left as is"; continue }
      elseif ($proc.ExitCode -ne 0) { Log "[$slug] hook exit '$($proc.ExitCode)'; tile left as is"; continue }
      else {
        try {
          $patch = Get-Content $outFile -Raw | ConvertFrom-Json
          foreach ($k in 'status', 'status_label', 'task', 'alert', 'summary', 'tests', 'health', 'stats', 'charts', 'showcase') { if ($patch.PSObject.Properties[$k]) { Set-Prop $tile $k $patch.$k } }
          if ($patch.activity -and $patch.activity.state) { $act.state = $patch.activity.state }   # e.g. 'stalled'
          if ($patch.activity -and $patch.activity.label) { $act.label = [string]$patch.activity.label }   # non-git projects (a host) own their label
          if ($patch.series) { $series = $patch.series }
        } catch { Log "[$slug] hook output is not valid JSON ($($_.Exception.Message)); tile left as is"; continue }
      }
    }
    Set-Prop $tile 'activity' $act
    if ($series) { Set-Prop $tile 'series' $series }

    # hash everything visible (not the series values, which change constantly and need no redraw)
    $vis = $tile | ConvertTo-Json -Depth 10 -Compress
    $visObj = $tile | ConvertTo-Json -Depth 10 | ConvertFrom-Json; if ($visObj.PSObject.Properties['series']) { $visObj.PSObject.Properties.Remove('series') }
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes(($visObj | ConvertTo-Json -Depth 10 -Compress)))).Replace('-', '')
    $hashFile = Join-Path $stateDir "$slug.hash"
    $old = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { '' }
    $missing = $occupied -notcontains $slug
    # an "all" chart's time range is set at draw time (since the first sample), so redraw such tiles every ~6h to keep it widening
    $widen = (@($tile.charts | Where-Object { $_.span -eq 'all' }).Count -gt 0) -and (Test-Path $hashFile) -and (((Get-Date) - (Get-Item $hashFile).LastWriteTime).TotalHours -gt 6)

    if ($hash -ne $old -or $missing -or $widen) {
      $tmp = Join-Path $stateDir "$slug.tile.json"
      [IO.File]::WriteAllText($tmp, $vis, (New-Object Text.UTF8Encoding $false))
      & $wall snapshot -File $tmp | Out-Null
      Set-Content $hashFile $hash -Encoding ascii
      Log "[$slug] redrawn ($(if ($missing) { 'tile was missing' } elseif ($widen) { 'widening all-time chart' } else { 'content changed' }))"
    } elseif ($series) {
      $pairs = @($series.PSObject.Properties | ForEach-Object { '{0}={1}' -f $_.Name, [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $_.Value) })
      & $wall series -Project $slug @pairs | Out-Null
    }
  } catch { Log "[$($p.project)] error: $($_.Exception.Message)" }
}
