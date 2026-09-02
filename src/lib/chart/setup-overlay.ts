import type { AssetAnalysis, AssetId, SetupProposal, SetupState } from "../trading/types";
import type { ChartTf } from "./types";
import { formatPrice } from "../utils";
import { displayEntryPrice } from "./labels";
import type { EpisodeFreeze } from "../watch/freeze";

/** V1 trigger is always a 15M close. Zone/SL/TP are price levels, not TF-bound. */
export const SETUP_CHART_TF: ChartTf = "15m";

const MADRID = "Europe/Madrid";

/** Temporalidad inicial de VER GRÁFICO: la del trigger del motor, no una elección de UI. */
export function setupChartTf(_asset: AssetAnalysis): ChartTf {
  return SETUP_CHART_TF;
}

export function hasChartableSetup(asset: AssetAnalysis): boolean {
  return asset.setup != null;
}

export interface StudyClock {
  openedAtMs: number;
  closedAtMs: number | null;
}

export interface ChartSetupLevels {
  state: SetupState;
  direction: "buy" | "sell";
  zoneLow: number;
  zoneHigh: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  invalidation: number;
  labelZone: string;
  labelEntry: string;
  labelSl: string;
  labelTp1: string;
  labelTp2: string | null;
  labelInv: string;
  xauOnProxy: boolean;
  /** Unix seconds. From episode.openedAtMs — not openedSlot, not last. */
  openedAtSec: number | null;
  /** Unix seconds when the episode closed. Null while the study is live. */
  closedAtSec: number | null;
  studyLive: boolean;
}

/**
 * Niveles congelados para el gráfico. No se recalculan con V1 actual.
 * Solo se pintan si el gráfico muestra el mismo activo y la misma TF.
 */
export interface FrozenChartLevels {
  episodeId: string;
  assetId: AssetId;
  tf: ChartTf;
  state: SetupState;
  direction: "buy" | "sell";
  zoneLow: number;
  zoneHigh: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  invalidation: number;
  digits: number;
  basis: number | null;
  openedAtMs: number | null;
  closedAtMs: number | null;
}

export interface ChartIntent {
  assetId: AssetId;
  tf: ChartTf;
  nonce: number;
  freeze: FrozenChartLevels | null;
}

export function msToUnixSec(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms) || ms < 1_000_000_000_000) return null;
  return Math.floor(ms / 1000);
}

export function studyStartClock(openedAtMs: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MADRID,
  }).format(new Date(openedAtMs));
}

/** Discrete label at the study-start vertical. No legend box. */
export function studyStartCaption(openedAtMs: number): string {
  return `Inicio de estudio · ${studyStartClock(openedAtMs)}`;
}

/**
 * Map engine setup → chart coordinates.
 * XAU cards show SPOT; candles are PROXY, so we add basis back (the reverse of
 * applyBasisToSetup). No new levels are invented.
 */
export function chartSetupLevels(
  asset: AssetAnalysis,
  clock?: StudyClock | null,
): ChartSetupLevels | null {
  const setup = asset.setup;
  if (!setup) return null;
  return levelsFromSetup(
    setup,
    asset.setupState,
    asset.digits,
    asset.id === "XAUUSD" ? asset.basis : null,
    clock,
  );
}

export function chartSetupLevelsFromFrozen(f: FrozenChartLevels): ChartSetupLevels {
  const shift = f.assetId === "XAUUSD" && f.basis != null && Number.isFinite(f.basis) ? f.basis : 0;
  const toChart = (n: number) => n + shift;
  const d = f.digits;
  const openedAtSec = msToUnixSec(f.openedAtMs);
  const closedAtSec = msToUnixSec(f.closedAtMs);
  return {
    state: f.state,
    direction: f.direction,
    zoneLow: toChart(f.zoneLow),
    zoneHigh: toChart(f.zoneHigh),
    entry: toChart(f.entry),
    stopLoss: toChart(f.stopLoss),
    takeProfit1: toChart(f.takeProfit1),
    takeProfit2: f.takeProfit2 != null ? toChart(f.takeProfit2) : null,
    invalidation: toChart(f.invalidation),
    labelZone: `${formatPrice(f.zoneLow, d)}–${formatPrice(f.zoneHigh, d)}`,
    labelEntry: formatPrice(f.entry, d),
    labelSl: formatPrice(f.stopLoss, d),
    labelTp1: formatPrice(f.takeProfit1, d),
    labelTp2: f.takeProfit2 != null ? formatPrice(f.takeProfit2, d) : null,
    labelInv: formatPrice(f.invalidation, d),
    xauOnProxy: shift !== 0,
    openedAtSec,
    closedAtSec,
    studyLive: openedAtSec != null && closedAtSec == null,
  };
}

