import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resample, snapshotIndicators } from "./indicators.ts";
import { analyzeAsset } from "./signals.ts";
import { buildSetup, failAcceptShort, rejectShort } from "./engine.ts";
import { calculateRisk } from "./risk.ts";
import { detectBosChoch, emaTrend } from "./structure.ts";
import type { CalendarEvent, Candle, NewsItem } from "./types.ts";
import { getAsset } from "./assets.ts";
import { isCmeSessionOpen } from "./integrity.ts";

const T0 = 1_710_000_000;
const S15 = 900;

function c(
  time: number,
  o: number,
  h: number,
  l: number,
  cl: number,
  v = 100,
): Candle {
  return {
    time,
    open: o,
    high: Math.max(o, h, cl),
    low: Math.min(o, l, cl),
    close: cl,
    volume: v,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 768 × 15m → 192 × 1h → 48 × 4h. BTC pending SHORT at 77.552. */
function btcMaster(opts?: {
  lastClose?: number;
  lastHigh?: number;
  lastLow?: number;
  lastOpen?: number;
  lastVol?: number;
  extra?: Candle[];
}): Candle[] {
  const n = 767;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const time = T0 + i * S15;
    const i4 = Math.floor(i / 16);
    const off = i % 16;
    let px = 76.55;
    if (i4 < 5) px = lerp(76.45, 76.8, i4 / 5);
    else if (i4 < 10) px = lerp(76.8, 77.4, (i4 - 5) / 5);
    else if (i4 < 14) px = lerp(77.2, 77.0, (i4 - 10) / 4);
    else if (i4 < 18) px = lerp(77.05, 76.95, (i4 - 14) / 4);
    else if (i4 < 45) px = lerp(76.9, 77.45, (i4 - 18) / 27);
    else px = 77.55;

    let o = px;
    let cl = px + (off % 3 === 0 ? 0.02 : -0.01);
    let h = Math.max(o, cl) + 0.04;
    let l = Math.min(o, cl) - 0.04;
    let v = 100;

    if (i4 === 5 && off === 8) {
      l = 76.67;
      cl = 76.72;
      o = 76.78;
      h = 76.82;
    }
    if (i4 === 10 && off === 8) {
      h = 77.964;
      cl = 77.7;
      o = 77.55;
      l = 77.5;
    }
    if (i4 === 14 && off === 8) {
      l = 76.888;
      cl = 76.92;
      o = 77.0;
      h = 77.05;
    }
    if (i4 === 18 && off === 15) {
      cl = 76.85;
      o = 76.95;
      h = 76.98;
      l = 76.82;
    }
    if (i4 === 45 && off === 8) {
      h = 77.74;
      cl = 77.6;
      o = 77.5;
      l = 77.48;
    }
    if (i === 762) {
      o = 77.71;
      h = 77.72;
      l = 77.64;
      cl = 77.65;
      v = 320;
    }
    if (i === 763) {
      o = 77.64;
      h = 77.64;
      l = 77.382;
      cl = 77.488;
      v = 110;
    }
    if (i === 764) {
      o = 77.49;
      h = 77.52;
      l = 77.45;
      cl = 77.5;
      v = 100;
    }
    if (i === 765) {
      o = 77.42;
      h = 77.5;
      l = 77.41;
      cl = 77.48;
      v = 100;
    }
    if (i === 766) {
      o = 77.48;
      h = 77.52;
      l = 77.44;
      cl = 77.5;
      v = 100;
    }
    if (i === 766) {
      o = opts?.lastOpen ?? 77.5;
      h = opts?.lastHigh ?? 77.58;
      l = opts?.lastLow ?? 77.53;
      cl = opts?.lastClose ?? 77.552;
      v = opts?.lastVol ?? 100;
    }
    out.push(c(time, o, h, l, cl, v));
  }
  if (opts?.extra) out.push(...opts.extra);
  return out;
}

function pack(master: Candle[]) {
  const m15 = master;
  const h1 = resample(master, 3_600_000);
  const h4 = resample(master, 14_400_000);
  return { m15, h1, h4 };
}

function nowOf(m15: Candle[]): number {
  const last = m15[m15.length - 1]!;
  return last.time * 1000 + 16 * 60 * 1000;
}

function engineOf(master: Candle[], extra?: Partial<Parameters<typeof buildSetup>[0]>) {
  const { m15, h1, h4 } = pack(master);
  return buildSetup({
    now: nowOf(m15),
    price: m15[m15.length - 1]!.close,
    digits: 3,
    m15,
    h1,
    h4,
    highImpactNewsAt: null,
    newsTitle: null,
    underlyingClosed: false,
    ...extra,
  });
}

function iso(cndl: Candle): string {
  return new Date(cndl.time * 1000).toISOString();
}

function analyzeBtc(master: Candle[], extra?: Partial<Parameters<typeof analyzeAsset>[0]>) {
  const { m15, h1, h4 } = pack(master);
  const now = nowOf(m15);
  const last = m15[m15.length - 1]!;
  return analyzeAsset({
    id: "BTCUSD",
    label: "BTCUSD",
    name: "Bitcoin",
    sourceNote: "test",
    dataSource: "Binance BTCUSDT",
    venue: "Binance",
    feedSymbol: "BTCUSDT",
    instrumentKind: "proxy",
    dataStatus: "ok",
    dataStatusLabel: "Datos recientes",
    lastDataAt: iso(last),
    digits: 3,
    price: last.close,
    dayChangePct: -0.2,
    marketTime: iso(last),
    quality: "live",
    qualityNote: "test",
    sparkline: m15.slice(-20).map((x) => x.close),
    series: {
      "5m": { candles: [], source: null, lastBarAt: null },
      "15m": { candles: m15, source: "Binance", lastBarAt: iso(last) },
      "1h": { candles: h1, source: "Binance", lastBarAt: iso(h1[h1.length - 1]!) },
      "4h": { candles: h4, source: "Binance", lastBarAt: iso(h4[h4.length - 1]!) },
    },
    news: [],
    calendar: [],
    now,
    sessionOpen: true,
    ...extra,
  });
}

describe("V1 engine BTC 77.552", () => {
  it("1-4 pending SHORT, not VENTA, not wait from 1h≠4h, EMA does not flip 4h", () => {
    const master = btcMaster();
    const { m15, h4 } = pack(master);
    const st = detectBosChoch(h4);
    const ind = snapshotIndicators(h4);
    const ema = emaTrend(h4[h4.length - 1]!.close, ind.ema20, ind.ema50, ind.ema200);

    assert.equal(st.bias, "bajista");
    assert.ok(st.bos);
    assert.equal(st.bos!.dir, "sell");
    assert.ok(Math.abs(st.bos!.level - 76.888) < 0.02, `tp/bos ${st.bos!.level}`);
    assert.ok(st.invalidation != null && st.invalidation >= 77.9, `inv ${st.invalidation}`);
    assert.ok(st.tp2 == null || st.tp2 < 76.888);

    const r = engineOf(master);
    assert.equal(r.state, "pending", r.waitReason ?? JSON.stringify(r.setup));
    assert.equal(r.setup?.direction, "sell");
    assert.ok(r.setup);
    assert.ok(Math.abs(r.setup!.zone.low - 77.65) < 0.04, `zone.low ${r.setup!.zone.low}`);
    assert.ok(Math.abs(r.setup!.zone.high - 77.72) < 0.04, `zone.high ${r.setup!.zone.high}`);
    assert.notEqual(r.setup!.quality, undefined);
    assert.ok(r.setup!.quality === "alta" || r.setup!.quality === "media");
    assert.equal(r.setup!.qualityPhase, "preliminar");
    assert.match(r.bias4hLabel, /BAJISTA/);

    const a = analyzeBtc(master);
    assert.equal(a.signal, "pending");
    assert.equal(a.setupState, "pending");
    assert.equal(a.entry, null);
    assert.notEqual(a.signal, "sell");
    assert.notEqual(a.setupState, "wait");
    assert.equal(a.trend, "bajista");

    if (ind.ema20 != null && ind.ema50 != null && ind.ema200 != null) {
      assert.ok(
        ema.bias > 0 || ind.ema20 > ind.ema50,
        "fixture keeps residual bullish EMA when possible",
      );
    }
    assert.equal(st.bias, "bajista");
    assert.ok(!r.bias4hLabel.includes("ALCISTA"));
    assert.ok(m15[m15.length - 1]!.close > 77.5);
  });

  it("5 close 15M > 77.964 → ESPERAR invalidado", () => {
    const r = engineOf(btcMaster({ lastClose: 77.98, lastHigh: 78.0, lastLow: 77.7, lastOpen: 77.6 }));
    assert.equal(r.state, "wait");
    assert.match(r.waitReason ?? "", /invalidado/i);
  });

  it("6 close 15M < 77.382 without retest → ESPERAR supersedido", () => {
    const r = engineOf(btcMaster({ lastClose: 77.3, lastHigh: 77.35, lastLow: 77.28, lastOpen: 77.4 }));
    assert.equal(r.state, "wait");
    assert.match(r.waitReason ?? "", /supersedido/i);
  });

  it("7-8 retest + valid 15M close → ENTRADA, no extra bar wait", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 180);
    const r = engineOf([...master, extra]);
    assert.equal(r.state, "entry", r.waitReason ?? r.setup?.missingForEntry ?? "");
    assert.equal(r.setup?.direction, "sell");
    assert.equal(r.setup?.qualityPhase, "final");
    assert.ok(r.setup!.stopLoss > r.setup!.zone.high);
    assert.ok(Math.abs(r.setup!.takeProfit1 - 76.888) < 0.05);
    const a = analyzeBtc([...master, extra]);
    assert.equal(a.signal, "sell");
    assert.equal(a.setupState, "entry");
    assert.ok(a.entry);
    assert.ok(a.wouldTrade !== "yes");
  });

  it("9 5M alone cannot create ENTRADA", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const m5 = [
      c(last.time, 77.7, 77.72, 77.64, 77.65, 300),
      c(last.time + 300, 77.66, 77.7, 77.62, 77.63, 200),
    ];
    const r = engineOf(master, { m5 });
    assert.equal(r.state, "pending");
  });

  it("10 wick only → not ENTRADA", () => {
    const r = engineOf(
      btcMaster({
        lastClose: 77.66,
        lastHigh: 77.71,
        lastLow: 77.5,
        lastOpen: 77.67,
        lastVol: 150,
      }),
    );
    assert.notEqual(r.state, "entry");
    const last = btcMaster({
      lastClose: 77.66,
      lastHigh: 77.71,
      lastLow: 77.5,
      lastOpen: 77.67,
    }).at(-1)!;
    assert.equal(failAcceptShort(last, { low: 77.65, high: 77.72 }, 77.964), false);
    assert.equal(rejectShort(last, { low: 77.65, high: 77.72 }, 77.964), false);
  });

  it("11 trigger volume below average → not ENTRADA", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 10);
    const r = engineOf([...master, extra]);
    assert.notEqual(r.state, "entry");
    assert.equal(r.state, "pending");
  });

  it("12 dead 4H volume can keep PENDIENTE but not ENTRADA", () => {
    const master = btcMaster();
    for (let i = master.length - 16; i < master.length; i++) {
      master[i] = { ...master[i]!, volume: 1 };
    }
    const pending = engineOf(master);
    assert.ok(pending.state === "pending" || pending.state === "map" || pending.state === "wait");
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 180);
    const entryAttempt = engineOf([...master, extra]);
    assert.notEqual(entryAttempt.state, "entry");
  });
});

