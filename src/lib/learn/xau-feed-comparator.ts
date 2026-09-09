import type { SqlQuery } from "../watch/store";

type FeedQuote = {
  source: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  latencyMs: number | null;
  status: "ok" | "unavailable" | "not_configured";
  error?: string;
};

export type XauFeedComparator = {
  generatedAt: string;
  quotes: FeedQuote[];
  history24h: Array<{ source: string; samples: number; avgMid: number | null; minMid: number | null; maxMid: number | null }>;
  history7d: Array<{ source: string; samples: number; avgMid: number | null; minMid: number | null; maxMid: number | null }>;
  mt4: { status: "not_connected"; note: string };
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function timed(source: string, fn: () => Promise<{ bid: number | null; ask: number | null }>): Promise<FeedQuote> {
  const started = Date.now();
  try {
    const q = await fn();
    const bid = num(q.bid);
    const ask = num(q.ask);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
    if (mid == null) throw new Error("sin precio válido");
    return { source, bid, ask, mid, latencyMs: Date.now() - started, status: "ok" };
  } catch (err) {
    return { source, bid: null, ask: null, mid: null, latencyMs: Date.now() - started, status: "unavailable", error: err instanceof Error ? err.message : "error" };
  }
}

async function goldApi(): Promise<{ bid: number | null; ask: number | null }> {
  const raw = (await json("https://api.gold-api.com/price/XAU")) as { price?: unknown };
  const price = num(raw.price);
  return { bid: price, ask: price };
}

async function bitget(): Promise<{ bid: number | null; ask: number | null }> {
  const raw = (await json("https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=XAUUSDT")) as { data?: Array<{ bidPr?: unknown; askPr?: unknown; lastPr?: unknown }> };
  const row = raw.data?.[0];
  const last = num(row?.lastPr);
  return { bid: num(row?.bidPr) ?? last, ask: num(row?.askPr) ?? last };
}

async function twelve(): Promise<{ bid: number | null; ask: number | null }> {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!key) throw Object.assign(new Error("TWELVE_DATA_API_KEY missing"), { code: "NOT_CONFIGURED" });
  const raw = (await json(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${encodeURIComponent(key)}`)) as { price?: unknown };
  const price = num(raw.price);
  return { bid: price, ask: price };
}

async function oanda(): Promise<{ bid: number | null; ask: number | null }> {
  const token = process.env.OANDA_API_TOKEN?.trim();
  const account = process.env.OANDA_ACCOUNT_ID?.trim();
  if (!token || !account) throw Object.assign(new Error("OANDA_API_TOKEN/OANDA_ACCOUNT_ID missing"), { code: "NOT_CONFIGURED" });
  const host = (process.env.OANDA_API_HOST?.trim() || "https://api-fxtrade.oanda.com").replace(/\/$/, "");
  const raw = (await json(`${host}/v3/accounts/${encodeURIComponent(account)}/pricing?instruments=XAU_USD`, {
    headers: { Authorization: `Bearer ${token}` },
  })) as { prices?: Array<{ bids?: Array<{ price?: unknown }>; asks?: Array<{ price?: unknown }> }> };
  const p = raw.prices?.[0];
  return { bid: num(p?.bids?.[0]?.price), ask: num(p?.asks?.[0]?.price) };
}

function normalizeNotConfigured(q: FeedQuote): FeedQuote {
  if (q.status === "unavailable" && /missing/i.test(q.error ?? "")) {
    return { ...q, status: "not_configured", error: undefined };
  }
  return q;
}

export async function captureXauFeedComparator(sql: SqlQuery): Promise<XauFeedComparator> {
  const quotes = await Promise.all([
    timed("GoldAPI", goldApi),
    timed("Bitget XAUUSDT", bitget),
    timed("Twelve Data", twelve),
    timed("OANDA", oanda),
  ]).then((rows) => rows.map(normalizeNotConfigured));

  for (const q of quotes) {
    if (q.mid == null) continue;
    await sql.query(
      `insert into shadow_xau_feed_samples (source,bid,ask,mid,latency_ms) values ($1,$2,$3,$4,$5)`,
      [q.source, q.bid, q.ask, q.mid, q.latencyMs],
    );
  }

  await sql.query(`delete from shadow_xau_feed_samples where captured_at < now() - interval '7 days'`);
  return buildXauFeedComparator(sql, quotes);
}

async function history(sql: SqlQuery, interval: "24 hours" | "7 days") {
  const rows = await sql.query<{ source: string; samples: number; avg_mid: number | null; min_mid: number | null; max_mid: number | null }>(
    `select source, count(*)::int as samples, avg(mid)::float8 as avg_mid, min(mid)::float8 as min_mid, max(mid)::float8 as max_mid
       from shadow_xau_feed_samples where captured_at >= now() - $1::interval group by source order by source`,
    [interval],
  );
  return rows.map((r) => ({ source: r.source, samples: r.samples, avgMid: r.avg_mid, minMid: r.min_mid, maxMid: r.max_mid }));
}

export async function buildXauFeedComparator(sql: SqlQuery, quotes?: FeedQuote[]): Promise<XauFeedComparator> {
  return {
    generatedAt: new Date().toISOString(),
    quotes: quotes ?? [],
    history24h: await history(sql, "24 hours"),
    history7d: await history(sql, "7 days"),
    mt4: {
      status: "not_connected",
      note: "MT4/T4Trade todavía no está conectado a Atalaya. No se inventa una referencia de broker.",
    },
  };
}
