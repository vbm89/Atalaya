import type { SqlQuery } from "../watch/store";
import { getAsset } from "../trading/assets";
import { fetchJson } from "../market/http";
import type { AssetId } from "../trading/types";

type Tf = "1m" | "5m";
type Row = [number, string, string, string, string, string, ...unknown[]];

const ASSETS: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];
const LIMIT = 1000;

function endpoint(asset: AssetId, tf: Tf): string | null {
  const meta = getAsset(asset);
  const interval = tf === "1m" ? "1m" : "5m";
  if (meta.binanceSymbol) {
    return `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(meta.binanceSymbol)}&interval=${interval}&limit=${LIMIT}`;
  }
  if (meta.bitgetSymbol) {
    return `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(meta.bitgetSymbol)}&granularity=${interval}&limit=${LIMIT}`;
  }
  return null;
}

async function fetchBars(asset: AssetId, tf: Tf): Promise<Array<{ t: number; o: number; h: number; l: number; c: number; v: number | null }>> {
  const url = endpoint(asset, tf);
  if (!url) return [];
  const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
  if (!res.ok || !res.data) return [];

  const rows: Row[] = Array.isArray(res.data)
    ? (res.data as Row[])
    : Array.isArray((res.data as { data?: unknown }).data)
      ? ((res.data as { data: unknown[] }).data as Row[])
      : [];

  return rows.map((r) => ({
    t: Math.floor(Number(r[0]) / 1000),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: r[5] == null ? null : Number(r[5]),
  })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.o) && Number.isFinite(r.h) && Number.isFinite(r.l) && Number.isFinite(r.c));
}

export async function captureShadowIntrabar(sql: SqlQuery): Promise<{ bars1m: number; bars5m: number }> {
  let bars1m = 0;
  let bars5m = 0;
  for (const asset of ASSETS) {
    for (const tf of ["1m", "5m"] as const) {
      const bars = await fetchBars(asset, tf);
      for (const b of bars) {
        await sql.query(
          `insert into shadow_intrabar_bars (asset_id, tf, t, o, h, l, c, v, captured_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, now())
           on conflict (asset_id, tf, t) do update set
             o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
             v = excluded.v, captured_at = excluded.captured_at`,
          [asset, tf, b.t, b.o, b.h, b.l, b.c, b.v],
        );
      }
      if (tf === "1m") bars1m += bars.length;
      else bars5m += bars.length;
    }
  }
  await sql.query(`delete from shadow_intrabar_bars where t < extract(epoch from now() - interval '8 days')::bigint`);
  return { bars1m, bars5m };
}
