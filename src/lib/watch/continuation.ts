import { applyBasisToSetup } from "../trading/engine";
import { snapshotIndicators } from "../trading/indicators";
import { detectBosChoch, swingHighs, swingLows } from "../trading/structure";
import type { AssetId, Candle, SetupProposal } from "../trading/types";

const MIN_RR = 1.5;
const PAD_ATR = 0.15;
const LOOKBACK_BREAK = 3;

function closed(candles: Candle[], nowMs: number): Candle[] {
  const now = Math.floor(nowMs / 1000);
  return candles.filter((c) => c.time + 900 <= now);
}

function nearestTarget(direction: "sell" | "buy", entry: number, risk: number, h1: Candle[], h4: Candle[]) {
  const levels = direction === "sell"
    ? [...swingLows(h1).map((s) => s.price), ...swingLows(h4).map((s) => s.price)].filter((p) => p < entry)
    : [...swingHighs(h1).map((s) => s.price), ...swingHighs(h4).map((s) => s.price)].filter((p) => p > entry);
  const sorted = [...new Set(levels.map((p) => Math.round(p * 100) / 100))]
    .sort((a, b) => direction === "sell" ? b - a : a - b);
  const valid = sorted.filter((p) => Math.abs(p - entry) / risk >= MIN_RR);
  return valid.length ? { tp1: valid[0]!, tp2: valid[1] ?? null } : null;
}

export function buildMomentumContinuation(args: {
  id: AssetId;
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  nowMs: number;
  basis?: number | null;
  digits: number;
}): SetupProposal | null {
  const m15 = closed(args.m15, args.nowMs);
  const h1 = closed(args.h1, args.nowMs);
  const h4 = closed(args.h4, args.nowMs);
  if (m15.length < 12 || h1.length < 12 || h4.length < 12) return null;

  const last = m15.at(-1)!;
  const prior = m15.slice(0, -1);
  const atr = snapshotIndicators(m15).atr;
  if (!atr || atr <= 0) return null;

  const st4 = detectBosChoch(h4);
  const st1 = detectBosChoch(h1);
  const recent = prior.slice(-LOOKBACK_BREAK);
  const priorLow = Math.min(...recent.map((c) => c.low));
  const priorHigh = Math.max(...recent.map((c) => c.high));
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;

  const bearishImpulse = last.close < last.open && last.close < priorLow &&
    (body >= atr * 0.7 || range >= atr * 1.1);
  const bullishImpulse = last.close > last.open && last.close > priorHigh &&
    (body >= atr * 0.7 || range >= atr * 1.1);

  const shortContext = st4.bias === "bajista" || st1.bias === "bajista";
  const longContext = st4.bias === "alcista" || st1.bias === "alcista";
  const direction = bearishImpulse && shortContext ? "sell" :
    bullishImpulse && longContext ? "buy" : null;
  if (!direction) return null;

  const swings = direction === "sell" ? swingHighs(m15) : swingLows(m15);
  const structural = swings.filter((s) => s.index < m15.length - 1).at(-1)?.price;
  const fallback = direction === "sell"
    ? Math.max(...prior.slice(-5).map((c) => c.high))
    : Math.min(...prior.slice(-5).map((c) => c.low));
  const anchor = structural ?? fallback;
  const stop = direction === "sell" ? anchor + atr * PAD_ATR : anchor - atr * PAD_ATR;
  const risk = Math.abs(last.close - stop);
  if (!(risk > 0) || risk > atr * 3.5) return null;

  const targets = nearestTarget(direction, last.close, risk, h1, h4);
  if (!targets) return null;

  const setup: SetupProposal = {
    state: "entry",
    kind: "continuation",
    direction,
    zone: { low: last.close, high: last.close },
    invalidation: stop,
    stopLoss: stop,
    takeProfit1: targets.tp1,
    takeProfit2: targets.tp2,
    riskReward: Math.abs(targets.tp1 - last.close) / risk,
    quality: "media",
    qualityPhase: "final",
    supersedeLevel: direction === "sell" ? priorLow : priorHigh,
    missingForEntry: null,
    slWide: risk > atr * 2,
    warnings: ["MOMENTUM CONTINUATION — capa Watch independiente de V1"],
    managementNote: "SL obligatorio. Señal de continuación; análisis, no orden.",
    entryLabel: last.close.toFixed(args.digits),
  };
  return args.id === "XAUUSD" && args.basis != null
    ? applyBasisToSetup(setup, args.basis, args.digits)
    : setup;
}
