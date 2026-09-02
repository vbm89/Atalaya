import type { AssetId, SetupState } from "../trading/types";
import { getAsset } from "../trading/assets";
import { BROKER_CONTRACTS } from "../trading/broker-contract";
import { displayEntryPrice } from "../chart/labels";

/**
 * Presentation layer. Phase 1: analysis vs broker labels.
 * Never invents a T4Trade last, never shifts V1 levels, never feeds the engine.
 */

export type BrokerMappingState = "FEED_NO_DISPONIBLE";

export const BROKER_PROVIDER = "T4Trade" as const;

export const CANONICAL_ANALYSIS: Record<
  AssetId,
  { instrument: string; provider: string; kind: "proxy" | "spot" }
> = {
  WTI: { instrument: "CLUSDT", provider: "Bitget", kind: "proxy" },
  US100: { instrument: "NDX100USDT", provider: "Bitget", kind: "proxy" },
  BTCUSD: { instrument: "BTCUSDT", provider: "Binance", kind: "proxy" },
  XAUUSD: { instrument: "XAUUSD", provider: "gold-api/OANDA", kind: "spot" },
};

export interface AnalysisView {
  instrument: string;
  provider: string;
  kind: "proxy" | "spot";
  price: number | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  state: SetupState;
}

export interface BrokerView {
  instrument: string;
  provider: typeof BROKER_PROVIDER;
  price: number | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  mappingState: BrokerMappingState;
}

export interface InstrumentPair {
  analysisInstrument: string;
  analysisProvider: string;
  analysisKind: "proxy" | "spot";
  brokerInstrument: string;
  brokerProvider: typeof BROKER_PROVIDER;
}

export interface AnalysisSource {
  id: AssetId;
  price: number | null;
  priceSpot?: number | null;
  feedSymbol?: string | null;
  venue?: string | null;
  dataSource?: string | null;
  setupState: SetupState;
  setup?: {
    direction: "buy" | "sell";
    zone: { low: number; high: number };
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number | null;
  } | null;
}

export function mappingStateLabel(state: BrokerMappingState): string {
  return "FEED BROKER NO DISPONIBLE";
}

export function emptyBrokerView(id: AssetId): BrokerView {
  return {
    instrument: BROKER_CONTRACTS[id].brokerSymbol,
    provider: BROKER_PROVIDER,
    price: null,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    mappingState: "FEED_NO_DISPONIBLE",
  };
}

export function instrumentPair(
  id: AssetId,
  hint?: { feedSymbol?: string | null; venue?: string | null; dataSource?: string | null },
): InstrumentPair {
  const canon = CANONICAL_ANALYSIS[id];
  return {
    analysisInstrument: analysisInstrumentOf(id, hint?.feedSymbol),
    analysisProvider: analysisProviderOf(id, hint?.dataSource, hint?.venue),
    analysisKind: canon.kind,
    brokerInstrument: BROKER_CONTRACTS[id].brokerSymbol,
    brokerProvider: BROKER_PROVIDER,
  };
}

function analysisInstrumentOf(id: AssetId, feedSymbol?: string | null): string {
  if (id === "XAUUSD") return "XAUUSD";
  const canon = CANONICAL_ANALYSIS[id].instrument;
  const feed = feedSymbol?.trim();
  if (!feed) return canon;
  if (id === "WTI" && /CLUSDT/i.test(feed)) return "CLUSDT";
  if (id === "US100" && /NDX100USDT/i.test(feed)) return "NDX100USDT";
  if (id === "BTCUSD" && /BTCUSDT/i.test(feed)) return "BTCUSDT";
  return canon;
}

