import { snapshotIndicators } from "./indicators";
import { TF_STEP_SEC } from "./integrity";
import {
  detectBosChoch,
  meanVolume,
  nearLevel,
  overlapsZone,
  swingHighs,
  swingLows,
} from "./structure";
import type {
  CalendarEvent,
  Candle,
  SetupKind,
  SetupProposal,
  SetupQuality,
  SetupState,
  Timeframe,
} from "./types";

export const RR_MIN = 1.5;
export const RR_ALTA = 2.0;
export const RR_HARD_MIN = 1.2;
export const VOL_ORIGIN = 2.0;
export const VOL_TRIGGER = 1.0;
export const VOL_DEAD = 0.3;
export const VOL_4H_DEAD = 0.25;
export const VOL_DISPLACE = 1.5;
export const SL_PAD_ATR = 0.15;
export const SL_WIDE_ATR = 1.2;
export const LATE_R = 0.3;
export const NEWS_WINDOW_MS = 60 * 60 * 1000;
export const CADUCITY_H1 = 6;
export const CADUCITY_H4 = 2;
export const CADUCITY_M15 = 8;

const MANAGEMENT =
  "Si ejecutas: SL obligatorio. Considerar 50 % en TP1 y BE del resto. Atalaya no mueve órdenes.";

export interface EngineInput {
  now: number;
  price: number;
  digits: number;
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  m5?: Candle[];
  highImpactNewsAt: number | null;
  newsTitle: string | null;
  underlyingClosed: boolean;
}

export interface EngineResult {
  state: SetupState;
  waitReason: string | null;
  setup: SetupProposal | null;
  bias4hLabel: string;
  warnings: string[];
}

interface OriginHit {
  index: number;
  zone: { low: number; high: number };
  originTf: "4h" | "1h" | "15m";
  kind: SetupKind;
}

export function closedCandles(
  candles: Candle[],
  tf: Timeframe,
  now: number,
): Candle[] {
  if (candles.length === 0) return [];
  const last = candles[candles.length - 1]!;
  const stepMs = TF_STEP_SEC[tf] * 1000;
  const barEnd = last.time * 1000 + stepMs;
  if (now + 50 < barEnd) return candles.slice(0, -1);
  return candles;
}

function third(candle: Candle, which: "lower" | "upper"): boolean {
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  const pos = (candle.close - candle.low) / range;
  return which === "lower" ? pos <= 1 / 3 : pos >= 2 / 3;
}

function isShortOrigin(candle: Candle, avgVol: number | null): boolean {
  if (avgVol == null || avgVol <= 0 || candle.volume == null) return false;
  if (candle.volume / avgVol < VOL_ORIGIN) return false;
  if (candle.close >= candle.high) return false;
  return third(candle, "lower") || candle.close < candle.open;
}

function isLongOrigin(candle: Candle, avgVol: number | null): boolean {
  if (avgVol == null || avgVol <= 0 || candle.volume == null) return false;
  if (candle.volume / avgVol < VOL_ORIGIN) return false;
  if (candle.close <= candle.low) return false;
  return third(candle, "upper") || candle.close > candle.open;
}

function isDisplacement(candle: Candle, atr: number | null, avgVol: number | null): boolean {
  if (atr == null || atr <= 0 || avgVol == null || avgVol <= 0 || candle.volume == null) {
    return false;
  }
  const body = Math.abs(candle.close - candle.open);
  return body >= atr && candle.volume / avgVol >= VOL_DISPLACE;
}

function clusterHighs(prices: number[], ref: number, atr: number | null): number {
  const tol = Math.max(atr ? atr * 0.3 : ref * 0.0015, ref * 0.0015);
  const near = prices.filter((p) => Math.abs(p - ref) <= tol);
  return near.length ? Math.max(...near) : ref;
}

function clusterLows(prices: number[], ref: number, atr: number | null): number {
  const tol = Math.max(atr ? atr * 0.3 : ref * 0.0015, ref * 0.0015);
  const near = prices.filter((p) => Math.abs(p - ref) <= tol);
  return near.length ? Math.min(...near) : ref;
}

export function failAcceptShort(
  c: Candle,
  zone: { low: number; high: number },
  inv: number,
): boolean {
  return overlapsZone(c, zone) && c.close < zone.low && c.close < inv;
}

