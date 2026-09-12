import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { SqlQuery } from "../watch/store.ts";
import type { AssetId } from "../trading/types.ts";
import type { DiscoveryBar } from "./shadow-discovery-types.ts";
import {
  assertExploreOnceSafe,
  DISCOVERY_METHOD_SHA,
  DISCOVERY_ONESHOT_MARK,
  DiscoveryExploreAbort,
  exploreDiscoveryOnce,
} from "./shadow-discovery-explore-once.ts";
import { collectExploreCatalog } from "./shadow-discovery-explore.ts";

function src(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function bar(assetId: AssetId, t: number, tf: DiscoveryBar["tf"] = "15m"): DiscoveryBar {
  return { assetId, tf, t, o: 100, h: 101, l: 99, c: 100.4, v: 10, source: "test" };
}

function memorySql(bars: DiscoveryBar[]): { sql: SqlQuery; journals: { n: number }; queries: string[] } {
  const journals = { n: 0 };
  const queries: string[] = [];
  const sql: SqlQuery = {
    async query<T>(text: string, _params?: unknown[]) {
      queries.push(text);
      const q = text.replace(/\s+/g, " ").toLowerCase();
      if (q.includes("insert into discovery_journal")) {
        journals.n += 1;
        return [{ id: 41 }] as T[];
      }
      if (q.includes("from discovery_bars")) {
        return bars.map((b) => ({
          asset_id: b.assetId, tf: b.tf, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, source: b.source,
        })) as T[];
      }
      if (q.includes("from discovery_ingest_cursor")) return [] as T[];
      if (q.includes("insert into discovery_bars") || q.includes("insert into discovery_ingest_cursor")) {
        throw new Error("oneshot must not ingest");
      }
      return [] as T[];
    },
  };
  return { sql, journals, queries };
}

describe("discovery one-shot explore", () => {
  it("GET/lab/ingest/UI never call exploreDiscoveryOnce", () => {
    const lab = src("shadow-discovery.ts");
    const fn = src("shadow-discovery.fn.ts");
    const route = readFileSync(new URL("../../routes/api/shadow/discovery.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../../components/dashboard/shadow-discovery-panel.tsx", import.meta.url), "utf8");
    const http = src("shadow-discovery-http.ts");
    assert.match(lab, /detectPatterns:\s*false/);
    assert.doesNotMatch(lab, /detectPatterns:\s*true/);
    assert.doesNotMatch(lab, /exploreDiscoveryOnce|collectExploreCatalog/);
    assert.doesNotMatch(fn, /exploreDiscoveryOnce|handleDiscoveryExplore|discovery-explore/);
    assert.doesNotMatch(route, /exploreDiscoveryOnce|handleDiscoveryExplore/);
    assert.doesNotMatch(panel, /exploreDiscoveryOnce|discovery-explore|handleDiscoveryExplore/);
    assert.match(http, /defaultDiscoveryIngest/);
    assert.doesNotMatch(http.slice(0, http.indexOf("handleDiscoveryExplore")), /exploreDiscoveryOnce/);
  });

  it("one-shot module uses detectPatterns true and never outcome/ingest", () => {
    const once = src("shadow-discovery-explore-once.ts");
    assert.match(once, /detectPatterns:\s*true/);
    assert.doesNotMatch(once, /outcomeAfterEvent|shadow-discovery-outcome|paginateNativeSeries|ingestDiscoveryCoverage/);
    const explore = src("shadow-discovery-explore.ts");
    assert.doesNotMatch(explore, /outcomeAfterEvent|shadow-discovery-outcome/);
  });

  it("explore route is POST-only and authorized", () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery-explore.ts", import.meta.url), "utf8");
    assert.match(route, /Method not allowed/);
    assert.match(route, /handleDiscoveryExplore/);
    assert.doesNotMatch(route, /ingestDiscoveryCoverage/);
  });

  it("abort if outcome or ranking leaks", () => {
    const bars = [bar("BTCUSD", 1_000)];
    const catalog = collectExploreCatalog(bars, 2_000, DISCOVERY_METHOD_SHA, { detectPatterns: true });
    catalog.report.outcomesSampled = 1 as 0;
    assert.throws(() => assertExploreOnceSafe(catalog), DiscoveryExploreAbort);
  });

  it("runs detectors, persists one journal, never writes bars/cursors", async () => {
    const now = 2_000_000;
    const bars: DiscoveryBar[] = [];
    for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as AssetId[]) {
      for (let i = 0; i < 40; i++) bars.push(bar(id, now - (40 - i) * 900));
    }
    const mem = memorySql(bars);
    const result = await exploreDiscoveryOnce(mem.sql, now, "test-impl");
    assert.equal(result.journalId, 41);
    assert.equal(result.persisted, true);
    assert.equal(mem.journals.n, 1);
    assert.equal(result.catalog.report.outcomesSampled, 0);
    assert.equal(result.catalog.report.journal.outcomeConsulted, false);
    assert.deepEqual(result.catalog.report.journal.candidates, []);
    assert.equal(result.catalog.report.journal.universe, "COMMON_4");
    assert.equal(result.catalog.report.journal.codeVersion, DISCOVERY_METHOD_SHA);
    assert.match(result.catalog.report.journal.notes ?? "", new RegExp(DISCOVERY_ONESHOT_MARK));
    assert.equal(result.catalog.report.rankingByExpectancy, false);
    assert.ok(!mem.queries.some((q) => /insert into discovery_bars/i.test(q)));
    assert.ok(!mem.queries.some((q) => /insert into discovery_ingest_cursor/i.test(q)));
  });
});
