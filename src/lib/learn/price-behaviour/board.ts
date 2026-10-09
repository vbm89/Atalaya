import { latestDecision } from "./decide.ts";
import { dataStatus, gateDecision, shortWait, type DataStatus } from "./freshness.ts";
import { PARAMS } from "./params.ts";
import type { AssetId, Bar } from "./types.ts";

export interface AttemptView {
  provider: string;
  httpStatus: number | null;
  error: string | null;
  bars: number;
  lastBarT: number | null;
  ok: boolean;
  fresh: boolean;
}

export interface AssetBoard {
  asset: AssetId;
  price: number | null;
  status: DataStatus;
  provider: string | null;
  lastBarT: number | null;
  updatedAt: number;
  bars: number;
  freshnessSec: number | null;
  error: string | null;
  attempts: AttemptView[];
  action: "COMPRA" | "VENTA" | "ESPERAR";
  direction: "LONG" | "SHORT" | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  setup: string | null;
  tier: "FULL" | "PARTIAL" | null;
  marketState: string;
  event: string;
  confirmation: boolean;
  evidence: Record<string, boolean>;
  rationale: string;
  wait: string;
  validatedEdge: false;
  liveTrading: false;
  candles: { t: number; o: number; h: number; l: number; c: number }[];
}

export function presentAsset(args: {
  asset: AssetId;
  bars: readonly Bar[];
  provider: string | null;
  sourceLive: boolean;
  error: string | null;
  attempts: AttemptView[];
  nowSec: number;
}): AssetBoard {
  const last = args.bars.length ? args.bars[args.bars.length - 1]! : null;
  const status: DataStatus = !args.sourceLive || !last ? "DATA_ERROR" : dataStatus(last.t, args.bars.length, args.nowSec, PARAMS.warmup + 1);
  const raw = latestDecision(args.bars, args.asset);
  const decision = gateDecision(raw, status, args.error);
  const age = last ? args.nowSec - (last.t + PARAMS.barSec) : null;
  return {
    asset: args.asset,
    price: last?.c ?? null,
    status,
    provider: args.provider,
    lastBarT: last?.t ?? null,
    updatedAt: args.nowSec,
    bars: args.bars.length,
    freshnessSec: age,
    error: args.error,
    attempts: args.attempts,
    action: decision.action,
    direction: decision.direction,
    entry: decision.entry,
    stop: decision.stop,
    target: decision.target,
    rr: decision.rr,
    setup: decision.setup,
    tier: decision.tier,
    marketState: decision.marketState.state,
    event: decision.event,
    confirmation: decision.confirmation,
    evidence: decision.evidence,
    rationale: decision.explanation.narrativa,
    wait: shortWait(decision),
    validatedEdge: false,
    liveTrading: false,
    candles: args.bars.slice(-80).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })),
  };
}
