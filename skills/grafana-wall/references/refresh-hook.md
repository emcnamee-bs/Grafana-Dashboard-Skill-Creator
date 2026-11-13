# Automatic refresh and the refresh hook

A snapshot is a picture. To keep a tile true without anyone re-running the skill, projects are **registered** and a scheduled task (`GrafanaWallRefresh`, every 2 minutes) runs `scripts/wall-refresh.ps1`.

## What refresh does for free (no hook needed)
For each registered project it starts from `<project>/.grafana-wall/tile.json` and updates:
- **branch**: `git branch --show-current`.
- **activity**: `active` if anything happened in the last 15 minutes (a commit, an edited uncommitted file, or a Claude Code session transcript for that folder), else `idle`. The label is deliberately coarse (`now`, `<1h`, `1h+`, `3h+`, `12h+`, `Nd+`) so the tile does not change every minute.

Everything else (status, task, tests, health, stats, live series) stays as the skill last wrote it unless the project has a hook.

## Redraw only when something visible changed
Every redraw makes the wall's Chrome window for that monitor reload (a ~2 s blink). Refresh therefore hashes the visible tile and calls `snapshot` only when it differs from last time, or when the tile has gone missing from the wall. If only chart numbers moved, it pushes them with `series` (no redraw, no blink). Keep that in mind when writing a hook: do not put things that change every run (timestamps, counters in text) into `task`, `stats` or `health`; put numbers that should move continuously into `series`.

## The hook: `<project>/.grafana-wall/refresh.ps1`
Optional. Runs in its own hidden PowerShell with the project as working directory and a **60 s timeout**. It must print **one JSON object to stdout** and exit 0. Any of these keys are merged into the tile (others are ignored):

| Key | Meaning |
|---|---|
| `status`, `status_label` | `ok`/`warn`/`fail`/`idle`/`building`, optional pill text |
| `task` | current objective text |
| `summary` | one or two sentences on what the tile is (full-screen square view) |
| `tests` | `{passed, failed, skipped?}` |
| `health` | list of `{name, state}`; replaces the tile's list. Items may carry `explain` and `detail` (see `tile-spec.md`, "Interactive detail") |
| `stats` | list of `{label, value, trend?}`; replaces the tile's list. Items may carry `explain` and `detail` (e.g. the members behind a `Containers 5` chip) |
| `charts` | the full list of points charts (see `tile-spec.md`): each with `title`, `subtitle`, `points`, `span_label`, `kpis`, and optionally `explain`, `history`/`history_label`, `breakdown`. Replaces the tile's list, so history is always current. |
| `series` | `{name: number}` current values for legacy live series charts |
| `activity` | `{state, label?}`: lets the hook say `stalled` (should be running but is not). The label stays automatic (coarse git/session recency) unless the hook gives one - for a project that is not a git repo (a host), e.g. `up 1d 4h`. Keep it coarse; it is part of the redraw hash. |

If the hook fails, times out or prints invalid JSON, refresh logs it (`~/.grafana-wall/refresh.log`) and keeps the last known facts for that project, so a broken hook never blanks a tile.

### Rules for hooks
- **Read-only and cheap**: they run every 2 minutes forever. HTTP GETs to health endpoints, `aws ... describe-*`, reading a results file or running a quick read-only database query are fine. Nothing that trades, writes, spends money, or approaches an API rate limit.
- **Chart points must come from clean, aligned buckets** (e.g. `end = floor(now/900)*900`, step 900) so the points only change when the data does; otherwise every refresh looks like a change and the tile is redrawn every 2 minutes. Redraws are seamless (the wrapper loads the new frame behind the old one), but needless ones are still wasted work. Do not put a ticking timestamp in any text field.
- **Detail follows the same alignment rule as chart points.** `history`, `breakdown` and `detail` are part of the redraw hash, so build them from aligned buckets (e.g. 3 h or 1 h boundaries), round totals coarsely (an exact 7-day run count changes every few minutes), and put no ticking timestamps or per-run counters in `why` or `worst` labels. Cache expensive long-range queries (10 min) like the 12 h chart.
- **Definitions beat guesses**: derive "error" and "run" from the project's own dashboards/alert rules, and when a metric you want does not exist (e.g. a consecutive-successes counter), compute it from counters over a range query (successes since the last bucket that contained a failure; show `N+` when no failure appears inside the lookback).
- **No secrets in output**; it ends up on a TV.
- **Fail loudly, never publish guesses.** `$ErrorActionPreference = 'Stop'` does not stop on a native command's exit code: check `$LASTEXITCODE` after every `gh`/`aws`/`curl`, and `throw` (or `exit 1`) when a call fails or returns nothing. A hook that swallows an error and prints empty-looking JSON replaces real facts on the wall with false ones (e.g. "0 open PRs"); a non-zero exit makes refresh keep the last known facts.
- **Never name a helper function after the command it wraps** (`function Gh` calling `& gh`, `function Git` calling `& git`): PowerShell is case-insensitive, so the function calls itself until "call depth overflow". Use `Invoke-GhJson`, `Invoke-GitIn`, etc.
- Pass `gh --json` fields as one string with no spaces (`'number,title'`); in an array splat they become separate arguments and `gh` rejects them.
- Compute health from a real check, never a constant. If a check cannot run, emit `unknown`.
- Prefer reading what the project already records (a ledger, a metrics file, the last test report) over re-deriving it.

### Minimal example
```powershell
# .grafana-wall/refresh.ps1
$up = try { (Invoke-WebRequest https://api.example.com/status -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
$pnl = (Get-Content "$PSScriptRoot\..\data\pnl.txt" -ErrorAction SilentlyContinue) -as [double]
@{
  status = if ($up) { 'ok' } else { 'fail' }
  health = @(@{ name = 'Example API'; state = if ($up) { 'up' } else { 'down' } })
  series = @{ earnings = $pnl }
} | ConvertTo-Json -Depth 5 -Compress
```

## Setup (once per machine, then once per project)
1. `scripts/Install-Refresh.ps1` creates the scheduled task (per-user, no admin). Check first: `Get-ScheduledTask GrafanaWallRefresh`.
2. In each project, after the first successful snapshot: `wall.ps1 register` (run from the project folder). `wall.ps1 projects` lists them, `wall.ps1 unregister -Project slug` stops auto-refresh, and `wall.ps1 release -Slot N` does both release and unregister.
3. `wall.ps1 refresh` runs a refresh immediately.

The wall's kiosk windows reload themselves when a dashboard is redrawn (the supervisor watches the dashboard version), so a redraw appears on the monitor within about 10 seconds.
