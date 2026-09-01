import type { DataStatus } from "../trading/types";

/** Per-asset feed health. Independent of V1 setupState. */
export type DataLamp = "ok" | "delayed" | "unavailable";

/** Server watch cycle health. Independent of V1 and of a single asset's feed. */
export type WatchLamp = "ok" | "stale" | "error";

export type WatchLampStatus = "ok" | "lag" | "failed" | "none";

/**
 * Same 20 min window as health.SERVER_STALE_MS.
 * Duplicated here so the client never imports node:crypto via secret.ts.
 */
export const WATCH_STALE_MS = 20 * 60 * 1000;

export interface AssetFeedSnap {
  dataStatus: DataStatus;
  dataStatusLabel?: string | null;
  lastDataAt: string | null;
  price: number | null;
}

export interface WatchLampSnap {
  lastStatus: WatchLampStatus | null | undefined;
  lastOkMs: number | null | undefined;
  stale: boolean;
  watchSecretConfigured: boolean;
}

const RANK: Record<DataLamp, number> = { ok: 0, delayed: 1, unavailable: 2 };

export function assetDataLamp(
  snap: AssetFeedSnap,
  _nowMs = Date.now(),
): { lamp: DataLamp; label: string } {
  const status = snap.dataStatus;
  if (status === "error" || status === "insufficient") {
    return { lamp: "unavailable", label: "DATOS NO DISPONIBLES" };
  }
  if (snap.price == null && status !== "session_closed") {
    return { lamp: "unavailable", label: "DATOS NO DISPONIBLES" };
  }
  if (status === "stale") {
    return { lamp: "delayed", label: "DATOS RETRASADOS" };
  }
  if (status === "session_closed") {
    return { lamp: "ok", label: "DATOS OK · subyacente cerrado" };
  }
  return { lamp: "ok", label: "DATOS OK" };
}

export function watchLamp(snap: WatchLampSnap, nowMs = Date.now()): { lamp: WatchLamp; label: string } {
  if (snap.lastStatus === "failed") {
    return { lamp: "error", label: "VIGILANCIA ERROR" };
  }
  if (!snap.watchSecretConfigured && (snap.lastOkMs == null || nowMs - snap.lastOkMs > WATCH_STALE_MS)) {
    return { lamp: "stale", label: "VIGILANCIA RETRASADA" };
  }
  if (snap.stale) {
    return { lamp: "stale", label: "VIGILANCIA RETRASADA" };
  }
  if (snap.lastStatus === "lag") {
    return { lamp: "stale", label: "VIGILANCIA RETRASADA" };
  }
  if (snap.lastStatus === "ok" || snap.lastStatus === "none") {
    if (snap.lastStatus === "none" && snap.lastOkMs == null) {
      return { lamp: "stale", label: "VIGILANCIA RETRASADA" };
    }
    return { lamp: "ok", label: "VIGILANCIA OK" };
  }
  return { lamp: "ok", label: "VIGILANCIA OK" };
}

export function worstDataLamp(snaps: AssetFeedSnap[]): { lamp: DataLamp; label: string; note: string | null } {
  if (!snaps.length) {
    return {
      lamp: "unavailable",
      label: "DATOS NO DISPONIBLES",
      note: "No hay datos válidos para evaluar. No es un ESPERAR de V1.",
    };
  }
  let worst: DataLamp = "ok";
  let label = "DATOS OK";
  for (const s of snaps) {
    const r = assetDataLamp(s);
    if (RANK[r.lamp] > RANK[worst]) {
      worst = r.lamp;
      label = r.label;
    }
  }
  if (worst === "delayed") {
    return {
      lamp: worst,
      label,
      note: "El mercado/feed está retrasado. La información puede no estar actualizada.",
    };
  }
  if (worst === "unavailable") {
    return {
      lamp: worst,
      label,
      note: "No hay datos válidos para evaluar. No es un ESPERAR de V1.",
    };
  }
  return { lamp: worst, label, note: null };
}

export function lampDotClass(lamp: DataLamp | WatchLamp): string {
  if (lamp === "ok") return "bg-buy";
  if (lamp === "delayed" || lamp === "stale") return "bg-wait";
  return "bg-sell";
}

export function lampTextClass(lamp: DataLamp | WatchLamp): string {
  if (lamp === "ok") return "text-buy";
  if (lamp === "delayed" || lamp === "stale") return "text-wait";
  return "text-sell";
}

export function watchGlyph(lamp: WatchLamp): string {
  if (lamp === "ok") return "✓ OK";
  if (lamp === "stale") return "⚠ RETRASADA";
  return "✕ ERROR";
}
