import type { AssetId, AssetMeta } from "./types";

export const ASSETS: AssetMeta[] = [
  {
    id: "XAUUSD",
    label: "XAUUSD",
    name: "Oro",
    yahooSymbol: "GC=F",
    bitgetSymbol: "XAUUSDT",
    okxInstId: "XAU-USDT-SWAP",
    mexcContract: "XAU_USDT",
    twelveSymbol: "XAU/USD",
    digits: 2,
    sourceNote: "Precio SPOT XAUUSD (gold-api cruzado con OANDA). Velas y técnica PROXY Bitget XAUUSDT.",
    newsQuery: "gold price OR XAUUSD OR \"precio del oro\"",
    yahooNewsQuery: "gold price XAUUSD",
    venue: "Bitget",
    feedSymbol: "XAUUSDT",
    instrumentKind: "proxy",
    session: "spot",
  },
  {
    id: "BTCUSD",
    label: "BTCUSD",
    name: "Bitcoin",
    yahooSymbol: "BTC-USD",
    binanceSymbol: "BTCUSDT",
    krakenPair: "XBTUSD",
    bitgetSymbol: "BTCUSDT",
    okxInstId: "BTC-USDT-SWAP",
    twelveSymbol: "BTC/USD",
    digits: 2,
    sourceNote: "PROXY · BTCUSDT en USDT, no el par BTCUSD al contado",
    newsQuery: "bitcoin BTC OR BTCUSD",
    yahooNewsQuery: "bitcoin BTC",
    venue: "Binance",
    feedSymbol: "BTCUSDT",
    instrumentKind: "proxy",
    session: "crypto24",
  },
  {
    id: "US100",
    label: "US100",
    name: "Nasdaq 100",
    yahooSymbol: "NQ=F",
    bitgetSymbol: "NDX100USDT",
    mexcContract: "NAS100_USDT",
    twelveSymbol: "NDX",
    digits: 2,
    sourceNote: "PROXY · perpetuo NDX100USDT, no es el Nasdaq 100 al contado ni NQ",
    newsQuery: "Nasdaq 100 OR NDX OR \"US100\"",
    yahooNewsQuery: "Nasdaq 100",
    venue: "Bitget",
    feedSymbol: "NDX100USDT",
    instrumentKind: "proxy",
    session: "cme",
  },
  {
    id: "WTI",
    label: "WTI",
    name: "Petróleo WTI",
    yahooSymbol: "CL=F",
    bitgetSymbol: "CLUSDT",
    okxInstId: "CL-USDT-SWAP",
    mexcContract: "USOIL_USDT",
    twelveSymbol: "WTI/USD",
    digits: 2,
    sourceNote: "PROXY · perpetuo CLUSDT, no es el futuro NYMEX CL",
    newsQuery: "WTI OR \"crude oil\" OR \"petróleo WTI\"",
    yahooNewsQuery: "WTI crude oil",
    venue: "Bitget",
    feedSymbol: "CLUSDT",
    instrumentKind: "proxy",
    session: "cme",
  },
];

export function getAsset(id: AssetId): AssetMeta {
  const found = ASSETS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown asset ${id}`);
  return found;
}

export const VOL_THRESHOLDS: Record<
  AssetId,
  { low: number; high: number }
> = {
  XAUUSD: { low: 0.35, high: 0.9 },
  BTCUSD: { low: 1.1, high: 2.6 },
  US100: { low: 0.45, high: 1.1 },
  WTI: { low: 1.0, high: 2.2 },
};