export function failAcceptLong(
  c: Candle,
  zone: { low: number; high: number },
  inv: number,
): boolean {
  return overlapsZone(c, zone) && c.close > zone.high && c.close > inv;
}

export function rejectShort(
  c: Candle,
  zone: { low: number; high: number },
  inv: number,
): boolean {
  if (!overlapsZone(c, zone)) return false;
  const mid = (zone.low + zone.high) / 2;
  const depth = zone.high - zone.low;
  const reached = c.high >= zone.low + 0.5 * depth || c.high >= zone.high;
  return (
    c.close <= mid &&
    third(c, "lower") &&
    c.close < c.open &&
    c.close < inv &&
    reached
  );
}

export function rejectLong(
  c: Candle,
  zone: { low: number; high: number },
  inv: number,
): boolean {
  if (!overlapsZone(c, zone)) return false;
  const mid = (zone.low + zone.high) / 2;
  const depth = zone.high - zone.low;
  const reached = c.low <= zone.high - 0.5 * depth || c.low <= zone.low;
  return (
    c.close >= mid &&
    third(c, "upper") &&
    c.close > c.open &&
    c.close > inv &&
    reached
  );
}

function volRatio(candles: Candle[], index: number): number | null {
  const avg = meanVolume(candles, index, 20);
  const v = candles[index]?.volume;
  if (avg == null || avg <= 0 || v == null) return null;
  return v / avg;
}

function lastOriginShort(
  candles: Candle[],
  afterIndex: number,
  atr: number | null,
): { index: number; zone: { low: number; high: number } } | null {
  const highs = swingHighs(candles).map((s) => s.price);
  let found: { index: number; zone: { low: number; high: number } } | null = null;
  for (let i = Math.max(afterIndex, 0); i < candles.length; i++) {
    const c = candles[i]!;
    const avg = meanVolume(candles, i, 20);
    if (!isShortOrigin(c, avg)) continue;
    const bodyLow = Math.min(c.open, c.close);
    const high = clusterHighs([...highs, c.high], c.high, atr);
    if (high <= bodyLow) continue;
    found = { index: i, zone: { low: bodyLow, high } };
  }
  return found;
}

function lastOriginLong(
  candles: Candle[],
  afterIndex: number,
  atr: number | null,
): { index: number; zone: { low: number; high: number } } | null {
  const lows = swingLows(candles).map((s) => s.price);
  let found: { index: number; zone: { low: number; high: number } } | null = null;
  for (let i = Math.max(afterIndex, 0); i < candles.length; i++) {
    const c = candles[i]!;
    const avg = meanVolume(candles, i, 20);
    if (!isLongOrigin(c, avg)) continue;
    const bodyHigh = Math.max(c.open, c.close);
    const low = clusterLows([...lows, c.low], c.low, atr);
    if (bodyHigh <= low) continue;
    found = { index: i, zone: { low, high: bodyHigh } };
  }
  return found;
}

function firstIndexAtOrAfter(candles: Candle[], timeSec: number): number {
  const i = candles.findIndex((c) => c.time >= timeSec);
  return i < 0 ? candles.length : i;
}

function barsAfter(candles: Candle[], originTime: number): number {
  return candles.filter((c) => c.time > originTime).length;
}

function padSl(atr15: number | null, price: number): number {
  return Math.max(atr15 != null ? atr15 * SL_PAD_ATR : 0, price * 0.0002);
}

function zoneAnchoredOnHtfs(
  zone: { low: number; high: number },
  short: boolean,
  h4: Candle[],
  h1: Candle[],
  atr4: number | null,
  atr1: number | null,
  ref: number,
): { on4h: boolean; on1h: boolean } {
  const h4Swings = short
    ? swingHighs(h4).map((s) => s.price)
    : swingLows(h4).map((s) => s.price);
  const h1Swings = short
    ? swingHighs(h1).map((s) => s.price)
    : swingLows(h1).map((s) => s.price);
  const on4h =
    nearLevel(zone.high, h4Swings, atr4, ref) ||
    nearLevel(zone.low, h4Swings, atr4, ref);
  const on1h =
    nearLevel(zone.high, h1Swings, atr1, ref) ||
    nearLevel(zone.low, h1Swings, atr1, ref);
  return { on4h, on1h };
}

