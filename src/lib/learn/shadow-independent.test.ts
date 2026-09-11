import { scanBreakoutRetest } from "./shadow-independent";

function bar(t: number, o: number, h: number, l: number, c: number) { return { t, o, h, l, c, v: 100 }; }

test("breakout-retest emits only after a later closed retest", () => {
  const bars = Array.from({ length: 16 }, (_, i) => bar(i * 900, 100, 101, 99, 100));
  bars.push(bar(16 * 900, 100, 103, 100, 102));
  bars.push(bar(17 * 900, 102, 102.5, 100, 101));
  const rows = scanBreakoutRetest("US100", bars as any);
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ strategy: "BREAKOUT_RETEST_15M", direction: "buy", decisionSlot: 18 * 900 });
});

test("scanner does not emit from future candles before the retest exists", () => {
  const bars = Array.from({ length: 16 }, (_, i) => bar(i * 900, 100, 101, 99, 100));
  bars.push(bar(16 * 900, 100, 103, 100, 102));
  expect(scanBreakoutRetest("BTCUSD", bars as any)).toHaveLength(0);
});