function levelsFromSetup(
  setup: SetupProposal,
  assetState: SetupState,
  digits: number,
  basis: number | null | undefined,
  clock?: StudyClock | null,
): ChartSetupLevels {
  const d = digits;
  const shift = basis != null && Number.isFinite(basis) ? basis : 0;
  const toChart = (n: number) => n + shift;
  const entrySpot = displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high);
  const state: SetupState = assetState === "wait" ? setup.state : assetState;
  const openedAtSec = msToUnixSec(clock?.openedAtMs);
  const closedAtSec = msToUnixSec(clock?.closedAtMs);
  return {
    state,
    direction: setup.direction,
    zoneLow: toChart(setup.zone.low),
    zoneHigh: toChart(setup.zone.high),
    entry: toChart(entrySpot),
    stopLoss: toChart(setup.stopLoss),
    takeProfit1: toChart(setup.takeProfit1),
    takeProfit2: setup.takeProfit2 != null ? toChart(setup.takeProfit2) : null,
    invalidation: toChart(setup.invalidation),
    labelZone: `${formatPrice(setup.zone.low, d)}–${formatPrice(setup.zone.high, d)}`,
    labelEntry: formatPrice(entrySpot, d),
    labelSl: formatPrice(setup.stopLoss, d),
    labelTp1: formatPrice(setup.takeProfit1, d),
    labelTp2: setup.takeProfit2 != null ? formatPrice(setup.takeProfit2, d) : null,
    labelInv: formatPrice(setup.invalidation, d),
    xauOnProxy: shift !== 0,
    openedAtSec,
    closedAtSec,
    studyLive: openedAtSec != null && closedAtSec == null,
  };
}

export function frozenLevelsFromSetup(
  asset: AssetAnalysis,
  episodeId = "live",
  clock?: StudyClock | null,
): FrozenChartLevels | null {
  const setup = asset.setup;
  if (!setup) return null;
  const entry = displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high);
  const state: SetupState = asset.setupState === "wait" ? setup.state : asset.setupState;
  return {
    episodeId,
    assetId: asset.id,
    tf: SETUP_CHART_TF,
    state,
    direction: setup.direction,
    zoneLow: setup.zone.low,
    zoneHigh: setup.zone.high,
    entry,
    stopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2,
    invalidation: setup.invalidation,
    digits: asset.digits,
    basis: asset.id === "XAUUSD" ? asset.basis : null,
    openedAtMs: clock?.openedAtMs ?? null,
    closedAtMs: clock?.closedAtMs ?? null,
  };
}

export function frozenLevelsFromEpisode(
  ep: {
    episodeId: string;
    assetId: AssetId;
    live: boolean;
    state: SetupState;
    direction: "buy" | "sell";
    zoneLow: number;
    zoneHigh: number;
    sl: number;
    tp1: number;
    tp2: number | null;
    setup: SetupProposal | null;
    freeze?: EpisodeFreeze | null;
    openedAtMs?: number | null;
    closedAtMs?: number | null;
  },
  digits: number,
): FrozenChartLevels | null {
  const setup = ep.setup;
  const zoneLow = setup?.zone.low ?? ep.zoneLow;
  const zoneHigh = setup?.zone.high ?? ep.zoneHigh;
  if (!(zoneHigh > zoneLow)) return null;
  const direction = setup?.direction ?? ep.direction;
  const entry = displayEntryPrice(direction, zoneLow, zoneHigh);
  const tf = (ep.freeze?.timeframe ?? SETUP_CHART_TF) as ChartTf;
  const state: SetupState = ep.live
    ? ep.state
    : setup?.state && setup.state !== "wait"
      ? setup.state
      : ep.state === "wait"
        ? "entry"
        : ep.state;
  const openedAtMs =
    ep.openedAtMs != null && Number.isFinite(ep.openedAtMs) && ep.openedAtMs >= 1_000_000_000_000
      ? ep.openedAtMs
      : ep.freeze?.capturedAtMs != null &&
          Number.isFinite(ep.freeze.capturedAtMs) &&
          ep.freeze.capturedAtMs >= 1_000_000_000_000
        ? ep.freeze.capturedAtMs
        : null;
  const closedAtMs =
    ep.closedAtMs != null && Number.isFinite(ep.closedAtMs) && ep.closedAtMs >= 1_000_000_000_000
      ? ep.closedAtMs
      : null;
  return {
    episodeId: ep.episodeId,
    assetId: ep.assetId,
    tf,
    state,
    direction,
    zoneLow,
    zoneHigh,
    entry,
    stopLoss: setup?.stopLoss ?? ep.sl,
    takeProfit1: setup?.takeProfit1 ?? ep.tp1,
    takeProfit2: setup?.takeProfit2 ?? ep.tp2,
    invalidation: setup?.invalidation ?? ep.sl,
    digits,
    basis: ep.assetId === "XAUUSD" ? (ep.freeze?.basis ?? null) : null,
    openedAtMs,
    closedAtMs: ep.live ? null : closedAtMs,
  };
}

