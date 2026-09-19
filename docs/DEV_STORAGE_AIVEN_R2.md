# DEV storage — Aiven PostgreSQL + S3-compatible object storage (Backblaze B2)

Research / DEV only. **PROD, Neon production data path, and Vercel are untouched** by this layer. No migrator write runs unless an operator explicitly passes `--confirm-write` with distinct `SOURCE_DATABASE_URL` / `TARGET_DATABASE_URL` and `OBJECT_STORAGE_*` credentials.

> Filename kept for continuity (`DEV_STORAGE_AIVEN_R2.md`). Cloudflare R2 account ID is **not** used; storage is generic S3-compatible (B2).

## Architecture

| Role | Store | Contents |
|------|--------|----------|
| OLTP / ops | **Aiven PostgreSQL** | Ops tables, `storage_manifest`, `storage_checkpoints`, `storage_job`, hot `market_m15` (and other short-horizon market state when wired) |
| Historical discovery OHLC | **S3-compatible object storage (Backblaze B2)** | Per-asset / per-TF / UTC-day **JSONL** objects under `discovery/{assetId}/{tf}/{YYYY-MM-DD}.jsonl` |

Bookkeeping migrations:

- `migrations/0013_dev_storage_manifest.sql` — idempotent `CREATE IF NOT EXISTS`
- `migrations/0014_storage_backend_object.sql` — widens `backend` check to `('r2','s3','pg')`

**Apply `0014` on Aiven before writing manifest rows with `backend = 's3'`.** Do not run migrate against Aiven as part of automated validation.

TypeScript facade: `src/lib/storage/` (`dev-storage.ts` wires PG + object storage + manifest). Primary adapter: `s3-adapter.ts` (`ObjectStorageAdapter`). R2-named exports are **aliases** only.

## Egress rules

1. **Never** open an unbounded `SELECT` on `discovery_bars`. Every read uses `WHERE asset_id = … AND tf = … AND t > $cursor ORDER BY t ASC LIMIT $n` (`loadDiscoveryBarsPage` / migrator page SQL).
2. SOURCE (Neon) sessions for migration set `default_transaction_read_only = on`.
3. SOURCE and TARGET must resolve to **different** `host:port/database` identities; equal → refuse (exit 2).
4. Object storage adapter is **inactive** (`active: false`) when any of `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_BUCKET` is missing/empty. Methods throw `InactiveStorageError`. No network client until active.
5. Secrets must not appear in git, logs, or plan JSON (URLs are redacted).
6. S3 client uses the configured endpoint + region; **does not** set `forcePathStyle` (B2 S3 virtual-host works with the endpoint; default `false`).

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
- **`--confirm-write`** is required for any write to Aiven or object storage. Operators must opt in; CI / default scripts never pass the flag.

Resumability: `storage_checkpoints` keyed by `(job_id, phase)` with `cursor_json` (`scopeIndex`, `afterT`, …).

## Environment variable names (no values)

| Name | Purpose |
|------|---------|
| `SOURCE_DATABASE_URL` | Neon (or other) read source for migration |
| `TARGET_DATABASE_URL` | Aiven DEV target (ops + manifest) |
| `DATABASE_URL` | App runtime DB (unchanged contract; not used by the migrator plan) |
| `OBJECT_STORAGE_ENDPOINT` | S3 API endpoint (example: `https://s3.us-east-005.backblazeb2.com`) |
| `OBJECT_STORAGE_REGION` | Region string (example: `us-east-005`) — **not** `"auto"` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Application key id |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Application key |
| `OBJECT_STORAGE_BUCKET` | Bucket name (example: `atalaya-dev-storage`) |

Examples above are documentation only — **not** hardcoded required defaults in code.

Do not commit `.env*` or place secrets in the repo.

## Explicit non-goals

- No change to V1 trading files or K1 detectors.
- No `DATABASE_URL` migration apply against Aiven/Neon as part of this research task’s validation.
- No copy-ops / export-bars / ingest against live SOURCE/TARGET/B2 in validation.
- No Vercel / PROD push or deploy from this workstream.
- No live B2 / R2 / Aiven object IO from this research commit’s validation.


## JSONL contract (canonical)

Each object `discovery/{assetId}/{tf}/{YYYY-MM-DD}.jsonl` is UTF-8 NDJSON.

Per line (stable field order):

```json
{"assetId":"XAUUSD","tf":"15m","t":1704067200,"o":1,"h":2,"l":0.5,"c":1.5,"v":9,"source":"..."}
```

- **camelCase** `assetId` (not `asset_id`). DB columns stay snake_case; the migrator/`barToJsonlLine` map at the boundary.
- Manual B2 smokes that used `asset_id` were non-canonical probes only.

## Migrator resume (safe mid-day)

Checkpoints store:

- `afterT`: **durable** — last `t` of the last **fully flushed** UTC day (or `0`)
- `currentDay`: open day being built (buffer is **not** persisted)

On resume, if `currentDay` is set, the migrator **rewinds** `afterT` to just before that UTC day and regenerates the entire day, overwriting the object. Durable `afterT` never advances past an incomplete day.

## verify-manifest

After write, the migrator runs `verifyManifestAgainstObjectStorage`: for each `storage_manifest` row, HEAD (byte size), GET (SHA-256 + row count) must match the manifest. Failure aborts the job.
