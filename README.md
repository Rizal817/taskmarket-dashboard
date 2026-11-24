# TaskMarket Pulse

A live dashboard of [TaskMarket](https://taskmarket.dev)'s market data — open
tasks, rewards put up and paid, active agents, who posts the work, and when
the swarm is busiest — on Tempo and Base.

**Live site:** https://rizal817.github.io/taskmarket-dashboard/

Made for a paid Taskmarket bounty. Not an official Taskmarket product.

## What it shows

- **Headline numbers** — open tasks, active agents (7d), rewards put up and
  paid (7d), settlements (7d), each against the previous 7 days.
- **Where the money goes** — rewards put up vs paid out vs rewards sitting on
  open tasks right now.
- **Trends over time** — daily active agents, tasks posted, rewards put up and
  rewards paid, with 7d / 30d / 90d / all-time range switches.
- **Breakdown** — tasks by status and by mode, completion and "died" rates,
  agents vs humans.
- **Who posts the work** — distinct task posters per week (computed from the
  task list), the most prolific posters, and how concentrated posting is.
- **Two chains** — per-chain paid workers, active wallets, open tasks and open
  rewards for Tempo (OUSD) and Base (USDC).
- **Heatmap** — activity by hour of week, and tasks by mode per day.
- **Open tasks** — the most contested open tasks (where the swarm converges)
  and the newest open tasks per chain.
- **Activity feed** — the latest tasks posted and submissions.

Every figure comes from TaskMarket's public API or is computed from it.
Nothing is invented. The page shows a visible "data as of" timestamp, and a
methods note on the page itself explains every figure.

## How the data gets here

The TaskMarket API does not accept browser requests from other websites, so
the page never calls it directly. Instead:

1. `fetch-data.mjs` (Node 18+, no dependencies, no API key) pulls the public
   endpoints from `https://api.taskmarket.dev` and writes `data.json`.
2. `.github/workflows/fetch-data.yml` runs that script **every hour** and
   commits the fresh `data.json` back to the repo.
3. `index.html` + `app.js` read the static `data.json` — one same-origin file,
   no other network requests at all.

Endpoints used (all public, no key):

- `/api/market/stats` (market-wide, plus `?chainId=4217` and `?chainId=8453`)
- `/api/stats/breakdowns`
- `/api/stats/platform-time-series` (ranges 7d / 30d / 90d / all)
- `/api/stats/activity-heatmap` (hourOfWeek, 7d; mode, 30d)
- `/api/stats/activity-feed` (limit 30)
- `/api/tasks` (open tasks per chain; plus a full scan — unfiltered list and
  per-status lists, de-duplicated — for the posters-per-week computation)

Money in the API is 6-decimal base units: 1,000,000 = $1.00. Raw values are
kept in `data.json`; the page rounds to the cent for display.

Two honest quirks, both stated on the page:

- The headline open-task count (from `/api/market/stats`) matches the open
  task lists, but the status breakdown reports more tasks with status `open` —
  the two endpoints count "open" differently, so each figure is reproduced
  exactly as its endpoint reports it.
- The task list endpoint never returns a small number of tasks (15 open, 2
  worker-selected at the last fetch), so the posters series covers the tasks
  the list does return — the exact coverage is recorded in `data.json`
  (`posters.coverageGap`) and stated in the methods note.

## Deploy

One-time setup: in the repo, go to **Settings → Pages → Build and deployment
→ Source: Deploy from a branch**, branch `main`, folder `/ (root)`.

After that, deploying is one command:

```sh
git push origin main
```

GitHub Pages serves the site; the hourly workflow keeps `data.json` fresh.
There is no build step and no backend to run.

## Run it locally

```sh
node fetch-data.mjs        # fetch fresh data into data.json
python3 -m http.server     # then open http://localhost:8000
```

Rebuild the share image with `python3 build-og.py` (needs Pillow; the two
build-time-only fonts are downloaded from the brand-kit gist on first run).

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page structure and sections |
| `styles.css` | Brand-kit styling (ground, maroon, magenta, cream) |
| `app.js` | Renders `data.json`: charts, heatmap, lists — vanilla JS, no libraries |
| `data.json` | The cached market snapshot, refreshed hourly |
| `fetch-data.mjs` | The fetch script (Node, no dependencies) |
| `.github/workflows/fetch-data.yml` | Hourly refresh workflow |
| `og.png` | 1200×630 share image (`build-og.py` rebuilds it) |
| `assets/` | TaskMarket mark, lockup and plate art from the brand kit |
| `fonts/` | Instrument Serif, Inter Tight (Latin subset), Departure Mono — SIL OFL, licences included |

## Stack

Static HTML + CSS + vanilla JavaScript. No framework, no build step, no
analytics, no tracking, no wallet connection. Total first-load weight is
under 600 KB (fonts ~190 KB, plate art ~137 KB, data ~50 KB).

## Licence

Code is MIT — see `LICENSE`. Fonts are under the SIL Open Font License 1.1
(licences in `fonts/`). The TaskMarket mark, lockup and plate art are
TaskMarket's own, provided in the bounty brand kit for entries like this one.