function firstTargets(
  short: boolean,
  zone: { low: number; high: number },
  st4: ReturnType<typeof detectBosChoch>,
  h4: Candle[],
  atr4: number | null,
  ref: number,
): { tp1: number | null; tp2: number | null } {
  const minGap = Math.max(atr4 ? atr4 * 0.3 : ref * 0.0015, ref * 0.0015);
  if (short) {
    const lows = swingLows(h4).map((s) => s.price);
    const below = [...lows, st4.tp1, st4.tp2, st4.majorLow, st4.bos?.level ?? null]
      .filter((p): p is number => p != null && zone.low - p >= minGap)
      .sort((a, b) => b - a);
    const uniq: number[] = [];
    for (const p of below) {
      if (!uniq.some((u) => Math.abs(u - p) < minGap * 0.25)) uniq.push(p);
    }
    return { tp1: uniq[0] ?? null, tp2: uniq[1] ?? null };
  }
  const highs = swingHighs(h4).map((s) => s.price);
  const above = [...highs, st4.tp1, st4.tp2, st4.majorHigh, st4.bos?.level ?? null]
    .filter((p): p is number => p != null && p - zone.high >= minGap)
    .sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const p of above) {
    if (!uniq.some((u) => Math.abs(u - p) < minGap * 0.25)) uniq.push(p);
  }
  return { tp1: uniq[0] ?? null, tp2: uniq[1] ?? null };
}

function pickOrigin(
  short: boolean,
  h4: Candle[],
  h1: Candle[],
  m15: Candle[],
  bosTime: number,
  bosLevel: number,
  bosIndex4: number,
  atr4: number | null,
  atr1: number | null,
  atr15: number | null,
  ref: number,
): OriginHit | null {
  const after4 = bosIndex4;
  const after1 = firstIndexAtOrAfter(h1, bosTime);
  const after15 = firstIndexAtOrAfter(m15, bosTime);

  const o15 = short
    ? lastOriginShort(m15, after15, atr15)
    : lastOriginLong(m15, after15, atr15);
  if (o15) {
    const ht = zoneAnchoredOnHtfs(o15.zone, short, h4, h1, atr4, atr1, ref);
    if (ht.on4h || ht.on1h) {
      return { ...o15, originTf: "15m", kind: "continuation" };
    }
  }

  const o1 = short
    ? lastOriginShort(h1, after1, atr1)
    : lastOriginLong(h1, after1, atr1);
  if (o1) {
    const ht = zoneAnchoredOnHtfs(o1.zone, short, h4, h1, atr4, atr1, ref);
    if (ht.on4h || ht.on1h) {
      return {
        index: firstIndexAtOrAfter(m15, h1[o1.index]!.time),
        zone: o1.zone,
        originTf: "1h",
        kind: "continuation",
      };
    }
  }

  const o4 = short
    ? lastOriginShort(h4, after4, atr4)
    : lastOriginLong(h4, after4, atr4);
  if (o4) {
    return {
      index: firstIndexAtOrAfter(m15, h4[o4.index]!.time),
      zone: o4.zone,
      originTf: "4h",
      kind: "continuation",
    };
  }

  const bosCandle = h4[bosIndex4];
  if (bosCandle) {
    const avg = meanVolume(h4, bosIndex4, 20);
    if (isDisplacement(bosCandle, atr4, avg)) {
      const w = Math.max(atr4 ? atr4 * 0.3 : bosLevel * 0.0015, bosLevel * 0.0015);
      const zone = { low: bosLevel - w, high: bosLevel + w };
      const retest = short
        ? lastOriginShort(m15, after15, atr15)
        : lastOriginLong(m15, after15, atr15);
      if (retest && overlapsZone(m15[retest.index]!, zone)) {
        return {
          index: retest.index,
          zone,
          originTf: "15m",
          kind: "break-retest",
        };
      }
    }
  }

  return null;
}

function qualityPrelim(args: {
  zoneTf4h: boolean;
  zoneTf1h: boolean;
  originVol: number | null;
  rr: number;
  dailyAgainst: boolean;
}): SetupQuality | null {
  if (args.rr < RR_MIN) return null;
  const strong =
    args.zoneTf4h &&
    args.zoneTf1h &&
    (args.originVol == null || args.originVol >= VOL_ORIGIN) &&
    args.rr >= RR_ALTA &&
    !args.dailyAgainst;
  return strong ? "alta" : "media";
}

