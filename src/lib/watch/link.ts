import type { AssetId } from "../trading/types";

const ASSETS: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

export interface WatchLink {
  assetId: AssetId;
  episodeId: string;
}

export function parseWatchLink(search: string): WatchLink | null {
  let q = search;
  try {
    if (search.includes("://") || search.startsWith("/")) {
      q = new URL(search, "https://atalaya.local").search;
    }
  } catch {
    /* keep raw */
  }
  if (q.startsWith("?")) q = q.slice(1);
  const sp = new URLSearchParams(q);
  const asset = sp.get("asset");
  const episode = sp.get("episode")?.trim() ?? "";
  if (!asset || !ASSETS.includes(asset as AssetId) || episode.length < 8) return null;
  return { assetId: asset as AssetId, episodeId: episode };
}

export function watchLinkPath(assetId: AssetId, episodeId: string): string {
  const sp = new URLSearchParams({ asset: assetId, episode: episodeId });
  return `/?${sp.toString()}`;
}