describe("V1 risk and contract", () => {
  it("13 min lot above recommended keeps ENTRADA visible with red risk", () => {
    const calc = calculateRisk({
      capital: 200,
      spec: { tickSize: 1, tickValue: 10, minLot: 0.01, lotStep: 0.01 },
      slDistance: 80,
    });
    assert.equal(calc.calculable, true);
    assert.ok(calc.minLotExceeds);
    assert.ok(calc.theoreticalLot != null && calc.theoreticalLot < 0.01);
    assert.equal(calc.usedLot, 0.01);
    assert.ok(calc.realEur != null && Math.abs(calc.realEur - 8) < 0.05);
    assert.ok(calc.realPct != null && Math.abs(calc.realPct - 4) < 0.05);
    assert.equal(calc.band, "muy_alto");
    assert.match(calc.reason ?? "", /lote mínimo/i);
  });

  it("14 incomplete contract → not calculable", () => {
    const calc = calculateRisk({ capital: 200, spec: null, slDistance: 80 });
    assert.equal(calc.calculable, false);
    assert.match(calc.reason ?? "", /CONFIGURA EL CONTRATO/);
  });

  it("never rounds lot up", () => {
    const calc = calculateRisk({
      capital: 200,
      spec: { tickSize: 1, tickValue: 1, minLot: 0.01, lotStep: 0.01 },
      slDistance: 10,
    });
    assert.ok(calc.theoreticalLot != null);
    assert.ok(calc.usedLot != null && calc.usedLot <= (calc.theoreticalLot < 0.01 ? 0.01 : calc.theoreticalLot) + 1e-9);
  });
});

