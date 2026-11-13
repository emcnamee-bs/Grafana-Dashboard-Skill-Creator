# Tile spec (v2)

JSON sent to `POST /snapshot` (via `wall.ps1 snapshot -File tile.json`, or produced each refresh by merging a project's hook output into `.grafana-wall/tile.json`). The server validates strictly; errors name the field. All text is HTML-escaped by the server. Unknown keys are ignored.

## Fields

| Field | Type | Notes |
|---|---|---|
| `project` | slug, required | `[a-z0-9][a-z0-9_-]{0,39}`. The tile's identity; reusing it refreshes the same slot. |
| `name` | text, max 22 shown | Display name in the top bar. Defaults to `project`. |
| `status` | `ok` `warn` `fail` `idle` `building` | Pill colour. Default `idle`. |
| `status_label` | text ≤14 | Pill text that summarises state: `ALL GREEN`, `5 FAILING`, `DOWN`. Defaults to the status word. |
| `branch` | text ≤40 | The git chip. |
| `activity` | `{state, label?}` | `state`: `active` `idle` `stalled`; `label` ≤24 (the client stamps the time if omitted). |
| `stats` | up to **6** × `{label, value, trend?, explain?, detail?}` | Top-bar chips: `label` ≤16, `value` ≤12 chars of display text, `trend` `up` `down` `flat`. Typical: open PRs, failures 24h, checks failing. `explain`/`detail`: see "Interactive detail". |
| `health` | up to 8 × `{name, state, explain?, detail?}` | Lights for the project's key parts. `state`: `up` `degraded` `down` `unknown`; `name` ≤18. `explain`/`detail`: see "Interactive detail". |
| `task` | text ≤90 (52 shown) | What is in flight. |
| `alert` | `{label?, text, state?, items?}` | Optional second banner in the same box right under the `task` line (e.g. the canary alerts). `label` <=10 (default `ALERT`), `text` <=90 (52 shown; the most urgent alert, in plain English), `state` `ok` `warn` `bad` (colours the label: quiet / being looked at / needs a human), `items` up to 12 x `{text <=90, state}` listed when the banner is clicked (full-screen view). Needs the hook output key `alert` (wall-refresh passes it through). Example: `{"label":"CHECKING","text":"Update canary is offline","state":"warn","items":[...]}` |
| `summary` | text ≤240 | One or two sentences on what the tile is; shown in the full-screen square view and as the top bar's hover tip. |
| `charts` | up to 4 (use 2-3) | See below. |
| `tests`, `layout`, `series` | legacy | Only used by the legacy series-chart layout (below). |
| `slot` | 1-18 | Optional: claim this specific vacant slot instead of the next one (a project that already owns a slot keeps it; an occupied slot is a conflict). |
| `showcase` | `{interval?, items[]}` | Optional rotating tile instead of the status template: one item at a time, animated, looping forever. `interval` 3-60 s (default 10); 1-100 `items` of `{group? ≤20, title ≤34, text ≤140}`. `name`/`status`/`status_label` still fill the top bar; charts/stats/health are ignored. Example: `examples/claude-skills/` (the Claude Skills square). |

## Charts (template v2: inline points)

```json
{ "title": "Provisioning", "subtitle": "errors / 15 min", "kind": "line", "span_label": "12h",
  "points": [[1791380700, 0], [1791381600, 2], ...],
  "kpis": [ {"label": "ERR 7D", "value": "0.5%", "state": "ok"}, {"label": "STREAK", "value": "128"} ] }
```
- `points`: up to 200 `[epoch_seconds, value]` pairs (or `{"t":..,"v":..}` objects). Use ~24-60 points on clean time buckets.
- `kind`: `line` (default) or `bar`. `title` ≤22, `subtitle` ≤26, `span_label` ≤8 (shows as `-12h` at the left of the footer; the footer also shows the max and `now`).
- `y_max` (optional number): fixes the top of the y-axis; the left axis shows `y_max`, half of it, and `0`, with gridlines at the top and middle. Use it when the viewer should read a fixed scale (e.g. `10` errors per bucket). If a point exceeds it the axis grows to the next clean value so nothing is clipped. Without it the axis auto-fits to a clean value (1, 2, 5, 10, 20, 50, ...).
- `kpis`: up to 2 chips per chart: `label` ≤12, `value` ≤10, optional `state` `ok`/`warn`/`bad` (colours the value).
- 2-3 charts are laid side by side in one landscape row at equal width; do not mix points charts and series charts in one tile.

The tile is one card: top bar (name, status, git chip, activity, stat chips, health lights, task) over the chart row. Every item has its own border. With no charts the top bar fills the square.

## Interactive detail (all optional; every field degrades to a minimal view when absent)

On the wall every box lights on hover and opens a full-screen view on click (top bar = the whole square; a chip, health light, chart or KPI = just that thing; Esc closes). These fields fill those views. `explain` is also the box's hover tooltip. This works on every status tile (with or without charts); the rotating `showcase` tile is not explorable.

| Field | On | Notes |
|---|---|---|
| `explain` | stat, health light, chart, KPI | ≤200 chars: what it is and what bad looks like. |
| `detail` | stat, health light | `{ "why": text ≤240, "items": [{ "name" ≤24, "state": up/degraded/down/unknown, "what" ≤120 }] }`, up to 12 items. `why` is what is going on right now (from real data); `items` lists the members (e.g. the 5 containers behind a `Containers 5` chip). |
| `history` | chart | Longer window than `points` (up to 400 `[epoch, value]` pairs) plus `history_label` (≤8, e.g. `7d`). Use clean aligned buckets. |
| `breakdown` | chart | `{ "ok_pct", "err_pct", "total", "worst": [{ "label" ≤24, "value" ≤12 }] }` (≤5 worst). Omit it and the viewer derives quiet/active buckets and the worst buckets from `history`. |

```json
{ "summary": "Always-on checks that provision, update and play content on test players.",
  "stats": [ { "label": "Containers", "value": "5", "explain": "Docker containers on the host.",
               "detail": { "why": "4 of 5 healthy", "items": [ { "name": "grafana", "state": "up", "what": "Dashboards" } ] } } ],
  "charts": [ { "title": "Update", "points": [...], "explain": "Failed update probes per 30 minutes.",
                "history": [...], "history_label": "7d",
                "breakdown": { "ok_pct": 99.5, "err_pct": 0.5, "total": 1800, "worst": [ { "label": "Tue 14:00", "value": "3 err" } ] },
                "kpis": [ { "label": "ERR 7D", "value": "0.5%", "state": "ok", "explain": "Share of runs in the last 7 days that failed." } ] } ] }
```
Each KPI also takes `explain` (≤200). The whole tile (spec plus payload) must stay under 120 KB and the request under 256 KB; the server answers 400 and names the problem otherwise. Everything here is part of the redraw hash: use aligned buckets and no ticking numbers (see `refresh-hook.md`).

## Legacy series charts

`{ "title", "series", "kind": line|bar|stat, "span": 1h..90d|all, "unit", "share" }` draws native Grafana panels reading numbers pushed with `wall.ps1 series` (history starts at the first push). Kept for compatibility and for cases where a live Grafana panel is wanted; the fixed template above is preferred.

## Example (a services project)

```json
{
  "project": "canaries", "name": "Canaries", "status": "warn", "status_label": "5 FAILING", "branch": "main",
  "activity": {"state": "idle", "label": "16d+"}, "task": "PR #44: Add HTTP notice intake to failure-log-capture",
  "health": [{"name": "CI build", "state": "up"}, {"name": "Provisioning", "state": "up"},
             {"name": "Update", "state": "degraded"}, {"name": "Content", "state": "up"}],
  "stats": [{"label": "Failures 24h", "value": "7"}, {"label": "Checks failing", "value": "5"}, {"label": "Open PRs", "value": "1"}],
  "charts": [ {"title": "Provisioning", "subtitle": "errors / 15 min", "points": [...], "span_label": "12h",
               "kpis": [{"label": "ERR 7D", "value": "0.5%", "state": "ok"}, {"label": "STREAK", "value": "128"}]},
              {"title": "Update", "...": "..."}, {"title": "Content", "...": "..."} ]
}
```
