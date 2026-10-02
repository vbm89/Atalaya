import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { decide } from "../learn/price-behaviour/decide.ts";
import type { AssetId, Bar } from "../learn/price-behaviour/types.ts";
import { lastClosedOpen, runCycle, type PaperTape } from "./cycle.ts";
import { readDecisions, readSignals } from "./store.ts";
import { captureStudy } from "./study.ts";
import { AUDIT_ASSETS, AUDIT_SEEDS, STRATEGY_FIELDS, auditTape, strategyAuditRows, strategyTuple, type StrategyTuple } from "./strategy-integrity.ts";

const golden = JSON.parse(readFileSync(new URL("./strategy-integrity.golden.json", import.meta.url), "utf8")) as Array<StrategyTuple & { asset: AssetId; seed: number }>;

function tape(bars: readonly Bar[]): PaperTape {
  return { bars: bars.map((row) => ({ ...row, source: "test" })), source: "LIVE", note: null, attempts: [] };
}

describe("strategy integrity", () => {
  it("keeps the audited decision tuple identical to the frozen baseline", () => {
    const live = strategyAuditRows();
    assert.equal(live.length, golden.length);
    assert.deepEqual(Object.keys(live[0]!).sort(), ["action", "asset", "entry", "event", "rr", "seed", "setup", "stop", "target", "tier"]);
    for (const field of STRATEGY_FIELDS) assert.equal(field in live[0]!, true);
    assert.deepEqual(live, golden);
  });

  it("capturing study does not move action, tier, setup, event, entry, stop, target or rr", () => {
    for (const asset of AUDIT_ASSETS) {
      for (const seed of AUDIT_SEEDS) {
        const bars = auditTape(seed * 3 + asset.length);
        const before = strategyTuple(bars, asset);
        const raw = decide(bars, bars.length - 1, asset);
        captureStudy(bars, {
          asset,
          lastBarT: bars.at(-1)!.t,
          marketState: raw.marketState.state,
          event: raw.event,
          setup: raw.setup,
          tier: raw.tier,
          direction: raw.direction,
          rr: raw.rr,
          entry: raw.entry,
          stop: raw.stop,
          target: raw.target,
          confirmation: raw.confirmation,
          evidence: raw.evidence,
        });
        assert.deepEqual(strategyTuple(bars, asset), before);
      }
    }
  });

  it("the live XAU paper gate matches the audit and does not admit a partial", async () => {
    const src = readFileSync(new URL("./cycle.ts", import.meta.url), "utf8");
    assert.match(src, /asset === "XAUUSD" && rawBoard\.action !== "ESPERAR" && rawBoard\.tier === "PARTIAL"/);
    const drops: number[] = [];
    for (const seed of AUDIT_SEEDS) {
      const bars = auditTape(seed * 3 + "XAUUSD".length);
      const raw = decide(bars, bars.length - 1, "XAUUSD");
      if (raw.action !== "ESPERAR" && raw.tier === "PARTIAL") drops.push(seed);
    }
    assert.ok(drops.length > 0);
    for (const seed of drops) {
      const bars = auditTape(seed * 3 + "XAUUSD".length);
      const expected = bars.at(-1)!.t;
      const now = expected + 900 + 40;
      assert.equal(lastClosedOpen(now), expected);
      const audited = strategyTuple(bars, "XAUUSD");
      assert.equal(audited.action, "ESPERAR");
      assert.equal(audited.tier, "PARTIAL");
      assert.equal(audited.entry, null);
      assert.equal(audited.stop, null);
      assert.equal(audited.target, null);
      assert.equal(audited.rr, null);
      const root = mkdtempSync(join(tmpdir(), "strategy-audit-"));
      const flat = bars.map((row) => ({ ...row, o: 50, h: 50.4, l: 49.6, c: 50 }));
      await runCycle({
        dir: root,
        nowSec: now,
        load: async (asset: AssetId) => tape(asset === "XAUUSD" ? bars : flat),
      });
      const decision = readDecisions(root).find((row) => row.asset === "XAUUSD" && row.mode === "LIVE");
      assert.ok(decision);
      assert.equal(decision!.decision, "ESPERAR");
      assert.equal(decision!.entry ?? null, null);
      assert.equal(decision!.stop ?? null, null);
      assert.equal(decision!.target ?? null, null);
      assert.equal(decision!.rr ?? null, null);
      assert.equal(readSignals(root).some((row) => row.asset === "XAUUSD"), false);
    }
  });
});
