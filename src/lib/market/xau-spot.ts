import { fetchJson } from "./http";
import type { SpotStatus } from "@/lib/trading/types";

export type { SpotStatus };

export interface XauSpotQuote {
  priceSpot: number | null;
  goldApi: number | null;
  oanda: number | null;
  source: string | null;
  status: SpotStatus;
  at: string | null;
  note: string;
}

function num(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

async function fetchGoldApi(): Promise<{ price: number | null; at: string | null; error: string | null }> {
  const res = await fetchJson<{ price?: number; updatedAt?: string }>(
    "https://api.gold-api.com/price/XAU",
    { timeoutMs: 8000, retries: 1 },
  );
  const price = num(res.data?.price);
  if (!res.ok || price == null) {
    return { price: null, at: null, error: res.error ?? `HTTP ${res.status}` };
  }
  return { price, at: res.data?.updatedAt ?? new Date().toISOString(), error: null };
}

/**
 * XAUUSD SPOT uses one authoritative source: gold-api.
 * OANDA is intentionally not consulted or required for availability.
 */
export async function loadXauSpotQuote(): Promise<XauSpotQuote> {
  const gold = await fetchGoldApi();

  if (gold.price == null) {
    return {
      priceSpot: null,
      goldApi: null,
      oanda: null,
      source: null,
      status: "unavailable",
      at: null,
      note: "DATOS NO DISPONIBLES — precio XAUUSD spot (gold-api).",
    };
  }

  return {
    priceSpot: gold.price,
    goldApi: gold.price,
    oanda: null,
    source: "gold-api XAU",
    status: "ok",
    at: gold.at,
    note: `SPOT XAUUSD gold-api ${gold.price.toFixed(2)}.`,
  };
}
