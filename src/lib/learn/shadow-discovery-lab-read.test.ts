import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { SqlQuery } from "../watch/store.ts";
import { DISCOVERY_ARCHIVE_TFS, DISCOVERY_COMMON_MIN_DAYS, type DiscoveryBar } from "./shadow-discovery-types.ts";
import type { BackfillResult } from "./shadow-discovery-ingest.ts";
import { ingestDiscoveryCoverage, readDiscoveryLab, runDiscoveryLab } from "./shadow-discovery.ts";
import { authorizeDiscoveryWrite } from "./shadow-discovery-http.ts";
import type { AssetId } from "../trading/types.ts";

const DAY = 86_400;

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

function coveredUniverse(days = 31) {
  const first = 10_000;
  const last = first + days * DAY;
  const assets: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];
  const bars: DiscoveryBar[] = [];
  const cursors: Mem["cursors"] = [];
  for (const tf of DISCOVERY_ARCHIVE_TFS) {
    for (const id of assets) {
      bars.push(bar(id, first, tf), bar(id, last, tf));
      cursors.push({
        asset_id: id, tf, oldest_t: first, newest_t: last,
        source: "mock", instrument: "MOCK", instrument_kind: "proxy-usdt-kline",
        exhausted: id === "US100" || id === "WTI",
        pages: id === "BTCUSD" ? 17 : 8,
        updated_at: "2026-09-01T00:00:00.000Z",
      });
    }
  }
  return { bars, cursors };
}

