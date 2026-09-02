import type { AssetId } from "../trading/types";

export const CHART_ASSET_BLURB: Record<AssetId, string> = {
  XAUUSD: "SPOT XAUUSD · velas PROXY XAUUSDT",
  BTCUSD: "Bitcoin / Dólar",
  US100: "Índice NASDAQ 100",
  WTI: "Petróleo crudo",
};

/** Visible copy only. Internal direction stays buy/sell. */
export function directionUi(dir: "buy" | "sell"): "COMPRA" | "VENTA" {
  return dir === "buy" ? "COMPRA" : "VENTA";
}

/**
 * V1 entryPx as shown in the UI. Not a fill band.
 * Sell → zone.low. Buy → zone.high. Same formula as engine.ts entryPx.
 */
export function displayEntryPrice(
  direction: "buy" | "sell",
  zoneLow: number,
  zoneHigh: number,
): number {
  return direction === "sell" ? zoneLow : zoneHigh;
}