/** Overlay only on the episode's asset + TF. BTC M15 ≠ BTC H1. */
export function activeFrozenOverlay(
  freeze: FrozenChartLevels | null | undefined,
  assetId: AssetId,
  tf: ChartTf,
): FrozenChartLevels | null {
  if (!freeze) return null;
  if (freeze.assetId !== assetId) return null;
  if (freeze.tf !== tf) return null;
  return freeze;
}

/** Study bands are price+time; they stay valid on any TF of the same asset. */
export function activeStudyOverlay(
  freeze: FrozenChartLevels | null | undefined,
  assetId: AssetId,
): FrozenChartLevels | null {
  if (!freeze) return null;
  if (freeze.assetId !== assetId) return null;
  return freeze;
}

export function chartIntentFromAnalysis(
  asset: AssetAnalysis,
  clock?: StudyClock | null,
): ChartIntent | null {
  const freeze = frozenLevelsFromSetup(asset, "live", clock);
  if (!freeze) return null;
  return { assetId: asset.id, tf: freeze.tf, nonce: Date.now(), freeze };
}

export function setupStateCaption(state: SetupState): string {
  if (state === "entry") return "ENTRADA — análisis, no orden";
  if (state === "pending") return "TRIGGER PENDIENTE — no es orden";
  if (state === "map") return "MAPA — no es orden";
  return "ESPERAR";
}

/** Stable key so the chart does not rebuild zone/SL/TP when the snapshot object is new but levels are the same. */
export function setupLevelsKey(lv: ChartSetupLevels | null): string {
  if (!lv) return "";
  return `${lv.state}|${lv.direction}|${lv.zoneLow}|${lv.zoneHigh}|${lv.stopLoss}|${lv.takeProfit1}|${lv.takeProfit2 ?? ""}|${lv.invalidation}|${lv.openedAtSec ?? ""}|${lv.closedAtSec ?? ""}`;
}

function includeIfNear(
  min: number,
  max: number,
  value: number,
  span: number,
): { min: number; max: number } {
  const dist = value < min ? min - value : value > max ? value - max : 0;
  if (dist <= span * 1.5) {
    return { min: Math.min(min, value), max: Math.max(max, value) };
  }
  return { min, max };
}

/** Price window for autoscale: setup + nearby last price. Far prints (WTI, etc.) must not squash the trade. */
export function setupVisiblePriceRange(
  lv: ChartSetupLevels,
  lastPrice: number | null,
): { min: number; max: number } {
  const vals = [lv.zoneLow, lv.zoneHigh, lv.stopLoss, lv.takeProfit1];
  if (lv.takeProfit2 != null) vals.push(lv.takeProfit2);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const span = Math.max(max - min, Number.EPSILON);
  if (lastPrice != null && Number.isFinite(lastPrice)) {
    const next = includeIfNear(min, max, lastPrice, span);
    min = next.min;
    max = next.max;
  }
  if (Number.isFinite(lv.invalidation)) {
    const next = includeIfNear(min, max, lv.invalidation, span);
    min = next.min;
    max = next.max;
  }
  const pad = Math.max(max - min, Number.EPSILON) * 0.14;
  return { min: min - pad, max: max + pad };
}

/**
 * Setup levels must not lock the price window. Lightweight Charts pinch only
 * calls zoomTime; a SL–TP lock makes candles look frozen while MAPA/PENDING.
 * Price lines stay on V1 prices regardless.
 */
export function setupAutoscaleLocked(_assetId: AssetId): boolean {
  return false;
}

