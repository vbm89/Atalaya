import { VOL_THRESHOLDS } from "./assets";
import {
  applyBasisToSetup,
  buildSetup,
  closedCandles,
  highImpactBlock,
} from "./engine";
import { snapshotIndicators } from "./indicators";
import { candleAgeMs, isTfStale, MIN_BARS } from "./integrity";
import { detectBosChoch, extractLevels, marketStructure } from "./structure";
import type {
  AssetId,
  AssetAnalysis,
  CalendarEvent,
  Candle,
  DataStatus,
  EntryProposal,
  IndicatorSnapshot,
  InstrumentKind,
  NewsItem,
  SetupProposal,
  SetupState,
  Signal,
  SpotStatus,
  Timeframe,
  TimeframeAnalysis,
  TradeDecision,
  Trend,
  VolatilityBand,
} from "./types";

export { MIN_BARS };

const EMPTY_IND: IndicatorSnapshot = {
  ema20: null,
  ema50: null,
  ema200: null,
  rsi: null,
  macd: null,
  macdSignal: null,
  macdHist: null,
  atr: null,
  atrPct: null,
  volumeRatio: null,
  volumeAvailable: false,
};

/** Floor for |basis| / spot, in percent. Also compared with ATR% 1h. */
const BASIS_FLOOR_PCT = 0.25;

function unavailableTf(
  tf: Timeframe,
  barCount: number,
  source: string | null,
  lastBarAt: string | null,
  reason: string,
  now: number,
): TimeframeAnalysis {
  const age = candleAgeMs(lastBarAt, now);
  return {
    timeframe: tf,
    barCount,
    trend: "lateral",
    structure: "DATOS NO DISPONIBLES",
    indicators: EMPTY_IND,
    levels: { supports: [], resistances: [] },
    score: 0,
    notes: [reason],
    sufficient: false,
    source,
    lastBarAt,
    stale: lastBarAt ? isTfStale(tf, lastBarAt, now) : true,
    ageMinutes: age == null ? null : Math.round(age / 60000),
  };
}

function scoreTimeframe(
  candles: Candle[],
  tf: Timeframe,
  source: string | null,
  lastBarAt: string | null,
  now: number,
): TimeframeAnalysis {
  const age = candleAgeMs(lastBarAt, now);
  const stale = isTfStale(tf, lastBarAt, now);
  if (candles.length < MIN_BARS[tf]) {
    return unavailableTf(
      tf,
      candles.length,
      source,
      lastBarAt,
      candles.length === 0
        ? "DATOS NO DISPONIBLES"
        : `DATOS NO DISPONIBLES (${candles.length} velas, se necesitan ${MIN_BARS[tf]})`,
      now,
    );
  }
  if (stale) {
    return unavailableTf(
      tf,
      candles.length,
      source,
      lastBarAt,
      `DATOS NO DISPONIBLES — última vela hace ${age != null ? Math.round(age / 60000) : "?"} min`,
      now,
    );
  }

  const ind = snapshotIndicators(candles);
  const structure =
    tf === "4h" || tf === "1h" ? detectBosChoch(candles) : marketStructure(candles);
  const levels = extractLevels(candles, ind.atr);
  const notes: string[] = [];
  const trend: Trend =
    "bias" in structure ? structure.bias : structure.trend;
  notes.push(structure.label);

  if (ind.rsi != null) notes.push(`RSI ${ind.rsi.toFixed(1)} (informativo)`);
  if (ind.macdHist != null) {
    notes.push(`MACD histograma ${ind.macdHist >= 0 ? "positivo" : "negativo"} (informativo)`);
  }
  if (ind.volumeAvailable && ind.volumeRatio != null) {
    notes.push(`Volumen ${ind.volumeRatio.toFixed(2)}× media`);
  } else {
    notes.push("Volumen no disponible en esta serie");
  }

  return {
    timeframe: tf,
    barCount: candles.length,
    trend,
    structure: structure.label,
    indicators: ind,
    levels,
    score: 0,
    notes,
    sufficient: true,
    source,
    lastBarAt,
    stale: false,
    ageMinutes: age == null ? null : Math.round(age / 60000),
  };
}

function volatilityBand(id: AssetId, atrPct: number | null): VolatilityBand {
  if (atrPct == null) return "media";
  const t = VOL_THRESHOLDS[id];
  if (atrPct < t.low) return "baja";
  if (atrPct > t.high) return "alta";
  return "media";
}

function nearest(levels: number[], price: number): number | null {
  if (!levels.length) return null;
  let best = levels[0]!;
  let dist = Math.abs(best - price);
  for (const l of levels) {
    const d = Math.abs(l - price);
    if (d < dist) {
      best = l;
      dist = d;
    }
  }
  return best;
}

