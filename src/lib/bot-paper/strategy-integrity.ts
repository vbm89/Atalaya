import { decide } from "../learn/price-behaviour/decide.ts";
import type { AssetId, Bar } from "../learn/price-behaviour/types.ts";

/** Auditoría. No lo importa el runtime. */
export const STRATEGY_FIELDS = ["action", "tier", "setup", "event", "entry", "stop", "target", "rr"] as const;

export interface StrategyTuple {
  action: "COMPRA" | "VENTA" | "ESPERAR";
  tier: "FULL" | "PARTIAL" | null;
  setup: string | null;
  event: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
}

export function auditTape(seed: number): Bar[] {
  const bars: Bar[] = [];
  let c = 100;
  for (let i = 0; i < 90; i++) {
    const drift = Math.sin((i + seed) / 4) * 1.8 + (i % 5 === 0 ? 2.2 : -0.15);
    const o = c;
    c = c + drift;
    bars.push({ t: 1_699_999_200 + i * 900, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.6, c, v: 1 });
  }
  return bars;
}

/** Misma decisión que el motor, con el filtro PAPER de XAU ya aplicado. No escribe nada. */
export function strategyTuple(bars: readonly Bar[], asset: AssetId): StrategyTuple {
  const d = decide(bars, bars.length - 1, asset);
  const dropXauPartial = asset === "XAUUSD" && d.action !== "ESPERAR" && d.tier === "PARTIAL";
  return {
    action: dropXauPartial ? "ESPERAR" : d.action,
    tier: d.tier,
    setup: d.setup,
    event: d.event,
    entry: dropXauPartial ? null : d.entry,
    stop: dropXauPartial ? null : d.stop,
    target: dropXauPartial ? null : d.target,
    rr: dropXauPartial ? null : d.rr,
  };
}

export const AUDIT_ASSETS: readonly AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];
export const AUDIT_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

export function strategyAuditRows(): Array<StrategyTuple & { asset: AssetId; seed: number }> {
  const rows = [];
  for (const asset of AUDIT_ASSETS) {
    for (const seed of AUDIT_SEEDS) {
      rows.push({ asset, seed, ...strategyTuple(auditTape(seed * 3 + asset.length), asset) });
    }
  }
  return rows;
}
