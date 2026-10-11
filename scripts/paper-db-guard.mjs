import pg from "pg";
import { readdir } from "node:fs/promises";
import { expected, isPrefix, paperTablesReady } from "./paper-db-policy.mjs";

const knownTables = new Set([
  "_migrations",
  "paper_bot_state",
  "paper_bot_decision",
  "paper_bot_signal",
  "watch_evals",
  "watch_snapshots",
  "signal_episodes",
  "signal_events",
  "push_subscriptions",
  "watch_config",
  "signal_outcomes",
  "watch_eval_versions",
  "market_m15",
  "episode_tape_bars",
  "episode_tape_gaps",
  "episode_context",
  "episode_journal",
  "episode_postmortem",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isAivenDatabaseHost(hostname) {
  if (!/^[a-z0-9.-]+$/.test(hostname)) return false;
  const labels = hostname.split(".");
  if (labels.length < 3) return false;
  if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    return false;
  }
  return labels.at(-2) === "aivencloud" && labels.at(-1) === "com";
}

const action = process.env.ACTION;
const confirm = process.env.MIGRATION_CONFIRM;
if (action !== "inspect" && action !== "migrate" && action !== "paper") {
  fail("ACTION must be exactly inspect, migrate or paper.");
}
if (typeof confirm !== "string" || confirm.includes("<<") || confirm.includes(">>")) {
  fail("MIGRATION_CONFIRM must be defined and already substituted.");
}

const raw = process.env.DATABASE_URL?.trim();
const hostWanted = process.env.PAPER_DB_HOST?.trim();
const nameWanted = process.env.PAPER_DB_NAME?.trim();
if (!raw || !hostWanted || !nameWanted) {
  fail("DATABASE_URL, PAPER_DB_HOST and PAPER_DB_NAME are required.");
}

let parsed;
try {
  parsed = new URL(raw);
} catch {
  fail("DATABASE_URL is not a valid URL.");
}
const host = parsed.hostname;
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!isAivenDatabaseHost(host) || !isAivenDatabaseHost(hostWanted)) {
  fail("Host is not an Aiven database hostname.");
}
if (host !== hostWanted) fail("Host does not match PAPER_DB_HOST.");
if (!database || database !== nameWanted) fail("Database name does not match PAPER_DB_NAME.");

const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
const filesMatch = files.length === expected.length && files.every((file, index) => file === expected[index]);
console.log(JSON.stringify({ host, database, migrationFiles: files, migrationFilesMatch: filesMatch }));
if (!filesMatch) fail("Top-level migration files are not exactly the five expected names.");

const pool = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 8000 });
try {
  const current = await pool.query("select current_database() as name");
  if (current.rows[0]?.name !== nameWanted) fail("current_database() does not match PAPER_DB_NAME.");

  const tables = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  const names = tables.rows.map((row) => row.table_name);
  const unknown = names.filter((name) => !knownTables.has(name));
  let applied = [];
  if (names.includes("_migrations")) {
    const recorded = await pool.query("select name from _migrations order by name");
    applied = recorded.rows.map((row) => row.name);
  }
  console.log(JSON.stringify({ action, publicTables: names, appliedMigrations: applied }));
  if (unknown.length > 0) fail("Unexpected public tables.");
  if (!isPrefix(applied)) fail("Migration record is not an ordered prefix of the five reviewed files.");
  if (names.length > 0 && applied.length === 0) fail("Public tables exist without a migration record.");

  if (action === "inspect") {
    if (names.length !== 0 || applied.length !== 0) {
      fail("INSPECT_NOT_EMPTY: state was printed. Inspect does not accept a database that already has tables.");
    }
    console.log("INSPECT_OK");
  } else if (action === "migrate") {
    if (confirm.trim() !== expected.join(",")) {
      fail("MIGRATION_CONFIRM does not match the five migration filenames.");
    }
    if (names.length > 0 && applied.length === 0) fail("Refusing to migrate an unrecognized database.");
    console.log(applied.length === 0 ? "MIGRATE_ALLOWED" : "MIGRATE_RESUME_ALLOWED");
  } else if (!paperTablesReady(names, applied)) {
    fail("Required paper tables or migration record are missing. Paper tick not started.");
  } else {
    console.log("PAPER_ALLOWED");
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error) fail("database unreachable");
  throw error;
} finally {
  await pool.end();
}
