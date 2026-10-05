import { applyBasisToSetup } from "../trading/engine";
import { snapshotIndicators } from "../trading/indicators";
import { detectBosChoch, swingHighs, swingLows } from "../trading/structure";
import type { AssetId, Candle, SetupProposal } from "../trading/types";
import { slotOpenSec, slotSecFromNow } from "./identity";
import { entrySessionOpen } from "./market-session";
import { assessSetupLevels, packProvenanceVerdict, stopFromStructuralAnchor, xauBasisVerdict, type LevelRejectReason } from "./level-integrity";

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

export interface ContinuationIntegrityReject {
  reason: LevelRejectReason;
  direction: "buy" | "sell" | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  anchor: number | null;
}

export function buildMomentumContinuation(args: {
  id: AssetId;
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  nowMs: number;
  basis?: number | null;
  digits: number;
  /** Feed id of the candles these levels are built from. Required once a signal exists. */
  instrument?: string | null;
  /** Source string stamped on that same pack. Required once a signal exists. */
  source?: string | null;
  /** Called once when an integrity rule refuses the entry. Strategy misses stay silent. */
  onIntegrityReject?: (info: ContinuationIntegrityReject) => void;
}): SetupProposal | null {
  const slot = slotSecFromNow(args.nowMs);
  const open = slotOpenSec(slot);
  // Closed session, or a bar that did not open and close inside it: no entry.
  if (!entrySessionOpen(args.id, args.nowMs, open, slot)) return null;

  const m15 = closed(args.m15, args.nowMs);
  const h1 = closed(args.h1, args.nowMs);
  const h4 = closed(args.h4, args.nowMs);
  if (m15.length < 12 || h1.length < 12 || h4.length < 12) return null;

  const last = m15.at(-1)!;
  // Only the bar that just closed. An older closed print is not a new entry.
  if (last.time !== open) return null;
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

  const entry = last.close;
  let anchor: number | null = null;
  let stop: number | null = null;
  let target: number | null = null;
  const reject = (reason: LevelRejectReason): null => {
    console.info("[watch] continuation rejected", { id: args.id, reason });
    args.onIntegrityReject?.({ reason, direction, entry, stop, target, anchor });
    return null;
  };

  // Do not invent a proxy→spot shift. Without a finite basis the three XAU
  // levels are not known to share one price base, so this is not an entry.
  if (args.id === "XAUUSD") {
    const basisVerdict = xauBasisVerdict(args.basis);
    if (!basisVerdict.ok && basisVerdict.reason) return reject(basisVerdict.reason);
  }
  const quoted = packProvenanceVerdict({
    assetId: args.id,
    instrument: args.instrument,
    source: args.source,
    candleCount: args.m15.length,
  });
  if (!quoted.ok && quoted.reason) return reject(quoted.reason);

  const swings = direction === "sell" ? swingHighs(m15) : swingLows(m15);
  const structural = swings.filter((s) => s.index < m15.length - 1).at(-1)?.price;
  const fallback = direction === "sell"
    ? Math.max(...prior.slice(-5).map((c) => c.high))
    : Math.min(...prior.slice(-5).map((c) => c.low));
  anchor = structural ?? fallback;
  // The swing has to sit on the adverse side before the pad. The pad must not
  // pull a wrong-side swing across the entry.
  const anchored = stopFromStructuralAnchor({
    direction,
    entry,
    anchor,
    pad: atr * PAD_ATR,
  });
  if (!anchored.ok) return reject(anchored.reason);
  stop = anchored.stop;
  const risk = direction === "sell" ? stop - entry : entry - stop;
  if (!(risk > 0)) return reject("risk-not-positive");
  if (risk > atr * 3.5) return reject("risk-out-of-bounds");

  const targets = nearestTarget(direction, entry, risk, h1, h4);
  if (!targets) return null;
  target = targets.tp1;

  const setup: SetupProposal = {
    state: "entry",
    kind: "continuation",
    direction,
    zone: { low: entry, high: entry },
    invalidation: stop,
    stopLoss: stop,
    takeProfit1: targets.tp1,
    takeProfit2: targets.tp2,
    riskReward: Math.abs(targets.tp1 - entry) / risk,
    quality: "media",
    qualityPhase: "final",
    supersedeLevel: direction === "sell" ? priorLow : priorHigh,
    missingForEntry: null,
    slWide: risk > atr * 2,
    warnings: ["MOMENTUM CONTINUATION — capa Watch independiente de V1"],
    managementNote: "SL obligatorio. Señal de continuación; análisis, no orden.",
    entryLabel: entry.toFixed(args.digits),
  };
  const published = args.id === "XAUUSD" && typeof args.basis === "number" && Number.isFinite(args.basis)
    ? applyBasisToSetup(setup, args.basis, args.digits)
    : setup;
  const verdict = assessSetupLevels(published, args.digits);
  if (!verdict.ok && verdict.reason) return reject(verdict.reason);
  return published;
}


/**
 * Re-anchors an existing Watch setup to the nearest reachable structural
 * target. It never lowers the RR floor; it only replaces an unnecessarily
 * distant target when a closer 15M/1H structure already pays >= 1.5R.
 */
export function adaptWatchTarget(args: {
  setup: SetupProposal;
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  currentPrice: number;
  basis?: number | null;
  digits: number;
}): SetupProposal {
  const { setup } = args;
  const entry = setup.direction === "sell" ? setup.zone.low : setup.zone.high;
  const risk = Math.abs(entry - setup.stopLoss);
  if (!(risk > 0)) return setup;

  const shift = (p: number) => p - (setup.direction === "sell" || setup.direction === "buy" ? (args.basis ?? 0) : 0);
  const current = args.currentPrice - (args.basis ?? 0);
  const levels = setup.direction === "sell"
    ? [
        ...swingLows(args.m15).map((s) => shift(s.price)),
        ...swingLows(args.h1).map((s) => shift(s.price)),
        ...swingLows(args.h4).map((s) => shift(s.price)),
      ].filter((p) => p < entry && p < current)
    : [
        ...swingHighs(args.m15).map((s) => shift(s.price)),
        ...swingHighs(args.h1).map((s) => shift(s.price)),
        ...swingHighs(args.h4).map((s) => shift(s.price)),
      ].filter((p) => p > entry && p > current);

  const unique = [...new Set(levels.map((p) => Number(p.toFixed(args.digits))))];
  const sorted = unique.sort((a, b) => setup.direction === "sell" ? b - a : a - b);
  const reachable = sorted.find((p) => Math.abs(p - entry) / risk >= MIN_RR);
  if (reachable == null) return setup;

  const originalDistance = Math.abs(setup.takeProfit1 - entry);
  const newDistance = Math.abs(reachable - entry);
  if (newDistance >= originalDistance) return setup;

  const tp2 = setup.takeProfit2 != null && Math.abs(setup.takeProfit2 - entry) > newDistance
    ? setup.takeProfit2
    : setup.takeProfit1;
  return {
    ...setup,
    takeProfit1: reachable,
    takeProfit2: tp2,
    riskReward: newDistance / risk,
    warnings: [...setup.warnings, "TP adaptado a estructura alcanzable 15M/1H"],
  };
}
