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

function warningsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Value equality for setups. Used to skip WatchBook writes when fold output is unchanged. */
export function setupsEqual(
  a: SetupProposal | null | undefined,
  b: SetupProposal | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.kind === b.kind &&
    a.direction === b.direction &&
    a.zone.low === b.zone.low &&
    a.zone.high === b.zone.high &&
    a.invalidation === b.invalidation &&
    a.stopLoss === b.stopLoss &&
    a.takeProfit1 === b.takeProfit1 &&
    a.takeProfit2 === b.takeProfit2 &&
    a.riskReward === b.riskReward &&
    a.quality === b.quality &&
    a.qualityPhase === b.qualityPhase &&
    a.supersedeLevel === b.supersedeLevel &&
    a.missingForEntry === b.missingForEntry &&
    a.slWide === b.slWide &&
    a.managementNote === b.managementNote &&
    a.entryLabel === b.entryLabel &&
    warningsEqual(a.warnings, b.warnings)
  );
}

function watchesEqual(a: AssetWatch | undefined, b: AssetWatch | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.phase === b.phase &&
    a.currentState === b.currentState &&
    a.previousState === b.previousState &&
    a.transition === b.transition &&
    a.expiredFromState === b.expiredFromState &&
    a.expiredAt === b.expiredAt &&
    a.expiredReason === b.expiredReason &&
    setupsEqual(a.liveSetup, b.liveSetup) &&
    setupsEqual(a.expiredSetup, b.expiredSetup)
  );
}

/**
 * WatchBook value equality. `evaluatedAt` is a fold stamp, not watch state —
 * two books that differ only there are treated as the same book.
 */
export function watchBooksEqual(a: WatchBook, b: WatchBook): boolean {
  if (a === b) return true;
  const ids = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    if (!watchesEqual(a[id as AssetId], b[id as AssetId])) return false;
  }
  return true;
}

export function watchPhaseCaption(w: AssetWatch): string {
  if (w.phase === "live") return `Vigente · ${setupStateEs(w.currentState)}`;
  if (w.phase === "expired") {
    const was = w.expiredFromState ? setupStateEs(w.expiredFromState) : "setup";
    return `Caducada · era ${was}`;
  }
  return "ESPERAR · sin setup válido";
}
