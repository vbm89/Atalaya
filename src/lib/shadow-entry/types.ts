/** Tipos del motor Shadow de entradas. Research-only. No es V1. No es K1. */

export type AssetId = "XAUUSD" | "BTCUSD" | "US100" | "WTI";
export type EntryTf = "15m" | "30m" | "1h" | "4h";
export type Direction = "LONG" | "SHORT" | "NO_ENTRY";

export type SignalStatus =
  | "READY"
  | "NO_ENTRY"
  | "DATA_INSUFFICIENT"
  | "CONFLICT"
  | "INCOMPLETE";

export type FamilyId =
  | "A_FAIL_EXTEND"
  | "B_SWEEP_RECLAIM_DISP"
  | "C_BREAKOUT_ACCEPT"
  | "C_BREAKOUT_REJECT"
  | "D_COMPRESSION_EXPAND";

export type RegimeKind =
  | "COMPRESSION"
  | "EXPANSION"
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "EXTENSION_UP"
  | "EXTENSION_DOWN"
  | "INDETERMINATE";

export type VolatilityBand = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";

export type ConfigQuality = "alta" | "media" | "baja" | null;

export type DataSourceKind = "LIVE" | "SYNTHETIC" | "INSUFFICIENT";

export type CloseIntegrity =
  | "PENDING"
  | "UNSTABLE"
  | "STABLE"
  | "BYPASS_REPLAY"
  | "BYPASS_KRAKEN";

export type CostStatus = "UNKNOWN";

export interface ShadowBar {
  assetId: AssetId;
  tf: EntryTf;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  source: string;
}

export interface RegimeState {
  kind: RegimeKind;
  volatility: VolatilityBand;
  compressionRun: number;
  atr: number | null;
  atrPercentile: number | null;
  sma20: number | null;
  closeVsSmaAtr: number | null;
  label: string;
}

export interface ShadowEvent {
  kind: string;
  index: number;
  direction: "buy" | "sell" | null;
  level: number | null;
  atr: number | null;
  extra: Record<string, number | string | boolean | null>;
}

export type NoEntryReason =
  | "NO_EVENT"
  | "NO_CONFIRMATION"
  | "RR_INSUFFICIENT"
  | "INVALIDATION_TOO_CLOSE"
  | "INVALIDATION_TOO_FAR"
  | "TARGET_UNDEFINED"
  | "CONTRADICTORY_STRUCTURE"
  | "DATA_INSUFFICIENT"
  | "REGIME_INCOMPATIBLE"
  | "SIGNAL_INCOMPLETE"
  | "EXCESSIVE_RISK"
  | "OPEN_BAR_EXCLUDED"
  | "ENTRY_MISSING"
  | "INVALIDATION_MISSING"
  | "TARGET_MISSING"
  | "RISK_NOT_POSITIVE"
  | "CLOSE_UNSTABLE";

export interface ShadowEvidence {
  structural: boolean;
  regime: boolean;
  confirmation: boolean;
  conflict: boolean;
  notes: string[];
}

export interface ShadowSignal {
  symbol: AssetId;
  timeframe: EntryTf;
  direction: Direction;
  status: SignalStatus;
  family: FamilyId | null;
  entry: number | null;
  invalidation: number | null;
  target: number | null;
  riskReward: number | null;
  riskAbs: number | null;
  evidence: ShadowEvidence;
  rationale: string;
  learning: {
    what: string;
    why: string;
    confirmed: string;
    invalidatesIf: string;
    wouldNotEnterIf: string;
    sees: string;
    event: string;
    confirms: string;
    wouldEnter: string;
    invalidates: string;
    objective: string;
    rrMeaning: string;
    decision: string;
  };
  regime: RegimeState;
  event: string | null;
  confirmation: string | null;
  timestamp: number | null;
  decisionIndex: number;
  decisionOpenT: number | null;
  decisionCloseT: number | null;
  quality: ConfigQuality;
  noEntryReason: NoEntryReason | null;
  costStatus: CostStatus;
  net: null;
  mode: "learning";
  validatedEdge: false;
  liveTrading: false;
  dataSource: DataSourceKind;
  dataNote: string;
  closeIntegrity?: CloseIntegrity | null;
  ohlcKey?: string | null;
  closeRevisionCount?: number | null;
}

export interface EngineSnapshot {
  bars: ShadowBar[];
  signal: ShadowSignal;
  replayIndex: number;
  warmup: number;
  source: DataSourceKind;
  fetchedAt: number;
  lastPrice: number | null;
  snapshotId: string;
  feed: "LIVE" | "CONECTANDO" | "SIN_CONEXION" | "MERCADO_CERRADO" | "STALE";
}