describe("lab READ vs INGEST split", () => {
  it("A/B. opening and reloading the lab does not ingest or write", async () => {
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
    await readDiscoveryLab(sql, 2_000_000);
    await runDiscoveryLab(sql, 2_000_000);
    await readDiscoveryLab(sql, 2_000_000);
    assert.equal(mem.inserts, 0);
    assert.equal(mem.cursorUpserts, 0);
    assert.equal(mem.journal, 0);
    assert.equal(mem.bars.length, n0);
    assert.ok(mem.queries.every((q) => !/insert into/i.test(q)));
  });

  it("C/E. below COMMON_MIN, Actualizar cobertura backfills only assets still short", async () => {
    const last = 10_000 + 8 * DAY;
    const { sql, mem } = memorySql({
      bars: [
        bar("BTCUSD", 10_000), bar("BTCUSD", 10_000 + 31 * DAY),
        bar("XAUUSD", 10_000), bar("XAUUSD", 10_000 + 31 * DAY),
        bar("US100", 10_000), bar("US100", last),
        bar("WTI", 10_000), bar("WTI", last),
      ],
      cursors: [
        { asset_id: "BTCUSD", tf: "15m", oldest_t: 10_000, newest_t: 10_000 + 31 * DAY, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: false, pages: 17, updated_at: null },
        { asset_id: "XAUUSD", tf: "15m", oldest_t: 10_000, newest_t: 10_000 + 31 * DAY, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: false, pages: 8, updated_at: null },
        { asset_id: "US100", tf: "15m", oldest_t: 10_000, newest_t: last, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: false, pages: 1, updated_at: null },
        { asset_id: "WTI", tf: "15m", oldest_t: 10_000, newest_t: last, source: "m", instrument: "M", instrument_kind: "proxy-usdt-kline", exhausted: false, pages: 1, updated_at: null },
      ],
    });
    const calls: Array<{ assetId: string; tf: string; beforeOpenSec: number | null; pages?: number }> = [];
    const view = await ingestDiscoveryCoverage(sql, last + 10_000, async (args) => {
      calls.push({ assetId: args.assetId, tf: args.tf, beforeOpenSec: args.beforeOpenSec, pages: args.pages });
      return pageFor(args.assetId, args.tf, (args.beforeOpenSec ?? 10_000) - 900);
    });
    assert.equal(view.ingestRan, true);
    assert.equal(view.ingestMode, "complete");
    assert.equal(view.backfillTf, "15m");
    assert.deepEqual(calls.map((c) => c.assetId).sort(), ["US100", "WTI"]);
    assert.ok(calls.every((c) => c.tf === "15m" && c.beforeOpenSec === 10_000 && c.pages === 8));
    assert.equal(mem.cursorUpserts, 2);
  });

  it("D. COMMON_MIN met does not historically deepen BTC/XAU live cursors", async () => {
    const { bars, cursors } = coveredUniverse(31);
    const { sql } = memorySql({ bars, cursors });
    const calls: Array<{ assetId: string; tf: string; beforeOpenSec: number | null; pages?: number }> = [];
    const view = await ingestDiscoveryCoverage(sql, 10_000 + 31 * DAY + 5_000, async (args) => {
      calls.push({ assetId: args.assetId, tf: args.tf, beforeOpenSec: args.beforeOpenSec, pages: args.pages });
      return pageFor(args.assetId, args.tf, args.nowSec - 900);
    });
    assert.equal(view.ingestRan, true);
    assert.equal(view.ingestMode, "tip");
    assert.equal(view.backfillTf, null);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.beforeOpenSec === null && c.pages === 1));
    assert.equal(calls.some((c) => c.assetId === "BTCUSD" && c.tf === "15m" && c.beforeOpenSec === 10_000), false);
  });

  it("F. GET/read path never writes", async () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const getBlock = route.slice(route.indexOf("GET:"), route.indexOf("POST:"));
    assert.match(getBlock, /getShadowDiscovery/);
    assert.doesNotMatch(getBlock, /ingestDiscoveryCoverage|handleDiscoveryWrite/);
    const fn = src("shadow-discovery.fn.ts");
    assert.doesNotMatch(fn.slice(fn.indexOf("getShadowDiscovery"), fn.indexOf("updateShadowDiscoveryCoverage")), /ingestDiscoveryCoverage/);
  });

  it("G. POST requires existing WATCH_SECRET bearer auth", () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const http = src("shadow-discovery-http.ts");
    assert.match(route, /POST:[\s\S]*handleDiscoveryWrite/);
    assert.match(http, /authorizeWatchRequest/);
    const prev = process.env.WATCH_SECRET;
    delete process.env.WATCH_SECRET;
    const missing = authorizeDiscoveryWrite(new Request("http://x/api/shadow/discovery", { method: "POST" }));
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 503);
    process.env.WATCH_SECRET = "discovery-write-secret-16";
    const none = authorizeDiscoveryWrite(new Request("http://x/api/shadow/discovery", { method: "POST" }));
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.status, 401);
    const bad = authorizeDiscoveryWrite(new Request("http://x/api/shadow/discovery", { method: "POST", headers: { authorization: "Bearer wrong-secret-16xx" } }));
    assert.equal(bad.ok, false);
    const good = authorizeDiscoveryWrite(new Request("http://x/api/shadow/discovery", { method: "POST", headers: { authorization: "Bearer discovery-write-secret-16" } }));
    assert.equal(good.ok, true);
    if (prev === undefined) delete process.env.WATCH_SECRET;
    else process.env.WATCH_SECRET = prev;
  });

  it("H/I. COMMON_4 / ASSET_DEEP / detectPatterns stay frozen", async () => {
    assert.equal(DISCOVERY_COMMON_MIN_DAYS, 30);
    const lab = src("shadow-discovery.ts");
    const uni = src("shadow-discovery-universe.ts");
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    assert.match(lab, /detectPatterns:\s*false/);
    assert.doesNotMatch(lab, /detectPatterns:\s*true/);
    assert.match(uni, /COMMON_4/);
    assert.match(uni, /ASSET_DEEP/);
    assert.match(panel, /COMMON_4/);
    assert.match(panel, /ASSET_DEEP/);
    const { sql } = memorySql({ bars: [bar("BTCUSD", 1_000)] });
    const view = await ingestDiscoveryCoverage(sql, 2_000_000, async (args) => pageFor(args.assetId, args.tf, 100));
    assert.equal(view.report.rankingByExpectancy, false);
  });

  it("J. discovery lab files still do not import V1 protected modules", () => {
    const files = [
      "shadow-discovery.ts",
      "shadow-discovery.fn.ts",
      "shadow-discovery-http.ts",
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
});
