#!/usr/bin/env node
/**
 * Neon → Aiven/S3-compatible (B2) DEV storage migrator.
 * Defaults to plan/dry-run. Any write to target/object storage requires --confirm-write.
 * Never prints full connection URLs or passwords.
 *
 * Write path (only with --confirm-write):
 *   - SOURCE: Pool max:1 + SET SESSION default_transaction_read_only = on
 *   - TARGET: Pool max:1 for manifest/checkpoints
 *   - discovery_bars copied by asset/tf with afterT cursor, grouped into UTC-day
 *     JSONL objects on S3-compatible storage (B2); progress in storage_checkpoints
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isMainModule } from "./with-app-env.mjs";

const { Pool } = pg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ host: string, database: string, port: string, user: string }} DbEndpoint */

/**
 * @param {string} url
 * @returns {DbEndpoint}
 */
export function parseDbEndpoint(url) {
  if (!url || !String(url).trim()) throw new Error("Database URL is empty");
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Database URL is not a valid URL");
  }
  const protocol = u.protocol.replace(/:$/, "");
  if (!/^postgres(ql)?$/i.test(protocol)) {
    throw new Error(`Unsupported DB protocol: ${protocol}`);
  }
  const database = decodeURIComponent((u.pathname || "/").replace(/^\//, "") || "");
  if (!database) throw new Error("Database URL missing database name");
  return {
    host: (u.hostname || "").toLowerCase(),
    database: database.toLowerCase(),
    port: u.port || "5432",
    user: decodeURIComponent(u.username || ""),
  };
}

/** @param {string} url */
export function normalizeDbIdentity(url) {
  const e = parseDbEndpoint(url);
  return `${e.host}:${e.port}/${e.database}`;
}

/**
 * @param {string} sourceUrl
 * @param {string} targetUrl
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertDistinctSourceTarget(sourceUrl, targetUrl) {
  if (!sourceUrl?.trim() || !targetUrl?.trim()) {
    return {
      ok: false,
      reason: "SOURCE_DATABASE_URL and TARGET_DATABASE_URL must both be set",
    };
  }
  let a;
  let b;
  try {
    a = normalizeDbIdentity(sourceUrl);
    b = normalizeDbIdentity(targetUrl);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (a === b) {
    return {
      ok: false,
      reason: `SOURCE and TARGET resolve to the same host+db (${a}). Refusing to run.`,
    };
  }
  return { ok: true };
}

/** @param {string} url */
export function redactDatabaseUrl(url) {
  if (!url) return "(unset)";
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = `${u.username.slice(0, 2)}***`;
    return `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  } catch {
    return "(unparseable-url)";
  }
}

/**
 * @param {string[]} argv
 * @returns {{ confirmWrite: boolean, jobId: string, pageSize: number, help: boolean }}
 */
export function parseMigrateArgs(argv) {
  const args = argv.slice(2);
  let confirmWrite = false;
  let help = false;
  let jobId = "dev-storage-migrate";
  let pageSize = 2000;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--confirm-write") confirmWrite = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--job-id" && args[i + 1]) jobId = args[++i];
    else if (a === "--page-size" && args[i + 1]) {
      pageSize = Math.max(1, Math.min(10_000, Number(args[++i]) || 2000));
    }
  }
  return { confirmWrite, jobId, pageSize, help };
}

export const DEFAULT_PLAN_SCOPES = Object.freeze([
  { assetId: "XAUUSD", tf: "15m" },
  { assetId: "XAUUSD", tf: "30m" },
  { assetId: "XAUUSD", tf: "1h" },
  { assetId: "XAUUSD", tf: "4h" },
  { assetId: "BTCUSD", tf: "15m" },
  { assetId: "BTCUSD", tf: "30m" },
  { assetId: "BTCUSD", tf: "1h" },
  { assetId: "BTCUSD", tf: "4h" },
  { assetId: "US100", tf: "15m" },
  { assetId: "US100", tf: "30m" },
  { assetId: "US100", tf: "1h" },
  { assetId: "US100", tf: "4h" },
  { assetId: "WTI", tf: "15m" },
  { assetId: "WTI", tf: "30m" },
  { assetId: "WTI", tf: "1h" },
  { assetId: "WTI", tf: "4h" },
]);

/** Bounded page SQL — mirrors src/lib/storage/pg-ops.ts (no unbounded scans). */
export function buildDiscoveryPageSql(assetId, tf, afterT, limit) {
  const lim = Math.max(1, Math.min(Math.floor(limit), 10_000));
  return {
    text: `select asset_id, tf, t, o, h, l, c, v, source
     from discovery_bars
     where asset_id = $1 and tf = $2 and t > $3
     order by t asc
     limit $4`,
    params: [assetId, tf, afterT, lim],
  };
}

/**
 * @param {{
 *   sourceUrl: string,
 *   targetUrl: string,
 *   confirmWrite: boolean,
 *   jobId: string,
 *   pageSize: number,
 *   scopes?: readonly { assetId: string, tf: string }[],
 *   estimatedCounts?: Record<string, number>,
 * }} opts
 */
export function buildMigrationPlan(opts) {
  const distinct = assertDistinctSourceTarget(opts.sourceUrl, opts.targetUrl);
  if (!distinct.ok) {
    return { ok: false, mode: "misconfigured", error: distinct.reason, steps: [] };
  }

  const scopes = opts.scopes ?? DEFAULT_PLAN_SCOPES;
  const mode = opts.confirmWrite ? "write" : "plan";
  /** @type {Array<Record<string, unknown>>} */
  const steps = [];

  steps.push({
    id: "open-source-readonly",
    action: "connect",
    target: "source",
    detail: "SET SESSION default_transaction_read_only = on",
    source: redactDatabaseUrl(opts.sourceUrl),
  });
  steps.push({
    id: "ensure-target-schema",
    action: "apply_migration_file",
    target: "target",
    file: "migrations/0013_dev_storage_manifest.sql",
    note: "CREATE IF NOT EXISTS + widen backend check for s3; no scientific tables",
    skippedUnlessWrite: true,
  });
  steps.push({
    id: "resume-checkpoint",
    action: "read_checkpoint",
    table: "storage_checkpoints",
    jobId: opts.jobId,
    phase: "discovery_bars_jsonl",
  });

  for (const scope of scopes) {
    const key = `${scope.assetId}/${scope.tf}`;
    steps.push({
      id: `copy-discovery-${scope.assetId}-${scope.tf}`,
      action: "copy_discovery_bars_by_day",
      assetId: scope.assetId,
      tf: scope.tf,
      pageSize: opts.pageSize,
      cursor: "durable afterT = last flushed day only; open currentDay rewound on resume → S3/B2 JSONL",
      estimatedRows: opts.estimatedCounts?.[key] ?? null,
      verify: ["row_count", "content_sha256"],
      skippedUnlessWrite: true,
    });
  }

  steps.push({
    id: "verify-manifest",
    action: "verify_manifest_against_object_storage",
    detail:
      "For each storage_manifest row: HEAD object (size) + GET body SHA-256 vs content_sha256; row_count from non-empty JSONL lines",
    skippedUnlessWrite: true,
  });

  return {
    ok: true,
    mode,
    jobId: opts.jobId,
    source: redactDatabaseUrl(opts.sourceUrl),
    target: redactDatabaseUrl(opts.targetUrl),
    sourceIdentity: normalizeDbIdentity(opts.sourceUrl),
    targetIdentity: normalizeDbIdentity(opts.targetUrl),
    objectStorage: {
      requiredEnv: [
        "OBJECT_STORAGE_ENDPOINT",
        "OBJECT_STORAGE_REGION",
        "OBJECT_STORAGE_ACCESS_KEY_ID",
        "OBJECT_STORAGE_SECRET_ACCESS_KEY",
        "OBJECT_STORAGE_BUCKET",
      ],
      optionalEnv: [],
      note: "Writes to S3-compatible object storage (B2) only with --confirm-write; adapter inactive without env",
    },
    steps,
    writeRequires: "--confirm-write",
    confirmWrite: opts.confirmWrite,
  };
}


/**
 * Canonical discovery JSONL line schema (matches src/lib/storage/jsonl-archive.ts ArchiveBar):
 *   { assetId, tf, t, o, h, l, c, v, source? }
 * Field names are camelCase. `asset_id` is NOT part of the object-storage contract
 * (Postgres columns remain snake_case; mapping happens at read time).
 */

/** @param {number} t unix seconds or ms */
export function utcDayFromT(t) {
  const ms = t > 1e12 ? t : t * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Exclusive lower bound for `t > afterT` to include all bars of UTC day. */
export function afterTBeforeUtcDay(day, timeUnit = "s") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid UTC day: ${day}`);
  }
  const startMs = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(startMs)) throw new Error(`Invalid UTC day: ${day}`);
  if (timeUnit === "ms") return startMs - 1;
  return Math.floor(startMs / 1000) - 1;
}

