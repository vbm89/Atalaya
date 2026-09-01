import type { AssetAnalysis, AssetId, SetupProposal, SetupState } from "../trading/types";

export type WatchPhase = "live" | "expired" | "wait";

export interface AssetWatch {
  id: AssetId;
  phase: WatchPhase;
  currentState: SetupState;
  previousState: SetupState;
  transition: string | null;
  liveSetup: SetupProposal | null;
  expiredSetup: SetupProposal | null;
  expiredFromState: SetupState | null;
  expiredAt: number | null;
  expiredReason: string | null;
  evaluatedAt: number;
}

/** Keep a caducada visible for the rest of the session window (not a live signal). */
export const EXPIRED_HOLD_MS = 6 * 60 * 60 * 1000;

export function setupStateEs(state: SetupState): string {
  if (state === "entry") return "ENTRADA";
  if (state === "pending") return "TRIGGER PENDIENTE";
  if (state === "map") return "MAPA";
  return "ESPERAR";
}

export function transitionLabel(from: SetupState, to: SetupState): string | null {
  if (from === to) return null;
  return `${setupStateEs(from)} → ${setupStateEs(to)}`;
}

export function foldAssetWatch(
  prev: AssetWatch | null,
  asset: Pick<AssetAnalysis, "id" | "setupState" | "setup" | "waitReason">,
  now: number,
  holdMs = EXPIRED_HOLD_MS,
): AssetWatch {
  const to = asset.setupState;
  const from: SetupState = prev?.currentState ?? "wait";
  const changed = transitionLabel(from, to);

  if (to !== "wait" && asset.setup) {
    return {
      id: asset.id,
      phase: "live",
      currentState: to,
      previousState: from,
      transition: changed,
      liveSetup: asset.setup,
      expiredSetup: null,
      expiredFromState: null,
      expiredAt: null,
      expiredReason: null,
      evaluatedAt: now,
    };
  }

  const wasLive =
    prev?.phase === "live" && prev.currentState !== "wait" && prev.liveSetup != null;

  if (wasLive && prev) {
    return {
      id: asset.id,
      phase: "expired",
      currentState: "wait",
      previousState: from,
      transition: changed ?? `${setupStateEs(from)} → ESPERAR`,
      liveSetup: null,
      expiredSetup: prev.liveSetup,
      expiredFromState: prev.currentState,
      expiredAt: now,
      expiredReason: asset.waitReason,
      evaluatedAt: now,
    };
  }

  if (
    prev?.phase === "expired" &&
    prev.expiredAt != null &&
    now - prev.expiredAt < holdMs
  ) {
    return {
      ...prev,
      id: asset.id,
      currentState: "wait",
      previousState: from,
      transition: changed ?? prev.transition,
      liveSetup: null,
      expiredReason: asset.waitReason ?? prev.expiredReason,
      evaluatedAt: now,
    };
  }

  return {
    id: asset.id,
    phase: "wait",
    currentState: "wait",
    previousState: from,
    transition: changed,
    liveSetup: null,
    expiredSetup: null,
    expiredFromState: null,
    expiredAt: null,
    expiredReason: null,
    evaluatedAt: now,
  };
}

export type WatchBook = Partial<Record<AssetId, AssetWatch>>;

export function foldWatchBook(
  prev: WatchBook,
  assets: Pick<AssetAnalysis, "id" | "setupState" | "setup" | "waitReason">[],
  now: number,
): WatchBook {
  const next: WatchBook = { ...prev };
  for (const a of assets) {
    next[a.id] = foldAssetWatch(prev[a.id] ?? null, a, now);
  }
  return next;
}

export function watchPhaseCaption(w: AssetWatch): string {
  if (w.phase === "live") return `Vigente · ${setupStateEs(w.currentState)}`;
  if (w.phase === "expired") {
    const was = w.expiredFromState ? setupStateEs(w.expiredFromState) : "setup";
    return `Caducada · era ${was}`;
  }
  return "ESPERAR · sin setup válido";
}
