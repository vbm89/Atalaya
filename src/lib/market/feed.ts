import {
  countGaps,
  hasExcessiveGaps,
  isCmeSessionOpen,
  isTfStale,
  MIN_BARS,
} from "@/lib/trading/integrity";
import type {
  AssetMeta,
  Candle,
  DataQuality,
  DataStatus,
  InstrumentKind,
  SpotStatus,
  Timeframe,
} from "@/lib/trading/types";
import { fetchBinanceKlines, fetchBinanceTicker } from "./binance";
import { fetchBitgetKlines, fetchBitgetTicker } from "./bitget";
import { fetchKrakenOHLC, fetchKrakenTicker } from "./kraken";
import { fetchMexcKlines, fetchMexcTicker } from "./mexc";
import { fetchOkxKlines, fetchOkxTicker } from "./okx";
import { lastBarIso, type QuoteFetch, type TfFetch } from "./series";
import { fetchTwelveKlines, fetchTwelveQuote, twelveDataKey } from "./twelvedata";
import { loadXauSpotQuote } from "./xau-spot";

export const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "4h"];

export interface TfPack {
  candles: Candle[];
  source: string | null;
  lastBarAt: string | null;
  error: string | null;
  stale: boolean;
  gapCount: number;
  ageMinutes: number | null;
}

export interface AssetPack {
  price: number | null;
  dayChangePct: number | null;
  marketTime: string | null;
  dataSource: string;
  venue: string;
  feedSymbol: string;
  instrumentKind: InstrumentKind;
  dataStatus: DataStatus;
  dataStatusLabel: string;
  lastDataAt: string | null;
  qualityNote: string;
  quality: DataQuality;
  sparkline: number[];
  tfs: Record<Timeframe, TfPack>;
  fallbackNote: string | null;
  sessionOpen: boolean;
  priceSpot: number | null;
  priceProxy: number | null;
  basis: number | null;
  basisPct: number | null;
  spotSource: string | null;
  proxySource: string | null;
  spotStatus: SpotStatus | null;
}

type ProviderId = "twelve" | "binance" | "kraken" | "bitget" | "okx" | "mexc";

function providersFor(asset: AssetMeta): ProviderId[] {
  const out: ProviderId[] = [];
  if (twelveDataKey() && asset.twelveSymbol) out.push("twelve");
  if (asset.binanceSymbol) out.push("binance");
  if (asset.krakenPair) out.push("kraken");
  if (asset.bitgetSymbol) out.push("bitget");
  if (asset.okxInstId) out.push("okx");
  if (asset.mexcContract) out.push("mexc");
  return out;
}

function providerLabel(asset: AssetMeta, provider: ProviderId): string {
  switch (provider) {
    case "twelve":
      return `Twelve Data ${asset.twelveSymbol}`;
    case "binance":
      return `Binance ${asset.binanceSymbol}`;
    case "kraken":
      return `Kraken ${asset.krakenPair}`;
    case "bitget":
      return `Bitget ${asset.bitgetSymbol}`;
    case "okx":
      return `OKX ${asset.okxInstId}`;
    case "mexc":
      return `MEXC ${asset.mexcContract}`;
  }
}

async function fetchTf(
  asset: AssetMeta,
  tf: Timeframe,
  provider: ProviderId,
): Promise<TfFetch> {
  switch (provider) {
    case "twelve":
      return fetchTwelveKlines(asset.twelveSymbol!, tf);
    case "binance": {
      const r = await fetchBinanceKlines(asset.binanceSymbol!, tf);
      return {
        candles: r.candles,
        source: `Binance ${asset.binanceSymbol}`,
        error: r.error,
      };
    }
    case "kraken": {
      const r = await fetchKrakenOHLC(asset.krakenPair!, tf);
      return {
        candles: r.candles,
        source: `Kraken ${asset.krakenPair}`,
        error: r.error,
      };
    }
    case "bitget":
      return fetchBitgetKlines(asset.bitgetSymbol!, tf);
    case "okx":
      return fetchOkxKlines(asset.okxInstId!, tf);
    case "mexc":
      return fetchMexcKlines(asset.mexcContract!, tf);
  }
}

async function fetchQuote(asset: AssetMeta, provider: ProviderId): Promise<QuoteFetch> {
  switch (provider) {
    case "twelve":
      return fetchTwelveQuote(asset.twelveSymbol!);
    case "binance": {
      const r = await fetchBinanceTicker(asset.binanceSymbol!);
      return {
        price: r.price,
        dayChangePct: r.changePct,
        marketTime: null,
        source: `Binance ${asset.binanceSymbol}`,
        error: r.error,
      };
    }
    case "kraken": {
      const r = await fetchKrakenTicker(asset.krakenPair!);
      return {
        price: r.price,
        dayChangePct: r.changePct,
        marketTime: null,
        source: `Kraken ${asset.krakenPair}`,
        error: r.error,
      };
    }
    case "bitget":
      return fetchBitgetTicker(asset.bitgetSymbol!);
    case "okx":
      return fetchOkxTicker(asset.okxInstId!);
    case "mexc":
      return fetchMexcTicker(asset.mexcContract!);
  }
}

