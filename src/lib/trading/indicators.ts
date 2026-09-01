import type { Candle, IndicatorSnapshot } from "./types";

function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out.push(sum / period);
    else out.push(Number.NaN);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}

export function rsiWilder(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(Number.NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macdCalc(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macd = closes.map((_, i) =>
    Number.isFinite(emaFast[i]) && Number.isFinite(emaSlow[i])
      ? emaFast[i]! - emaSlow[i]!
      : Number.NaN,
  );
  const finiteStart = macd.findIndex((v) => Number.isFinite(v));
  const signalLine = new Array(closes.length).fill(Number.NaN) as number[];
  if (finiteStart >= 0) {
    const slice = macd.slice(finiteStart).map((v) => (Number.isFinite(v) ? v : 0));
    const sig = ema(slice, signal);
    for (let i = 0; i < sig.length; i++) signalLine[finiteStart + i] = sig[i]!;
  }
  const hist = macd.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signalLine[i])
      ? v - signalLine[i]!
      : Number.NaN,
  );
  return { macd, signal: signalLine, hist };
}

export function atrWilder(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(Number.NaN);
  if (candles.length <= period) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0]!.high - candles[0]!.low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
  }
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i]!;
  out[period] = seed / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}

export function finiteLast(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function snapshotIndicators(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const volumeAvailable = volumes.some((v) => v != null && v > 0);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi = rsiWilder(closes, 14);
  const macd = macdCalc(closes);
  const atr = atrWilder(candles, 14);
  const lastClose = last(closes) ?? null;
  const lastAtr = finiteLast(atr);
  const volSma = volumeAvailable
    ? sma(
        volumes.map((v) => v ?? 0),
        20,
      )
    : [];
  const lastVol = last(volumes);
  const lastVolSma = finiteLast(volSma);
  const volumeRatio =
    volumeAvailable && lastVol != null && lastVolSma && lastVolSma > 0
      ? lastVol / lastVolSma
      : null;

  return {
    ema20: finiteLast(ema20),
    ema50: finiteLast(ema50),
    ema200: finiteLast(ema200),
    rsi: finiteLast(rsi),
    macd: finiteLast(macd.macd),
    macdSignal: finiteLast(macd.signal),
    macdHist: finiteLast(macd.hist),
    atr: lastAtr,
    atrPct:
      lastAtr != null && lastClose && lastClose > 0
        ? (lastAtr / lastClose) * 100
        : null,
    volumeRatio,
    volumeAvailable,
  };
}

export function resample(
  candles: Candle[],
  bucketMs: number,
): Candle[] {
  if (candles.length === 0) return [];
  const grouped = new Map<number, Candle[]>();
  for (const c of candles) {
    const key = Math.floor((c.time * 1000) / bucketMs) * bucketMs;
    const list = grouped.get(key);
    if (list) list.push(c);
    else grouped.set(key, [c]);
  }
  const keys = [...grouped.keys()].sort((a, b) => a - b);
  const out: Candle[] = [];
  for (const key of keys) {
    const bars = grouped.get(key)!;
    const first = bars[0]!;
    const lastBar = bars[bars.length - 1]!;
    let high = first.high;
    let low = first.low;
    let volume = 0;
    let volKnown = false;
    for (const b of bars) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      if (b.volume != null) {
        volume += b.volume;
        volKnown = true;
      }
    }
    out.push({
      time: Math.floor(key / 1000),
      open: first.open,
      high,
      low,
      close: lastBar.close,
      volume: volKnown ? volume : null,
    });
  }
  return out;
}
