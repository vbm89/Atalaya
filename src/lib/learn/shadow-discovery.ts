/**
 * Shadow Pattern Discovery facade.
 *
 * READ PATH  → readDiscoveryLab / runDiscoveryLab
 *   Neon → coverage / universe / UI. No provider calls. No Neon writes.
 *
 * WRITE PATH → ingestDiscoveryCoverage
 *   UI "Actualizar cobertura" → complete COMMON_MIN or refresh the tape tip.
 *   Never auto-deepens ASSET_DEEP history.
 *
 * This step does not explore patterns, register k, or rank expectancy.
 */
import type { AssetId } from "../trading/types";
import type { SqlQuery } from "../watch/store";
import { DISCOVERY_ARCHIVE_TFS, DISCOVERY_ASSETS, type DiscoveryTf } from "./shadow-discovery-types";
import { DISCOVERY_PAGES_PER_CALL, paginateNativeSeries, type BackfillResult } from "./shadow-discovery-ingest";
import { buildCoverage, exploreDiscovery, type DiscoveryExploreReport } from "./shadow-discovery-explore";
import {
  assetsNeedingCoverage,
  nextTfToCompleteCoverage,
  spansFromCoverage,
} from "./shadow-discovery-universe";
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
export { nextDiscoveryTfToBackfill, nextTfToCompleteCoverage } from "./shadow-discovery-universe";

export const DISCOVERY_CODE_VERSION = "shadow-discovery-1";

export type DiscoveryPaginator = (args: {
  assetId: AssetId;
  tf: DiscoveryTf;
  beforeOpenSec: number | null;
  nowSec: number;
  pages?: number;
}) => Promise<BackfillResult>;

export type DiscoveryIngestMode = "complete" | "tip" | "idle";

export interface DiscoveryLabView {
  report: DiscoveryExploreReport;
  ingested: number;
  fromStore: boolean;
  backfillTf: DiscoveryTf | null;
  lastUpdatedAt: string | null;
  ingestRan: boolean;
  assetsProcessed: number | null;
  ingestMode: DiscoveryIngestMode;
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

function spansOf(cursors: readonly DiscoveryCursor[], bars: readonly import("./shadow-discovery-types").DiscoveryBar[]) {
  return spansFromCoverage(buildCoverage(bars, cursors));
}

/** READ ONLY. Opening the lab must call this. Never paginates or writes. */
export async function readDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<DiscoveryLabView> {
  const bars = sql ? await loadDiscoveryBars(sql) : [];
  const cursors = sql ? await loadDiscoveryCursors(sql).catch(() => [] as DiscoveryCursor[]) : [];
  const report = decorateReport(bars, cursors, nowSec);
  const completeTf = nextTfToCompleteCoverage(spansOf(cursors, bars));
  return {
    report,
    ingested: 0,
    fromStore: bars.length > 0,
    backfillTf: completeTf,
    lastUpdatedAt: latestCursorUpdate(cursors),
    ingestRan: false,
    assetsProcessed: null,
    ingestMode: "idle",
  };
}

async function persistCompletePage(
  sql: SqlQuery,
  paginate: DiscoveryPaginator,
  assetId: AssetId,
  tf: DiscoveryTf,
  cur: DiscoveryCursor | undefined,
  nowSec: number,
): Promise<number> {
  const page = await paginate({
    assetId,
    tf,
    beforeOpenSec: cur?.oldestT ?? null,
    nowSec,
    pages: DISCOVERY_PAGES_PER_CALL,
  });
  const n = await persistDiscoveryBars(sql, page.bars);
  await upsertDiscoveryCursor(sql, {
    assetId,
    tf,
    oldestT: page.oldestT ?? cur?.oldestT ?? null,
    newestT: page.newestT ?? cur?.newestT ?? null,
    source: page.source,
    instrument: page.instrument,
    instrumentKind: page.kind,
    exhausted: page.exhausted,
    pages: page.pages,
  });
  return n;
}

async function persistTipPage(
  sql: SqlQuery,
  paginate: DiscoveryPaginator,
  assetId: AssetId,
  tf: DiscoveryTf,
  cur: DiscoveryCursor | undefined,
  nowSec: number,
): Promise<number> {
  const page = await paginate({
    assetId,
    tf,
    beforeOpenSec: null,
    nowSec,
    pages: 1,
  });
  const n = await persistDiscoveryBars(sql, page.bars);
  await upsertDiscoveryCursor(sql, {
    assetId,
    tf,
    oldestT: cur?.oldestT ?? page.oldestT ?? null,
    newestT: page.newestT ?? cur?.newestT ?? null,
    source: page.source ?? cur?.source ?? null,
    instrument: page.instrument ?? cur?.instrument ?? null,
    instrumentKind: page.kind ?? cur?.instrumentKind ?? null,
    exhausted: cur?.exhausted ?? page.exhausted,
    pages: 0,
  });
  return n;
}

/**
 * WRITE. Explicit "Actualizar cobertura" only.
 * Completes TFs below COMMON_MIN. If every archive TF is unlocked, refreshes
 * the newest page only. Never walks older ASSET_DEEP history.
 */
export async function ingestDiscoveryCoverage(
  sql: SqlQuery | null,
  nowSec = Math.floor(Date.now() / 1000),
  paginate: DiscoveryPaginator = paginateNativeSeries,
): Promise<DiscoveryLabView> {
  if (!sql) {
    const empty = await readDiscoveryLab(null, nowSec);
    return { ...empty, ingestRan: true, ingested: 0, assetsProcessed: 0, ingestMode: "idle" };
  }
  const existing = await loadDiscoveryBars(sql);
  const cursors = await loadDiscoveryCursors(sql).catch(() => [] as DiscoveryCursor[]);
  const spans = spansOf(cursors, existing);
  const completeTf = nextTfToCompleteCoverage(spans);
  let ingested = 0;
  let assetsProcessed = 0;
  let ingestMode: DiscoveryIngestMode = "idle";
  if (completeTf) {
    ingestMode = "complete";
    const pending = assetsNeedingCoverage(spans, completeTf);
    assetsProcessed = pending.length;
    const jobs = pending.map((assetId) => {
      const cur = cursors.find((c) => c.assetId === assetId && c.tf === completeTf);
      return persistCompletePage(sql, paginate, assetId, completeTf, cur, nowSec);
    });
    ingested = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
  } else {
    ingestMode = "tip";
    const tipJobs: Promise<number>[] = [];
    for (const tf of DISCOVERY_ARCHIVE_TFS) {
      for (const assetId of DISCOVERY_ASSETS) {
        const cur = cursors.find((c) => c.assetId === assetId && c.tf === tf);
        if (!cur && !existing.some((b) => b.assetId === assetId && b.tf === tf)) continue;
        assetsProcessed += 1;
        tipJobs.push(persistTipPage(sql, paginate, assetId, tf, cur, nowSec));
      }
    }
    ingested = (await Promise.all(tipJobs)).reduce((a, b) => a + b, 0);
  }
  const view = await readDiscoveryLab(sql, nowSec);
  try { await persistDiscoveryJournal(sql, view.report.journal); } catch { /* best-effort */ }
  return {
    ...view,
    ingested,
    backfillTf: completeTf,
    ingestRan: true,
    assetsProcessed,
    ingestMode,
  };
}

/** Alias of the read path. Lab open / GET must never ingest. */
export async function runDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<DiscoveryLabView> {
  return readDiscoveryLab(sql, nowSec);
}
