import type { AssetAnalysis, AssetId, SetupProposal, SetupState } from "../trading/types";
import type { ChartTf } from "./types";
import { formatPrice } from "../utils";
import type { EpisodeFreeze } from "../watch/freeze";

/** V1 trigger is always a 15M close. Zone/SL/TP are price levels, not TF-bound. */
export const SETUP_CHART_TF: ChartTf = "15m";

/** Temporalidad inicial de VER GRÁFICO: la del trigger del motor, no una elección de UI. */
export function setupChartTf(_asset: AssetAnalysis): ChartTf {
  return SETUP_CHART_TF;
}

export function hasChartableSetup(asset: AssetAnalysis): boolean {
  return asset.setup != null;
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
}

export interface ChartIntent {
  assetId: AssetId;
  tf: ChartTf;
  nonce: number;
  freeze: FrozenChartLevels | null;
}

/**
 * Map engine setup → chart coordinates.
 * XAU cards show SPOT; candles are PROXY, so we add basis back (the reverse of
 * applyBasisToSetup). No new levels are invented.
 */
export function chartSetupLevels(asset: AssetAnalysis): ChartSetupLevels | null {
  const setup = asset.setup;
  if (!setup) return null;
  return levelsFromSetup(setup, asset.setupState, asset.digits, asset.id === "XAUUSD" ? asset.basis : null);
}

export function chartSetupLevelsFromFrozen(f: FrozenChartLevels): ChartSetupLevels {
  const shift = f.assetId === "XAUUSD" && f.basis != null && Number.isFinite(f.basis) ? f.basis : 0;
  const toChart = (n: number) => n + shift;
  const d = f.digits;
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
  };
}

function levelsFromSetup(
  setup: SetupProposal,
  assetState: SetupState,
  digits: number,
  basis: number | null | undefined,
): ChartSetupLevels {
  const d = digits;
  const shift = basis != null && Number.isFinite(basis) ? basis : 0;
  const toChart = (n: number) => n + shift;
  const entrySpot = setup.direction === "sell" ? setup.zone.low : setup.zone.high;
  const state: SetupState = assetState === "wait" ? setup.state : assetState;
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
  };
}

export function frozenLevelsFromSetup(
  asset: AssetAnalysis,
  episodeId = "live",
): FrozenChartLevels | null {
  const setup = asset.setup;
  if (!setup) return null;
  const entry = setup.direction === "sell" ? setup.zone.low : setup.zone.high;
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
  },
  digits: number,
): FrozenChartLevels | null {
  const setup = ep.setup;
  const zoneLow = setup?.zone.low ?? ep.zoneLow;
  const zoneHigh = setup?.zone.high ?? ep.zoneHigh;
  if (!(zoneHigh > zoneLow)) return null;
  const direction = setup?.direction ?? ep.direction;
  const entry = direction === "sell" ? zoneLow : zoneHigh;
  const tf = (ep.freeze?.timeframe ?? SETUP_CHART_TF) as ChartTf;
  const state: SetupState = ep.live
    ? ep.state
    : setup?.state && setup.state !== "wait"
      ? setup.state
      : ep.state === "wait"
        ? "entry"
        : ep.state;
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

export function chartIntentFromAnalysis(asset: AssetAnalysis): ChartIntent | null {
  const freeze = frozenLevelsFromSetup(asset);
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
  return `${lv.state}|${lv.direction}|${lv.zoneLow}|${lv.zoneHigh}|${lv.stopLoss}|${lv.takeProfit1}|${lv.takeProfit2 ?? ""}|${lv.invalidation}`;
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
 * XAU/BTC/WTI keep the setup-locked price window (autoscaleInfoProvider + ZoneBand).
 * US100 must not: Lightweight Charts pinch only calls zoomTime. If the price window
 * is frozen to SL–TP, candles stay visually flat and pinch looks broken.
 * Levels are still drawn at the same prices; only autoscale participation differs.
 */
export function setupAutoscaleLocked(assetId: AssetId): boolean {
  return assetId !== "US100";
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

export type ChartPriceLineTone = "sl" | "tp" | "zone";

export interface ChartPriceLineSpec {
  id: "zoneHigh" | "zoneLow" | "sl" | "tp1" | "tp2";
  price: number;
  /** Empty: the axis shows the number only. Identification is color + line. */
  title: "";
  tone: ChartPriceLineTone;
}

export type ChartLevelVisibility = {
  zone?: boolean;
  sl?: boolean;
  tp1?: boolean;
  tp2?: boolean;
};

/**
 * Native price-line specs. Prices come from V1/freeze levels, never from last.
 * Invalidation and Last are not drawn.
 */
export function chartPriceLineSpecs(
  lv: ChartSetupLevels,
  visible?: ChartLevelVisibility,
): ChartPriceLineSpec[] {
  const out: ChartPriceLineSpec[] = [];
  if (visible?.zone !== false) {
    out.push({ id: "zoneHigh", price: lv.zoneHigh, title: "", tone: "zone" });
    out.push({ id: "zoneLow", price: lv.zoneLow, title: "", tone: "zone" });
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

/** Very light fills. Direction and prices come from V1; nothing is recalculated. */
export function setupFillBands(lv: ChartSetupLevels, visible?: ChartLevelVisibility): ChartFillBand[] {
  const out: ChartFillBand[] = [];
  if (visible?.zone !== false) {
    out.push({ low: lv.zoneLow, high: lv.zoneHigh, kind: "zone" });
  }
  const sl = lv.stopLoss;
  const tp = lv.takeProfit2 ?? lv.takeProfit1;
  if (lv.direction === "sell") {
    out.push({ low: Math.min(lv.zoneHigh, sl), high: Math.max(lv.zoneHigh, sl), kind: "risk" });
    out.push({ low: Math.min(lv.zoneLow, tp), high: Math.max(lv.zoneLow, tp), kind: "reward" });
  } else {
    out.push({ low: Math.min(lv.zoneLow, sl), high: Math.max(lv.zoneLow, sl), kind: "risk" });
    out.push({ low: Math.min(lv.zoneHigh, tp), high: Math.max(lv.zoneHigh, tp), kind: "reward" });
  }
  return out;
}
