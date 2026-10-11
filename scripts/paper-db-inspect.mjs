import pg from "pg";
import { pathToFileURL } from "node:url";

export function isAivenDatabaseHost(hostname) {
  if (!/^[a-z0-9.-]+$/.test(hostname)) return false;
  const labels = hostname.split(".");
  if (labels.length < 3) return false;
  if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    return false;
  }
  return labels.at(-2) === "aivencloud" && labels.at(-1) === "com";
}

export function inspectTarget(env) {
  if (env.DATABASE_URL?.trim()) return { ok: false, message: "DATABASE_URL must not be set." };
  const raw = env.PAPER_DATABASE_URL?.trim();
  const hostWanted = env.PAPER_DB_HOST?.trim();
  const nameWanted = env.PAPER_DB_NAME?.trim();
  if (!raw || !hostWanted || !nameWanted) {
    return { ok: false, message: "PAPER_DATABASE_URL, PAPER_DB_HOST and PAPER_DB_NAME are required." };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "PAPER_DATABASE_URL is not a valid URL." };
  }
  const host = parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!isAivenDatabaseHost(host) || !isAivenDatabaseHost(hostWanted)) {
    return { ok: false, message: "Host is not an Aiven database hostname." };
  }
  if (host !== hostWanted) return { ok: false, message: "Host does not match PAPER_DB_HOST." };
  if (!database || database !== nameWanted) return { ok: false, message: "Database name does not match PAPER_DB_NAME." };
  return { ok: true, connectionString: raw, database };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const target = inspectTarget(process.env);
  if (!target.ok) fail(target.message);
  const pool = new pg.Pool({ connectionString: target.connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const current = await pool.query("select current_database() as name");
    if (current.rows[0]?.name !== target.database) fail("current database does not match PAPER_DB_NAME.");
    const tables = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    if (tables.rows.length !== 0) fail("INSPECT_NOT_EMPTY");
    console.log("INSPECT_OK");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(target.connectionString) || message.includes(target.database)) fail("database error");
    fail("database unreachable");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
