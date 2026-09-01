import type { AssetId } from "./types";

/**
 * Unique source of T4Trade / Tradeco Limited / T4Trade-Real2 / Standard
 * contract metadata. Asset keys stay XAUUSD | BTCUSD | US100 | WTI.
 * Broker symbols (US100Cash, WTICash) never become asset keys.
 *
 * Provenance:
 * - mt4_capture: MT4 Specification cards supplied by the owner
 *   (IMG_7934 XAUUSD, IMG_7941 BTCUSD, IMG_7940 US100Cash, IMG_7939 WTICash).
 * - owner_confirmed: stated by the owner in addition to the card
 *   (minLot / lotStep, which the Specification window does not list).
 * - unknown: must stay null. Never copy another asset. Never assume 0 or 1.
 */
export type FieldProvenance = "mt4_capture" | "owner_confirmed" | "unknown";

export type ProfitCalculation = "cfd";
export type MarginCalculation = "contracts";
export type PendingOrderPolicy = "gtc";
export type SpreadType = "floating" | "fixed";
export type SwapType = "points" | "usd";

export interface BrokerContract {
  assetKey: AssetId;
  brokerSymbol: string;
  contractSize: number | null;
  tickSize: number | null;
  tickValueUsd: number | null;
  minLot: number | null;
  lotStep: number | null;
  digits: number | null;
  stopsLevel: number | null;
  swapLong: number | null;
  swapShort: number | null;
  swapType: SwapType | null;
  marginCoverage: number | null;
  marginPercent: number | null;
  profitCalculation: ProfitCalculation | null;
  marginCalculation: MarginCalculation | null;
  pendingOrderPolicy: PendingOrderPolicy | null;
  spreadType: SpreadType | null;
  currency: "USD" | null;
}

export type BrokerField = Exclude<keyof BrokerContract, "assetKey" | "brokerSymbol">;

const CRITICAL: BrokerField[] = [
  "contractSize",
  "tickSize",
  "tickValueUsd",
  "minLot",
  "lotStep",
  "digits",
];

export const BROKER_CONTRACTS: Record<AssetId, BrokerContract> = {
  XAUUSD: {
    assetKey: "XAUUSD",
    brokerSymbol: "XAUUSD",
    contractSize: 100,
    tickSize: 0.01,
    tickValueUsd: 1,
    minLot: 0.01,
    lotStep: 0.01,
    digits: 2,
    stopsLevel: 0,
    swapLong: -50.8,
    swapShort: 18.2,
    swapType: "points",
    marginCoverage: 50,
    marginPercent: 0.1,
    profitCalculation: "cfd",
    marginCalculation: "contracts",
    pendingOrderPolicy: "gtc",
    spreadType: "floating",
    currency: "USD",
  },
  BTCUSD: {
    assetKey: "BTCUSD",
    brokerSymbol: "BTCUSD",
    contractSize: 1,
    tickSize: 0.01,
    tickValueUsd: 1,
    minLot: 0.01,
    lotStep: 0.01,
    digits: 2,
    stopsLevel: 0,
    swapLong: -10,
    swapShort: -10,
    swapType: "points",
    marginCoverage: 0.5,
    marginPercent: 0.2,
    profitCalculation: "cfd",
    marginCalculation: "contracts",
    pendingOrderPolicy: "gtc",
    spreadType: "floating",
    currency: "USD",
  },
  US100: {
    assetKey: "US100",
    brokerSymbol: "US100Cash",
    contractSize: 1,
    tickSize: 0.01,
    tickValueUsd: 0.01,
    minLot: 0.1,
    lotStep: 0.01,
    digits: 2,
    stopsLevel: 0,
    swapLong: -5.74,
    swapShort: -1.04,
    swapType: "points",
    marginCoverage: 0.5,
    marginPercent: 1,
    profitCalculation: "cfd",
    marginCalculation: "contracts",
    pendingOrderPolicy: "gtc",
    spreadType: "floating",
    currency: "USD",
  },
  WTI: {
    assetKey: "WTI",
    brokerSymbol: "WTICash",
    contractSize: 1000,
    tickSize: 0.01,
    tickValueUsd: 10,
    minLot: 0.01,
    lotStep: 0.01,
    digits: 2,
    stopsLevel: 0,
    swapLong: 5.18,
    swapShort: -29,
    swapType: "points",
    marginCoverage: 500,
    marginPercent: 0.5,
    profitCalculation: "cfd",
    marginCalculation: "contracts",
    pendingOrderPolicy: "gtc",
    spreadType: "floating",
    currency: "USD",
  },
};

