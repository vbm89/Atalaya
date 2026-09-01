import type { AssetId } from "./types";
import {
  BROKER_CONTRACTS,
  lotInvalidReason,
  type BrokerContract,
} from "./broker-contract";

/**
 * MT4 / T4Trade profit for CFD · Contracts:
 *
 *   ticks = (exit - entry) / tickSize          [buy; sell flips the sign]
 *   grossUsd = ticks * tickValueUsd * volume
 *
 * Equivalent to priceDiff * (tickValueUsd / tickSize) * volume.
 *
 * Do NOT substitute contractSize when it disagrees with tickValue/tickSize.
 * BTCUSD card: contractSize=1, tickSize=0.01, tickValue=1.00 USD
 * → 1.00 price * 1.0 lot = 100 USD, not 1 USD.
 *
 * Spread is floating: not subtracted here (no invented tick count).
 * Commission: only if the caller supplies it. Cards do not list one.
 * Swap: overnight, only if nightsHeld is supplied.
 * EUR: only if usdPerEur (EURUSD) is supplied. Never invent a FX rate.
 */

export type Direction = "buy" | "sell";

export interface TradeInput {
  assetId: AssetId;
  direction: Direction;
  entry: number;
  exit: number;
  volume: number;
  nightsHeld?: number;
  commissionUsd?: number | null;
  commissionEur?: number | null;
  usdPerEur?: number | null;
  contract?: BrokerContract;
}

export interface TradePl {
  calculable: boolean;
  reason: string | null;
  assetKey: AssetId;
  brokerSymbol: string;
  direction: Direction;
  entry: number;
  exit: number;
  volume: number;
  priceDiff: number;
  signedMove: number;
  ticks: number | null;
  tickSize: number | null;
  tickValueUsd: number | null;
  contractSize: number | null;
  usdPerPricePerLot: number | null;
  usedContractSizeShortcut: boolean;
  grossUsd: number | null;
  swapUsd: number | null;
  commissionUsd: number | null;
  netUsd: number | null;
  usdPerEur: number | null;
  netEur: number | null;
  eurReason: string | null;
  currency: "USD" | null;
}

function fail(partial: Partial<TradePl> & Pick<TradePl, "assetKey" | "brokerSymbol" | "direction" | "entry" | "exit" | "volume">, reason: string): TradePl {
  return {
    calculable: false,
    reason,
    priceDiff: partial.exit - partial.entry,
    signedMove: 0,
    ticks: null,
    tickSize: partial.tickSize ?? null,
    tickValueUsd: partial.tickValueUsd ?? null,
    contractSize: partial.contractSize ?? null,
    usdPerPricePerLot: null,
    usedContractSizeShortcut: false,
    grossUsd: null,
    swapUsd: null,
    commissionUsd: null,
    netUsd: null,
    usdPerEur: partial.usdPerEur ?? null,
    netEur: null,
    eurReason: "EUR NO CALCULABLE — P/L USD no calculable.",
    currency: "USD",
    ...partial,
  };
}

export function signedPriceMove(direction: Direction, entry: number, exit: number): number {
  return direction === "buy" ? exit - entry : entry - exit;
}

export function calculateTradePl(input: TradeInput): TradePl {
  const c = input.contract ?? BROKER_CONTRACTS[input.assetId];
  const base = {
    assetKey: c.assetKey,
    brokerSymbol: c.brokerSymbol,
    direction: input.direction,
    entry: input.entry,
    exit: input.exit,
    volume: input.volume,
    tickSize: c.tickSize,
    tickValueUsd: c.tickValueUsd,
    contractSize: c.contractSize,
    usdPerEur: input.usdPerEur ?? null,
  };

  if (c.tickSize == null || !(c.tickSize > 0)) {
    return fail(base, `P/L NO CALCULABLE — tickSize no confirmado para ${c.assetKey}.`);
  }
  if (c.tickValueUsd == null || !(c.tickValueUsd > 0)) {
    return fail(base, `P/L NO CALCULABLE — tickValue no confirmado para ${c.assetKey}.`);
  }
  if (c.minLot == null || c.lotStep == null) {
    return fail(base, `P/L NO CALCULABLE — lote no confirmado para ${c.assetKey}.`);
  }
  if (!Number.isFinite(input.entry) || !Number.isFinite(input.exit)) {
    return fail(base, "P/L NO CALCULABLE — precios no numéricos.");
  }
  const lotWhy = lotInvalidReason(c.assetKey, input.volume);
  if (lotWhy) {
    return fail(base, lotWhy);
  }

  const signedMove = signedPriceMove(input.direction, input.entry, input.exit);
  const ticks = signedMove / c.tickSize;
  const usdPer = c.tickValueUsd / c.tickSize;
  const grossUsd = ticks * c.tickValueUsd * input.volume;

  let swapUsd: number | null = 0;
  const nights = input.nightsHeld ?? 0;
  if (nights > 0) {
    if (c.swapLong == null || c.swapShort == null) {
      swapUsd = null;
    } else {
      const perLot = input.direction === "buy" ? c.swapLong : c.swapShort;
      swapUsd = perLot * input.volume * nights;
    }
  }

  let commissionUsd: number | null = 0;
  if (input.commissionUsd != null) {
    if (!(input.commissionUsd >= 0) || !Number.isFinite(input.commissionUsd)) {
      return fail(base, "P/L NO CALCULABLE — comisión USD inválida.");
    }
    commissionUsd = input.commissionUsd;
  } else if (input.commissionEur != null) {
    if (input.usdPerEur == null || !(input.usdPerEur > 0)) {
      return fail(
        { ...base, ticks, usdPerPricePerLot: usdPer },
        "P/L NO CALCULABLE — comisión en EUR sin tipo de cambio USD/EUR.",
      );
    }
    commissionUsd = input.commissionEur * input.usdPerEur;
  }

  if (swapUsd == null) {
    return fail(
      { ...base, ticks, usdPerPricePerLot: usdPer },
      "P/L NO CALCULABLE — swap no confirmado y la operación cruza noches.",
    );
  }

  const netUsd = grossUsd + swapUsd - (commissionUsd ?? 0);

  let netEur: number | null = null;
  let eurReason: string | null = null;
  const usdPerEur = input.usdPerEur ?? null;
  if (usdPerEur == null || !(usdPerEur > 0)) {
    eurReason = "EUR NO CALCULABLE — falta tipo de cambio USD/EUR (EURUSD). No se inventa.";
  } else {
    netEur = netUsd / usdPerEur;
  }

  return {
    calculable: true,
    reason: null,
    assetKey: c.assetKey,
    brokerSymbol: c.brokerSymbol,
    direction: input.direction,
    entry: input.entry,
    exit: input.exit,
    volume: input.volume,
    priceDiff: input.exit - input.entry,
    signedMove,
    ticks,
    tickSize: c.tickSize,
    tickValueUsd: c.tickValueUsd,
    contractSize: c.contractSize,
    usdPerPricePerLot: usdPer,
    usedContractSizeShortcut: false,
    grossUsd,
    swapUsd,
    commissionUsd,
    netUsd,
    usdPerEur,
    netEur,
    eurReason,
    currency: "USD",
  };
}