/**
 * Safe resume: if an open currentDay was checkpointed, rewind afterT to the
 * start of that UTC day so the day is regenerated in full. Clears currentDay.
 * @param {{ scopeIndex?: number, afterT?: number, currentDay?: string | null }} raw
 * @param {"s"|"ms"} [timeUnit]
 */
export function resolveResumeCursor(raw, timeUnit = "s") {
  const scopeIndex = Number(raw?.scopeIndex) || 0;
  let afterT = Number(raw?.afterT) || 0;
  const currentDay = raw?.currentDay ?? null;
  if (currentDay) {
    // Infer ms vs s from afterT magnitude when possible
    const unit = afterT > 1e12 ? "ms" : timeUnit;
    afterT = afterTBeforeUtcDay(currentDay, unit);
    return {
      scopeIndex,
      afterT,
      currentDay: null,
      rewoundDay: currentDay,
      durable: true,
    };
  }
  return {
    scopeIndex,
    afterT,
    currentDay: null,
    rewoundDay: null,
    durable: true,
  };
}

export function discoveryDayObjectKey(assetId, tf, day) {
  return `discovery/${assetId}/${tf}/${day}.jsonl`;
}

/** Map a discovery_bars row → canonical JSONL line (no trailing newline). */
export function barLine(row) {
  const o = {
    assetId: row.asset_id,
    tf: row.tf,
    t: Number(row.t),
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    v: row.v == null ? null : Number(row.v),
  };
  if (row.source != null) o.source = row.source;
  return JSON.stringify(o);
}

