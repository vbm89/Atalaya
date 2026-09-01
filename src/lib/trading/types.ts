export type AssetId = "XAUUSD" | "BTCUSD" | "US100" | "WTI";

export type Timeframe = "5m" | "15m" | "1h" | "4h";

export type Signal = "buy" | "sell" | "wait" | "map" | "pending";

export type SetupState = "wait" | "map" | "pending" | "entry";

export type SetupKind = "continuation" | "break-retest";

export type SetupQuality = "alta" | "media";

export type RiskBand = "bajo" | "medio" | "alto" | "muy_alto" | "extremo";

export type Trend = "alcista" | "bajista" | "lateral";

export type VolatilityBand = "baja" | "media" | "alta";

export type Impact = "positivo" | "negativo" | "neutral";

export type Importance = "alta" | "media" | "baja";

export type DataQuality = "live" | "delayed" | "insufficient";

export type InstrumentKind = "native" | "proxy";

export type DataStatus = "ok" | "stale" | "session_closed" | "insufficient" | "error";

export type SpotStatus = "ok" | "unconfirmed" | "unreliable" | "unavailable";

export type SessionKind = "crypto24" | "cme" | "spot";

export interface DailySnapshot {
  source: string;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  atr: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  support1: number | null;
  support2: number | null;
  resist1: number | null;
  resist2: number | null;
  monthHigh: number | null;
  monthLow: number | null;
}

export type TradeDecision = "yes" | "wait" | "no";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface AssetMeta {
  id: AssetId;
  label: string;
  name: string;
  yahooSymbol: string;
  binanceSymbol?: string;
  krakenPair?: string;
  bitgetSymbol?: string;
  okxInstId?: string;
  mexcContract?: string;
  twelveSymbol?: string;
  digits: number;
  sourceNote: string;
  newsQuery: string;
  yahooNewsQuery: string;
  venue: string;
  feedSymbol: string;
  instrumentKind: InstrumentKind;
  session: SessionKind;
}

export interface IndicatorSnapshot {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  volumeAvailable: boolean;
}

export interface Levels {
  supports: number[];
  resistances: number[];
}

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  barCount: number;
  trend: Trend;
  structure: string;
  indicators: IndicatorSnapshot;
  levels: Levels;
  score: number;
  notes: string[];
  sufficient: boolean;
  source: string | null;
  lastBarAt: string | null;
  stale: boolean;
  ageMinutes: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
  assetId: AssetId;
  summary: string;
  impact: Impact;
  importance: Importance;
  classifiedBy: "model" | "keywords" | "unclassified";
}

export interface SetupZone {
  low: number;
  high: number;
}

export interface SetupProposal {
  state: SetupState;
  kind: SetupKind;
  direction: "buy" | "sell";
  zone: SetupZone;
  invalidation: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  riskReward: number;
  quality: SetupQuality;
  qualityPhase: "preliminar" | "final";
  supersedeLevel: number | null;
  missingForEntry: string | null;
  slWide: boolean;
  warnings: string[];
  managementNote: string;
  entryLabel: string;
}

export interface EntryProposal {
  direction: "buy" | "sell";
  entry: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;
  confidence: number;
  reason: string;
}

export interface ContractSpec {
  tickSize: number;
  tickValue: number;
  minLot: number;
  lotStep: number;
}

export interface AssetAnalysis {
  id: AssetId;
  label: string;
  name: string;
  sourceNote: string;
  dataSource: string;
  venue: string;
  feedSymbol: string;
  instrumentKind: InstrumentKind;
  dataStatus: DataStatus;
  dataStatusLabel: string;
  lastDataAt: string | null;
  availableTimeframes: Timeframe[];
  quality: DataQuality;
  qualityNote: string;
  price: number | null;
  priceSpot: number | null;
  priceProxy: number | null;
  basis: number | null;
  basisPct: number | null;
  spotSource: string | null;
  proxySource: string | null;
  spotStatus: SpotStatus | null;
  dayChangePct: number | null;
  marketTime: string | null;
  sparkline: number[];
  trend: Trend;
  volatility: VolatilityBand;
  atrPct: number | null;
  signal: Signal;
  setupState: SetupState;
  setup: SetupProposal | null;
  technicalSummary: string;
  supports: number[];
  resistances: number[];
  timeframes: TimeframeAnalysis[];
  news: NewsItem[];
  entry: EntryProposal | null;
  waitReason: string | null;
  wouldTrade: TradeDecision;
  wouldTradeReason: string;
  confidence: number;
  digits: number;
  bias4hLabel: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  at: string;
  impact: Importance;
  forecast: string | null;
  previous: string | null;
  assets: AssetId[];
}

export interface AnalysisSnapshot {
  generatedAt: string;
  source: string;
  disclaimer: string;
  bestOpportunityId: AssetId | null;
  bestOpportunityNote: string;
  assets: AssetAnalysis[];
  calendar: CalendarEvent[];
  calendarNote: string;
  errors: string[];
}

/**
 * Extension points for later versions. Not implemented in V1 —
 * the analysis engine must never place or close live trades.
 */
export type FutureCapability =
  | "alerts"
  | "tradeTracking"
  | "journal"
  | "backtesting"
  | "interactiveCharts"
  | "moneyManagement"
  | "metaTraderBridge"
  | "autoExecution";
