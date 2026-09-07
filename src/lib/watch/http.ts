import { getSql } from "@/lib/db";
import { loadWatchMarket } from "./analyze";
import { dispatchEventPushes, sendWebPush } from "./notify";
import { authorizeWatchRequest } from "./secret";
import { createPgStore } from "./store";
import { runWatchTick } from "./tick";

type WatchSql = Awaited<ReturnType<typeof getSql>>;

async function runShadowReplaySidecar(sql: WatchSql, generatedAt: string): Promise<void> {
  if ((process.env.SHADOW_REPLAY_ENABLED?.trim() ?? "") !== "true") return;

  try {
    const { loadShadowEpisodes } = await import("@/lib/learn/shadow-db");
    const { analyzeShadowReplay } = await import("@/lib/learn/shadow-analysis");
    const { saveShadowReplayReport } = await import("@/lib/learn/shadow-replay-store");
    const episodes = await loadShadowEpisodes(sql);
    const report = analyzeShadowReplay(episodes);
    await saveShadowReplayReport(sql, report, generatedAt);
    console.info("[shadow] replay", {
      status: "ok",
      episodesAnalyzed: report.replay.episodesAnalyzed,
      comparisons: report.comparisons.length,
    });
  } catch (e) {
    console.error("[shadow] replay failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function handleWatchTick(request: Request): Promise<Response> {
  const auth = authorizeWatchRequest(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
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
        const { rememberAfterTick, writeTerminalPostMortems } = await import("@/lib/memory/persist");
        await rememberAfterTick(sql, work);
        await writeTerminalPostMortems(sql, work.touched, nowMs);
      },
    });

    // Shadow V2 is a research sidecar. It runs only after a successful Watch
    // cycle and can never alter the V1 result or HTTP status.
    if (result.status === "ok") {
      await runShadowReplaySidecar(sql, new Date(nowMs).toISOString());
    }

    const status =
      result.status === "failed" ? 500 : result.status === "too_early" ? 425 : 200;
    return Response.json(result, { status });
  } catch {
    return Response.json(
      { error: "Tick no disponible. No se ha inventado ninguna señal.", status: "failed" },
      { status: 503 },
    );
  }
}

export async function handleWatchHealth(): Promise<Response> {
  const nowMs = Date.now();
  const { readWatchHealth, toPublicWatchHealth, emptyPublicHealth } = await import("./health");
  try {
    const sql = await getSql();
    const store = createPgStore(sql);
    const health = await readWatchHealth(store, nowMs);
    const openEpisodes = await store.countOpenEpisodes();
    return Response.json(toPublicWatchHealth(health, nowMs, { persistence: "ok", openEpisodes }));
  } catch {
    return Response.json(emptyPublicHealth(nowMs, "error"), { status: 200 });
  }
}