function analysisProviderOf(
  id: AssetId,
  dataSource?: string | null,
  venue?: string | null,
): string {
  if (id === "XAUUSD") return CANONICAL_ANALYSIS.XAUUSD.provider;
  const raw = `${dataSource ?? ""} ${venue ?? ""}`;
  if (/bitget/i.test(raw)) return "Bitget";
  if (/binance/i.test(raw)) return "Binance";
  if (/okx/i.test(raw)) return "OKX";
  if (/mexc/i.test(raw)) return "MEXC";
  if (/kraken/i.test(raw)) return "Kraken";
  if (/twelve/i.test(raw)) return "Twelve Data";
  return CANONICAL_ANALYSIS[id].provider || getAsset(id).venue;
}

export function analysisLevels(src: AnalysisSource): AnalysisView {
  const pair = instrumentPair(src.id, src);
  const setup = src.setup;
  const entry =
    setup != null
      ? displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high)
      : null;
  const price = src.id === "XAUUSD" ? (src.priceSpot ?? src.price) : src.price;
  return {
    instrument: pair.analysisInstrument,
    provider: pair.analysisProvider,
    kind: pair.analysisKind,
    price: price ?? null,
    entry,
    sl: setup?.stopLoss ?? null,
    tp1: setup?.takeProfit1 ?? null,
    tp2: setup?.takeProfit2 ?? null,
    state: src.setupState,
  };
}

export function viewsFromAsset(src: AnalysisSource): {
  analysis: AnalysisView;
  broker: BrokerView;
} {
  return { analysis: analysisLevels(src), broker: emptyBrokerView(src.id) };
}

export function analysisDisclaimer(id: AssetId): string {
  switch (id) {
    case "WTI":
      return "La señal V1 está calculada sobre CLUSDT.\nNo representa precios de ejecución de T4Trade WTICash.";
    case "US100":
      return "La señal V1 está calculada sobre NDX100USDT.\nNo representa precios de ejecución de T4Trade US100Cash.";
    case "BTCUSD":
      return "La señal V1 está calculada sobre BTCUSDT.\nNo representa precios de ejecución de T4Trade BTCUSD.";
    case "XAUUSD":
      return "La señal V1 está en SPOT XAUUSD (gold-api/OANDA). Velas PROXY XAUUSDT. No es last verificado de T4Trade XAUUSD.";
  }
}

export function analysisPriceCaption(id: AssetId, hint?: { dataSource?: string | null; venue?: string | null }): string {
  const pair = instrumentPair(id, hint);
  if (id === "XAUUSD") return "SPOT XAUUSD · gold-api/OANDA";
  if (pair.analysisKind === "proxy") {
    return `${pair.analysisInstrument} · ${pair.analysisProvider} · PROXY`;
  }
  return `${pair.analysisInstrument} · ${pair.analysisProvider}`;
}

export function chartAnalysisCaption(id: AssetId): string {
  switch (id) {
    case "WTI":
      return "ANÁLISIS · CLUSDT · BITGET · PROXY";
    case "US100":
      return "ANÁLISIS · NDX100USDT · BITGET · PROXY";
    case "BTCUSD":
      return "ANÁLISIS · BTCUSDT · PROXY";
    case "XAUUSD":
      return "ANÁLISIS · SPOT XAUUSD · velas PROXY XAUUSDT";
  }
}

export function pushInstrumentLine(id: AssetId, direction: "COMPRA" | "VENTA"): string {
  if (id === "XAUUSD") return `${direction} · SPOT XAUUSD`;
  const inst = CANONICAL_ANALYSIS[id].instrument;
  return `${direction} · ${inst} · PROXY`;
}

export function theoreticalRiskNote(): string {
  return "Estimación teórica usando la distancia del análisis y el contrato T4Trade. No representa una orden ejecutable.";
}

export function executionRiskLabel(): { calculable: false; label: "NO CALCULABLE" } {
  return { calculable: false, label: "NO CALCULABLE" };
}

export function executionCostsLabel(): { calculable: false; label: "NO CALCULABLE" } {
  return { calculable: false, label: "NO CALCULABLE" };
}

export function isExecutionRiskCalculable(broker: BrokerView): boolean {
  return (
    broker.mappingState !== "FEED_NO_DISPONIBLE" &&
    broker.entry != null &&
    broker.sl != null
  );
}