export const FIELD_SOURCE: Record<AssetId, Record<BrokerField, FieldProvenance>> = {
  XAUUSD: {
    contractSize: "mt4_capture",
    tickSize: "mt4_capture",
    tickValueUsd: "mt4_capture",
    minLot: "owner_confirmed",
    lotStep: "owner_confirmed",
    digits: "mt4_capture",
    stopsLevel: "mt4_capture",
    swapLong: "mt4_capture",
    swapShort: "mt4_capture",
    swapType: "mt4_capture",
    marginCoverage: "mt4_capture",
    marginPercent: "mt4_capture",
    profitCalculation: "mt4_capture",
    marginCalculation: "mt4_capture",
    pendingOrderPolicy: "mt4_capture",
    spreadType: "mt4_capture",
    currency: "mt4_capture",
  },
  BTCUSD: {
    contractSize: "mt4_capture",
    tickSize: "mt4_capture",
    tickValueUsd: "mt4_capture",
    minLot: "owner_confirmed",
    lotStep: "owner_confirmed",
    digits: "mt4_capture",
    stopsLevel: "mt4_capture",
    swapLong: "mt4_capture",
    swapShort: "mt4_capture",
    swapType: "mt4_capture",
    marginCoverage: "mt4_capture",
    marginPercent: "mt4_capture",
    profitCalculation: "mt4_capture",
    marginCalculation: "mt4_capture",
    pendingOrderPolicy: "mt4_capture",
    spreadType: "mt4_capture",
    currency: "mt4_capture",
  },
  US100: {
    contractSize: "mt4_capture",
    tickSize: "mt4_capture",
    tickValueUsd: "mt4_capture",
    minLot: "owner_confirmed",
    lotStep: "owner_confirmed",
    digits: "mt4_capture",
    stopsLevel: "mt4_capture",
    swapLong: "mt4_capture",
    swapShort: "mt4_capture",
    swapType: "mt4_capture",
    marginCoverage: "mt4_capture",
    marginPercent: "mt4_capture",
    profitCalculation: "mt4_capture",
    marginCalculation: "mt4_capture",
    pendingOrderPolicy: "mt4_capture",
    spreadType: "mt4_capture",
    currency: "mt4_capture",
  },
  WTI: {
    contractSize: "mt4_capture",
    tickSize: "mt4_capture",
    tickValueUsd: "mt4_capture",
    minLot: "owner_confirmed",
    lotStep: "owner_confirmed",
    digits: "mt4_capture",
    stopsLevel: "mt4_capture",
    swapLong: "mt4_capture",
    swapShort: "mt4_capture",
    swapType: "mt4_capture",
    marginCoverage: "mt4_capture",
    marginPercent: "mt4_capture",
    profitCalculation: "mt4_capture",
    marginCalculation: "mt4_capture",
    pendingOrderPolicy: "mt4_capture",
    spreadType: "mt4_capture",
    currency: "mt4_capture",
  },
};

export function getBrokerContract(id: AssetId): BrokerContract {
  return BROKER_CONTRACTS[id];
}

export function unknownFields(c: BrokerContract): BrokerField[] {
  const out: BrokerField[] = [];
  for (const k of CRITICAL) {
    const v = c[k];
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) out.push(k);
  }
  return out;
}

export function contractReady(id: AssetId): boolean {
  return unknownFields(BROKER_CONTRACTS[id]).length === 0;
}

/** USD per 1.00 of price per 1.0 lot. Null if tickSize/tickValue unknown. Never assumes 0 or 1. */
export function usdPerPricePerLot(c: BrokerContract): number | null {
  if (c.tickSize == null || c.tickValueUsd == null) return null;
  if (!(c.tickSize > 0) || !(c.tickValueUsd > 0)) return null;
  return c.tickValueUsd / c.tickSize;
}

const LOT_EPS = 1e-8;

/**
 * volume >= minLot and (volume - minLot) is an integer number of lotStep.
 * US100 0.11 is valid. 0.105 is not. Never snap 0.11 → 0.10.
 */
export function isValidLot(volume: number, minLot: number, lotStep: number): boolean {
  if (!Number.isFinite(volume) || !Number.isFinite(minLot) || !Number.isFinite(lotStep)) return false;
  if (!(minLot > 0) || !(lotStep > 0)) return false;
  if (volume + LOT_EPS < minLot) return false;
  const steps = (volume - minLot) / lotStep;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

export function isValidLotForAsset(id: AssetId, volume: number): boolean {
  const c = BROKER_CONTRACTS[id];
  if (c.minLot == null || c.lotStep == null) return false;
  return isValidLot(volume, c.minLot, c.lotStep);
}

export function lotInvalidReason(id: AssetId, volume: number): string | null {
  const c = BROKER_CONTRACTS[id];
  if (c.minLot == null || c.lotStep == null) {
    return `LOTE NO CALCULABLE — minLot/lotStep no confirmados para ${id}.`;
  }
  if (!Number.isFinite(volume)) return "Volumen no numérico.";
  if (volume + LOT_EPS < c.minLot) {
    return `Volumen ${volume} < lote mínimo ${c.minLot} (${c.brokerSymbol}).`;
  }
  if (!isValidLot(volume, c.minLot, c.lotStep)) {
    return `Volumen ${volume} no respeta paso ${c.lotStep} desde ${c.minLot} (${c.brokerSymbol}).`;
  }
  return null;
}
