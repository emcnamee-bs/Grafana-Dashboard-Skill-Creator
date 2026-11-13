# Grafana wall

A wall of 18 live project tiles on three kiosk monitors, fed by a Claude Code skill.

```
Claude Code skill (grafana-wall)  --tile spec JSON-->  slot-writer  --draws-->  Grafana dashboards wall-top / wall-middle / wall-bottom
        |                                                   |
        '-- wall.ps1 series (live numbers) --> slot-writer --> Pushgateway --> Prometheus --> chart panels
```

| Path | What |
|---|---|
| `skills/grafana-wall/` | The skill (`SKILL.md`, `references/`, `scripts/wall.ps1`). Copy to `~/.claude/skills/grafana-wall`. |
| `server/slot-writer/` | Stdlib-Python service (Docker) on the Grafana host: validates specs, claims slots, pushes series, redraws tiles. |
| `board/build_board.ps1` | Builds the blank 18-slot board (3 dashboards x 6 slots). |
| `kiosk/` | Windows supervisor (`GrafanaWall.ps1`, `Install.ps1`, `monitors.example.json`): one fullscreen kiosk Chrome window per monitor, restarted if it crashes. Each window opens the slot-writer's `/wall/<dashboard>?w=95` wrapper page (see below). |

## Slots

Slots 01-06 are the top monitor, 07-12 middle, 13-18 bottom. A new project takes the lowest vacant slot, so a monitor fills before the next one is used. A project keeps its slot when refreshed.

## Server API (`X-Wall-Key` header required except `/health`)

| Call | Purpose |
|---|---|
| `GET /slots` | Slot states and owners |
| `POST /snapshot[?dry=1]` | Validate a tile spec, claim/refresh a slot, redraw (dry = report only) |
| `POST /series` | Push live chart values without redrawing |
| `POST /release/<n>` | Return a slot to vacant |

Tile spec: `skills/grafana-wall/references/tile-spec.md`. Layout and colours live in the `CONFIG` block at the top of `app.py`.

## Deploying the server

On the Grafana host, with the compose stack in `~/monitoring`: copy `server/slot-writer/` to `~/monitoring/slot-writer/`, create `.env` there with `GRAFANA_TOKEN` (service-account token, Editor) and `WALL_KEY` (shared secret), then `docker compose up -d --build slot-writer`. Prometheus should run with `--storage.tsdb.retention.time=5y` so "all-time" charts stay true. Never commit `.env`.

## Client configuration

`WALL_URL` + `WALL_KEY` environment variables, or `~/.grafana-wall.json` = `{"url": "http://<host>:8088", "key": "<WALL_KEY>"}`.

## Automatic refresh

`skills/grafana-wall/scripts/Install-Refresh.ps1` registers a scheduled task that runs `wall-refresh.ps1` every 2 minutes. For each project registered with `wall.ps1 register` it keeps the git branch and activity current, runs the project's optional `.grafana-wall/refresh.ps1` hook (status, tests, health, stats, chart series) and redraws the tile only when something visible changed. Details: `skills/grafana-wall/references/refresh-hook.md`.
## Kiosk wrapper page (overscan margin + live reload)

`GET /wall/<dashboard-uid>?w=95` (unauthenticated: static HTML only) serves a page that frames the Grafana dashboard at `w`% of the screen width (default 95, 50-100), centred on the dashboard's own dark background. TVs crop edges (overscan) and a kiosk Chrome window snaps back to full-monitor size if resized, so the margin has to live in the page. The page also polls `/wall/<uid>/version` every 5 s and reloads only the frame when the dashboard is redrawn (Grafana never re-reads a dashboard's layout by itself). Requires Grafana with `GF_SECURITY_ALLOW_EMBEDDING=true`. `/api/health` is an alias of `/health` so the supervisor's Grafana health check works against this port.

## Reaching the host by name

Use a name that resolves on the LAN (`<host>.local` via mDNS), not a bare hostname: a Tailscale install can add a hosts-file entry that maps the bare name to a tailnet address that may not forward your ports.
## Tile template (v2)

Every tile uses one fixed template: a bordered top bar (name, status pill, git chip, activity, stat chips, health lights, task) over a landscape row of 2-4 equal charts, each with up to two KPI chips. Charts carry their own `points` (drawn server-side as a base64 SVG image, because Grafana's text panel strips inline SVG), so history is present from the first draw. See `skills/grafana-wall/references/tile-spec.md`. If a user does not name the charts, the skill spawns a graph-candidate agent and asks a multiple-choice question (`references/chart-candidates.md`).