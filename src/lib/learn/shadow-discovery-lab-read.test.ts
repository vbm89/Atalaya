import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { SqlQuery } from "../watch/store.ts";
import type { DiscoveryBar } from "./shadow-discovery-types.ts";
import type { BackfillResult } from "./shadow-discovery-ingest.ts";
import { ingestDiscoveryCoverage, readDiscoveryLab, runDiscoveryLab } from "./shadow-discovery.ts";
import { DISCOVERY_COMMON_MIN_DAYS } from "./shadow-discovery-types.ts";
import type { AssetId } from "../trading/types.ts";

function src(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function bar(assetId: AssetId, t: number, tf: DiscoveryBar["tf"] = "15m"): DiscoveryBar {
  return { assetId, tf, t, o: 100, h: 101, l: 99, c: 100.4, v: 10, source: "test" };
}

interface Mem {
  bars: DiscoveryBar[];
  cursors: Array<{
    asset_id: string; tf: string; oldest_t: number | null; newest_t: number | null;
    source: string | null; instrument: string | null; instrument_kind: string | null;
    exhausted: boolean; pages: number; updated_at: string | null;
  }>;
  inserts: number;
  cursorUpserts: number;
  journal: number;
  queries: string[];
}

function memorySql(init?: Partial<Mem>): { sql: SqlQuery; mem: Mem } {
  const mem: Mem = {
    bars: init?.bars ? [...init.bars] : [],
    cursors: init?.cursors ? [...init.cursors] : [],
    inserts: 0,
    cursorUpserts: 0,
    journal: 0,
    queries: [],
  };
  const sql: SqlQuery = {
    async query<T>(text: string, params?: unknown[]) {
      mem.queries.push(text);
      const q = text.replace(/\s+/g, " ").toLowerCase();
      if (q.includes("insert into discovery_bars")) {
        mem.inserts += 1;
        const p = params ?? [];
        const added: Array<{ c: number }> = [];
        for (let i = 0; i < p.length; i += 9) {
          const next: DiscoveryBar = {
            assetId: p[i] as AssetId,
            tf: p[i + 1] as DiscoveryBar["tf"],
            t: Number(p[i + 2]),
            o: Number(p[i + 3]),
            h: Number(p[i + 4]),
            l: Number(p[i + 5]),
            c: Number(p[i + 6]),
            v: p[i + 7] == null ? null : Number(p[i + 7]),
            source: String(p[i + 8]),
          };
          if (!mem.bars.some((b) => b.assetId === next.assetId && b.tf === next.tf && b.t === next.t)) {
            mem.bars.push(next);
            added.push({ c: 1 });
          }
        }
        return added as T[];
      }
      if (q.includes("insert into discovery_ingest_cursor")) {
        mem.cursorUpserts += 1;
        return [] as T[];
      }
      if (q.includes("insert into discovery_journal")) {
        mem.journal += 1;
        return [] as T[];
      }
      if (q.includes("from discovery_bars")) {
        return mem.bars.map((b) => ({
          asset_id: b.assetId, tf: b.tf, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, source: b.source,
        })) as T[];
      }
      if (q.includes("from discovery_ingest_cursor")) {
        return mem.cursors as T[];
      }
      return [] as T[];
    },
  };
  return { sql, mem };
}

function pageFor(assetId: AssetId, tf: DiscoveryBar["tf"], t: number): BackfillResult {
  const b = bar(assetId, t, tf);
  return {
    bars: [b],
    exhausted: false,
    pages: 1,
    source: "mock",
    instrument: "MOCK",
    kind: "proxy-usdt-kline",
    oldestT: t,
    newestT: t,
  };
}

describe("lab READ vs INGEST split", () => {
  it("A/B/C. readDiscoveryLab does not ingest, write bars, or touch cursors", async () => {
    const existing = [bar("BTCUSD", 1_000), bar("XAUUSD", 1_000), bar("US100", 1_000), bar("WTI", 1_000)];
    const { sql, mem } = memorySql({
      bars: existing,
      cursors: [{
        asset_id: "BTCUSD", tf: "15m", oldest_t: 1_000, newest_t: 1_000,
        source: "mock", instrument: "MOCK", instrument_kind: "proxy-usdt-kline",
        exhausted: false, pages: 1, updated_at: "2026-09-01T00:00:00.000Z",
      }],
    });
    const n0 = mem.bars.length;
    const view = await readDiscoveryLab(sql, 2_000_000);
    assert.equal(view.ingestRan, false);
    assert.equal(view.ingested, 0);
    assert.equal(view.assetsProcessed, null);
    assert.equal(view.report.rankingByExpectancy, false);
    assert.equal(mem.inserts, 0);
    assert.equal(mem.cursorUpserts, 0);
    assert.equal(mem.journal, 0);
    assert.equal(mem.bars.length, n0);
    assert.ok(mem.queries.every((q) => !/insert into/i.test(q)));
    assert.equal(view.report.journal.outcomeConsulted, false);
  });

  it("A. runDiscoveryLab is the read path, not ingest", async () => {
    const { sql, mem } = memorySql({ bars: [bar("BTCUSD", 1_000)] });
    const view = await runDiscoveryLab(sql, 2_000_000);
    assert.equal(view.ingestRan, false);
    assert.equal(mem.inserts, 0);
    const lab = src("shadow-discovery.ts");
    assert.match(lab, /export async function runDiscoveryLab/);
    assert.match(lab, /return readDiscoveryLab\(sql, nowSec\)/);
  });

  it("D/E. Actualizar cobertura starts ingest and continues from existing cursors", async () => {
    const { sql, mem } = memorySql({
      bars: [bar("BTCUSD", 5_000), bar("XAUUSD", 5_000), bar("US100", 5_000), bar("WTI", 5_000)],
      cursors: (["BTCUSD", "XAUUSD", "US100", "WTI"] as AssetId[]).map((id) => ({
        asset_id: id, tf: "15m", oldest_t: 5_000, newest_t: 5_000,
        source: "mock", instrument: "MOCK", instrument_kind: "proxy-usdt-kline",
        exhausted: false, pages: 1, updated_at: "2026-09-01T00:00:00.000Z",
      })),
    });
    const calls: Array<{ assetId: string; tf: string; beforeOpenSec: number | null }> = [];
    const view = await ingestDiscoveryCoverage(sql, 2_000_000, async (args) => {
      calls.push({ assetId: args.assetId, tf: args.tf, beforeOpenSec: args.beforeOpenSec });
      return pageFor(args.assetId, args.tf, (args.beforeOpenSec ?? 5_000) - 900);
    });
    assert.equal(view.ingestRan, true);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.beforeOpenSec === 5_000));
    assert.equal(mem.cursorUpserts, calls.length);
    assert.ok(mem.inserts > 0);
    assert.ok(view.ingested >= 0);
  });

  it("F. reloading the lab several times does not grow discovery_bars", async () => {
    const { sql, mem } = memorySql({ bars: [bar("BTCUSD", 1_000)] });
    const n0 = mem.bars.length;
    await readDiscoveryLab(sql, 2_000_000);
    await readDiscoveryLab(sql, 2_000_000);
    await readDiscoveryLab(sql, 2_000_000);
    assert.equal(mem.bars.length, n0);
    assert.equal(mem.inserts, 0);
  });

  it("G/H. update path does not enable Pattern Discovery; detectPatterns stays false", async () => {
    const lab = src("shadow-discovery.ts");
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    const fn = src("shadow-discovery.fn.ts");
    assert.match(lab, /detectPatterns:\s*false/);
    assert.doesNotMatch(lab, /detectPatterns:\s*true/);
    assert.doesNotMatch(panel, /detectPatterns/);
    assert.match(fn, /readDiscoveryLab/);
    assert.match(fn, /ingestDiscoveryCoverage/);
    assert.match(panel, /updateShadowDiscoveryCoverage/);
    assert.match(panel, /getShadowDiscovery/);
    const { sql } = memorySql({ bars: [bar("BTCUSD", 1_000)] });
    const view = await ingestDiscoveryCoverage(sql, 2_000_000, async (args) => pageFor(args.assetId, args.tf, 100));
    assert.equal(view.ingestRan, true);
    assert.doesNotMatch(lab, /detectPatterns:\s*true/);
  });

  it("I. COMMON_4 / ASSET_DEEP / COMMON_MIN stay 30d", () => {
    assert.equal(DISCOVERY_COMMON_MIN_DAYS, 30);
    const types = src("shadow-discovery-types.ts");
    const uni = src("shadow-discovery-universe.ts");
    assert.match(types, /DISCOVERY_COMMON_MIN_DAYS = 30/);
    assert.match(uni, /COMMON_4/);
    assert.match(uni, /ASSET_DEEP/);
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    assert.match(panel, /COMMON_4/);
    assert.match(panel, /ASSET_DEEP/);
  });

  it("J. discovery lab files still do not import V1 protected modules", () => {
    const files = [
      "shadow-discovery.ts",
      "shadow-discovery.fn.ts",
      "shadow-discovery-lab-read.test.ts",
    ];
    for (const f of files) {
      const body = src(f);
      assert.doesNotMatch(body, /trading\/engine/);
      assert.doesNotMatch(body, /trading\/signals/);
      assert.doesNotMatch(body, /trading\/structure/);
      assert.doesNotMatch(body, /trading\/risk/);
      assert.doesNotMatch(body, /watch\/outcome/);
      assert.doesNotMatch(body, /market\/xau-spot/);
    }
  });

  it("GET consult path is readDiscoveryLab; POST is ingest", () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const fn = src("shadow-discovery.fn.ts");
    assert.match(fn, /getShadowDiscovery[\s\S]*readDiscoveryLab/);
    assert.match(fn, /updateShadowDiscoveryCoverage[\s\S]*ingestDiscoveryCoverage/);
    assert.doesNotMatch(fn.slice(fn.indexOf("getShadowDiscovery"), fn.indexOf("updateShadowDiscoveryCoverage")), /ingestDiscoveryCoverage/);
    assert.match(route, /GET:[\s\S]*getShadowDiscovery/);
    assert.match(route, /POST:[\s\S]*updateShadowDiscoveryCoverage/);
  });

  it("exhausted assets are not paginated again", async () => {
    const { sql } = memorySql({
      bars: [bar("BTCUSD", 1_000), bar("XAUUSD", 1_000), bar("US100", 1_000), bar("WTI", 1_000)],
      cursors: [
        { asset_id: "BTCUSD", tf: "15m", oldest_t: 1_000, newest_t: 1_000, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: true, pages: 8, updated_at: null },
        { asset_id: "XAUUSD", tf: "15m", oldest_t: 1_000, newest_t: 1_000, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: false, pages: 1, updated_at: null },
        { asset_id: "US100", tf: "15m", oldest_t: 1_000, newest_t: 1_000, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: true, pages: 8, updated_at: null },
        { asset_id: "WTI", tf: "15m", oldest_t: 1_000, newest_t: 1_000, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: true, pages: 8, updated_at: null },
      ],
    });
    const seen: string[] = [];
    const view = await ingestDiscoveryCoverage(sql, 2_000_000, async (args) => {
      seen.push(args.assetId);
      return pageFor(args.assetId, args.tf, 100);
    });
    assert.deepEqual(seen, ["XAUUSD"]);
    assert.equal(view.assetsProcessed, 1);
  });
});
