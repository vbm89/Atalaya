# Scheduling: one source, 15m-aligned at :07

Status: proposal. This document changes no workflow, cron-job.org job, secret
or Vercel setting. Apply it by hand once the team is unpaused.

## Rule: ONE SINGLE SCHEDULING SOURCE

Exactly one scheduler calls the deployment, with this schedule:

```
7,22,37,52 * * * *
```

On every run it calls, in this order:

1. `GET /api/watch/tick` with `Authorization: Bearer $WATCH_SECRET` (V1 Watch tick).
2. `POST /api/paper/cron` with `Authorization: Bearer $CRON_SECRET` (durable paper tick).

It **never** calls `/api/bot`. `GET /api/bot` is read-only: it returns the
durable view plus `ledgerBehind` and does not advance the paper ledger.

Shadow V2 replay is never scheduled. Run it on demand with
`POST /api/learn/shadow-replay` (enabled, host and token gated; see
`src/lib/learn/shadow-replay-http.ts`).

### Planned source: GitHub Actions on `main`

The planned source is the `main` workflow
`.github/workflows/atalaya-paper-tick.yml` once PR-1a (commit `fbc14e9`, branch
`fix/api-bot-readonly-paper-cron`) is merged into `main`. That commit keeps the
watch step and adds a separate paper step (`if: always()`).

Until PR-1a is on `main`, nothing schedules `/api/paper/cron`.

GitHub only runs `schedule:` triggers from the default branch. Scheduled runs
are best-effort: they can start late or be skipped. Both endpoints are
idempotent per closed bar, so a late run is safe. A skipped run loses that bar.

Observed (Actions run history, read-only): since 2026-10-01 the `main` schedule
fired only 4–6 times per day instead of 96. Check this before relying on GitHub
Actions as the only source.

### cron-job.org: alternative only, never at the same time

A cron-job.org (or other HTTP cron) job may exist as an external alternative.
`scripts/ops-watch-tick.example.sh` documents a 5-minute job; whether it really
exists is **unverified**.

- If it exists, disable it, or retime it to the schedule above and disable the
  GitHub schedule instead.
- **cron-job.org and GitHub Actions must never run at the same time.**

## Why :07 and not :01

- 15m bars close at :00, :15, :30 and :45. The provider can publish the closed
  bar late.
- **Paper:** `STALE_GIVEUP_SEC = 180` (`src/lib/bot-paper/cycle.ts:16`).
  - If the closed bar is missing and less than 180 s have passed since the
    close, the asset is only marked "waited" and nothing is recorded
    (`cycle.ts:219-221`, `cycle.ts:243-246`).
  - With one call per slot, no later call in that slot retries it. On the next
    slot the bar becomes `LIVE_CATCHUP` ESPERAR, with no signal
    (`cycle.ts:268-271`).
  - From 180 s on, the bar is always closed deterministically: `DATA_STALE` or
    `DATA_ERROR`, ESPERAR (`cycle.ts:247-252`).
- **Watch:**
  - `too_early` before close + `FEED_GRACE_MS` (8 s) (`src/lib/watch/schedule.ts:8`,
    `src/lib/watch/tick.ts:186-193`).
  - `lag` when the BTC 15M bar is not published yet (`tick.ts:216-243`).
  - A `lag` slot is retried only if **another call arrives in the same slot**
    (`src/lib/watch/store.ts:133`, `store.ts:280-283`).
- At :01 (60 s after close), a slow provider can therefore leave the bar
  waited or lagged, with no guaranteed retry inside the slot.
- At :07 (420 s after close), paper is past the 180 s give-up and the feed has
  had minutes to publish. This leaves enough margin.
- Trade-off: Watch notifications arrive about 7 minutes after the close.
- `SERVERLESS_FRESH_SEC = 16 min` (`src/lib/bot-paper/ledger.ts:24`). If a
  scheduled run starts more than about 1 minute later than the previous one,
  the UI can briefly show the paper bot as "DETENIDO".

## Who calls what (from the code)

| Caller | Runs? | Endpoint | Method / secret | Schedule |
| --- | --- | --- | --- | --- |
| `main` `.github/workflows/atalaya-paper-tick.yml` (dacec36) | Yes, schedules only run from `main` | `https://atalaya-dev.vercel.app/api/watch/tick` | GET / `WATCH_SECRET` | `7,22,37,52 * * * *` |
| Same workflow after PR-1a (`fbc14e9`, not on `main` yet) | After merge | + `https://atalaya-dev.vercel.app/api/paper/cron` | POST / `CRON_SECRET`, `if: always()` | same |
| `research/shadow-ob-audit` `.github/workflows/atalaya-paper-tick.yml` | **Never on schedule** (not the default branch) | `/api/bot` | GET / `CRON_SECRET` | `7,22,37,52 * * * *` (inert) |
| cron-job.org (`scripts/ops-watch-tick.example.sh`) | Unverified | `/api/watch/tick` | POST / `WATCH_SECRET` | every 5 min (if it exists) |

## 0540c20 is NOT in this branch

`fix/dev-ops-clean` is built on `4307331` (live DEV) and excludes `0540c20`
(V1-input CME session clock change, not accepted) and the later research
commits. Deploy this exact commit; do not deploy `research/shadow-ob-audit`.

## Migrations are opt-in

`npm run build` still ends with `db:migrate`, but `scripts/migrate.mjs` skips
unless `ALLOW_DB_MIGRATE=1` (`scripts/migrate-guard.mjs`). No Vercel build
migrates by default.

## Checklist (manual, after unpause)

- [ ] Merge PR-1a (`fbc14e9`) into `main` so `/api/paper/cron` is scheduled.
- [ ] Make sure the GitHub Actions secrets `WATCH_SECRET` and `CRON_SECRET`
      match the Vercel values for atalaya-dev.
- [ ] Disable any cron-job.org job (or the GitHub schedule): one source only.
- [ ] Nothing calls `/api/bot` on a schedule.
- [ ] Confirm one run per 15m in the Actions history and in the deployment
      requests.

## Update (perf/anti-cpu PR)

This PR applies the rule above: `.github/workflows/atalaya-paper-tick.yml` now
calls `GET /api/watch/tick` (WATCH_SECRET) and then `POST /api/paper/cron`
(CRON_SECRET, `if: always()`), never `/api/bot`. It supersedes PR #4.
After merging, disable the cron-job.org 5-minute job. `/api/paper/cron` skips
all market fetches when every asset already has the latest closed bar.
