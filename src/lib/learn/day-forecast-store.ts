import type { AssetAnalysis, AssetId } from "@/lib/trading/types";
import type { DailyForecast } from "./day-forecast";
import type { SqlQuery } from "@/lib/watch/store";

export type ForecastOutcome = "acierto" | "fallo" | "en_curso" | "neutro";

export interface ForecastTracking {
  forecastDate: string;
  assetId: AssetId;
  generatedAt: string;
  direction: DailyForecast["direction"];
  confidence: number;
  referencePrice: number;
  lastPrice: number;
  mfePct: number;
  maePct: number;
  status: "open" | "closed";
  outcome: ForecastOutcome | null;
  outcomeAt: string | null;
  reasons: string[];
  snapshot: {
    technicalSummary: string;
    timeframes: Array<{ timeframe: string; trend: string; structure: string; score: number; sufficient: boolean }>;
    supports: number[];
    resistances: number[];
    setupState: string;
    signal: string;
  };
}

export interface ForecastStats {
  total: number;
  closed: number;
  correct: number;
  failed: number;
  open: number;
  winRate: number | null;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function rowToTracking(row: Record<string, unknown>): ForecastTracking {
  const snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : (row.snapshot ?? {});
  const reasons = typeof row.reasons === "string" ? JSON.parse(row.reasons) : (row.reasons ?? []);
  return {
    forecastDate: String(row.forecast_date),
    assetId: row.asset_id as AssetId,
    generatedAt: new Date(String(row.generated_at)).toISOString(),
    direction: row.direction as DailyForecast["direction"],
    confidence: Number(row.confidence),
    referencePrice: Number(row.reference_price),
    lastPrice: Number(row.last_price),
    mfePct: Number(row.mfe_pct),
    maePct: Number(row.mae_pct),
    status: row.status === "closed" ? "closed" : "open",
    outcome: (row.outcome as ForecastOutcome | null) ?? null,
    outcomeAt: row.outcome_at ? new Date(String(row.outcome_at)).toISOString() : null,
    reasons: Array.isArray(reasons) ? reasons.map(String) : [],
    snapshot: {
      technicalSummary: String(snapshot.technicalSummary ?? ""),
      timeframes: Array.isArray(snapshot.timeframes) ? snapshot.timeframes : [],
      supports: Array.isArray(snapshot.supports) ? snapshot.supports.map(Number) : [],
      resistances: Array.isArray(snapshot.resistances) ? snapshot.resistances.map(Number) : [],
      setupState: String(snapshot.setupState ?? ""),
      signal: String(snapshot.signal ?? ""),
    },
  };
}

export async function recordDailyForecasts(sql: SqlQuery, assets: AssetAnalysis[], forecasts: DailyForecast[], generatedAt: string): Promise<void> {
  const date = dayKey(generatedAt);
  for (const forecast of forecasts) {
    const asset = assets.find((a) => a.id === forecast.assetId);
    if (!asset || !Number.isFinite(asset.price)) continue;
    const snapshot = {
      technicalSummary: asset.technicalSummary,
      timeframes: asset.timeframes.map((tf) => ({ timeframe: tf.timeframe, trend: tf.trend, structure: tf.structure, score: tf.score, sufficient: tf.sufficient })),
      supports: asset.supports,
      resistances: asset.resistances,
      setupState: asset.setupState,
      signal: asset.signal,
    };

    await sql.query(
      `insert into shadow_day_forecasts
       (forecast_date, asset_id, generated_at, direction, confidence, bullish_score, bearish_score,
        reasons, snapshot, reference_price, last_price, last_seen_at)
       values ($1::date, $2, $3::timestamptz, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $10, $3::timestamptz)
       on conflict (forecast_date, asset_id) do update set
         last_price = excluded.last_price,
         last_seen_at = excluded.last_seen_at,
         mfe_pct = greatest(shadow_day_forecasts.mfe_pct,
           case when shadow_day_forecasts.direction = 'subir' then greatest(0, ((excluded.last_price - shadow_day_forecasts.reference_price) / nullif(shadow_day_forecasts.reference_price, 0)) * 100)
                when shadow_day_forecasts.direction = 'bajar' then greatest(0, ((shadow_day_forecasts.reference_price - excluded.last_price) / nullif(shadow_day_forecasts.reference_price, 0)) * 100)
                else 0 end),
         mae_pct = greatest(shadow_day_forecasts.mae_pct,
           case when shadow_day_forecasts.direction = 'subir' then greatest(0, ((shadow_day_forecasts.reference_price - excluded.last_price) / nullif(shadow_day_forecasts.reference_price, 0)) * 100)
                when shadow_day_forecasts.direction = 'bajar' then greatest(0, ((excluded.last_price - shadow_day_forecasts.reference_price) / nullif(shadow_day_forecasts.reference_price, 0)) * 100)
                else greatest(0, abs(((excluded.last_price - shadow_day_forecasts.reference_price) / nullif(shadow_day_forecasts.reference_price, 0)) * 100)) end)`,
      [date, forecast.assetId, generatedAt, forecast.direction, forecast.confidence, forecast.bullishScore, forecast.bearishScore, JSON.stringify(forecast.reasons), JSON.stringify(snapshot), asset.price],
    );

    await sql.query(
      `with calculated as (
         select id,
           case
             when direction = 'neutro' and abs(((last_price-reference_price)/nullif(reference_price,0))*100) >= 0.5 then case when last_price > reference_price then 'acierto' else 'fallo' end
             when direction = 'neutro' then 'neutro'
             when direction = 'subir' and ((last_price-reference_price)/nullif(reference_price,0))*100 >= 0.5 then 'acierto'
             when direction = 'subir' and ((reference_price-last_price)/nullif(reference_price,0))*100 >= 0.5 then 'fallo'
             when direction = 'bajar' and ((reference_price-last_price)/nullif(reference_price,0))*100 >= 0.5 then 'acierto'
             when direction = 'bajar' and ((last_price-reference_price)/nullif(reference_price,0))*100 >= 0.5 then 'fallo'
             else 'en_curso'
           end as new_outcome
         from shadow_day_forecasts
         where forecast_date = $1::date and asset_id = $2
       )
       update shadow_day_forecasts s
       set outcome = c.new_outcome,
           status = case when c.new_outcome in ('acierto','fallo') then 'closed' else 'open' end,
           outcome_at = case when c.new_outcome in ('acierto','fallo') then coalesce(s.outcome_at, s.last_seen_at) else null end
       from calculated c
       where s.id = c.id`,
      [date, forecast.assetId],
    );
  }
}

export async function getDailyForecastTracking(sql: SqlQuery, date?: string): Promise<ForecastTracking[]> {
  const target = date ?? new Date().toISOString().slice(0, 10);
  try {
    const rows = await sql.query<Record<string, unknown>>(`select * from shadow_day_forecasts where forecast_date = $1::date order by asset_id`, [target]);
    return rows.map(rowToTracking);
  } catch {
    return [];
  }
}

export async function getDailyForecastHistory(sql: SqlQuery, limit = 120): Promise<ForecastTracking[]> {
  try {
    const rows = await sql.query<Record<string, unknown>>(`select * from shadow_day_forecasts order by forecast_date desc, asset_id limit $1`, [limit]);
    return rows.map(rowToTracking);
  } catch {
    return [];
  }
}

export function summariseForecasts(rows: ForecastTracking[]): ForecastStats {
  const closed = rows.filter((r) => r.outcome === "acierto" || r.outcome === "fallo");
  const correct = closed.filter((r) => r.outcome === "acierto").length;
  return {
    total: rows.length,
    closed: closed.length,
    correct,
    failed: closed.length - correct,
    open: rows.filter((r) => r.outcome === "en_curso" || r.outcome == null).length,
    winRate: closed.length ? Math.round((correct / closed.length) * 1000) / 10 : null,
  };
}
