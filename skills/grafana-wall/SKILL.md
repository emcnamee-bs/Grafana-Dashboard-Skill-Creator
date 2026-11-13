---
name: grafana-wall
description: Put the current project on the user's Grafana monitor wall - claims the next vacant square (18 squares across 3 monitors) and fills it with a live status tile built from one fixed template - a rich top bar (project name, status, git branch chip, activity, PRs/failures chips, health lights for the project's key parts, current task) over a landscape row of 2-3 charts, each with its own KPI chips. If the user does not say which charts they want, the skill has an agent propose candidates and asks the user to pick up to three. Also refreshes or releases a project's square. Use this whenever the user mentions the wall, the monitors, the Grafana square/tile/board/dashboard for a project, "put this on the wall", "show this project on my screens", "update my tile", "free up the slot", or wants any project's live status visible on the Grafana displays - even if they don't say "skill". Accepts free-text guidance when invoked (e.g. "error history over 12 hours for each canary, with the weekly error rate and the success streak") and during the run.
---

# Grafana wall

The user has three TVs running a Grafana "wall": 18 squares (slots 01-18, six per monitor: top 01-06, middle 07-12, bottom 13-18). Each running project gets one square. Squares are meant to look like one family: **the same template for every project, with the content swapped**, so a glance across the wall compares like with like.

You gather facts about the project, send a **tile spec** (a small JSON file) to the wall server, and the server draws the square. You decide *what is worth showing*; the template decides *how it looks*. The canaries square is the reference for what a good one looks like.

## The template (fixed - do not invent layouts)

**Top bar** (all of it, always in this shape; optional parts only when you have real data):
- **Name** of the project and a **status pill** (ok / warn / fail / idle / building) whose text summarises state (`ALL GREEN`, `5 FAILING`, `DOWN`).
- **Git chip** (branch) and **activity chip** (`active`/`idle` with a coarse age).
- **Stat chips**: the few numbers that say how it's going - typically PRs open, failures in 24h, checks failing; up to 6.
- **Health lights** for the project's *key parts* (APIs, services, hosts, CI): one bordered pill each, green/amber/red/grey.
- **Task line**: what is in flight (an open PR, current branch goal), if there is one.

**Charts row** (the bottom half): **2 or 3 charts side by side, equal width, landscape** (1 is allowed only if the project truly has a single useful series). Each chart sits in its own bordered box with a title, an optional subtitle (units/window), up to **two KPI chips** (a number that explains the chart, e.g. `ERR 7D 0.4%`, `STREAK 128`), the chart itself, and a `-12h ... max N ... now` footer. Chart data travels *inside* the spec as `points`, so history is there from the first draw.

**Explorable**: on the wall every box lights up on hover and opens a full-screen view on click (top bar = the whole square with every chart large; a stat chip, health light, chart or KPI = just that, with more history, percentages and a short explanation; Esc closes). The server draws these views from fields you supply (`summary`, `explain`, `detail`, `history`, `breakdown`; see `references/tile-spec.md`).

Everything has a border; colours, fonts and spacing are fixed by the server. Projects differ only in which chips, lights, charts and KPIs they have. If a project has nothing chart-worthy yet, publish the top bar alone (it fills the square) and say so; never pad with fake charts.

## Before you start

1. Run `& "$HOME\.claude\skills\grafana-wall\scripts\wall.ps1" slots` (call the script by absolute path; you will be sitting in the project's folder, not the skill's). If it fails with a connection error, the wall is not configured or the server is down: tell the user plainly and stop; do not guess keys or URLs. Setup is `WALL_URL`+`WALL_KEY` env vars or `~/.grafana-wall.json`. Use a LAN-resolvable host name (`<host>.local`), not a bare name Tailscale may have remapped.
2. Note whether this project already owns a slot (the slug appears in the listing). If so you are *refreshing*; the slot stays the same.
3. If the wall is full, say who occupies what and ask which to release. Never release another project's slot without being told to.

## Deciding the charts

