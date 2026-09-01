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
