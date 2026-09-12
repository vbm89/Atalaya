/**
 * Shadow Pattern Discovery facade.
 * Independent of V1 live path and of K1. Does not register hypotheses.
 */
import { ingestNativeDiscovery } from "./shadow-discovery-ingest";
import { exploreDiscovery, type DiscoveryExploreReport } from "./shadow-discovery-explore";
import { persistDiscoveryBars, persistDiscoveryJournal, loadDiscoveryBars } from "./shadow-discovery-store";
import type { SqlQuery } from "../watch/store";
import type { DiscoveryBar, DiscoveryTf } from "./shadow-discovery-types";
import { DISCOVERY_ARCHIVE_TFS } from "./shadow-discovery-types";

export { exploreDiscovery, buildCoverage } from "./shadow-discovery-explore";
export { detectEvents } from "./shadow-discovery-events";
export { detectSequences } from "./shadow-discovery-sequences";
export { ingestNativeDiscovery } from "./shadow-discovery-ingest";
export { DISCOVERY_TFS, DISCOVERY_ARCHIVE_TFS, DISCOVERY_ASSETS } from "./shadow-discovery-types";

export const DISCOVERY_CODE_VERSION = "shadow-discovery-1";

function missingArchiveTf(bars: readonly DiscoveryBar[]): DiscoveryTf | null {
  for (const tf of DISCOVERY_ARCHIVE_TFS) {
    if (!bars.some((b) => b.tf === tf)) return tf;
  }
  return null;
}

export async function runDiscoveryLab(sql: SqlQuery | null, nowSec = Math.floor(Date.now() / 1000)): Promise<{
  report: DiscoveryExploreReport;
  ingested: number;
  fromStore: boolean;
}> {
  let bars: DiscoveryBar[] = [];
  let ingested = 0;
  let fromStore = false;
  if (sql) {
    bars = await loadDiscoveryBars(sql);
    fromStore = bars.length > 0;
    const nextTf = missingArchiveTf(bars);
    if (nextTf) {
      const fresh = await ingestNativeDiscovery({ tfs: [nextTf], limit: 300 });
      ingested = await persistDiscoveryBars(sql, fresh);
      bars = await loadDiscoveryBars(sql);
      fromStore = bars.length > 0;
    }
  }
  const report = exploreDiscovery(bars, nowSec, DISCOVERY_CODE_VERSION);
  if (sql) {
    try { await persistDiscoveryJournal(sql, report.journal); } catch { /* journal is best-effort */ }
  }
  return { report, ingested, fromStore };
}
