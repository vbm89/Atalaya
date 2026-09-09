import type { SqlQuery } from "../watch/store";
import type { ShadowEpisode } from "./shadow-replay";
import { v1EntrySlot } from "./shadow-replay";

type Tf = "1m" | "5m";
const STEP: Record<Tf, number> = { "1m": 60, "5m": 300 };

export interface ShadowIntrabarMethod {
  method: "TRIGGER_1M" | "TRIGGER_5M";
  candidates: number;
  extra: number;
  overlap: number;
  earlierThanV1: number;
  tp1: number;
  tp2: number;
  sl: number;
  pending: number;
  decided: number;
  successPct: number | null;
  meanR: number | null;
  dataEpisodes: number;
}

export interface ShadowIntrabarReport {
  generatedAt: string;
  episodesAnalyzed: number;
  bars1m: number;
  bars5m: number;
  methods: ShadowIntrabarMethod[];
  limitations: string[];
}

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number | null }

function ratio(bars: Bar[], i: number): number | null {
  const values = bars.slice(Math.max(0, i - 20), i).map((b) => b.v).filter((v): v is number => v != null && v > 0);
  const v = bars[i]?.v;
  if (!values.length || v == null || v <= 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg > 0 ? v / avg : null;
}
function overlaps(b: Bar, low: number, high: number): boolean { return b.h >= low && b.l <= high; }
function third(b: Bar, upper: boolean): boolean {
  const range = b.h - b.l;
  if (range <= 0) return false;
  const p = (b.c - b.l) / range;
  return upper ? p >= 2 / 3 : p <= 1 / 3;
}
function failAccept(b: Bar, ep: ShadowEpisode): boolean {
  const c = ep.case;
  if (c.invalidation == null || !overlaps(b, c.zoneLow, c.zoneHigh)) return false;
  return c.direction === "sell" ? b.c < c.zoneLow && b.c < c.invalidation : b.c > c.zoneHigh && b.c > c.invalidation;
}
function reject(b: Bar, ep: ShadowEpisode): boolean {
  const c = ep.case;
  if (c.invalidation == null || !overlaps(b, c.zoneLow, c.zoneHigh)) return false;
  const mid = (c.zoneLow + c.zoneHigh) / 2;
  const depth = c.zoneHigh - c.zoneLow;
  if (c.direction === "sell") {
    const reached = b.h >= c.zoneLow + 0.5 * depth || b.h >= c.zoneHigh;
    return b.c <= mid && third(b, false) && b.c < b.o && b.c < c.invalidation && reached;
  }
  const reached = b.l <= c.zoneHigh - 0.5 * depth || b.l <= c.zoneLow;
  return b.c >= mid && third(b, true) && b.c > b.o && b.c > c.invalidation && reached;
}
function invalidated(b: Bar, ep: ShadowEpisode): boolean {
  const c = ep.case;
  return c.invalidation != null && (c.direction === "sell" ? b.h >= c.invalidation : b.l <= c.invalidation);
}

function candidate(ep: ShadowEpisode, tf: Tf, bars: Bar[], nowSec: number): { bar: Bar; index: number } | null {
  const c = ep.case;
  const usable = bars.filter((b) => b.t + STEP[tf] <= nowSec && b.t + STEP[tf] >= c.openedSlot).sort((a, b) => a.t - b.t);
  if (!usable.length) return null;
  let armed = c.openedState === "pending" || c.openedState === "entry";
  for (let i = 0; i < usable.length; i += 1) {
    const b = usable[i]!;
    if (invalidated(b, ep)) return null;
    if (!armed) {
      if (c.direction === "sell" && b.c < c.zoneLow) armed = true;
      if (c.direction === "buy" && b.c > c.zoneHigh) armed = true;
      continue;
    }
    const vr = ratio(usable, i);
    if ((failAccept(b, ep) || reject(b, ep)) && vr != null && vr >= 1) return { bar: b, index: i };
  }
  return null;
}

function resolve(ep: ShadowEpisode, tf: Tf, candidateBar: Bar, bars: Bar[], nowSec: number): "tp1" | "tp2" | "sl" | "pending" {
  const c = ep.case;
  const after = bars.filter((b) => b.t >= candidateBar.t && b.t + STEP[tf] <= nowSec).sort((a, b) => a.t - b.t);
  for (const b of after) {
    const sl = c.direction === "sell" ? b.h >= c.sl : b.l <= c.sl;
    const tp1 = c.direction === "sell" ? b.l <= c.tp1 : b.h >= c.tp1;
    const tp2 = c.tp2 != null && (c.direction === "sell" ? b.l <= c.tp2 : b.h >= c.tp2);
    if (sl) return "sl";
    if (tp1) return "tp1";
    if (tp2) return "tp2";
  }
  return "pending";
}

function outcomeR(ep: ShadowEpisode, outcome: string): number | null {
  const c = ep.case;
  const risk = Math.abs(c.entry - c.sl);
  if (!(risk > 0)) return null;
  if (outcome === "sl") return -1;
  if (outcome === "tp2" && c.tp2 != null) return Math.abs(c.tp2 - c.entry) / risk;
  if (outcome === "tp1") return Math.abs(c.tp1 - c.entry) / risk;
  return null;
}

export async function buildShadowIntrabarReport(sql: SqlQuery, episodes: readonly ShadowEpisode[]): Promise<ShadowIntrabarReport> {
  const nowSec = Math.floor(Date.now() / 1000);
  const assets = [...new Set(episodes.map((e) => e.case.assetId))];
  const rows = await sql.query<Record<string, unknown>>(
    `select asset_id, tf, t, o, h, l, c, v
       from shadow_intrabar_bars
      where asset_id = any($1::text[])
        and t >= extract(epoch from now() - interval '8 days')::bigint
      order by asset_id, tf, t`,
    [assets],
  );
  const grouped = new Map<string, Bar[]>();
  for (const r of rows) {
    const key = `${String(r.asset_id)}:${String(r.tf)}`;
    const list = grouped.get(key) ?? [];
    list.push({ t: Number(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: r.v == null ? null : Number(r.v) });
    grouped.set(key, list);
  }

  const methods = (["1m", "5m"] as const).map((tf): ShadowIntrabarMethod => {
    let candidates = 0, extra = 0, overlap = 0, earlierThanV1 = 0, tp1 = 0, tp2 = 0, sl = 0, pending = 0, dataEpisodes = 0;
    const rs: number[] = [];
    for (const ep of episodes) {
      const bars = grouped.get(`${ep.case.assetId}:${tf}`) ?? [];
      if (bars.length) dataEpisodes += 1;
      const found = candidate(ep, tf, bars, nowSec);
      if (!found) continue;
      candidates += 1;
      const base = v1EntrySlot(ep);
      if (base == null) extra += 1;
      else { overlap += 1; if (found.bar.t + STEP[tf] < base) earlierThanV1 += 1; }
      const outcome = resolve(ep, tf, found.bar, bars, nowSec);
      if (outcome === "tp1") tp1 += 1;
      else if (outcome === "tp2") tp2 += 1;
      else if (outcome === "sl") sl += 1;
      else pending += 1;
      const r = outcomeR(ep, outcome);
      if (r != null) rs.push(r);
    }
    const decided = tp1 + tp2 + sl;
    return { method: tf === "1m" ? "TRIGGER_1M" : "TRIGGER_5M", candidates, extra, overlap, earlierThanV1, tp1, tp2, sl, pending, decided, successPct: decided ? ((tp1 + tp2) / decided) * 100 : null, meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, dataEpisodes };
  });

  return {
    generatedAt: new Date().toISOString(),
    episodesAnalyzed: episodes.length,
    bars1m: assets.length ? Math.max(...assets.map((a) => grouped.get(`${a}:1m`)?.length ?? 0)) : 0,
    bars5m: assets.length ? Math.max(...assets.map((a) => grouped.get(`${a}:5m`)?.length ?? 0)) : 0,
    methods,
    limitations: [
      "La comparación 1M/5M usa la zona y niveles V1 congelados; no modifica V1.",
      "La captura intrabar empieza desde la implantación; no se inventa histórico 1M/5M que Atalaya no hubiera guardado.",
      "Solo se consideran velas intrabar cerradas y con volumen comparable disponible (ratio >= 1).",
      "Si una misma vela toca SL y TP, se contabiliza SL por criterio conservador.",
    ],
  };
}
