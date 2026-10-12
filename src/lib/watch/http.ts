import { dbSource, getSql } from "@/lib/db";
import { dbWriteGate } from "@/lib/db-identity";
import { loadWatchMarket } from "./analyze";
import { dispatchEventPushes, sendWebPush } from "./notify";
import { authorizeWatchRequest } from "./secret";
import { createPgStore } from "./store";
import { runWatchTick } from "./tick";

const RETRY_DELAY_MS = 750;

export async function handleWatchTick(request: Request): Promise<Response> {
  const auth = authorizeWatchRequest(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const blocked = dbWritesBlocked();
  if (blocked) return blocked;

  const nowMs = Date.now();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
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
          const { rememberAfterTick, writeTerminalPostMortems } = await import("@/lib/memory/persist");
          await rememberAfterTick(sql, work);
          await writeTerminalPostMortems(sql, work.touched, nowMs);
        },
      });

      // Shadow V2 replay is not part of the tick: it reloads every episode and
      // its tape, so it runs only on demand via POST /api/learn/shadow-replay.

      const status =
        result.status === "failed" ? 500 : result.status === "too_early" ? 425 : 200;
      return Response.json(result, { status });
    } catch (e) {
      lastError = e;
      console.error("[watch] tick infrastructure failure", {
        attempt: attempt + 1,
        error: e instanceof Error ? e.message : String(e),
      });
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  return Response.json(
    {
      error: "Tick no disponible. No se ha inventado ninguna señal.",
      status: "failed",
      retryable: true,
      detail: lastError instanceof Error ? lastError.message : null,
    },
    { status: 503 },
  );
}

export async function handleWatchHealth(): Promise<Response> {
  const nowMs = Date.now();
  const { readWatchHealth, toPublicWatchHealth, emptyPublicHealth } = await import("./health");
  try {
    const sql = await getSql();
    const store = createPgStore(sql);
    const health = await readWatchHealth(store, nowMs);
    const openEpisodes = await store.countOpenEpisodes();
    return Response.json({ ...toPublicWatchHealth(health, nowMs, { persistence: "ok", openEpisodes }), ...dbGatePublic() });
  } catch {
    return Response.json({ ...emptyPublicHealth(nowMs, "error"), ...dbGatePublic() }, { status: 200 });
  }
}

/** Non-secret DB identity: truncated fingerprint + whether writes are allowed. */
export function dbGatePublic(): { dbSource: string; dbFingerprint: string | null; dbWritable: boolean } {
  if (dbSource !== "neon") return { dbSource, dbFingerprint: null, dbWritable: true };
  const gate = dbWriteGate();
  return { dbSource, dbFingerprint: gate.fingerprint, dbWritable: gate.writable };
}

/** 503 before any market fetch when the DB identity gate keeps the DB read-only. */
export function dbWritesBlocked(): Response | null {
  const gate = dbGatePublic();
  if (gate.dbWritable) return null;
  return Response.json(
    { status: "failed", error: "DB read-only: DB_IDENTITY_ALLOW no coincide con DATABASE_URL.", dbFingerprint: gate.dbFingerprint },
    { status: 503 },
  );
}
