#!/usr/bin/env node
/**
 * Local watch cycle. Same calls as handleWatchTick, without HTTP or WATCH_SECRET.
 *
 * Does not run unless invoked. Requires the TypeScript loader:
 *   node --experimental-strip-types --import ./scripts/register-ts-ext.mjs scripts/watch-tick.mjs
 */
import { getSql } from "../src/lib/db.ts";
import { loadWatchMarket } from "../src/lib/watch/analyze.ts";
import { dispatchEventPushes, sendWebPush } from "../src/lib/watch/notify.ts";
import { createPgStore } from "../src/lib/watch/store.ts";
import { runWatchTick } from "../src/lib/watch/tick.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Watch tick not started.");
  process.exit(1);
}

function publicError(error) {
  const message = error instanceof Error ? error.message : "error";
  const url = process.env.DATABASE_URL?.trim();
  if (url && message.includes(url)) return "database error";
  return message;
}

const nowMs = Date.now();
try {
  const sql = await getSql();
  const store = createPgStore(sql);
  const result = await runWatchTick({
    nowMs,
    store,
    load: () => loadWatchMarket(nowMs),
    notify: async (events) => {
      try {
        const out = await dispatchEventPushes(store, events, sendWebPush);
        return out.sent;
      } catch {
        return 0;
      }
    },
    remember: async (work) => {
      const { rememberAfterTick, writeTerminalPostMortems } = await import(
        "../src/lib/memory/persist.ts"
      );
      await rememberAfterTick(sql, work);
      await writeTerminalPostMortems(sql, work.touched, nowMs);
    },
  });
  console.log(JSON.stringify({ status: result.status, slot: result.slot ?? null }));
  if (result.status === "failed") process.exitCode = 1;
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
}
