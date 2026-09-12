/**
 * Shadow Pattern Discovery facade.
 *
 * READ PATH  → readDiscoveryLab / runDiscoveryLab
 *   Neon → coverage / universe / UI. No provider calls. No Neon writes.
 *
 * WRITE PATH → ingestDiscoveryCoverage
 *   UI "Actualizar cobertura" → paginateNativeSeries → Neon bars + cursors.
 *
 * This step does not explore patterns, register k, or rank expectancy.
 */
import type { AssetId } from "../trading/types";
import type { SqlQuery } from "../watch/store";
import { DISCOVERY_ASSETS, type DiscoveryTf } from "./shadow-discovery-types";
import { DISCOVERY_PAGES_PER_CALL, paginateNativeSeries, type BackfillResult } from "./shadow-discovery-ingest";
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

export type DiscoveryPaginator = (args: {
  assetId: AssetId;
  tf: DiscoveryTf;
  beforeOpenSec: number | null;
  nowSec: number;
  pages?: number;
}) => Promise<BackfillResult>;

export interface DiscoveryLabView {
  report: DiscoveryExploreReport;
  ingested: number;
  fromStore: boolean;
  backfillTf: DiscoveryTf | null;
  lastUpdatedAt: string | null;
  ingestRan: boolean;
  assetsProcessed: number | null;
}

function latestCursorUpdate(cursors: readonly DiscoveryCursor[]): string | null {
  let latest: string | null = null;
  for (const c of cursors) {
    const at = c.updatedAt ?? null;
    if (!at) continue;
    if (latest == null || at > latest) latest = at;
  }
  return latest;
}

function decorateReport(
  bars: readonly import("./shadow-discovery-types").DiscoveryBar[],
  cursors: readonly DiscoveryCursor[],
  nowSec: number,
): DiscoveryExploreReport {
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
  return report;
}

function nextTf(cursors: readonly DiscoveryCursor[], bars: readonly import("./shadow-discovery-types").DiscoveryBar[]): DiscoveryTf | null {
  const coverageNow = buildCoverage(bars, cursors);
  const spans = spansFromCoverage(coverageNow);
  return nextDiscoveryTfToBackfill(spans);
}

/** READ ONLY. Opening the lab must call this. Never paginates or writes. */
export async function readDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<DiscoveryLabView> {
  const bars = sql ? await loadDiscoveryBars(sql) : [];
  const cursors = sql ? await loadDiscoveryCursors(sql).catch(() => [] as DiscoveryCursor[]) : [];
  const report = decorateReport(bars, cursors, nowSec);
  return {
    report,
    ingested: 0,
    fromStore: bars.length > 0,
    backfillTf: bars.length || cursors.length ? nextTf(cursors, bars) : null,
    lastUpdatedAt: latestCursorUpdate(cursors),
    ingestRan: false,
    assetsProcessed: null,
  };
}

/**
 * WRITE. Explicit "Actualizar cobertura" only.
 * Continues from discovery_ingest_cursor. Does not reset pages/oldest_t.
 */
export async function ingestDiscoveryCoverage(
  sql: SqlQuery | null,
  nowSec = Math.floor(Date.now() / 1000),
  paginate: DiscoveryPaginator = paginateNativeSeries,
): Promise<DiscoveryLabView> {
  if (!sql) {
    const empty = await readDiscoveryLab(null, nowSec);
    return { ...empty, ingestRan: true, ingested: 0, assetsProcessed: 0 };
  }
  const existing = await loadDiscoveryBars(sql);
  const cursors = await loadDiscoveryCursors(sql).catch(() => [] as DiscoveryCursor[]);
  const backfillTf = nextTf(cursors, existing);
  let ingested = 0;
  let assetsProcessed = 0;
  if (backfillTf) {
    const pending = DISCOVERY_ASSETS.filter((assetId) => {
      const cur = cursors.find((c) => c.assetId === assetId && c.tf === backfillTf);
      return !cur?.exhausted;
    });
    assetsProcessed = pending.length;
    const jobs = pending.map(async (assetId: AssetId) => {
      const cur = cursors.find((c) => c.assetId === assetId && c.tf === backfillTf);
      const page = await paginate({
        assetId,
        tf: backfillTf,
        beforeOpenSec: cur?.oldestT ?? null,
        nowSec,
        pages: DISCOVERY_PAGES_PER_CALL,
      });
      const n = await persistDiscoveryBars(sql, page.bars);
      await upsertDiscoveryCursor(sql, {
        assetId,
        tf: backfillTf,
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
  const view = await readDiscoveryLab(sql, nowSec);
  try { await persistDiscoveryJournal(sql, view.report.journal); } catch { /* best-effort */ }
  return {
    ...view,
    ingested,
    backfillTf,
    ingestRan: true,
    assetsProcessed,
  };
}

/** Alias of the read path. Lab open / GET must never ingest. */
export async function runDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<DiscoveryLabView> {
  return readDiscoveryLab(sql, nowSec);
}
