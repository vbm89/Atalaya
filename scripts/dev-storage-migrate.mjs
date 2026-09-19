#!/usr/bin/env node
/**
 * Neon → Aiven/R2 DEV storage migrator.
 * Defaults to plan/dry-run. Any write to target/R2 requires --confirm-write.
 * Never prints full connection URLs or passwords.
 *
 * Write path (only with --confirm-write):
 *   - SOURCE: Pool max:1 + SET SESSION default_transaction_read_only = on
 *   - TARGET: Pool max:1 for manifest/checkpoints
 *   - discovery_bars copied by asset/tf with afterT cursor, grouped into UTC-day
 *     JSONL objects on R2; progress in storage_checkpoints
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
    note: "CREATE IF NOT EXISTS only; no scientific tables",
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
      cursor: "afterT ascending; group by UTC day → R2 JSONL",
      estimatedRows: opts.estimatedCounts?.[key] ?? null,
      verify: ["row_count", "content_sha256"],
      skippedUnlessWrite: true,
    });
  }

  steps.push({
    id: "verify-manifest",
    action: "verify",
    detail: "Compare source counts vs storage_manifest row_count / sha256",
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
    r2: {
      requiredEnv: [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
      ],
      optionalEnv: ["R2_ENDPOINT"],
      note: "Writes to R2 only with --confirm-write; adapter inactive without env",
    },
    steps,
    writeRequires: "--confirm-write",
    confirmWrite: opts.confirmWrite,
  };
}

function utcDayFromT(t) {
  const ms = t > 1e12 ? t : t * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function discoveryDayObjectKey(assetId, tf, day) {
  return `discovery/${assetId}/${tf}/${day}.jsonl`;
}

function barLine(row) {
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
 * Execute write migration. Requires distinct SOURCE/TARGET and R2 env.
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

  const requiredR2 = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ];
  const missing = requiredR2.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new Error(`R2 inactive for write: missing ${missing.join(", ")}`);
  }

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const accountId = env.R2_ACCOUNT_ID.trim();
  const endpoint =
    (env.R2_ENDPOINT && env.R2_ENDPOINT.trim()) ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  const bucket = env.R2_BUCKET.trim();
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
    },
  });
  const r2 = {
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

    await targetPool.query(
      `insert into storage_job (job_id, kind, source_label, target_label, mode, started_at, notes)
       values ($1, $2, $3, $4, 'write', now(), $5)
       on conflict (job_id) do update set mode = 'write', started_at = now(), finished_at = null, notes = excluded.notes`,
      [
        opts.jobId,
        "neon_to_aiven_r2",
        redactDatabaseUrl(opts.sourceUrl),
        redactDatabaseUrl(opts.targetUrl),
        "discovery_bars → R2 JSONL + manifest",
      ],
    );

    const cpRes = await targetPool.query(
      `select cursor_json, status from storage_checkpoints
       where job_id = $1 and phase = $2 limit 1`,
      [opts.jobId, "discovery_bars_jsonl"],
    );
    /** @type {{ scopeIndex: number, afterT: number, currentDay: string | null, dayLines: string[], daySha: import('node:crypto').Hash | null, dayRows: number }} */
    let cursor = {
      scopeIndex: 0,
      afterT: 0,
      currentDay: null,
      dayLines: [],
      daySha: null,
      dayRows: 0,
    };
    if (cpRes.rows[0]?.cursor_json) {
      const raw =
        typeof cpRes.rows[0].cursor_json === "string"
          ? JSON.parse(cpRes.rows[0].cursor_json)
          : cpRes.rows[0].cursor_json;
      cursor.scopeIndex = Number(raw.scopeIndex) || 0;
      cursor.afterT = Number(raw.afterT) || 0;
      cursor.currentDay = raw.currentDay ?? null;
      log(`[resume] scopeIndex=${cursor.scopeIndex} afterT=${cursor.afterT}`);
    }

    async function flushDay(assetId, tf, day, lines, shaHex, rowCount) {
      if (!day || !lines.length) return;
      const text = lines.join("\n") + "\n";
      const key = discoveryDayObjectKey(assetId, tf, day);
      const byteSize = Buffer.byteLength(text, "utf8");
      await r2.putObject(key, text);
      await targetPool.query(
        `insert into storage_manifest
           (object_key, asset_id, tf, day, content_sha256, byte_size, row_count, backend, created_at, updated_at)
         values ($1,$2,$3,$4::date,$5,$6,$7,'r2',now(),now())
         on conflict (object_key) do update set
           content_sha256 = excluded.content_sha256,
           byte_size = excluded.byte_size,
           row_count = excluded.row_count,
           updated_at = now()`,
        [key, assetId, tf, day, shaHex, byteSize, rowCount],
      );
      log(`[r2] wrote ${key} rows=${rowCount} sha=${shaHex.slice(0, 12)}…`);
    }

    async function saveCheckpoint(status, extra = {}) {
      const payload = {
        scopeIndex: cursor.scopeIndex,
        afterT: cursor.afterT,
        currentDay: cursor.currentDay,
        ...extra,
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

    await saveCheckpoint("running");

    for (; cursor.scopeIndex < scopes.length; cursor.scopeIndex += 1) {
      const scope = scopes[cursor.scopeIndex];
      let dayLines = [];
      let dayHash = createHash("sha256");
      let dayRows = 0;
      let currentDay = cursor.currentDay;
      // Do not resume mid-day buffer across process restarts (buffer not persisted).
      if (cursor.scopeIndex > 0 || cursor.afterT === 0) {
        currentDay = null;
        cursor.currentDay = null;
      }

      for (;;) {
        const { text, params } = buildDiscoveryPageSql(
          scope.assetId,
          scope.tf,
          cursor.afterT,
          opts.pageSize,
        );
        const page = await sourceClient.query(text, params);
        if (!page.rows.length) break;

        for (const row of page.rows) {
          const t = Number(row.t);
          const day = utcDayFromT(t);
          if (currentDay != null && day !== currentDay) {
            const sha = dayHash.digest("hex");
            await flushDay(scope.assetId, scope.tf, currentDay, dayLines, sha, dayRows);
            dayLines = [];
            dayHash = createHash("sha256");
            dayRows = 0;
          }
          currentDay = day;
          cursor.currentDay = day;
          const line = barLine(row);
          dayLines.push(line);
          dayHash.update(line + "\n");
          dayRows += 1;
          cursor.afterT = t;
        }
        await saveCheckpoint("running");
        if (page.rows.length < opts.pageSize) break;
      }

      if (currentDay && dayLines.length) {
        const sha = dayHash.digest("hex");
        await flushDay(scope.assetId, scope.tf, currentDay, dayLines, sha, dayRows);
      }
      cursor.afterT = 0;
      cursor.currentDay = null;
      await saveCheckpoint("running", { completedScope: `${scope.assetId}/${scope.tf}` });
    }

    await saveCheckpoint("done", { finished: true });
    await targetPool.query(
      `update storage_job set finished_at = now(), notes = coalesce(notes,'') || ' done'
       where job_id = $1`,
      [opts.jobId],
    );
    log("[done] migration write finished");
  } finally {
    if (sourceClient) sourceClient.release();
    r2.destroy();
    await sourcePool.end().catch(() => {});
    await targetPool.end().catch(() => {});
  }
}

/**
 * @param {{
 *   sourceUrl?: string,
 *   targetUrl?: string,
 *   argv?: string[],
 *   log?: (s: string) => void,
 *   env?: NodeJS.ProcessEnv,
 *   executeWrite?: typeof executeMigrationWrite,
 * }} [opts]
 */
export async function runDevStorageMigrateCli(opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const parsed = parseMigrateArgs(argv);

  if (parsed.help) {
    log(`Usage: node scripts/dev-storage-migrate.mjs [--confirm-write] [--job-id ID] [--page-size N]

Neon → Aiven/R2 migrator. Default mode is plan/dry-run (no writes).

Required env (names only; values never printed):
  SOURCE_DATABASE_URL   Neon (read-only session)
  TARGET_DATABASE_URL   Aiven (must differ from source)
  R2_*                  only needed for --confirm-write

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
      "\n[dry-run] No writes performed. Pass --confirm-write to execute copy to target/R2.",
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