/**
 * Pure day-copy loop for tests: pages rows, groups by UTC day, flushes complete days.
 * Checkpoint semantics:
 *   - afterT stored in checkpoints is ONLY advanced after a day flush succeeds
 *     (durableAfterT = last t of last flushed day).
 *   - While a day is open, checkpoints may record currentDay but afterT stays
 *     at durableAfterT (or the rewound day bound).
 * @param {{
 *   assetId: string,
 *   tf: string,
 *   pageSize: number,
 *   initialAfterT?: number,
 *   initialCurrentDay?: string | null,
 *   fetchPage: (afterT: number, limit: number) => Promise<Array<Record<string, unknown>>>,
 *   flushDay: (day: string, text: string, meta: { sha256: string, byteSize: number, rowCount: number, lastT: number }) => Promise<void>,
 *   saveCheckpoint: (cursor: { afterT: number, currentDay: string | null, openDayRows?: number }) => Promise<void>,
 *   shouldCrash?: (info: { phase: string, afterT: number, currentDay: string | null, durableAfterT: number }) => boolean,
 * }} opts
 */
export async function copyDiscoveryScopeByDay(opts) {
  const resumed = resolveResumeCursor({
    afterT: opts.initialAfterT ?? 0,
    currentDay: opts.initialCurrentDay ?? null,
  });
  let durableAfterT = resumed.afterT;
  let afterT = durableAfterT;
  let currentDay = null;
  /** @type {string[]} */
  let dayLines = [];
  let dayHash = createHash("sha256");
  let dayRows = 0;
  let lastTInDay = 0;

  const crash = (phase) => {
    if (
      opts.shouldCrash?.({
        phase,
        afterT,
        currentDay,
        durableAfterT,
      })
    ) {
      const err = new Error(`simulated crash at ${phase}`);
      err.name = "SimulatedMigratorCrash";
      throw err;
    }
  };

  async function flushOpenDay() {
    if (!currentDay || !dayLines.length) {
      currentDay = null;
      dayLines = [];
      dayRows = 0;
      return;
    }
    const text = dayLines.join("\n") + "\n";
    const sha256 = dayHash.digest("hex");
    const byteSize = Buffer.byteLength(text, "utf8");
    const rowCount = dayRows;
    const lastT = lastTInDay;
    const day = currentDay;
    await opts.flushDay(day, text, { sha256, byteSize, rowCount, lastT });
    // Durable advance ONLY after successful flush
    durableAfterT = lastT;
    afterT = durableAfterT;
    currentDay = null;
    dayLines = [];
    dayHash = createHash("sha256");
    dayRows = 0;
    lastTInDay = 0;
    await opts.saveCheckpoint({
      afterT: durableAfterT,
      currentDay: null,
    });
    crash("after-flush-checkpoint");
  }

  await opts.saveCheckpoint({
    afterT: durableAfterT,
    currentDay: null,
  });

  for (;;) {
    const rows = await opts.fetchPage(afterT, opts.pageSize);
    if (!rows.length) break;

    for (const row of rows) {
      const t = Number(row.t);
      const day = utcDayFromT(t);
      if (currentDay != null && day !== currentDay) {
        await flushOpenDay();
      }
      if (currentDay == null) {
        currentDay = day;
        dayLines = [];
        dayHash = createHash("sha256");
        dayRows = 0;
      }
      const line = barLine(row);
      dayLines.push(line);
      dayHash.update(line + "\n");
      dayRows += 1;
      lastTInDay = t;
      // In-memory read cursor may move; durable afterT stays until flush.
      afterT = t;
      // Persist open-day marker with durable afterT (NOT mid-day afterT).
      await opts.saveCheckpoint({
        afterT: durableAfterT,
        currentDay,
        openDayRows: dayRows,
      });
      crash("mid-day-after-row");
    }

    // Page boundary checkpoint (same durable rule).
    await opts.saveCheckpoint({
      afterT: durableAfterT,
      currentDay,
      openDayRows: dayRows,
    });
    crash("after-page-checkpoint");

    if (rows.length < opts.pageSize) break;
  }

  await flushOpenDay();
  return { durableAfterT, flushed: true };
}

