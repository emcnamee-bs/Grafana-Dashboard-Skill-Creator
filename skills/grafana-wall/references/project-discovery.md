# Discovering what a project should show

Goal: a few minutes of targeted looking, then a tile built only from facts you actually found. If a signal is not there, leave the module out.

## Identity (always)
- `git rev-parse --show-toplevel`, `git branch --show-current`, `git remote get-url origin` (GitHub is assumed; no remote is fine, skip it). Slug from the folder/repo name, lowercased, non-alphanumerics to `-`; the README title is only for the display name.
- `git log -1 --format=%cr` and `git status --short` give a quick pulse for activity (`active` if the working tree is dirty or the last commit is minutes old, or a process of the project is running; otherwise `idle`).

## APIs and services (for `health`)
Look, in this order, and stop when the picture is clear:
1. Manifests: `requirements.txt` / `pyproject.toml` / `package.json` / `go.mod` - SDK names reveal providers (`kalshi`, `boto3`, `stripe`, `openai`, `slack_sdk`...).
2. Config *names*, not values: `.env.example`, `config/*.yml`, `docker-compose.yml`, `terraform/*.tf`, `serverless.yml`. Env var names like `KALSHI_API_KEY`, `DATABASE_URL`, `AWS_REGION` tell you what the project depends on. **Do not open real `.env` files, key files or credential stores.**
3. Code: `grep -rIn "https\?://"` over source (skip vendored/test fixtures) for base URLs; `grep -n "boto3\|ec2\|lambda\|s3"` for AWS usage.
4. README / docs for stated dependencies and how the thing is run.

Pick the 3-6 dependencies whose failure would break the project. One chip each with a short name.

### Probing health (read-only, cheap)
- HTTP APIs: GET a documented status/health endpoint (or the base URL) with a short timeout; 2xx = `up`, slow or 4xx/5xx = `degraded`, no connection = `down`. Do not call endpoints that cost money, trade, write, or count against tight rate limits.
- AWS: `aws ec2 describe-instance-status`, `aws lambda get-function`, `aws rds describe-db-instances` etc., using whatever profile the project already uses. If AWS access is not already configured, ask before using it.
- Local services: TCP connect to the port, or check the process/container is running.
- Cannot probe? Use `unknown` rather than guessing `up`.

## Tests (for `tests`)
- Find the runner (`pytest.ini`, `pyproject [tool.pytest]`, `package.json scripts.test`, `go test`). Prefer an existing result artifact (`.pytest_cache/v/cache/lastfailed`, `junit.xml`, `coverage` output, CI summary via `gh run list --limit 1`).
- Running the suite is fine if it is fast (under ~1 minute) and has no side effects; otherwise ask or skip.

## Metrics worth a chart or stat
Ask: what number would the user glance at to know the project is doing its job?
- Money/trading: cumulative P&L (`earnings`, line, `span: all`), P&L today, open positions, win rate, fills per hour.
- Services/pipelines: requests per minute, error rate, queue depth, jobs completed, latency.
- Data collectors: rows ingested, last successful run age.
Find where the code already computes or logs it (a ledger table, a metrics function, a results file). The chart needs a *recurring* number, so decide how it gets pushed: from the project's own code at the moment the number changes (best), or from a periodic `refresh.ps1` that reads the source of truth (database query, log tail, API call). Never fabricate or backfill invented history.

## Status and activity rubric
- `ok`: running as intended; dependencies up; tests green. `warn`: a dependency degraded, tests failing, or recent errors. `fail`: required dependency down or the project is crashed. `idle`: nothing meant to be running right now. `building`: uncommitted changes, a deploy in flight, or a feature branch with commits in the last ~15 min (a clean tree on a stable branch with nothing running is `idle`, not `building`).
- Activity `active`: something happened in the last ~15 min (commit, run, trade, request). `stalled`: it should be running continuously but nothing has happened for a long time.

## Also note what could explain each part (for the full-screen views)
While discovering, jot down where an explanation could come from, so the tile can answer "what is this and what is wrong?" on click: what each health light checks (and what a failure of it means), the members behind any count chip (containers, services, workers, queues: name, current health, what each does), the project's own alert rules or dashboard panel descriptions (they define "error" and "bad"), and where longer history exists (a 7-day range query, a ledger table). Record only what you can back with the project or live data; anything unknown stays out and that item opens a minimal view.

## When to ask the user
- Which number is "the" headline metric, when several are plausible.
- Permission for anything with side effects, cost, or new credentials.
- Whether money amounts/account details are OK to show on a shared screen.
Batch these into one short message; otherwise decide and state the choice.