function blankTf(error: string): TfPack {
  return {
    candles: [],
    source: null,
    lastBarAt: null,
    error,
    stale: true,
    gapCount: 0,
    ageMinutes: null,
  };
}

function toTfPack(result: TfFetch, tf: Timeframe, now: number): TfPack {
  const lastBarAt = lastBarIso(result.candles);
  const gaps = countGaps(result.candles, tf);
  const stale = isTfStale(tf, lastBarAt, now);
  const excessive = hasExcessiveGaps(result.candles, tf);
  const age = lastBarAt ? Math.round((now - Date.parse(lastBarAt)) / 60000) : null;
  let error = result.error;
  if (!error && result.candles.length < MIN_BARS[tf]) {
    error =
      result.candles.length === 0
        ? "DATOS NO DISPONIBLES"
        : `insuficiente (${result.candles.length} velas, mín. ${MIN_BARS[tf]})`;
  }
  if (excessive) {
    error = `DATOS NO DISPONIBLES — ${gaps} huecos en la serie nativa`;
  }
  return {
    candles: excessive ? [] : result.candles,
    source: result.source,
    lastBarAt,
    error,
    stale,
    gapCount: gaps,
    ageMinutes: age,
  };
}

async function loadFromProvider(
  asset: AssetMeta,
  provider: ProviderId,
  now: number,
): Promise<AssetPack> {
  const sourceName = providerLabel(asset, provider);
  const [quote, ...tfList] = await Promise.all([
    fetchQuote(asset, provider).catch((e): QuoteFetch => ({
      price: null,
      dayChangePct: null,
      marketTime: null,
      source: sourceName,
      error: e instanceof Error ? e.message : "error",
    })),
    ...TIMEFRAMES.map((tf) =>
      fetchTf(asset, tf, provider)
        .then((r) => toTfPack(r, tf, now))
        .catch((e) =>
          blankTf(`${sourceName}: ${e instanceof Error ? e.message : "error"}`),
        ),
    ),
  ]);

  const tfs = {
    "5m": tfList[0]!,
    "15m": tfList[1]!,
    "1h": tfList[2]!,
    "4h": tfList[3]!,
  };

  const lastFromBars = TIMEFRAMES.map((tf) => tfs[tf].lastBarAt)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1);

  const price =
    quote.price ??
    tfs["5m"].candles.at(-1)?.close ??
    tfs["15m"].candles.at(-1)?.close ??
    tfs["1h"].candles.at(-1)?.close ??
    tfs["4h"].candles.at(-1)?.close ??
    null;

  const lastDataAt = lastFromBars ?? quote.marketTime ?? null;
  const sessionOpen =
    asset.session === "crypto24" || asset.session === "spot"
      ? true
      : isCmeSessionOpen(now);

  const usable = TIMEFRAMES.filter((tf) => {
    const p = tfs[tf];
    return (
      p.candles.length >= MIN_BARS[tf] &&
      !p.stale &&
      !hasExcessiveGaps(p.candles, tf)
    );
  });

  const anyStale = TIMEFRAMES.some((tf) => tfs[tf].candles.length > 0 && tfs[tf].stale);
  const notes: string[] = [];

  for (const tf of TIMEFRAMES) {
    const p = tfs[tf];
    if (p.candles.length < MIN_BARS[tf] || p.error?.startsWith("DATOS NO DISPONIBLES")) {
      notes.push(`${tf}: DATOS NO DISPONIBLES${p.error && p.error !== "DATOS NO DISPONIBLES" ? ` (${p.error})` : ""}`);
    } else if (p.stale) {
      notes.push(`${tf}: DATOS NO DISPONIBLES — última vela hace ${p.ageMinutes ?? "?"} min`);
    } else if (p.gapCount > 0) {
      notes.push(`${tf}: ${p.gapCount} huecos (serie nativa, sin relleno)`);
    }
  }

  let dataStatus: DataStatus = "ok";
  let dataStatusLabel = "Datos recientes";
  let quality: DataQuality = "live";

  if (price == null && usable.length === 0) {
    dataStatus = quote.error ? "error" : "insufficient";
    dataStatusLabel = quote.error ? `Error de fuente: ${quote.error}` : "Datos incompletos";
    quality = "insufficient";
  } else if (!sessionOpen) {
    dataStatus = "session_closed";
    dataStatusLabel = "Subyacente cerrado";
    quality = "delayed";
    notes.push(
      "El mercado del subyacente (CME/COMEX/NYMEX) está cerrado. El precio es de un PROXY 24/7.",
    );
  } else if (anyStale || usable.length < 4) {
    dataStatus = anyStale ? "stale" : "insufficient";
    dataStatusLabel = anyStale ? "Datos antiguos" : "Timeframes incompletos";
    quality = anyStale ? "delayed" : "insufficient";
  }

  const sparkSrc =
    tfs["15m"].candles.length >= 8 ? tfs["15m"].candles : tfs["5m"].candles;

  return {
    price,
    dayChangePct: quote.dayChangePct,
    marketTime: lastDataAt,
    dataSource: sourceName,
    venue: sourceName.split(" ")[0] ?? asset.venue,
    feedSymbol:
      provider === "binance"
        ? asset.binanceSymbol ?? asset.feedSymbol
        : provider === "kraken"
          ? asset.krakenPair ?? asset.feedSymbol
          : provider === "bitget"
            ? asset.bitgetSymbol ?? asset.feedSymbol
            : provider === "okx"
              ? asset.okxInstId ?? asset.feedSymbol
              : provider === "mexc"
                ? asset.mexcContract ?? asset.feedSymbol
                : asset.feedSymbol,
    instrumentKind: asset.instrumentKind,
    dataStatus,
    dataStatusLabel,
    lastDataAt,
    qualityNote: notes.filter(Boolean).join(" ") || `Velas nativas intradía de ${sourceName}.`,
    quality,
    sparkline: sparkSrc.slice(-48).map((c) => c.close),
    tfs,
    fallbackNote: null,
    sessionOpen,
    priceSpot: null,
    priceProxy: null,
    basis: null,
    basisPct: null,
    spotSource: null,
    proxySource: null,
    spotStatus: null,
  };
}