/**
 * Verify storage_manifest rows against object storage (HEAD size + GET sha256 + line count).
 * @param {{
 *   listManifest: () => Promise<Array<{ object_key: string, content_sha256: string, byte_size: number|string, row_count: number|string }>>,
 *   headObject: (key: string) => Promise<{ contentLength: number } | null>,
 *   getObjectText: (key: string) => Promise<string>,
 * }} deps
 */
export async function verifyManifestAgainstObjectStorage(deps) {
  const rows = await deps.listManifest();
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  let ok = true;
  for (const row of rows) {
    const key = row.object_key;
    const head = await deps.headObject(key);
    if (!head) {
      ok = false;
      results.push({ key, ok: false, reason: "missing_object" });
      continue;
    }
    const expectedSize = Number(row.byte_size);
    if (head.contentLength !== expectedSize) {
      ok = false;
      results.push({
        key,
        ok: false,
        reason: "byte_size_mismatch",
        expected: expectedSize,
        actual: head.contentLength,
      });
      continue;
    }
    const text = await deps.getObjectText(key);
    const sha = createHash("sha256").update(text, "utf8").digest("hex");
    if (sha !== row.content_sha256) {
      ok = false;
      results.push({
        key,
        ok: false,
        reason: "sha256_mismatch",
        expected: row.content_sha256,
        actual: sha,
      });
      continue;
    }
    const lineCount = text.endsWith("\n")
      ? text.slice(0, -1).split("\n").filter((l) => l.length).length
      : text.split("\n").filter((l) => l.length).length;
    if (lineCount !== Number(row.row_count)) {
      ok = false;
      results.push({
        key,
        ok: false,
        reason: "row_count_mismatch",
        expected: Number(row.row_count),
        actual: lineCount,
      });
      continue;
    }
    results.push({ key, ok: true });
  }
  return { ok, checked: results.length, results };
}

/**
 * Execute write migration. Requires distinct SOURCE/TARGET and OBJECT_STORAGE_* env.
 * @param {{
 *   sourceUrl: string,
 *   targetUrl: string,
 *   jobId: string,
 *   pageSize: number,
 *   scopes?: readonly { assetId: string, tf: string }[],
 *   env?: NodeJS.ProcessEnv,
 *   log?: (s: string) => void,
 * }} opts
 */
