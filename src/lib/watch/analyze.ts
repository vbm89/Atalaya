import { ASSETS } from "@/lib/trading/assets";
import { analyzeAsset } from "@/lib/trading/signals";
import type { AssetAnalysis, AssetId, CalendarEvent, Candle, NewsItem, Timeframe } from "@/lib/trading/types";
import { fetchCalendar } from "@/lib/market/calendar";
import { emptyPack, loadAssetPack, TIMEFRAMES } from "@/lib/market/feed";
import { foldInputFromAnalysis } from "./freeze";
import type { WatchLoad } from "./tick";

/**
 * Same V1 path as the dashboard, without news/LLM. Calendar is included
 * because high-impact events can block ENTRADA. Chart ticks are not used.
 */
export async function loadWatchMarket(nowMs: number): Promise<WatchLoad> {
  const errors: string[] = [];

  const calendarP = fetchCalendar().catch((e): { events: CalendarEvent[]; note: string } => {
    errors.push(`Calendario: ${e instanceof Error ? e.message : "error"}`);
    return { events: [], note: "Error al leer calendario." };
  });

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

  const calendar = await calendarP;
  const emptyNews: NewsItem[] = [];

  const analyzed: AssetAnalysis[] = ASSETS.map((meta, i) => {
    const pack = packs[i] ?? emptyPack(meta);
    if (pack.quality === "insufficient") errors.push(`${meta.id}: datos insuficientes`);
    if (pack.fallbackNote) errors.push(`${meta.id}: ${pack.fallbackNote}`);
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
      { candles: (typeof pack.tfs)["5m"]["candles"]; source: string | null; lastBarAt: string | null }
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
      news: emptyNews,
      calendar: calendar.events,
      now: nowMs,
      sessionOpen: pack.sessionOpen,
    });
  });

  const m15ByAsset: Partial<Record<AssetId, Candle[]>> = {};
  const h1ByAsset: Partial<Record<AssetId, Candle[]>> = {};
  const h4ByAsset: Partial<Record<AssetId, Candle[]>> = {};
  const sourceByAsset: Partial<Record<AssetId, string | null>> = {};
  const instrumentByAsset: Partial<Record<AssetId, string | null>> = {};
  for (let i = 0; i < ASSETS.length; i += 1) {
    const id = ASSETS[i]!.id;
    const pack = packs[i];
    m15ByAsset[id] = pack?.tfs["15m"].candles;
    h1ByAsset[id] = pack?.tfs["1h"].candles;
    h4ByAsset[id] = pack?.tfs["4h"].candles;
    sourceByAsset[id] = pack?.tfs["15m"].source ?? pack?.dataSource ?? null;
    instrumentByAsset[id] = pack?.feedSymbol ?? null;
  }

  return {
    assets: analyzed.map((a) => foldInputFromAnalysis(a, nowMs)),
    m15ByAsset,
    h1ByAsset,
    h4ByAsset,
    calendar: calendar.events,
    sourceByAsset,
    instrumentByAsset,
    errors,
  };
}
