/**
 * Series deterministas para tests, replay y demo.
 * Cada escenario planta un mecanismo conocido. No son evidencia de edge.
 */
import { STEP_SEC } from "./constants.ts";
import type { AssetId, Direction, EntryTf, ShadowBar } from "./types.ts";

const START = 1_700_000_000;

function candle(
  assetId: AssetId,
  tf: EntryTf,
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
): ShadowBar {
  const hi = Math.max(o, h, l, c);
  const lo = Math.min(o, h, l, c);
  return { assetId, tf, t, o, h: hi, l: lo, c, v: 100, source: "synthetic" };
}

function quietBlock(
  n: number,
  mid: number,
  width: number,
  assetId: AssetId,
  tf: EntryTf,
  fromT: number,
): ShadowBar[] {
  const step = STEP_SEC[tf];
  const out: ShadowBar[] = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 5) * (width * 0.25);
    const o = mid + drift;
    const c = mid + Math.cos(i / 7) * (width * 0.2);
    const h = Math.max(o, c) + width * 0.35;
    const l = Math.min(o, c) - width * 0.35;
    out.push(candle(assetId, tf, fromT + i * step, o, h, l, c));
  }
  return out;
}

function append(
  base: ShadowBar[],
  rows: Array<[number, number, number, number]>,
): ShadowBar[] {
  const last = base[base.length - 1]!;
  const step = STEP_SEC[last.tf];
  const extra = rows.map((row, k) =>
    candle(last.assetId, last.tf, last.t + (k + 1) * step, row[0], row[1], row[2], row[3]),
  );
  return [...base, ...extra];
}

export interface NamedFixture {
  id: string;
  label: string;
  expect: Direction;
  family: string | null;
  bars: ShadowBar[];
  decisionIndex: number;
}

function xau(n = 45) {
  return quietBlock(n, 2000, 8, "XAUUSD", "15m", START);
}

/** Chop sin evento accionable. */
export function fixtureChop(): NamedFixture {
  const bars = xau(60);
  return {
    id: "chop",
    label: "Chop — sin evento",
    expect: "NO_ENTRY",
    family: null,
    bars,
    decisionIndex: bars.length - 1,
  };
}

/** A LONG: extremo bajista, sin extensión, reclaim. */
export function fixtureFailExtendLong(): NamedFixture {
  let bars = xau(45);
  bars = append(bars, [
    [2000, 2002, 1988, 1992],
    [1992, 1996, 1989, 1994],
    [1994, 1997, 1990, 1995],
    [1995, 2010, 1994, 2006],
  ]);
  return {
    id: "a-long",
    label: "A · Extremo → fail-extend · LONG",
    expect: "LONG",
    family: "A_FAIL_EXTEND",
    bars,
    decisionIndex: bars.length - 1,
  };
}

/** A SHORT simétrico. */
export function fixtureFailExtendShort(): NamedFixture {
  let bars = xau(45);
  bars = append(bars, [
    [2000, 2012, 1998, 2008],
    [2008, 2011, 2004, 2006],
    [2006, 2010, 2003, 2005],
    [2005, 2006, 1990, 1992],
  ]);
  return {
    id: "a-short",
    label: "A · Extremo → fail-extend · SHORT",
    expect: "SHORT",
    family: "A_FAIL_EXTEND",
    bars,
    decisionIndex: bars.length - 1,
  };
}

/**
 * B LONG: swing low confirmado, sweep, reclaim, displacement.
 * Se construye con un valle claro y un cuerpo final ≥ ATR.
 */
export function fixtureSweepLong(): NamedFixture {
  let bars = xau(40);
  bars = append(bars, [
    [2000, 2004, 1996, 1998],
    [1998, 2000, 1994, 1996],
    [1996, 1998, 1986, 1990],
    [1990, 1994, 1988, 1992],
    [1992, 1998, 1990, 1996],
    [1996, 2000, 1984, 1997],
    [1997, 2004, 1995, 2002],
    [2002, 2028, 2000, 2024],
  ]);
  return {
    id: "b-long",
    label: "B · Sweep → reclaim → disp · LONG",
    expect: "LONG",
    family: "B_SWEEP_RECLAIM_DISP",
    bars,
    decisionIndex: bars.length - 1,
  };
}

export function fixtureSweepShort(): NamedFixture {
  let bars = xau(40);
  bars = append(bars, [
    [2000, 2004, 1996, 2002],
    [2002, 2006, 2000, 2004],
    [2004, 2014, 2002, 2010],
    [2010, 2012, 2006, 2008],
    [2008, 2010, 2002, 2004],
    [2004, 2016, 2003, 2005],
    [2005, 2008, 1996, 1998],
    [1998, 2000, 1972, 1976],
  ]);
  return {
    id: "b-short",
    label: "B · Sweep → reclaim → disp · SHORT",
    expect: "SHORT",
    family: "B_SWEEP_RECLAIM_DISP",
    bars,
    decisionIndex: bars.length - 1,
  };
}