export async function executeMigrationWrite(opts) {
  const log = opts.log ?? ((s) => console.log(s));
  const env = opts.env ?? process.env;
  const distinct = assertDistinctSourceTarget(opts.sourceUrl, opts.targetUrl);
  if (!distinct.ok) throw new Error(distinct.reason);

  const requiredObjectStorage = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "OBJECT_STORAGE_BUCKET",
  ];
  const missing = requiredObjectStorage.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new Error(`Object storage inactive for write: missing ${missing.join(", ")}`);
  }

  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } =
    await import("@aws-sdk/client-s3");
  const endpoint = env.OBJECT_STORAGE_ENDPOINT.trim();
  const region = env.OBJECT_STORAGE_REGION.trim();
  const bucket = env.OBJECT_STORAGE_BUCKET.trim();
  // Do not set forcePathStyle (B2 S3 virtual-host).
  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY.trim(),
    },
  });
  const objectStore = {
    async putObject(key, text) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: Buffer.from(text, "utf8"),
          ContentType: "application/x-ndjson",
        }),
      );
    },
    async headObject(key) {
      try {
        const out = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return { contentLength: Number(out.ContentLength ?? 0) };
      } catch (err) {
        const status = err?.$metadata?.httpStatusCode;
        const name = err?.name || "";
        if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
        throw err;
      }
    },
    async getObjectText(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return await out.Body.transformToString("utf8");
    },
    destroy() {
      s3.destroy();
    },
  };

  const sourcePool = new Pool({ connectionString: opts.sourceUrl, max: 1 });
  const targetPool = new Pool({ connectionString: opts.targetUrl, max: 1 });

  const scopes = opts.scopes ?? DEFAULT_PLAN_SCOPES;
  let sourceClient;
  try {
    sourceClient = await sourcePool.connect();
    await sourceClient.query("SET SESSION default_transaction_read_only = on");

    const migrationSql = readFileSync(
      join(ROOT, "migrations/0013_dev_storage_manifest.sql"),
      "utf8",
    );
    await targetPool.query(migrationSql);
    const widenSql = readFileSync(
      join(ROOT, "migrations/0014_storage_backend_object.sql"),
      "utf8",
    );
    await targetPool.query(widenSql);

    await targetPool.query(
      `insert into storage_job (job_id, kind, source_label, target_label, mode, started_at, notes)
       values ($1, $2, $3, $4, 'write', now(), $5)
       on conflict (job_id) do update set mode = 'write', started_at = now(), finished_at = null, notes = excluded.notes`,
      [
        opts.jobId,
        "neon_to_aiven_s3",
        redactDatabaseUrl(opts.sourceUrl),
        redactDatabaseUrl(opts.targetUrl),
        "discovery_bars → S3/B2 JSONL + manifest (safe day resume)",
      ],
    );

    const cpRes = await targetPool.query(
      `select cursor_json, status from storage_checkpoints
       where job_id = $1 and phase = $2 limit 1`,
      [opts.jobId, "discovery_bars_jsonl"],
    );

    let scopeIndex = 0;
    let seedAfterT = 0;
    let resumedScopeIndex = 0;
    if (cpRes.rows[0]?.cursor_json) {
      const raw =
        typeof cpRes.rows[0].cursor_json === "string"
          ? JSON.parse(cpRes.rows[0].cursor_json)
          : cpRes.rows[0].cursor_json;
      scopeIndex = Number(raw.scopeIndex) || 0;
      resumedScopeIndex = scopeIndex;
      seedAfterT = Number(raw.afterT) || 0;
      const resolved = resolveResumeCursor({
        scopeIndex,
        afterT: seedAfterT,
        currentDay: raw.currentDay ?? null,
      });
      if (resolved.rewoundDay) {
        log(
          `[resume] rewound open day ${resolved.rewoundDay} → afterT=${resolved.afterT} (full day regenerate)`,
        );
      } else {
        log(`[resume] scopeIndex=${scopeIndex} afterT=${resolved.afterT}`);
      }
      seedAfterT = resolved.afterT;
    }

    async function saveCheckpoint(status, cursor) {
      const payload = {
        scopeIndex: cursor.scopeIndex,
        afterT: cursor.afterT,
        currentDay: cursor.currentDay,
      };
      await targetPool.query(
        `insert into storage_checkpoints (job_id, phase, cursor_json, status, updated_at)
         values ($1, $2, $3::jsonb, $4, now())
         on conflict (job_id, phase) do update set
           cursor_json = excluded.cursor_json,
           status = excluded.status,
           updated_at = now()`,
        [opts.jobId, "discovery_bars_jsonl", JSON.stringify(payload), status],
      );
    }

    await saveCheckpoint("running", {
      scopeIndex,
      afterT: seedAfterT,
      currentDay: null,
    });

    for (; scopeIndex < scopes.length; scopeIndex += 1) {
      const scope = scopes[scopeIndex];
      // Only the resumed scope keeps seedAfterT; later scopes start at 0.
      const startAfterT = scopeIndex === resumedScopeIndex ? seedAfterT : 0;

      await copyDiscoveryScopeByDay({

        assetId: scope.assetId,
        tf: scope.tf,
        pageSize: opts.pageSize,
        initialAfterT: startAfterT,
        initialCurrentDay: null,
        fetchPage: async (afterT, limit) => {
          const { text, params } = buildDiscoveryPageSql(
            scope.assetId,
            scope.tf,
            afterT,
            limit,
          );
          const page = await sourceClient.query(text, params);
          return page.rows;
        },
        flushDay: async (day, text, meta) => {
          const key = discoveryDayObjectKey(scope.assetId, scope.tf, day);
          await objectStore.putObject(key, text);
          await targetPool.query(
            `insert into storage_manifest
               (object_key, asset_id, tf, day, content_sha256, byte_size, row_count, backend, created_at, updated_at)
             values ($1,$2,$3,$4::date,$5,$6,$7,'s3',now(),now())
             on conflict (object_key) do update set
               content_sha256 = excluded.content_sha256,
               byte_size = excluded.byte_size,
               row_count = excluded.row_count,
               updated_at = now()`,
            [
              key,
              scope.assetId,
              scope.tf,
              day,
              meta.sha256,
              meta.byteSize,
              meta.rowCount,
            ],
          );
          log(`[s3] wrote ${key} rows=${meta.rowCount} sha=${meta.sha256.slice(0, 12)}…`);
        },
        saveCheckpoint: async (c) => {
          await saveCheckpoint("running", {
            scopeIndex,
            afterT: c.afterT,
            currentDay: c.currentDay,
          });
        },
      });

      seedAfterT = 0;
      await saveCheckpoint("running", {
        scopeIndex: scopeIndex + 1,
        afterT: 0,
        currentDay: null,
      });
    }

    // verify-manifest (real)
    const verification = await verifyManifestAgainstObjectStorage({
      listManifest: async () => {
        const res = await targetPool.query(
          `select object_key, content_sha256, byte_size, row_count from storage_manifest`,
        );
        return res.rows;
      },
      headObject: (key) => objectStore.headObject(key),
      getObjectText: (key) => objectStore.getObjectText(key),
    });
    if (!verification.ok) {
      throw new Error(
        `verify-manifest failed: ${JSON.stringify(verification.results.filter((r) => !r.ok))}`,
      );
    }
    log(`[verify-manifest] ok checked=${verification.checked}`);

    await saveCheckpoint("done", {
      scopeIndex: scopes.length,
      afterT: 0,
      currentDay: null,
    });
    await targetPool.query(
      `update storage_job set finished_at = now(), notes = coalesce(notes,'') || ' done'
       where job_id = $1`,
      [opts.jobId],
    );
    log("[done] migration write finished");
  } finally {
    if (sourceClient) sourceClient.release();
    objectStore.destroy();
    await sourcePool.end().catch(() => {});
    await targetPool.end().catch(() => {});
  }
}


