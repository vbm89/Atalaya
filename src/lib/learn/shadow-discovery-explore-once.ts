/**
 * Explicit one-shot Pattern Discovery. Not the lab GET/read path.
 * Never paginates. Never updates cursors. Never calls outcome.
 */
import type { SqlQuery } from "../watch/store";
import {
  collectExploreCatalog,
  type DiscoveryExploreCatalog,
} from "./shadow-discovery-explore";
import { loadDiscoveryBars, loadDiscoveryCursors, persistDiscoveryJournal } from "./shadow-discovery-store";

export const DISCOVERY_METHOD_SHA = "36a5eb837a9bfd3b1d9bbc4e397107714f5cb419";
export const DISCOVERY_ONESHOT_MARK = "FIRST_ONESHOT_EXPLORE";

export class DiscoveryExploreAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryExploreAbort";
  }
}

export function assertExploreOnceSafe(catalog: DiscoveryExploreCatalog): void {
  const { report } = catalog;
  if (report.outcomesSampled !== 0) {
    throw new DiscoveryExploreAbort("ABORT: outcomesSampled != 0");
  }
  if (report.journal.outcomeConsulted !== false) {
    throw new DiscoveryExploreAbort("ABORT: outcomeConsulted");
  }
  if (report.rankingByExpectancy !== false) {
    throw new DiscoveryExploreAbort("ABORT: rankingByExpectancy");
  }
  if (report.journal.candidates.length > 0) {
    throw new DiscoveryExploreAbort("ABORT: candidates not empty");
  }
  if (report.journal.universe !== "COMMON_4") {
    throw new DiscoveryExploreAbort("ABORT: universe is not COMMON_4");
  }
}

export interface DiscoveryExploreOnceResult {
  journalId: number | null;
  persisted: boolean;
  catalog: DiscoveryExploreCatalog;
  nCommon4: Array<{ tf: string; n: number | null; days: number | null; available: boolean }>;
}

function oneshotJournal(catalog: DiscoveryExploreCatalog, implSha: string) {
  const { report } = catalog;
  const cells = catalog.cells.map((c) => `${c.tf}|${c.assetId}|${c.kind}=${c.n}`);
  const seq = catalog.sequenceCells.map((c) => `${c.family}|${c.assetId}|${c.tf}=${c.n}`);
  return {
    ...report.journal,
    universe: "COMMON_4" as const,
    codeVersion: DISCOVERY_METHOD_SHA,
    candidates: [] as string[],
    outcomeConsulted: false,
    discarded: [
      "warmupOutsideCommon",
      "outside_COMMON_4_window",
      "k1_test_15m_post_registeredAt",
      "ASSET_DEEP",
    ],
    discardReason:
      "technical/methodological only: warmup, window, K1 TEST 15m, ASSET_DEEP. never outcome.",
    notes: [
      DISCOVERY_ONESHOT_MARK,
      "primera exploración one-shot COMMON_4",
      `methodSha=${DISCOVERY_METHOD_SHA}`,
      `implSha=${implSha}`,
      "detectPatterns=true only on this path",
      "GET/lab detectPatterns=false",
      "outcome no consultado",
      "descriptivo, no validación",
      `catalogN=${catalog.catalogN}`,
      `warmupExcluded=${catalog.warmupExcludedN}`,
      `warmupTagged=${catalog.warmupTaggedN}`,
      `outsideWindow=${catalog.outsideWindowN}`,
      `k1TestExcluded=${catalog.k1TestExcludedN}`,
      `cells=${cells.join(",")}`,
      `sequences=${seq.join(",")}`,
    ].join(". "),
  };
}

export async function exploreDiscoveryOnce(
  sql: SqlQuery,
  nowSec = Math.floor(Date.now() / 1000),
  implSha = "local",
): Promise<DiscoveryExploreOnceResult> {
  const bars = await loadDiscoveryBars(sql);
  const cursors = await loadDiscoveryCursors(sql).catch(() => []);
  const catalog = collectExploreCatalog(bars, nowSec, DISCOVERY_METHOD_SHA, {
    detectPatterns: true,
    cursors,
  });
  assertExploreOnceSafe(catalog);
  const journal = oneshotJournal(catalog, implSha);
  catalog.report.journal = journal;
  const journalId = await persistDiscoveryJournal(sql, journal);
  return {
    journalId,
    persisted: journalId != null,
    catalog,
    nCommon4: catalog.report.universes.common4.map((c) => ({
      tf: c.tf,
      n: c.n,
      days: c.days,
      available: c.available,
    })),
  };
}
