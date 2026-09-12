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
  DiscoveryExploreAlreadyExecuted,
  exploreDiscoveryOnce,
} from "./shadow-discovery-explore-once.ts";
import { collectExploreCatalog } from "./shadow-discovery-explore.ts";

function src(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function bar(assetId: AssetId, t: number, tf: DiscoveryBar["tf"] = "15m"): DiscoveryBar {
  return { assetId, tf, t, o: 100, h: 101, l: 99, c: 100.4, v: 10, source: "test" };
}

function sampleBars(now: number): DiscoveryBar[] {
  const bars: DiscoveryBar[] = [];
  for (const id of ["XAUUSD", "BTCUSD", "US100", "WTI"] as AssetId[]) {
    for (let i = 0; i < 40; i++) bars.push(bar(id, now - (40 - i) * 900));
  }
  return bars;
}

function memorySql(bars: DiscoveryBar[], opts?: { delayBarsMs?: number }): {
  sql: SqlQuery;
  journals: { n: number; notes: string[] };
  queries: string[];
  barsLoads: { n: number };
} {
  const journals = { n: 0, notes: [] as string[] };
  const queries: string[] = [];
  const barsLoads = { n: 0 };
  let chain = Promise.resolve();
  const runQuery = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    queries.push(text);
    const q = text.replace(/\s+/g, " ").toLowerCase();
    if (q.includes("pg_advisory_xact_lock")) return [] as T[];
    if (q.includes("from discovery_journal") && q.includes("position")) {
      const mark = String(params?.[0] ?? "");
      const hit = journals.notes.findIndex((n) => n.includes(mark));
      if (hit < 0) return [] as T[];
      return [{ id: hit + 1 }] as T[];
    }
    if (q.includes("insert into discovery_journal")) {
      journals.n += 1;
      journals.notes.push(String(params?.[10] ?? ""));
      return [{ id: journals.n }] as T[];
    }
    if (q.includes("from discovery_bars")) {
      barsLoads.n += 1;
      if (opts?.delayBarsMs) await new Promise((r) => setTimeout(r, opts.delayBarsMs));
      return bars.map((b) => ({
        asset_id: b.assetId, tf: b.tf, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, source: b.source,
      })) as T[];
    }
    if (q.includes("from discovery_ingest_cursor")) return [] as T[];
    if (q.includes("insert into discovery_bars") || q.includes("insert into discovery_ingest_cursor")) {
      throw new Error("oneshot must not ingest");
    }
    return [] as T[];
  };
  const sql: SqlQuery = {
    async query<T>(text: string, params?: unknown[]) {
      return runQuery<T>(text, params);
    },
    async transaction<T>(fn: (tx: SqlQuery) => Promise<T>): Promise<T> {
      const run = () => fn(sql);
      const next = chain.then(run, run);
      chain = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { sql, journals, queries, barsLoads };
}

describe("discovery one-shot explore", () => {
  it("E. GET/lab/ingest/UI never call exploreDiscoveryOnce and stay detectPatterns false", () => {
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
    assert.match(http, /ALREADY_EXECUTED/);
    const writeHttp = http.slice(
      http.indexOf("export async function handleDiscoveryWrite"),
      http.indexOf("export async function handleDiscoveryExplore"),
    );
    assert.doesNotMatch(writeHttp, /exploreDiscoveryOnce/);
  });

  it("one-shot module uses detectPatterns true and never outcome/ingest", () => {
    const once = src("shadow-discovery-explore-once.ts");
    assert.match(once, /detectPatterns:\s*true/);
    assert.match(once, /pg_advisory_xact_lock/);
    assert.match(once, /findOneshotExploreJournal/);
    assert.doesNotMatch(once, /outcomeAfterEvent|shadow-discovery-outcome|paginateNativeSeries|ingestDiscoveryCoverage/);
    const explore = src("shadow-discovery-explore.ts");
    assert.doesNotMatch(explore, /outcomeAfterEvent|shadow-discovery-outcome/);
  });

  it("explore route is POST-only and authorized", () => {
    const route = readFileSync(new URL("../../routes/api/shadow/discovery-explore.ts", import.meta.url), "utf8");
    assert.match(route, /Method not allowed/);
    assert.match(route, /handleDiscoveryExplore/);
    assert.doesNotMatch(route, /ingestDiscoveryCoverage/);
    const http = src("shadow-discovery-http.ts");
    assert.match(http, /authorizeDiscoveryExplore/);
    assert.match(http, /DISCOVERY_EXPLORE_TOKEN/);
    assert.match(
      http,
      /export function authorizeDiscoveryWrite\(request: Request\) \{\s*return authorizeWatchRequest\(request\);\s*\}/,
    );
  });

  it("abort if outcome or ranking leaks", () => {
    const bars = [bar("BTCUSD", 1_000)];
    const catalog = collectExploreCatalog(bars, 2_000, DISCOVERY_METHOD_SHA, { detectPatterns: true });
    catalog.report.outcomesSampled = 1 as 0;
    assert.throws(() => assertExploreOnceSafe(catalog), DiscoveryExploreAbort);
  });

  it("A. first execution is allowed and persists one journal", async () => {
    const now = 2_000_000;
    const mem = memorySql(sampleBars(now));
    const result = await exploreDiscoveryOnce(mem.sql, now, "test-impl");
    assert.equal(result.journalId, 1);
    assert.equal(result.persisted, true);
    assert.equal(mem.journals.n, 1);
    assert.equal(mem.barsLoads.n, 1);
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

  it("B/D. second execution is blocked before detectors", async () => {
    const now = 2_000_000;
    const mem = memorySql(sampleBars(now));
    await exploreDiscoveryOnce(mem.sql, now, "test-impl");
    const loadsAfterFirst = mem.barsLoads.n;
    await assert.rejects(
      () => exploreDiscoveryOnce(mem.sql, now, "test-impl-2"),
      (err: unknown) => err instanceof DiscoveryExploreAlreadyExecuted,
    );
    assert.equal(mem.journals.n, 1);
    assert.equal(mem.barsLoads.n, loadsAfterFirst);
  });

  it("C. concurrent calls cannot persist two journals or run two detects", async () => {
    const now = 2_000_000;
    const mem = memorySql(sampleBars(now), { delayBarsMs: 40 });
    const results = await Promise.allSettled([
      exploreDiscoveryOnce(mem.sql, now, "a"),
      exploreDiscoveryOnce(mem.sql, now, "b"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const blocked = results.filter((r) =>
      r.status === "rejected" && r.reason instanceof DiscoveryExploreAlreadyExecuted,
    );
    assert.equal(ok.length, 1);
    assert.equal(blocked.length, 1);
    assert.equal(mem.journals.n, 1);
    assert.equal(mem.barsLoads.n, 1);
  });
});