export async function runDevStorageMigrateCli(opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const parsed = parseMigrateArgs(argv);

  if (parsed.help) {
    log(`Usage: node scripts/dev-storage-migrate.mjs [--confirm-write] [--job-id ID] [--page-size N]

Neon → Aiven/S3-compatible (B2) migrator. Default mode is plan/dry-run (no writes).

Required env (names only; values never printed):
  SOURCE_DATABASE_URL   Neon (read-only session)
  TARGET_DATABASE_URL   Aiven (must differ from source)
  OBJECT_STORAGE_*      only needed for --confirm-write

Without --confirm-write: prints plan and exits 0 (or 2 if misconfigured).
`);
    return 0;
  }

  const sourceUrl = opts.sourceUrl ?? env.SOURCE_DATABASE_URL ?? "";
  const targetUrl = opts.targetUrl ?? env.TARGET_DATABASE_URL ?? "";

  const plan = buildMigrationPlan({
    sourceUrl,
    targetUrl,
    confirmWrite: parsed.confirmWrite,
    jobId: parsed.jobId,
    pageSize: parsed.pageSize,
  });

  if (!plan.ok) {
    log(JSON.stringify({ ok: false, error: plan.error, mode: plan.mode }, null, 2));
    return 2;
  }

  log(JSON.stringify(plan, null, 2));

  if (!parsed.confirmWrite) {
    log(
      "\n[dry-run] No writes performed. Pass --confirm-write to execute copy to target/object storage.",
    );
    return 0;
  }

  const runWrite = opts.executeWrite ?? executeMigrationWrite;
  await runWrite({
    sourceUrl,
    targetUrl,
    jobId: parsed.jobId,
    pageSize: parsed.pageSize,
    env,
    log,
  });
  return 0;
}

if (isMainModule(import.meta.url)) {
  runDevStorageMigrateCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 2;
    });
}
