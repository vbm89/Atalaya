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

const CONSENSUS_PCT = 0.15;

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

async function fetchOandaSpot(): Promise<{ price: number | null; error: string | null }> {
  const url =
    "https://scanner.tradingview.com/symbol?symbol=" +
    encodeURIComponent("OANDA:XAUUSD") +
    "&fields=" +
    encodeURIComponent("close,bid,ask,update_mode");
  const res = await fetchJson<{ close?: number; bid?: number; ask?: number }>(url, {
    timeoutMs: 8000,
    retries: 1,
  });
  const price = num(res.data?.close) ?? num(res.data?.bid);
  if (!res.ok || price == null) {
    return { price: null, error: res.error ?? `HTTP ${res.status}` };
  }
  return { price, error: null };
}

export async function loadXauSpotQuote(): Promise<XauSpotQuote> {
  const [gold, oanda] = await Promise.all([fetchGoldApi(), fetchOandaSpot()]);

  if (gold.price == null && oanda.price == null) {
    return {
      priceSpot: null,
      goldApi: null,
      oanda: null,
      source: null,
      status: "unavailable",
      at: null,
      note: "DATOS NO DISPONIBLES — precio XAUUSD spot (gold-api y OANDA).",
    };
  }

  if (gold.price != null && oanda.price != null) {
    const deltaPct = (Math.abs(gold.price - oanda.price) / oanda.price) * 100;
    if (deltaPct > CONSENSUS_PCT) {
      return {
        priceSpot: null,
        goldApi: gold.price,
        oanda: oanda.price,
        source: null,
        status: "unreliable",
        at: gold.at,
        note: `DATOS NO DISPONIBLES — gold-api ${gold.price.toFixed(2)} y OANDA ${oanda.price.toFixed(2)} difieren ${deltaPct.toFixed(3)} %.`,
      };
    }
    return {
      priceSpot: gold.price,
      goldApi: gold.price,
      oanda: oanda.price,
      source: "gold-api XAU",
      status: "ok",
      at: gold.at,
      note: `SPOT XAUUSD gold-api ${gold.price.toFixed(2)} cruzado con OANDA ${oanda.price.toFixed(2)} (Δ ${deltaPct.toFixed(3)} %).`,
    };
  }

  if (gold.price != null) {
    return {
      priceSpot: gold.price,
      goldApi: gold.price,
      oanda: null,
      source: "gold-api XAU",
      status: "unconfirmed",
      at: gold.at,
      note: `SPOT XAUUSD gold-api ${gold.price.toFixed(2)} (OANDA no disponible; cruce incompleto).`,
    };
  }

  return {
    priceSpot: oanda.price,
    goldApi: null,
    oanda: oanda.price,
    source: "OANDA XAUUSD",
    status: "unconfirmed",
    at: new Date().toISOString(),
    note: `SPOT XAUUSD OANDA ${oanda.price!.toFixed(2)} (gold-api no disponible; cruce incompleto).`,
  };
}
