# DEV storage — Aiven PostgreSQL + Cloudflare R2

Research / DEV only. **PROD, Neon production data path, and Vercel are untouched** by this layer. No migrator write runs unless an operator explicitly passes `--confirm-write` with distinct `SOURCE_DATABASE_URL` / `TARGET_DATABASE_URL` and R2 credentials.

## Architecture

| Role | Store | Contents |
|------|--------|----------|
| OLTP / ops | **Aiven PostgreSQL** | Ops tables, `storage_manifest`, `storage_checkpoints`, `storage_job`, hot `market_m15` (and other short-horizon market state when wired) |
| Historical discovery OHLC | **Cloudflare R2** | Per-asset / per-TF / UTC-day **JSONL** objects under `discovery/{assetId}/{tf}/{YYYY-MM-DD}.jsonl` |

Bookkeeping migration: `migrations/0013_dev_storage_manifest.sql` (idempotent `CREATE IF NOT EXISTS`). No scientific detector / universe / lookback tables.

TypeScript facade: `src/lib/storage/` (`dev-storage.ts` wires PG + R2 + manifest).

## Egress rules

1. **Never** open an unbounded `SELECT` on `discovery_bars`. Every read uses `WHERE asset_id = … AND tf = … AND t > $cursor ORDER BY t ASC LIMIT $n` (`loadDiscoveryBarsPage` / migrator page SQL).
2. SOURCE (Neon) sessions for migration set `default_transaction_read_only = on`.
3. SOURCE and TARGET must resolve to **different** `host:port/database` identities; equal → refuse (exit 2).
4. R2 adapter is **inactive** (`active: false`) when any of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` is missing. Methods throw `InactiveStorageError`. No network client until active.
5. Secrets must not appear in git, logs, or plan JSON (URLs are redacted).

## Migrator dry-run

```bash
# plan only (default) — requires both URLs set and distinct
SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… npm run storage:migrate:plan
# or:
node scripts/dev-storage-migrate.mjs
```

- Prints a JSON plan: steps, scopes (asset×tf), verify hooks (`row_count`, `content_sha256`), redacted endpoints.
- Exits **0** after the plan when configuration is valid.
- Exits **2** if URLs missing/equal/unparseable.
- **`--confirm-write`** is required for any write to Aiven or R2. This research commit implements the write path but operators must opt in; CI / default scripts never pass the flag.

Resumability: `storage_checkpoints` keyed by `(job_id, phase)` with `cursor_json` (`scopeIndex`, `afterT`, …).

## Environment variable names (no values)

| Name | Purpose |
|------|---------|
| `SOURCE_DATABASE_URL` | Neon (or other) read source for migration |
| `TARGET_DATABASE_URL` | Aiven DEV target (ops + manifest) |
| `DATABASE_URL` | App runtime DB (unchanged contract; not used by the migrator plan) |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | Optional custom S3 endpoint (default `https://{account}.r2.cloudflarestorage.com`) |

Do not commit `.env*` or place secrets in the repo.

## Explicit non-goals

- No change to V1 trading files or K1 detectors.
- No `DATABASE_URL` migration apply against Aiven/Neon as part of this research task’s validation.
- No copy-ops / export-bars / ingest against live SOURCE/TARGET in validation.
- No Vercel / PROD push or deploy from this workstream.
