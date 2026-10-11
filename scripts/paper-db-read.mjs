import pg from "pg";

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

if (process.env.ACTION !== "paper") fail("Read requires ACTION=paper.");

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
if (!isAivenDatabaseHost(host) || !isAivenDatabaseHost(hostWanted) || host !== hostWanted) {
  fail("Host is not an accepted Aiven database hostname.");
}
if (!database || database !== nameWanted) fail("Database name does not match PAPER_DB_NAME.");

const pool = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 8000 });
try {
  const current = await pool.query("select current_database() as name");
  if (current.rows[0]?.name !== nameWanted) fail("current_database() does not match PAPER_DB_NAME.");
  const rows = await pool.query(
    "select asset, timeframe, last_bar_t, mode, decision, reason, provider, data_status, evaluated_at from paper_bot_decision order by evaluated_at desc limit 8",
  );
  console.log(JSON.stringify(rows.rows));
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  if ((raw && message.includes(raw)) || message.includes(host) || (database && message.includes(database))) {
    fail("could not read paper_bot_decision");
  }
  if (error && typeof error === "object" && "code" in error) fail("could not read paper_bot_decision");
  throw error;
} finally {
  await pool.end();
}