function qualityFinal(
  prelim: SetupQuality,
  triggerVol: number | null,
  failAccept: boolean,
): SetupQuality {
  if (
    prelim === "alta" &&
    failAccept &&
    triggerVol != null &&
    triggerVol >= 1.5
  ) {
    return "alta";
  }
  return "media";
}

export function highImpactBlock(
  id: string,
  calendar: CalendarEvent[],
  now: number,
): { at: number; title: string } | null {
  const hits = calendar.filter((e) => {
    const t = new Date(e.at).getTime();
    return (
      t >= now &&
      t <= now + NEWS_WINDOW_MS &&
      e.impact === "alta" &&
      e.assets.includes(id as never)
    );
  });
  const e = hits[0];
  if (!e) return null;
  return { at: new Date(e.at).getTime(), title: e.title };
}

export function applyBasisToSetup(
  setup: SetupProposal,
  basis: number,
  digits: number,
): SetupProposal {
  const shift = (n: number) => n - basis;
  const zone = { low: shift(setup.zone.low), high: shift(setup.zone.high) };
  const entryPx = setup.direction === "sell" ? zone.low : zone.high;
  return {
    ...setup,
    zone,
    invalidation: shift(setup.invalidation),
    stopLoss: shift(setup.stopLoss),
    takeProfit1: shift(setup.takeProfit1),
    takeProfit2: setup.takeProfit2 != null ? shift(setup.takeProfit2) : null,
    supersedeLevel: setup.supersedeLevel != null ? shift(setup.supersedeLevel) : null,
    entryLabel: `${entryPx.toFixed(digits)} · zona ${zone.low.toFixed(digits)} – ${zone.high.toFixed(digits)}`,
  };
}