describe("V1 gates XAU / US100 / news / old engine", () => {
  it("15 XAU SPOT works even if CME gold futures are closed", () => {
    const saturday = Date.UTC(2026, 7, 29, 12, 0, 0);
    assert.equal(isCmeSessionOpen(saturday), false);
    assert.equal(getAsset("XAUUSD").session, "spot");
    const master = btcMaster();
    const { m15, h1, h4 } = pack(master);
    const last = m15[m15.length - 1]!;
    const a = analyzeAsset({
      id: "XAUUSD",
      label: "XAUUSD",
      name: "Oro",
      sourceNote: "test",
      dataSource: "Bitget XAUUSDT",
      venue: "Bitget",
      feedSymbol: "XAUUSDT",
      instrumentKind: "proxy",
      dataStatus: "ok",
      dataStatusLabel: "ok",
      lastDataAt: iso(last),
      digits: 2,
      price: 2400,
      priceSpot: 2400,
      priceProxy: last.close,
      basis: last.close - 2400,
      basisPct: ((last.close - 2400) / 2400) * 100,
      spotSource: "gold-api",
      proxySource: "Bitget",
      spotStatus: "ok",
      dayChangePct: 0,
      marketTime: iso(last),
      quality: "live",
      qualityNote: "test",
      sparkline: [],
      series: {
        "15m": { candles: m15, source: "Bitget", lastBarAt: iso(last) },
        "1h": { candles: h1, source: "Bitget", lastBarAt: iso(h1.at(-1)!) },
        "4h": { candles: h4, source: "Bitget", lastBarAt: iso(h4.at(-1)!) },
      },
      news: [],
      calendar: [],
      now: nowOf(m15),
      sessionOpen: true,
    });
    assert.notEqual(a.waitReason, "ESPERAR — el mercado del subyacente está cerrado. El precio es de un PROXY 24/7; no se genera COMPRA ni VENTA.");
    assert.ok(
      a.setupState === "pending" || a.setupState === "map" || a.setupState === "wait" || a.setupState === "entry",
    );
  });

  it("16 XAU SPOT unreliable → ESPERAR datos", () => {
    const master = btcMaster();
    const a = analyzeBtc(master, {
      id: "XAUUSD",
      label: "XAUUSD",
      name: "Oro",
      priceSpot: null,
      priceProxy: 2405,
      basis: null,
      spotStatus: "unavailable",
    });
    assert.equal(a.setupState, "wait");
    assert.match(a.waitReason ?? "", /precio XAUUSD spot/i);
    assert.equal(a.setup, null);
  });

  it("17 US100/WTI underlying closed → no ENTRADA", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 180);
    const a = analyzeBtc([...master, extra], {
      id: "US100",
      label: "US100",
      name: "Nasdaq 100",
      sessionOpen: false,
    });
    assert.notEqual(a.setupState, "entry");
    assert.notEqual(a.signal, "buy");
    assert.notEqual(a.signal, "sell");
  });

  it("18 no LONG+SHORT at once", () => {
    const a = analyzeBtc(btcMaster());
    if (a.setup) {
      assert.ok(a.setup.direction === "buy" || a.setup.direction === "sell");
    }
    assert.ok(a.signal !== "buy" || a.setup?.direction === "buy");
    assert.ok(a.signal !== "sell" || a.setup?.direction === "sell");
  });

  it("22 news does not flip direction", () => {
    const news: NewsItem[] = [
      {
        id: "n1",
        title: "Bitcoin ETF inflows smash records",
        source: "test",
        url: "https://example.com",
        publishedAt: new Date().toISOString(),
        assetId: "BTCUSD",
        summary: "",
        impact: "positivo",
        importance: "alta",
        classifiedBy: "keywords",
      },
    ];
    const a = analyzeBtc(btcMaster(), { news });
    assert.equal(a.setup?.direction ?? "sell", "sell");
    assert.notEqual(a.signal, "buy");
  });

  it("22b high-impact calendar blocks ENTRADA only", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 180);
    const now = nowOf([...master, extra]);
    const calendar: CalendarEvent[] = [
      {
        id: "cal1",
        title: "FOMC",
        country: "US",
        at: new Date(now + 30 * 60 * 1000).toISOString(),
        impact: "alta",
        forecast: null,
        previous: null,
        assets: ["BTCUSD"],
      },
    ];
    const a = analyzeBtc([...master, extra], { calendar, now });
    assert.notEqual(a.setupState, "entry");
    assert.ok(a.setupState === "pending" || a.setupState === "map");
  });

  it("23-27 no score key, no ATR SL/TP multiples, no SL-less entry, no BE claim", () => {
    const master = btcMaster();
    const last = master[master.length - 1]!;
    const extra = c(last.time + S15, 77.66, 77.7, 77.62, 77.63, 180);
    const a = analyzeBtc([...master, extra]);
    assert.ok(a.timeframes.every((t) => t.score === 0 || !t.sufficient));
    if (a.setupState === "entry" && a.setup && a.entry) {
      const atr = a.timeframes.find((t) => t.timeframe === "1h")?.indicators.atr;
      if (atr) {
        const slDist = Math.abs(a.setup.stopLoss - a.setup.zone.low);
        assert.ok(Math.abs(slDist - atr * 1.5) > atr * 0.2 || slDist < atr);
        assert.notEqual(a.setup.riskReward, 1.6);
      }
      assert.ok(a.setup.stopLoss > 0);
      assert.match(a.setup.managementNote, /Atalaya no mueve órdenes/);
      assert.doesNotMatch(a.setup.managementNote, /ha ejecutado|ya movió|BE hecho/i);
    }
  });
});

describe("V1 source session", () => {
  it("XAU session is spot, BTC crypto24, US100/WTI cme", () => {
    assert.equal(getAsset("XAUUSD").session, "spot");
    assert.equal(getAsset("BTCUSD").session, "crypto24");
    assert.equal(getAsset("US100").session, "cme");
    assert.equal(getAsset("WTI").session, "cme");
  });
});
