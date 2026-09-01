import { ASSETS } from "@/lib/trading/assets";
import { analyzeAsset, pickBest } from "@/lib/trading/signals";
import type { AnalysisSnapshot, NewsItem, Timeframe } from "@/lib/trading/types";
import { fetchCalendar } from "./calendar";
import { enrichWithModel } from "./explain";
import { emptyPack, loadAssetPack, TIMEFRAMES } from "./feed";
import { fetchAssetNews } from "./news";

const DISCLAIMER =
  "Herramienta de análisis. No ejecuta operaciones ni es asesoramiento financiero. XAUUSD: precio SPOT (gold-api cruzado con OANDA); velas 5m/15m/1h/4h PROXY Bitget XAUUSDT. US100 y WTI proceden de PROXY. BTCUSD usa BTCUSDT (PROXY). El comentario es estimación técnica.";

let cache: { at: number; data: AnalysisSnapshot } | null = null;
const CACHE_MS = 45_000;

export async function runMarketAnalysis(force = false): Promise<AnalysisSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const errors: string[] = [];
  const now = Date.now();

  const calendarP = fetchCalendar();
  const newsP = Promise.all(
    ASSETS.map(async (a) => {
      try {
        return await fetchAssetNews(a);
      } catch (e) {
        errors.push(`Noticias ${a.id}: ${e instanceof Error ? e.message : "error"}`);
        return { items: [] as NewsItem[], note: "Error al leer noticias." };
      }
    }),
  );

  const packs = await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        return await loadAssetPack(asset);
      } catch (e) {
        errors.push(`${asset.id}: ${e instanceof Error ? e.message : "error"}`);
        return emptyPack(asset, e instanceof Error ? e.message : "error");
      }
    }),
  );

  const [calendar, newsAll] = await Promise.all([calendarP, newsP]);

  const usedSources = new Set<string>();

  const assets = ASSETS.map((meta, i) => {
    const pack = packs[i] ?? emptyPack(meta);
    if (pack.quality === "insufficient") errors.push(`${meta.id}: datos insuficientes`);
    if (pack.fallbackNote) errors.push(`${meta.id}: ${pack.fallbackNote}`);
    if (pack.dataSource && pack.dataSource !== "ninguna") usedSources.add(pack.dataSource);
    if (pack.spotSource) usedSources.add(pack.spotSource);
    const series = Object.fromEntries(
      TIMEFRAMES.map((tf) => [
        tf,
        {
          candles: pack.tfs[tf].candles,
          source: pack.tfs[tf].source,
          lastBarAt: pack.tfs[tf].lastBarAt,
        },
      ]),
    ) as Record<
      Timeframe,
      { candles: typeof pack.tfs["5m"]["candles"]; source: string | null; lastBarAt: string | null }
    >;
    return analyzeAsset({
      id: meta.id,
      label: meta.label,
      name: meta.name,
      sourceNote: meta.sourceNote,
      dataSource: pack.dataSource,
      venue: pack.venue,
      feedSymbol: pack.feedSymbol,
      instrumentKind: pack.instrumentKind,
      dataStatus: pack.dataStatus,
      dataStatusLabel: pack.dataStatusLabel,
      lastDataAt: pack.lastDataAt,
      digits: meta.digits,
      price: pack.price,
      priceSpot: pack.priceSpot,
      priceProxy: pack.priceProxy,
      basis: pack.basis,
      basisPct: pack.basisPct,
      spotSource: pack.spotSource,
      proxySource: pack.proxySource,
      spotStatus: pack.spotStatus,
      dayChangePct: pack.dayChangePct,
      marketTime: pack.marketTime,
      quality: pack.quality,
      qualityNote: pack.qualityNote,
      sparkline: pack.sparkline,
      series,
      news: newsAll[i]?.items ?? [],
      calendar: calendar.events,
      now,
      sessionOpen: pack.sessionOpen,
    });
  });

  const best = pickBest(assets);
  let snapshot: AnalysisSnapshot = {
    generatedAt: new Date().toISOString(),
    source: [...usedSources].join(" · ") || "sin fuentes",
    disclaimer: DISCLAIMER,
    bestOpportunityId: best.id,
    bestOpportunityNote: best.note,
    assets,
    calendar: calendar.events,
    calendarNote: calendar.note,
    errors,
  };

  snapshot = await enrichWithModel(snapshot);
  cache = { at: Date.now(), data: snapshot };
  return snapshot;
}