/** PROXY → SPOT: nivelSpot = nivelProxy − basis. */
export function toSpotLevel(nivelProxy: number, basis: number): number {
  return nivelProxy - basis;
}

export function translateProxyLevelsToSpot(
  levels: number[],
  basis: number | null,
): number[] {
  if (basis == null) return [];
  return levels.map((l) => toSpotLevel(l, basis));
}

/** Proximity in the SAME price space. Never mix spot vs proxy. */
export function isNearLevel(
  price: number,
  levels: number[],
  pct = 0.0015,
): boolean {
  const n = nearest(levels, price);
  return n != null && Math.abs(n - price) / price < pct;
}

/**
 * Price that execution/display must use.
 * XAU: SPOT only. Never XAUUSDT. Other assets: the single feed price.
 */
export function executionPrice(args: {
  id: AssetId;
  price: number | null;
  priceSpot?: number | null;
}): number | null {
  if (args.id === "XAUUSD") return args.priceSpot ?? null;
  return args.price;
}

function uniqueSorted(values: number[], desc: boolean): number[] {
  const rounded = values.map((v) => Math.round(v * 10000) / 10000);
  const uniq = [...new Set(rounded)];
  uniq.sort((a, b) => (desc ? b - a : a - b));
  return uniq;
}

function signalFromState(state: SetupState, direction: "buy" | "sell" | null): Signal {
  if (state === "entry" && direction === "buy") return "buy";
  if (state === "entry" && direction === "sell") return "sell";
  if (state === "map") return "map";
  if (state === "pending") return "pending";
  return "wait";
}

function confidenceFrom(state: SetupState, quality: SetupProposal["quality"] | null): number {
  if (state === "wait" || !quality) return 0;
  if (state === "entry") return quality === "alta" ? 85 : 70;
  return quality === "alta" ? 75 : 60;
}

function entryFromSetup(
  setup: SetupProposal,
  digits: number,
  confidence: number,
): EntryProposal {
  return {
    direction: setup.direction,
    entry: setup.entryLabel,
    entryLow: setup.zone.low,
    entryHigh: setup.zone.high,
    stopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2 ?? setup.takeProfit1,
    riskReward: setup.riskReward,
    confidence,
    reason: "Análisis, no orden. Tú decides.",
  };
}

export interface SeriesInput {
  candles: Candle[];
  source: string | null;
  lastBarAt: string | null;
}

