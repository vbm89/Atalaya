export type AssetId = "XAUUSD" | "BTCUSD" | "US100" | "WTI";
export type Action = "COMPRA" | "VENTA" | "ESPERAR";
export type Side = "LONG" | "SHORT";

export type MarketStateKind =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "COMPRESSION"
  | "EXPANSION"
  | "REVERSAL_ATTEMPT"
  | "UNCLEAR";

export type EventKind =
  | "BREAKOUT_UP"
  | "BREAKOUT_DOWN"
  | "SWEEP_HIGH"
  | "SWEEP_LOW"
  | "RECLAIM_UP"
  | "RECLAIM_DOWN"
  | "REJECTION_HIGH"
  | "REJECTION_LOW"
  | "DISPLACEMENT_UP"
  | "DISPLACEMENT_DOWN"
  | "PULLBACK"
  | "PULLBACK_COMPLETE"
  | "COMPRESSION"
  | "EXPANSION"
  | "FAILED_BREAKOUT_UP"
  | "FAILED_BREAKOUT_DOWN"
  | "NO_EVENT";

export type SetupId =
  | "TREND_PULLBACK"
  | "BREAKOUT_ACCEPTANCE"
  | "SWEEP_RECLAIM"
  | "FAILED_BREAKOUT"
  | "EXPANSION_CONTINUATION";

export type WaitReason =
  | "WARMUP"
  | "NO_SETUP"
  | "INCOMPLETE"
  | "CONTRADICTION"
  | "INVALIDATION"
  | "RR_INSUFFICIENT"
  | "NO_TARGET"
  | "DATA";

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number | null;
}

export interface CandleView {
  range: number;
  body: number;
  bodyFrac: number;
  upperWick: number;
  lowerWick: number;
  closeLocation: number;
  trueRange: number;
  rangeAtr: number | null;
  tags: string[];
}

export interface Swing {
  index: number;
  price: number;
  kind: "high" | "low";
  confirmIndex: number;
}

export interface StructureView {
  swings: Swing[];
  hh: boolean;
  hl: boolean;
  lh: boolean;
  ll: boolean;
  lastHigh: Swing | null;
  prevHigh: Swing | null;
  lastLow: Swing | null;
  prevLow: Swing | null;
  recentHigh: number | null;
  recentLow: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  bosUp: boolean;
  bosDown: boolean;
}

export interface MarketState {
  state: MarketStateKind;
  confidence: number;
  evidence: string[];
}

export interface PriceEvent {
  event: EventKind;
  confidence: number;
  price: number;
  level: number | null;
  evidence: string[];
}

export interface ContextView {
  ema: number | null;
  atr: number | null;
  atrPercentile: number | null;
  distStructureAtr: number | null;
  distSessionHighAtr: number | null;
  distSessionLowAtr: number | null;
  distRecentHighAtr: number | null;
  distRecentLowAtr: number | null;
  distEmaAtr: number | null;
  volatility: "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";
  session: string;
  sessionHigh: number | null;
  sessionLow: number | null;
  htf1h: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  htf4h: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
}

export interface SetupHit {
  id: SetupId;
  direction: Side;
  complete: boolean;
  evidence: Record<string, boolean>;
  missing: string[];
  defended: number | null;
}

export interface Explanation {
  estado: string;
  evento: string;
  estructura: string;
  confirmacion: string;
  entrada: string;
  sl: string;
  tp: string;
  rr: string;
  decision: string;
  narrativa: string;
}

export interface Decision {
  asset: AssetId;
  timestamp: number | null;
  barOpenT: number | null;
  action: Action;
  direction: Side | null;
  marketState: MarketState;
  setup: SetupId | null;
  event: EventKind;
  events: PriceEvent[];
  confirmation: boolean;
  entry: number | null;
  stop: number | null;
  target: number | null;
  targetSource: string | null;
  rr: number | null;
  risk: number | null;
  evidence: Record<string, boolean>;
  missingEvidence: string[];
  levels: {
    swingHigh: number | null;
    swingLow: number | null;
    rangeHigh: number | null;
    rangeLow: number | null;
    recentHigh: number | null;
    recentLow: number | null;
    sessionHigh: number | null;
    sessionLow: number | null;
    ema: number | null;
    atr: number | null;
    defended: number | null;
  };
  context: ContextView;
  candle: CandleView | null;
  explanation: Explanation;
  reason: WaitReason | "READY";
  detail: string;
  /** FULL = setup completo. PARTIAL = lectura objetiva sin todas las piezas del setup. */
  tier: "FULL" | "PARTIAL" | null;
  mode: "learning";
  validatedEdge: false;
  liveTrading: false;
}
