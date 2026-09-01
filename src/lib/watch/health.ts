import { nextWatchEvalMs } from "./schedule";
import { watchSecret } from "./secret";
import { vapidConfigured } from "./vapid";
import type { WatchStore } from "./store";

export const SERVER_STALE_MS = 20 * 60 * 1000;

export type WatchHealthStatus = "ok" | "lag" | "failed" | "none";

export interface WatchHealth {
  lastTickAt: string | null;
  lastSlot: number | null;
  lastStatus: WatchHealthStatus;
  lastError: string | null;
  lastEvalMs: number | null;
  lastOkMs: number | null;
  nextEvalMs: number;
  stale: boolean;
  watchSecretConfigured: boolean;
  snapshots: Array<{
    assetId: string;
    state: string;
    episodeId: string | null;
    evaluatedAtMs: number;
  }>;
}

export interface PublicWatchHealth {
  ok: boolean;
  service: "atalaya-watch";
  timestamp: string;
  persistence: "ok" | "error";
  watchSecret: "CONFIGURED" | "NOT_CONFIGURED";
  vapid: "CONFIGURED" | "NOT_CONFIGURED";
  lastTickAt: string | null;
  lastTickAgeMs: number | null;
  lastStatus: WatchHealthStatus;
  lastEvalMs: number | null;
  nextEvalMs: number;
  stale: boolean;
  openEpisodes: number;
  watchSecretConfigured: boolean;
}

export function toPublicWatchHealth(
  h: WatchHealth,
  nowMs: number,
  extra?: { persistence?: "ok" | "error"; openEpisodes?: number },
): PublicWatchHealth {
  const lastTickAgeMs = h.lastEvalMs != null ? Math.max(0, nowMs - h.lastEvalMs) : null;
  const secret = h.watchSecretConfigured;
  return {
    ok: extra?.persistence !== "error" && !h.stale && h.lastStatus !== "failed",
    service: "atalaya-watch",
    timestamp: new Date(nowMs).toISOString(),
    persistence: extra?.persistence ?? "ok",
    watchSecret: secret ? "CONFIGURED" : "NOT_CONFIGURED",
    vapid: vapidConfigured() ? "CONFIGURED" : "NOT_CONFIGURED",
    lastTickAt: h.lastTickAt,
    lastTickAgeMs,
    lastStatus: h.lastStatus,
    lastEvalMs: h.lastEvalMs,
    nextEvalMs: h.nextEvalMs,
    stale: h.stale,
    openEpisodes: extra?.openEpisodes ?? 0,
    watchSecretConfigured: secret,
  };
}

export function emptyPublicHealth(nowMs: number, persistence: "ok" | "error"): PublicWatchHealth {
  return {
    ok: false,
    service: "atalaya-watch",
    timestamp: new Date(nowMs).toISOString(),
    persistence,
    watchSecret: watchSecret() != null ? "CONFIGURED" : "NOT_CONFIGURED",
    vapid: vapidConfigured() ? "CONFIGURED" : "NOT_CONFIGURED",
    lastTickAt: null,
    lastTickAgeMs: null,
    lastStatus: "none",
    lastEvalMs: null,
    nextEvalMs: nextWatchEvalMs(nowMs),
    stale: true,
    openEpisodes: 0,
    watchSecretConfigured: watchSecret() != null,
  };
}

export async function readWatchHealth(store: WatchStore, nowMs: number): Promise<WatchHealth> {
  const last = await store.lastCompletedEval();
  const lastOk = await store.lastOkEval();
  const snapshots = await store.listSnapshots();
  const lastOkMs = lastOk?.ranAtMs ?? null;
  return {
    lastTickAt: last ? new Date(last.ranAtMs).toISOString() : null,
    lastSlot: last?.slot ?? null,
    lastStatus: last ? (last.status as WatchHealthStatus) : "none",
    lastError: last?.error ?? null,
    lastEvalMs: last?.ranAtMs ?? null,
    lastOkMs,
    nextEvalMs: nextWatchEvalMs(nowMs),
    stale: lastOkMs == null || nowMs - lastOkMs > SERVER_STALE_MS,
    watchSecretConfigured: watchSecret() != null,
    snapshots: snapshots.map((s) => ({
      assetId: s.assetId,
      state: s.state,
      episodeId: s.episodeId,
      evaluatedAtMs: s.evaluatedAtMs,
    })),
  };
}