export function analyzeAsset(args: {
  id: AssetId;
  label: string;
  name: string;
  sourceNote: string;
  dataSource: string;
  venue: string;
  feedSymbol: string;
  instrumentKind: InstrumentKind;
  dataStatus: DataStatus;
  dataStatusLabel: string;
  lastDataAt: string | null;
  digits: number;
  price: number | null;
  priceSpot?: number | null;
  priceProxy?: number | null;
  basis?: number | null;
  basisPct?: number | null;
  spotSource?: string | null;
  proxySource?: string | null;
  spotStatus?: SpotStatus | null;
  dayChangePct: number | null;
  marketTime: string | null;
  quality: AssetAnalysis["quality"];
  qualityNote: string;
  sparkline: number[];
  series: Partial<Record<Timeframe, SeriesInput>>;
  news: NewsItem[];
  calendar: CalendarEvent[];
  now: number;
  sessionOpen: boolean;
}): AssetAnalysis {
  const tfs: TimeframeAnalysis[] = [];
  const order: Timeframe[] = ["5m", "15m", "1h", "4h"];
  for (const tf of order) {
    const pack = args.series[tf];
    const candles = pack?.candles ?? [];
    tfs.push(
      scoreTimeframe(
        candles,
        tf,
        pack?.source ?? null,
        pack?.lastBarAt ?? null,
        args.now,
      ),
    );
  }

  const usable = tfs.filter((t) => t.sufficient);
  const availableTimeframes = usable.map((t) => t.timeframe);
  const missingTfs = tfs.filter((t) => !t.sufficient).map((t) => t.timeframe);

  const h1 = tfs.find((t) => t.timeframe === "1h");
  const h4 = tfs.find((t) => t.timeframe === "4h");
  const m15 = tfs.find((t) => t.timeframe === "15m");
  const atrPct = h1?.sufficient
    ? h1.indicators.atrPct
    : h4?.sufficient
      ? h4.indicators.atrPct
      : null;
  const vol = volatilityBand(args.id, atrPct);

  const supportsProxy = uniqueSorted(
    [
      ...(h1?.sufficient ? h1.levels.supports : []),
      ...(h4?.sufficient ? h4.levels.supports : []),
    ],
    true,
  ).slice(0, 3);
  const resistancesProxy = uniqueSorted(
    [
      ...(h1?.sufficient ? h1.levels.resistances : []),
      ...(h4?.sufficient ? h4.levels.resistances : []),
    ],
    false,
  ).slice(0, 3);

  const isXau = args.id === "XAUUSD";
  const priceSpot = isXau ? (args.priceSpot ?? null) : null;
  const priceProxy = isXau ? (args.priceProxy ?? null) : null;
  const basis = isXau ? (args.basis ?? null) : null;
  const basisPct = isXau ? (args.basisPct ?? null) : null;
  const spotStatus = isXau ? (args.spotStatus ?? null) : null;

  const tradePrice = executionPrice({
    id: args.id,
    price: args.price,
    priceSpot,
  });
  const emaPrice = isXau ? priceProxy : args.price;

  const supports = isXau
    ? translateProxyLevelsToSpot(supportsProxy, basis)
    : supportsProxy;
  const resistances = isXau
    ? translateProxyLevelsToSpot(resistancesProxy, basis)
    : resistancesProxy;

  const newsBlock = highImpactBlock(args.id, args.calendar, args.now);

  let setupState: SetupState = "wait";
  let setup: SetupProposal | null = null;
  let waitReason: string | null = null;
  let bias4hLabel = h4?.sufficient ? h4.structure : "Sin datos 4H";
  let extraWarnings: string[] = [];

  const underlyingClosed = args.id === "BTCUSD" || args.id === "XAUUSD" ? false : !args.sessionOpen;

  if (
    isXau &&
    (priceSpot == null ||
      spotStatus === "unreliable" ||
      spotStatus === "unavailable")
  ) {
    waitReason = "ESPERAR — DATOS NO DISPONIBLES — precio XAUUSD spot.";
  } else if (isXau && spotStatus !== "ok") {
    waitReason =
      "ESPERAR — precio XAUUSD spot no confirmado (cruce gold-api/OANDA incompleto).";
  } else if (isXau && (priceProxy == null || basis == null)) {
    waitReason = "ESPERAR — DATOS NO DISPONIBLES — precio PROXY XAUUSDT.";
  } else if (
    isXau &&
    basisPct != null &&
    Math.abs(basisPct) > Math.max(BASIS_FLOOR_PCT, atrPct ?? 0)
  ) {
    waitReason = `ESPERAR — basis PROXY/SPOT (${basisPct.toFixed(3)} %) supera max(0.25 %, ATR% 1h).`;
  } else if (!isXau && args.price == null) {
    waitReason = "ESPERAR — no hay precio real disponible.";
  } else if (args.dataStatus === "error") {
    waitReason = `ESPERAR — error de fuente. ${args.dataStatusLabel}`;
  } else if (!h1?.sufficient || !h4?.sufficient || !m15?.sufficient) {
    waitReason = `ESPERAR — DATOS NO DISPONIBLES en ${missingTfs.filter((t) => t !== "5m").join(", ") || "15M/1H/4H"}.`;
  } else {
    const raw15 = args.series["15m"]?.candles ?? [];
    const raw1 = args.series["1h"]?.candles ?? [];
    const raw4 = args.series["4h"]?.candles ?? [];
    const m15c = closedCandles(raw15, "15m", args.now);
    const h1c = closedCandles(raw1, "1h", args.now);
    const h4c = closedCandles(raw4, "4h", args.now);
    const enginePrice = isXau ? (priceProxy ?? 0) : (args.price ?? 0);
    const result = buildSetup({
      now: args.now,
      price: enginePrice,
      digits: args.digits,
      m15: m15c,
      h1: h1c,
      h4: h4c,
      m5: args.series["5m"]?.candles,
      highImpactNewsAt: newsBlock?.at ?? null,
      newsTitle: newsBlock?.title ?? null,
      underlyingClosed,
    });
    setupState = result.state;
    waitReason = result.waitReason;
    bias4hLabel = result.bias4hLabel;
    extraWarnings = result.warnings;
    setup =
      isXau && result.setup && basis != null
        ? applyBasisToSetup(result.setup, basis, args.digits)
        : result.setup;
    if (newsBlock && setup && setupState !== "entry") {
      setup = {
        ...setup,
        warnings: [
          ...setup.warnings,
          `Noticia de alto impacto próxima: ${newsBlock.title}. No ENTRADA nueva.`,
        ],
      };
    }
  }

  const trend: Trend =
    bias4hLabel.startsWith("BAJISTA")
      ? "bajista"
      : bias4hLabel.startsWith("ALCISTA")
        ? "alcista"
        : h4?.sufficient
          ? h4.trend
          : "lateral";

  const signal = signalFromState(setupState, setup?.direction ?? null);
  const confidence = confidenceFrom(setupState, setup?.quality ?? null);
  const rsi = h1?.sufficient ? h1.indicators.rsi : null;
  const ind1h = h1?.sufficient ? h1.indicators : null;

  const technicalSummary =
    usable.length === 0
      ? "DATOS NO DISPONIBLES — no hay lectura técnica fiable"
      : [
          bias4hLabel,
          ind1h?.ema20 != null && emaPrice != null
            ? `EMA20 ${emaPrice >= ind1h.ema20 ? "por debajo del precio (informativo)" : "por encima del precio (informativo)"}`
            : null,
          rsi != null ? `RSI ${rsi.toFixed(0)} (informativo)` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  let entry: EntryProposal | null = null;
  if (setup && setupState === "entry") {
    entry = entryFromSetup(setup, args.digits, confidence);
  }

  let wouldTrade: TradeDecision = "no";
  let wouldTradeReason = waitReason ?? "ESPERAR — no existe oportunidad definida.";
  if (setupState === "entry" && setup) {
    wouldTrade = "wait";
    wouldTradeReason =
      "Señal técnicamente válida. Análisis, no orden. Tú decides. Calidad alta ≠ más lote.";
  } else if (setupState === "pending" && setup) {
    wouldTrade = "wait";
    wouldTradeReason =
      "TRIGGER PENDIENTE — no es orden. Falta cierre 15M de fallo de aceptación o rechazo. Tú decides.";
  } else if (setupState === "map" && setup) {
    wouldTrade = "wait";
    wouldTradeReason = "MAPA vivo — no es orden. El precio puede seguir dentro de la zona.";
  }

  if (setup && extraWarnings.length) {
    setup = { ...setup, warnings: [...new Set([...setup.warnings, ...extraWarnings])] };
  }

  return {
    id: args.id,
    label: args.label,
    name: args.name,
    sourceNote: args.sourceNote,
    dataSource: args.dataSource,
    venue: args.venue,
    feedSymbol: args.feedSymbol,
    instrumentKind: args.instrumentKind,
    dataStatus: args.dataStatus,
    dataStatusLabel: args.dataStatusLabel,
    lastDataAt: args.lastDataAt,
    availableTimeframes,
    quality: args.quality,
    qualityNote: args.qualityNote,
    price: tradePrice,
    priceSpot: isXau ? priceSpot : null,
    priceProxy: isXau ? priceProxy : null,
    basis: isXau ? basis : null,
    basisPct: isXau ? basisPct : null,
    spotSource: isXau ? (args.spotSource ?? null) : null,
    proxySource: isXau ? (args.proxySource ?? null) : null,
    spotStatus: isXau ? spotStatus : null,
    dayChangePct: args.dayChangePct,
    marketTime: args.marketTime,
    sparkline: args.sparkline,
    trend,
    volatility: vol,
    atrPct,
    signal,
    setupState,
    setup,
    technicalSummary: technicalSummary || "Sin resumen técnico (datos incompletos)",
    supports,
    resistances,
    timeframes: tfs,
    news: args.news,
    entry,
    waitReason: setupState === "wait" ? (waitReason ?? "ESPERAR — no existe oportunidad definida.") : null,
    wouldTrade,
    wouldTradeReason,
    confidence,
    digits: args.digits,
    bias4hLabel,
  };
}

export function pickBest(assets: AssetAnalysis[]): {
  id: AssetId | null;
  note: string;
} {
  const rank = (x: AssetAnalysis) => {
    if (x.setupState === "entry") return 3;
    if (x.setupState === "pending") return 2;
    if (x.setupState === "map") return 1;
    return 0;
  };
  const candidates = [...assets]
    .filter((a) => rank(a) > 0 && a.dataStatus !== "error")
    .sort((a, b) => {
      const d = rank(b) - rank(a);
      if (d !== 0) return d;
      return (b.setup?.riskReward ?? 0) - (a.setup?.riskReward ?? 0);
    });
  const top = candidates[0];
  if (!top || !top.setup) {
    return {
      id: null,
      note: "NO HAY NINGUNA ENTRADA CLARA AHORA.",
    };
  }
  const dir =
    top.setup.direction === "buy" ? "LONG" : "SHORT";
  const state =
    top.setupState === "entry"
      ? "ENTRADA"
      : top.setupState === "pending"
        ? "TRIGGER PENDIENTE"
        : "MAPA";
  return {
    id: top.id,
    note: `${top.label} · ${state} · ${dir} · calidad ${top.setup.quality.toUpperCase()}`,
  };
}
