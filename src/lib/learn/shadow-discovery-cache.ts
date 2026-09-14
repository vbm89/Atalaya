import type { SqlQuery } from "../watch/store";
import type { DiscoveryExploreReport } from "./shadow-discovery-explore";
import type { DiscoveryCursor } from "./shadow-discovery-store";

export const DISCOVERY_CACHE_KEY = "COMMON_4";

export function discoveryCursorFingerprint(cursors: readonly DiscoveryCursor[]): string {
  return JSON.stringify([...cursors]
    .sort((a, b) => `${a.assetId}:${a.tf}`.localeCompare(`${b.assetId}:${b.tf}`))
    .map((c) => [c.assetId, c.tf, c.oldestT, c.newestT, c.exhausted, c.pages, c.updatedAt ?? null]));
}

export async function loadDiscoveryLabCache(
  sql: SqlQuery,
  cacheKey: string,
  cursorFingerprint: string,
): Promise<DiscoveryExploreReport | null> {
  const rows = await sql.query<{ report: DiscoveryExploreReport | string }>(
    `select report from discovery_lab_cache where cache_key = $1 and cursor_fingerprint = $2 limit 1`,
    [cacheKey, cursorFingerprint],
  );
  const raw = rows[0]?.report;
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as DiscoveryExploreReport; } catch { return null; }
  }
  return raw;
}

export async function saveDiscoveryLabCache(
  sql: SqlQuery,
  cacheKey: string,
  cursorFingerprint: string,
  report: DiscoveryExploreReport,
): Promise<void> {
  await sql.query(
    `insert into discovery_lab_cache (cache_key, cursor_fingerprint, generated_at, report)
     values ($1,$2,now(),$3::jsonb)
     on conflict (cache_key) do update set
       cursor_fingerprint = excluded.cursor_fingerprint,
       generated_at = excluded.generated_at,
       report = excluded.report`,
    [cacheKey, cursorFingerprint, JSON.stringify(report)],
  );
}