/** When lockAutoscale is false (US100), the zone fill does not expand the price window to SL/TP. */
export function zoneBandAutoscaleRange(
  low: number,
  high: number,
  extras: number[],
  lockAutoscale: boolean,
): { minValue: number; maxValue: number } | null {
  if (!lockAutoscale) return null;
  const vals = [low, high, ...extras].filter((n) => Number.isFinite(n));
  if (vals.length < 2) return null;
  return {
    minValue: Math.min(...vals),
    maxValue: Math.max(...vals),
  };
}

export type ChartPriceLineTone = "sl" | "tp" | "entry";

export interface ChartPriceLineSpec {
  id: "entry" | "sl" | "tp1" | "tp2";
  price: number;
  /** Empty: the axis shows the number only. Identification is color + line. */
  title: "";
  tone: ChartPriceLineTone;
}

export type ChartLevelVisibility = {
  entry?: boolean;
  zone?: boolean;
  sl?: boolean;
  tp1?: boolean;
  tp2?: boolean;
};

/**
 * Native price-line specs. Prices come from V1/freeze levels, never from last.
 * One ENTRADA line (V1 entryPx). Zone edges are fill-only — not a second entry.
 * Invalidation and Last are not drawn.
 */
export function chartPriceLineSpecs(
  lv: ChartSetupLevels,
  visible?: ChartLevelVisibility,
): ChartPriceLineSpec[] {
  const out: ChartPriceLineSpec[] = [];
  if (visible?.entry !== false) {
    out.push({ id: "entry", price: lv.entry, title: "", tone: "entry" });
  }
  if (visible?.sl !== false) out.push({ id: "sl", price: lv.stopLoss, title: "", tone: "sl" });
  if (visible?.tp1 !== false) out.push({ id: "tp1", price: lv.takeProfit1, title: "", tone: "tp" });
  if (visible?.tp2 !== false && lv.takeProfit2 != null) {
    out.push({ id: "tp2", price: lv.takeProfit2, title: "", tone: "tp" });
  }
  return out;
}

export interface ChartFillBand {
  low: number;
  high: number;
  kind: "zone" | "risk" | "reward";
}

/** Very light fills. Direction and prices come from V1; nothing is recalculated.
 * Zone band = origin (no price-line labels). Risk/reward use V1 entryPx. */
export function setupFillBands(lv: ChartSetupLevels, visible?: ChartLevelVisibility): ChartFillBand[] {
  const out: ChartFillBand[] = [];
  if (visible?.zone !== false) {
    out.push({ low: lv.zoneLow, high: lv.zoneHigh, kind: "zone" });
  }
  const sl = lv.stopLoss;
  const tp = lv.takeProfit2 ?? lv.takeProfit1;
  const entry = lv.entry;
  out.push({ low: Math.min(entry, sl), high: Math.max(entry, sl), kind: "risk" });
  out.push({ low: Math.min(entry, tp), high: Math.max(entry, tp), kind: "reward" });
  return out;
}

export interface TimePointX {
  time: number;
  x: number;
}

/**
 * Map a unix-seconds timestamp onto the time axis, interpolating between bars.
 * Does not snap 23:03 onto the 23:00 or 23:15 candle.
 */
export function interpolateTimeCoordinate(
  timeSec: number,
  points: readonly TimePointX[],
): number | null {
  if (!points.length || !Number.isFinite(timeSec)) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) return first.x;
  if (timeSec <= first.time) {
    const next = points[1]!;
    const dt = next.time - first.time;
    if (dt === 0) return first.x;
    return first.x + ((timeSec - first.time) / dt) * (next.x - first.x);
  }
  if (timeSec >= last.time) {
    const prev = points[points.length - 2]!;
    const dt = last.time - prev.time;
    if (dt === 0) return last.x;
    return last.x + ((timeSec - last.time) / dt) * (last.x - prev.x);
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.time <= timeSec) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const dt = b.time - a.time;
  if (dt === 0) return a.x;
  return a.x + ((timeSec - a.time) / dt) * (b.x - a.x);
}

/** Right edge: now while live, closedAt when the episode has ended. */
export function studyHorizonSec(lv: ChartSetupLevels, nowMs: number): number | null {
  if (lv.openedAtSec == null) return null;
  if (lv.closedAtSec != null) return Math.max(lv.openedAtSec, lv.closedAtSec);
  if (!Number.isFinite(nowMs) || nowMs <= 0) return lv.openedAtSec;
  return Math.max(lv.openedAtSec, nowMs / 1000);
}
