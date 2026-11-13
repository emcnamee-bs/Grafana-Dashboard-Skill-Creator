# Graph-candidate agent

Use this when the user has not said which charts they want. Spawn a read-only research subagent (Agent tool, `general-purpose` or `Explore`) with the prompt below, filling in the project path. It must not edit files, run anything with side effects, or print secrets. Take its answer, trim it to the best 4-6, and offer them to the user as a multiple-choice list (`AskUserQuestion`, `multiSelect: true`, pick up to 4).

## Prompt

> You are helping decide which 2-4 charts should appear on a project-status tile shown on a wall of TVs. The tile has a top bar (name, status, git branch, activity, PRs/failures chips, health lights for key parts) and a landscape row of charts, each with a title and up to two KPI chips. The viewer glances at it from across a room: which charts would tell them most about whether this project is healthy and making progress?
>
> Project folder: `<path>` (read-only: read manifests, README, docs, config *names* (never open `.env` or key files), source, existing dashboards/alert rules/CI config, test config). Do not run anything that changes state.
>
> Return 4-6 candidate charts, best first. For each give:
> 1. **title** (<= 22 chars) and **subtitle** (what it plots, unit, window, <= 26 chars);
> 2. **what it shows and why a viewer would care** (one sentence);
> 3. **data source**: the exact thing that can supply points *right now* (a Prometheus/Grafana the project already feeds with the metric names, a database table/column, a log/results file, an API endpoint) and the query or command; say how many points it yields and how far back it goes;
> 4. **up to two KPI chips** that explain it (label <= 12 chars, value, how computed) - e.g. a rate over a longer window, a current streak, a total;
> 5. **reachability**: can it be queried read-only from this machine today (yes / needs access X / needs a metric added);
> 6. **definition risks**: anything ambiguous about what counts as an error/success/run, with your proposed definition.
>
> Prefer charts that exist in the project's own dashboards or alert rules (they encode what the team already watches), over invented ones. Prefer one chart per distinct component/service over several charts of the same thing. Do not propose anything whose data you cannot name. If the project has no chart-worthy data, say so plainly instead of padding.

## Presenting the options

Turn each candidate into one option: label = the chart title, description = what it shows + KPI chips + reachability in a line. Mark the 2-4 you would pick with "(Recommended)". Ask: "Which charts should go on the square? Pick up to 4." If the user picks more than four, ask which four. If the user types their own in "Other", treat it as a named chart and verify its data source before promising it.
