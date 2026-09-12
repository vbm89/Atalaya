/**
 * Shadow Pattern Discovery facade — universe ingest + coverage.
 * This step does not explore patterns, register k, or rank expectancy.
 */
import type { AssetId } from "../trading/types";
import type { SqlQuery } from "../watch/store";
import { DISCOVERY_ASSETS, type DiscoveryTf } from "./shadow-discovery-types";
import { DISCOVERY_PAGES_PER_CALL, paginateNativeSeries } from "./shadow-discovery-ingest";
import { buildCoverage, exploreDiscovery, type DiscoveryExploreReport } from "./shadow-discovery-explore";
import { nextDiscoveryTfToBackfill, spansFromCoverage } from "./shadow-discovery-universe";
import {
  loadDiscoveryBars,
  loadDiscoveryCursors,
  persistDiscoveryBars,
  persistDiscoveryJournal,
  upsertDiscoveryCursor,
  type DiscoveryCursor,
} from "./shadow-discovery-store";

export { exploreDiscovery, buildCoverage } from "./shadow-discovery-explore";
export { detectEvents } from "./shadow-discovery-events";
export { detectSequences } from "./shadow-discovery-sequences";
export { ingestNativeDiscovery, paginateNativeSeries } from "./shadow-discovery-ingest";
export { DISCOVERY_TFS, DISCOVERY_ARCHIVE_TFS, DISCOVERY_ASSETS, DISCOVERY_COMMON_MIN_DAYS } from "./shadow-discovery-types";
export { nextDiscoveryTfToBackfill } from "./shadow-discovery-universe";

export const DISCOVERY_CODE_VERSION = "shadow-discovery-1";

export async function runDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<{
  report: DiscoveryExploreReport;
  ingested: number;
  fromStore: boolean;
  backfillTf: DiscoveryTf | null;
}> {
  let ingested = 0;
  let fromStore = false;
  let backfillTf: DiscoveryTf | null = null;
  if (sql) {
    const existing = await loadDiscoveryBars(sql);
    fromStore = existing.length > 0;
    const cursors = await loadDiscoveryCursors(sql).catch(() => [] as DiscoveryCursor[]);
    const coverageNow = buildCoverage(existing, cursors);
    const spans = spansFromCoverage(coverageNow);
    backfillTf = nextDiscoveryTfToBackfill(spans);
    const jobs = DISCOVERY_ASSETS.map(async (assetId: AssetId) => {
      const cur = cursors.find((c) => c.assetId === assetId && c.tf === backfillTf);
      if (cur?.exhausted) return 0;
      const page = await paginateNativeSeries({
        assetId,
        tf: backfillTf!,
        beforeOpenSec: cur?.oldestT ?? null,
        nowSec,
        pages: DISCOVERY_PAGES_PER_CALL,
      });
      const n = await persistDiscoveryBars(sql, page.bars);
      await upsertDiscoveryCursor(sql, {
        assetId,
        tf: backfillTf!,
        oldestT: page.oldestT ?? cur?.oldestT ?? null,
        newestT: page.newestT ?? cur?.newestT ?? null,
        source: page.source,
        instrument: page.instrument,
        instrumentKind: page.kind,
        exhausted: page.exhausted,
        pages: page.pages,
      });
      return n;
    });
    ingested = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
  }
  const bars = sql ? await loadDiscoveryBars(sql) : [];
  const cursors = sql ? await loadDiscoveryCursors(sql).catch(() => []) : [];
  const report = exploreDiscovery(bars, nowSec, DISCOVERY_CODE_VERSION, { detectPatterns: false, cursors });
  report.coverage = report.coverage.map((row) => {
    const cur = cursors.find((c) => c.assetId === row.assetId && c.tf === row.tf);
    if (!cur) return row;
    return {
      ...row,
      exhausted: cur.exhausted,
      instrument: row.instrument ?? cur.instrument,
      instrumentKind: row.instrumentKind ?? cur.instrumentKind,
    };
  });
  report.journal.outcomeConsulted = false;
  if (!report.journal.notes?.includes("descriptivo, no validación")) {
    report.journal.notes = `${report.journal.notes ?? ""} descriptivo, no validación.`.trim();
  }
  if (sql) {
    try { await persistDiscoveryJournal(sql, report.journal); } catch { /* best-effort */ }
  }
  return { report, ingested, fromStore: fromStore || bars.length > 0, backfillTf };
}