/** C aceptación LONG: dos cierres sobre el rango-16. */
export function fixtureAcceptLong(): NamedFixture {
  const bars = quietBlock(40, 2000, 6, "XAUUSD", "15m", START);
  const last = bars[bars.length - 1]!;
  const step = STEP_SEC[last.tf];
  const extra: ShadowBar[] = [
    candle("XAUUSD", "15m", last.t + step, 2004, 2018, 2003, 2016),
    candle("XAUUSD", "15m", last.t + 2 * step, 2016, 2024, 2014, 2022),
  ];
  const all = [...bars, ...extra];
  return {
    id: "c-accept-long",
    label: "C · Aceptación de ruptura · LONG",
    expect: "LONG",
    family: "C_BREAKOUT_ACCEPT",
    bars: all,
    decisionIndex: all.length - 1,
  };
}

export function fixtureAcceptShort(): NamedFixture {
  const bars = quietBlock(40, 2000, 6, "XAUUSD", "15m", START);
  const last = bars[bars.length - 1]!;
  const step = STEP_SEC[last.tf];
  const extra: ShadowBar[] = [
    candle("XAUUSD", "15m", last.t + step, 1996, 1997, 1982, 1984),
    candle("XAUUSD", "15m", last.t + 2 * step, 1984, 1986, 1974, 1976),
  ];
  const all = [...bars, ...extra];
  return {
    id: "c-accept-short",
    label: "C · Aceptación de ruptura · SHORT",
    expect: "SHORT",
    family: "C_BREAKOUT_ACCEPT",
    bars: all,
    decisionIndex: all.length - 1,
  };
}

/** C rechazo: breakout up then close back inside. */
export function fixtureRejectShort(): NamedFixture {
  const bars = quietBlock(40, 2000, 6, "XAUUSD", "15m", START);
  const last = bars[bars.length - 1]!;
  const step = STEP_SEC[last.tf];
  const extra: ShadowBar[] = [
    candle("XAUUSD", "15m", last.t + step, 2004, 2018, 2003, 2015),
    candle("XAUUSD", "15m", last.t + 2 * step, 2014, 2016, 1996, 1998),
  ];
  const all = [...bars, ...extra];
  return {
    id: "c-reject-short",
    label: "C · Rechazo de ruptura · SHORT",
    expect: "SHORT",
    family: "C_BREAKOUT_REJECT",
    bars: all,
    decisionIndex: all.length - 1,
  };
}

/** D: occupancy de compresión y ruptura de caja. */
export function fixtureCompressionLong(): NamedFixture {
  let bars = quietBlock(40, 2000, 12, "XAUUSD", "15m", START);
  bars = append(bars, [
    [2000, 2002, 1999, 2001],
    [2001, 2002.2, 1999.2, 2000.4],
    [2000.4, 2001.8, 1999.1, 2000.2],
    [2000.2, 2001.5, 1999.4, 2000.8],
    [2000.8, 2022, 2000.5, 2018],
  ]);
  return {
    id: "d-long",
    label: "D · Compresión → expansión · LONG",
    expect: "LONG",
    family: "D_COMPRESSION_EXPAND",
    bars,
    decisionIndex: bars.length - 1,
  };
}

export function fixtureMissingData(): NamedFixture {
  return {
    id: "missing",
    label: "Datos insuficientes",
    expect: "NO_ENTRY",
    family: null,
    bars: xau(8),
    decisionIndex: 7,
  };
}

/**
 * Replay controlado de 72h. Alias estables para UI y smoke.
 * A → LONG, B → SHORT, C → NO ENTRY. No se retocan las reglas para forzar el resultado.
 */
export function fixtureEscenarioA(): NamedFixture {
  const f = fixtureFailExtendLong();
  return { ...f, id: "escenario-a", label: "Replay A · COMPRA" };
}

export function fixtureEscenarioB(): NamedFixture {
  const f = fixtureFailExtendShort();
  return { ...f, id: "escenario-b", label: "Replay B · VENTA" };
}

export function fixtureEscenarioC(): NamedFixture {
  const f = fixtureChop();
  return { ...f, id: "escenario-c", label: "Replay C · ESPERAR" };
}

export const CONTROLLED_SCENARIOS = [
  { id: "escenario-a", label: "Replay A · COMPRA", expect: "LONG" as const },
  { id: "escenario-b", label: "Replay B · VENTA", expect: "SHORT" as const },
  { id: "escenario-c", label: "Replay C · ESPERAR", expect: "NO_ENTRY" as const },
] as const;

export function allFixtures(): NamedFixture[] {
  return [
    fixtureChop(),
    fixtureFailExtendLong(),
    fixtureFailExtendShort(),
    fixtureSweepLong(),
    fixtureSweepShort(),
    fixtureAcceptLong(),
    fixtureAcceptShort(),
    fixtureRejectShort(),
    fixtureCompressionLong(),
    fixtureMissingData(),
  ];
}

export function fixtureById(id: string): NamedFixture | null {
  if (id === "escenario-a") return fixtureEscenarioA();
  if (id === "escenario-b") return fixtureEscenarioB();
  if (id === "escenario-c") return fixtureEscenarioC();
  return allFixtures().find((f) => f.id === id) ?? null;
}

/** Serie más larga para el slider de replay (chop + un LONG A al final). */
export function fixtureReplayTape(): NamedFixture {
  const a = fixtureFailExtendLong();
  return { ...a, id: "replay", label: "Replay · extremo LONG al final" };
}
