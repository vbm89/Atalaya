#!/usr/bin/env node
/**
 * Local paper cycle. Calls runDurableTick only after PostgreSQL answers.
 * Without DATABASE_URL, or if the server is unreachable, it exits before any
 * market fetch or ledger write. PGLite is not a fallback here.
 *
 * Does not run unless invoked:
 *   node --experimental-strip-types --import ./scripts/register-ts-ext.mjs scripts/paper-tick.mjs
 */
import pg from "pg";

function publicError(error) {
  const message = error instanceof Error ? error.message : "error";
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return message;
  if (message.includes(url)) return "database error";
  try {
    const host = new URL(url).hostname;
    if (host && message.includes(host)) return "database error";
  } catch {
    return "database error";
  }
  return message;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Paper tick not started.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  await pool.query("select 1");
} catch (error) {
  console.error(`paper tick: database unreachable (${publicError(error)})`);
  process.exit(1);
} finally {
  await pool.end();
}

try {
  const { runDurableTick } = await import("../src/lib/bot-paper/tick.ts");
  const { report } = await runDurableTick();
  console.log(
    JSON.stringify({
      decisions: report.decisions,
      signalsNew: report.signalsNew,
      duplicates: report.duplicates,
      processed: report.processed,
      waited: report.waited,
      liveTrading: false,
    }),
  );
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
}