export function buildSetup(input: EngineInput): EngineResult {
  const warnings: string[] = [];
  const h4 = input.h4;
  const h1 = input.h1;
  const m15 = input.m15;
  if (h4.length < 8 || h1.length < 8 || m15.length < 8) {
    return {
      state: "wait",
      waitReason: "ESPERAR — DATOS NO DISPONIBLES en 15M, 1H o 4H.",
      setup: null,
      bias4hLabel: "Sin datos",
      warnings,
    };
  }

  const st4Full = detectBosChoch(h4);
  const st4Prev = h4.length > 8 ? detectBosChoch(h4.slice(0, -1)) : null;
  const lastProbe = m15[m15.length - 1];
  if (lastProbe && st4Prev?.bos && st4Prev.invalidation != null) {
    if (st4Prev.bos.dir === "sell" && lastProbe.close > st4Prev.invalidation) {
      return {
        state: "wait",
        waitReason: `ESPERAR — invalidado (cierre 15M > ${st4Prev.invalidation.toFixed(input.digits)}).`,
        setup: null,
        bias4hLabel: `BAJISTA LOCAL · ${st4Prev.label}`,
        warnings,
      };
    }
    if (st4Prev.bos.dir === "buy" && lastProbe.close < st4Prev.invalidation) {
      return {
        state: "wait",
        waitReason: `ESPERAR — invalidado (cierre 15M < ${st4Prev.invalidation.toFixed(input.digits)}).`,
        setup: null,
        bias4hLabel: `ALCISTA LOCAL · ${st4Prev.label}`,
        warnings,
      };
    }
  }

  const st4 = st4Full;
  const st1 = detectBosChoch(h1);
  const bias4hLabel = st4.bias === "bajista"
    ? `BAJISTA LOCAL · ${st4.label}`
    : st4.bias === "alcista"
      ? `ALCISTA LOCAL · ${st4.label}`
      : st4.label;

  if (st4.bias === "lateral" || !st4.bos) {
    return {
      state: "wait",
      waitReason: "ESPERAR — no hay BOS 4H por cierre.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const dir = st4.bos.dir;
  const short = dir === "sell";
  const atr15 = snapshotIndicators(m15).atr;
  const atr1h = snapshotIndicators(h1).atr;
  const atr4h = snapshotIndicators(h4).atr;
  const h4ForVol =
    h4.length >= 2 && h4[h4.length - 1]!.time - h4[h4.length - 2]!.time < TF_STEP_SEC["4h"] * 0.5
      ? h4.slice(0, -1)
      : h4;
  const vol4h = snapshotIndicators(h4ForVol).volumeRatio;

  const bosTime = h4[st4.bos.index]?.time ?? 0;
  const origin = pickOrigin(
    short,
    h4,
    h1,
    m15,
    bosTime,
    st4.bos.level,
    st4.bos.index,
    atr4h,
    atr1h,
    atr15,
    input.price,
  );

  if (!origin) {
    return {
      state: "wait",
      waitReason: "ESPERAR — BOS 4H sin zona 4H/1H de origen válida.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const kind = origin.kind;
  const zone = origin.zone;
  const originIdx = Math.min(Math.max(origin.index, 0), m15.length - 1);
  const originCandle = m15[originIdx]!;
  const originVol = volRatio(m15, originIdx);
  const ht = zoneAnchoredOnHtfs(zone, short, h4, h1, atr4h, atr1h, input.price);

  const invalidation =
    st4.invalidation ??
    st1.invalidation ??
    (short ? zone.high : zone.low);

  const lows15 = swingLows(m15);
  const highs15 = swingHighs(m15);
  const afterOriginLows = lows15.filter((s) => s.index > originIdx);
  const afterOriginHighs = highs15.filter((s) => s.index > originIdx);
  const zoneTol = Math.max(atr15 ? atr15 * 0.3 : input.price * 0.0015, input.price * 0.0015);
  const supersedeLevel = short
    ? (afterOriginLows
        .filter((s) => s.price < zone.low - zoneTol)
        .at(-1)?.price ?? null)
    : (afterOriginHighs
        .filter((s) => s.price > zone.high + zoneTol)
        .at(-1)?.price ?? null);

  const slPad = padSl(atr15, short ? zone.high : zone.low);
  let stopLoss = short ? zone.high + slPad : zone.low - slPad;

  const targets = firstTargets(short, zone, st4, h4, atr4h, input.price);
  const tp1 = targets.tp1;
  const tp2 = targets.tp2;
  if (tp1 == null) {
    return {
      state: "wait",
      waitReason: "ESPERAR — no hay TP estructural a favor.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const entryPx = short ? zone.low : zone.high;
  const risk = Math.abs(entryPx - stopLoss);
  if (risk <= 0) {
    return {
      state: "wait",
      waitReason: "ESPERAR — no hay ancla estructural de SL.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }
  const reward = Math.abs(tp1 - entryPx);
  const rr = reward / risk;
  if (rr < RR_HARD_MIN) {
    return {
      state: "wait",
      waitReason: "ESPERAR — R:R estructural por debajo de 1,2.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }
  if (rr < RR_MIN) {
    return {
      state: "wait",
      waitReason: "ESPERAR — R:R estructural por debajo de 1,5.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const slWide = atr1h != null && risk > atr1h * SL_WIDE_ATR;
  if (slWide) warnings.push("SL amplio");
  if (vol4h != null && vol4h < VOL_4H_DEAD) {
    warnings.push("Liquidez posiblemente reducida");
  }

  const prelim = qualityPrelim({
    zoneTf4h: ht.on4h,
    zoneTf1h: ht.on1h,
    originVol,
    rr,
    dailyAgainst: false,
  });
  if (!prelim) {
    return {
      state: "wait",
      waitReason: "ESPERAR — el setup no alcanza calidad MEDIA.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const originTime = originCandle.time;
  const expired =
    barsAfter(h1, originTime) >= CADUCITY_H1 ||
    barsAfter(h4, originTime) >= CADUCITY_H4 ||
    (origin.originTf === "15m" && barsAfter(m15, originTime) >= CADUCITY_M15);
  if (expired) {
    return {
      state: "wait",
      waitReason: "ESPERAR — sin setup válido actualmente.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  const afterOrigin = m15.slice(originIdx + 1);
  let armed = false;
  let retested = false;
  for (const c of afterOrigin) {
    if (short && c.close < zone.low) armed = true;
    if (!short && c.close > zone.high) armed = true;
    if (armed && overlapsZone(c, zone)) retested = true;
  }

  const last = m15[m15.length - 1];
  if (!last) {
    return {
      state: "wait",
      waitReason: "ESPERAR — DATOS NO DISPONIBLES en 15M.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  if (short && last.close > invalidation) {
    return {
      state: "wait",
      waitReason: `ESPERAR — invalidado (cierre 15M > ${invalidation.toFixed(input.digits)}).`,
      setup: null,
      bias4hLabel,
      warnings,
    };
  }
  if (!short && last.close < invalidation) {
    return {
      state: "wait",
      waitReason: `ESPERAR — invalidado (cierre 15M < ${invalidation.toFixed(input.digits)}).`,
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  if (st1.choch && st1.choch.dir !== dir && st1.choch.index >= firstIndexAtOrAfter(h1, originTime)) {
    return {
      state: "wait",
      waitReason: "ESPERAR — CHOCH 1H contrario.",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  if (
    armed &&
    !retested &&
    supersedeLevel != null &&
    ((short && last.close < supersedeLevel) || (!short && last.close > supersedeLevel))
  ) {
    return {
      state: "wait",
      waitReason: "ESPERAR — mapa supersedido (viaje sin retest).",
      setup: null,
      bias4hLabel,
      warnings,
    };
  }

  if (short && last.high > stopLoss) stopLoss = last.high + slPad;
  if (!short && last.low < stopLoss) stopLoss = last.low - slPad;

  const riskNow = Math.abs(entryPx - stopLoss);
  const rrNow = riskNow > 0 ? Math.abs(tp1 - entryPx) / riskNow : rr;

  const digits = input.digits;
  const baseSetup = (
    state: SetupState,
    quality: SetupQuality,
    phase: "preliminar" | "final",
  ): SetupProposal => ({
    state,
    kind,
    direction: dir,
    zone,
    invalidation,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    riskReward: rrNow,
    quality,
    qualityPhase: phase,
    supersedeLevel,
    missingForEntry:
      state === "pending"
        ? "Falta: cierre 15M de fallo de aceptación o rechazo."
        : state === "map"
          ? "Falta: salida 15M de la zona a favor."
          : null,
    slWide,
    warnings: [...warnings],
    managementNote: MANAGEMENT,
    entryLabel: `${entryPx.toFixed(digits)} · zona ${zone.low.toFixed(digits)} – ${zone.high.toFixed(digits)}`,
  });

  if (!armed) {
    return {
      state: "map",
      waitReason: null,
      setup: baseSetup("map", prelim, "preliminar"),
      bias4hLabel,
      warnings,
    };
  }

  const t2 = short
    ? failAcceptShort(last, zone, invalidation) || rejectShort(last, zone, invalidation)
    : failAcceptLong(last, zone, invalidation) || rejectLong(last, zone, invalidation);
  const fail = short
    ? failAcceptShort(last, zone, invalidation)
    : failAcceptLong(last, zone, invalidation);
  const triggerVol = volRatio(m15, m15.length - 1);

  const missing: string[] = [];
  if (!t2) missing.push("cierre 15M de fallo de aceptación o rechazo");
  if (st4.bias !== (short ? "bajista" : "alcista")) missing.push("sesgo 4H intacto");
  if (input.highImpactNewsAt != null) missing.push("noticia de alto impacto próxima");
  const traveled = short ? zone.low - last.close : last.close - zone.high;
  const path = Math.abs(tp1 - (short ? zone.low : zone.high));
  if (path > 0 && traveled >= LATE_R * path) {
    missing.push("señal tardía");
    warnings.push("Señal tardía");
  }
  if (triggerVol == null || triggerVol < VOL_TRIGGER || triggerVol < VOL_DEAD) {
    missing.push("volumen 15M insuficiente");
  }
  if (vol4h != null && vol4h < VOL_4H_DEAD) missing.push("volumen 4H muerto");
  if (input.underlyingClosed) missing.push("mercado del subyacente cerrado");

  if (t2 && missing.length === 0) {
    const qf = qualityFinal(prelim, triggerVol, fail);
    return {
      state: "entry",
      waitReason: null,
      setup: {
        ...baseSetup("entry", qf, "final"),
        missingForEntry: null,
      },
      bias4hLabel,
      warnings,
    };
  }

  const pending = baseSetup("pending", prelim, "preliminar");
  pending.missingForEntry = `Falta: ${missing.join("; ") || "cierre 15M de fallo de aceptación o rechazo"}.`;
  return {
    state: "pending",
    waitReason: null,
    setup: pending,
    bias4hLabel,
    warnings,
  };
}