1. **The user named them** (what to plot, over what window, and what extra numbers per chart): that is the brief. Build exactly those, up to 3. If they named more than 3, ask which three.
2. **The user did not name them** (e.g. "put this on the wall"): do not guess silently. Spawn a **graph-candidate agent** (the Agent tool, a read-only research subagent; give it the prompt in `references/chart-candidates.md` and the project path). It reads the project and returns 4-6 candidates, each with: a title, what it plots and over what window, the data source and query that would back it, suggested KPI chips, and a confidence/effort note. Then present the best candidates as a **multiple-choice list** with `AskUserQuestion` (`multiSelect: true`, up to 4 options per question; put your recommended ones first and say "pick up to 3"; the built-in "Other" lets them name their own). If they pick more than 3, ask which three to keep. If the agent finds nothing chart-worthy, say so and publish the top bar only.
3. Charts must be backed by **real data you can query now** (a Prometheus/Grafana the project already feeds, a ledger table, logs, an API). If a chart the user wants has no reachable data yet, leave that chart out, publish the rest, and tell the user exactly what is missing (access, a metric to add) in the report. Do not draw an empty box.

Treat the user's guidance (at invocation or later) as binding; fold mid-run changes in and re-render. Ask only about things that change the tile and that you cannot decide; batch questions.

## Workflow

1. **Identify**: slug = project folder (or repo) name, lowercased, non-alphanumerics to `-` (stable identity; the README title can be the display `name`, max 22 chars), `git branch --show-current`; a missing remote is fine.
2. **Discover** per `references/project-discovery.md`: manifests, env-var *names*, README, base URLs, compose/terraform, tests, existing dashboards and alert rules (they define what "failure" means here). Never open `.env` files or print secrets.
3. **Choose the top-bar content**: key parts for health lights (3-5), the stat chips, status rules, task. Status: `ok` working, `warn` degraded or some checks failing, `fail` a key part down, `idle` nothing running, `building` uncommitted work/deploy in flight. Activity: `active` if anything happened in ~15 min, else `idle`.
4. **Choose the charts** (see above), then for each: the query for its points (aim for ~24-60 points, aligned to clean time buckets so the picture only changes when the data does), the KPI chips (max 2) and how each is computed. Write the definitions down for the user (e.g. "update canary: error = failed probe; streak = iterations since the last failed probe").
5. **Write the hook** `.grafana-wall/refresh.ps1` in the project: it queries the facts, builds status, health, stat chips, task **and the charts with their points and KPIs**, and prints one JSON object. Read `references/refresh-hook.md` first (contract, safety rules, the fail-loudly rule). It must be read-only and cheap; ask before using credentials the project does not already use. Also write `.grafana-wall/tile.json` (the base spec; the hook's output overrides its facts) and keep `.grafana-wall/` out of the repo's git status via `.git/info/exclude` unless the user wants it committed.

   **Make it explorable.** Write a concise `explain` (≤200 chars: what it is, what bad looks like) for every stat chip, health light, chart and KPI, and a one-sentence `summary` for the tile, in `.grafana-wall/tile.json`. Have the hook return, from real data: `history` for each chart (a longer window than the tile shows, aligned buckets), `breakdown` when success/error counts exist, and `detail` for anything that is a list or has a cause (the members of a "5 containers" chip with each one's health and purpose; a `why` for a degraded/down light, e.g. which check is failing). Keep every sentence short.
6. **Validate and publish**: run the hook by hand and read its output; `wall.ps1 snapshot -File .grafana-wall/tile.json -Dry`; then publish (run `wall.ps1 refresh`, or snapshot without `-Dry`) and `wall.ps1 slots` to confirm. Register the project for auto-refresh: `wall.ps1 register` from the project folder; install the refresher once per machine if `Get-ScheduledTask GrafanaWallRefresh` finds nothing (`scripts/Install-Refresh.ps1`).
7. **Look at it.** Capture the monitor or render the dashboard and check: nothing clipped, charts readable, numbers correct. Fix and republish until it is right.
8. **Report back** briefly: slot/monitor, what the top bar and each chart show, how each number is defined, what refreshes automatically, what you could not include and why, and a question or two about what to change. The layout is expected to evolve with the user's feedback.

## Guardrails

- Everything is shown on a TV in a shared space: no secrets, tokens, account numbers, customer names. Dollar amounts and P&L are the user's call; ask once if unsure.
- Probes and queries are read-only and cheap; never trigger side effects, spend money or hammer an API.
- Never invent data or backfill invented history. A number you cannot get shows `?`, a health you cannot probe is `unknown`.
- One project, one slot. Refresh in place; `wall.ps1 release -Slot N` frees a slot and stops auto-refresh. Do not release other projects' slots unasked.
- Validation errors name the field: read them, fix and retry; do not hide failures from the user.
- `explain`/`detail` text is shown on a TV: no secrets, and say only what you can support from the project or the live data (a `why` you cannot back with data stays out; that item then opens a minimal view).