function packHasAnyData(pack: AssetPack): boolean {
  if (pack.price != null || pack.priceProxy != null) return true;
  return TIMEFRAMES.some((tf) => pack.tfs[tf].candles.length > 0);
}

async function attachXauSpot(pack: AssetPack): Promise<AssetPack> {
  const proxy = pack.priceProxy ?? pack.price;
  pack.priceProxy = proxy;
  pack.proxySource = pack.dataSource;
  const spot = await loadXauSpotQuote();
  pack.priceSpot = spot.priceSpot;
  pack.spotSource = spot.source;
  pack.spotStatus = spot.status;
  pack.basis =
    proxy != null && spot.priceSpot != null ? proxy - spot.priceSpot : null;
  pack.basisPct =
    pack.basis != null && spot.priceSpot != null && spot.priceSpot !== 0
      ? (pack.basis / spot.priceSpot) * 100
      : null;
  pack.price = spot.priceSpot;
  pack.qualityNote = `${spot.note} ${pack.qualityNote}`.trim();
  if (spot.priceSpot == null && pack.dataStatus !== "session_closed") {
    pack.dataStatus = spot.status === "unreliable" ? "insufficient" : "insufficient";
    pack.dataStatusLabel = "DATOS NO DISPONIBLES — precio XAUUSD spot";
    pack.quality = "insufficient";
  }
  return pack;
}

export async function loadAssetPack(asset: AssetMeta): Promise<AssetPack> {
  const now = Date.now();
  const chain = providersFor(asset);
  if (chain.length === 0) {
    const empty = emptyPack(asset, "Ninguna fuente configurada.");
    return asset.id === "XAUUSD" ? attachXauSpot(empty) : empty;
  }

  const primaryId = chain[0]!;
  const primary = await loadFromProvider(asset, primaryId, now);
  if (packHasAnyData(primary)) {
    return asset.id === "XAUUSD" ? attachXauSpot(primary) : primary;
  }

  const primaryErr =
    primary.qualityNote || `La fuente principal ${providerLabel(asset, primaryId)} no entregó datos.`;

  for (const fb of chain.slice(1)) {
    const pack = await loadFromProvider(asset, fb, now);
    if (!packHasAnyData(pack)) continue;
    pack.fallbackNote = `${primaryErr} Respaldo explícito: ${pack.dataSource}.`;
    pack.qualityNote = `${pack.fallbackNote} ${pack.qualityNote}`.trim();
    if (pack.dataStatus === "ok") {
      pack.dataStatus = "insufficient";
      pack.dataStatusLabel = "Respaldo (fuente principal falló)";
    }
    return asset.id === "XAUUSD" ? attachXauSpot(pack) : pack;
  }

  const empty = emptyPack(asset, primaryErr);
  return asset.id === "XAUUSD" ? attachXauSpot(empty) : empty;
}

export function emptyPack(asset?: AssetMeta, note = "Sin datos de mercado en esta actualización."): AssetPack {
  const blank = blankTf("DATOS NO DISPONIBLES");
  return {
    price: null,
    dayChangePct: null,
    marketTime: null,
    dataSource: asset ? `${asset.venue} ${asset.feedSymbol}` : "ninguna",
    venue: asset?.venue ?? "ninguna",
    feedSymbol: asset?.feedSymbol ?? "—",
    instrumentKind: asset?.instrumentKind ?? "proxy",
    dataStatus: "error",
    dataStatusLabel: "Error de fuente",
    lastDataAt: null,
    qualityNote: note,
    quality: "insufficient",
    sparkline: [],
    tfs: {
      "5m": { ...blank },
      "15m": { ...blank },
      "1h": { ...blank },
      "4h": { ...blank },
    },
    fallbackNote: null,
    sessionOpen: true,
    priceSpot: null,
    priceProxy: null,
    basis: null,
    basisPct: null,
    spotSource: null,
    proxySource: null,
    spotStatus: null,
  };
}
