import type { AssetId } from "../trading/types";

/** Discovery timeframes. 30m is native. 1m/5m are first-class but historically thin. */
export type DiscoveryTf = "1m" | "5m" | "15m" | "30m" | "1h" | "4h";

export const DISCOVERY_TFS: readonly DiscoveryTf[] = ["1m", "5m", "15m", "30m", "1h", "4h"];
export const DISCOVERY_ARCHIVE_TFS: readonly DiscoveryTf[] = ["15m", "30m", "1h", "4h"];
export const DISCOVERY_RECENT_TFS: readonly DiscoveryTf[] = ["1m", "5m"];
export const DISCOVERY_ASSETS: readonly AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

/**
 * Calendar days of per-asset tape (or exhausted) required to *unlock the next TF ingest*.
 * Not a sufficiency / validation threshold. Inference on this tape stays INSUFFICIENT.
 */
export const DISCOVERY_COMMON_MIN_DAYS = 30;

export type DiscoveryUniverseKind = "COMMON_4" | "ASSET_DEEP" | "TF_SOLO";


export const DISCOVERY_STEP_SEC: Record<DiscoveryTf, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
};

/** Generic post-event window. Documented laboratory default — not fit to results. */
export const DISCOVERY_OUTCOME_HORIZON_BARS = 8;

/** Max bars between sequence legs. Grammar constant, not a searched optimum. */
export const DISCOVERY_SEQUENCE_MAX_GAP_BARS = 8;

export const DISCOVERY_SWING_RADIUS = 2;
export const DISCOVERY_ATR_PERIOD = 14;
export const DISCOVERY_RANGE_LOOKBACK = 16;

export interface DiscoveryBar {
  assetId: AssetId;
  tf: DiscoveryTf;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  source: string;
  instrument?: string;
  instrumentKind?: DiscoveryInstrumentKind;
}

export type DiscoveryStatus = "A" | "B" | "C" | "D";

export type DiscoveryInstrumentKind = "proxy-usdt-kline" | "proxy-swap";

export type DiscoveryQuality = "ok" | "thin" | "empty" | "invalid";

export type DiscoveryUse = "explore" | "recent_only" | "unavailable";

export interface DiscoveryGap {
  assetId: AssetId;
  tf: DiscoveryTf;
  fromT: number;
  toT: number;
  missing: number;
}

export interface DiscoveryCoverageRow {
  assetId: AssetId;
  tf: DiscoveryTf;
  source: string | null;
  instrument: string | null;
  instrumentKind: DiscoveryInstrumentKind | null;
  firstT: number | null;
  lastT: number | null;
  firstIso: string | null;
  lastIso: string | null;
  bars: number;
  days: number | null;
  marketDays: number;
  gaps: number;
  missingBars: number;
  quality: DiscoveryQuality;
  use: DiscoveryUse;
  discoveryStatus: DiscoveryStatus;
  servesExplore: boolean;
  servesTrainCandidate: boolean;
  exhausted: boolean | null;
}

export type DiscoveryEventKind =
  | "swing_high"
  | "swing_low"
  | "range_breakout"
  | "failed_breakout"
  | "sweep_prior_high"
  | "sweep_prior_low"
  | "reclaim"
  | "displacement"
  | "bos_up"
  | "bos_down"
  | "fvg_created"
  | "fvg_retested";

export interface DiscoveryEvent {
  id: string;
  assetId: AssetId;
  tf: DiscoveryTf;
  kind: DiscoveryEventKind;
  /** Open time of the decision bar (unix seconds). */
  openT: number;
  /** Close time of the decision bar. Causal clock. */
  closeT: number;
  direction: "buy" | "sell" | null;
  level: number | null;
  atr: number | null;
  extra: Record<string, number | string | boolean | null>;
  /**
   * True when detection of a COMMON_4 event used bars with t < COMMON_4.fromT.
   * Does not invalidate the event. Not lookahead.
   */
  warmupOutsideCommon: boolean;
}

export interface DiscoveryMtfAvailability {
  from: DiscoveryTf;
  to: DiscoveryTf;
  /** True only when both TFs have a COMMON_4 window and native tape. Never 1m/5m. */
  historical: boolean;
  /** 1m/5m (or mixed with them) may exist as recent tape only. */
  recentOnly: boolean;
  reason: string;
}

export type DiscoverySequenceFamily =
  | "LEVEL_REACTION_CONFIRM"
  | "BREAKOUT_RETEST_CONTINUE"
  | "SWEEP_RECLAIM_DISPLACE"
  | "HTF_CONTEXT_LTF_EVENT";

export interface DiscoverySequence {
  family: DiscoverySequenceFamily;
  assetId: AssetId;
  legs: DiscoveryEvent[];
  decisionCloseT: number;
}

export interface DiscoveryOutcome {
  eventId: string;
  horizonBars: number;
  barsAvailable: number;
  mfeAtr: number | null;
  maeAtr: number | null;
  closeReturnAtr: number | null;
  /** Never coerced from missing costs. */
  netR: null;
  costKnown: false;
}

export interface DiscoveryJournalEntry {
  exploredAt: string;
  universe: string;
  primitives: string[];
  families: string[];
  variants: string[];
  discarded: string[];
  discardReason: string | null;
  candidates: string[];
  outcomeConsulted: boolean;
  codeVersion: string;
  notes: string | null;
}
