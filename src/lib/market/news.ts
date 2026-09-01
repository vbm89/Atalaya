import type { AssetId, AssetMeta, Importance, Impact, NewsItem } from "@/lib/trading/types";
import { fetchJson, fetchText } from "./http";

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]!.trim()) : null;
}

function parseRss(xml: string, assetId: AssetId): NewsItem[] {
  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1]!;
    const titleRaw = tag(block, "title");
    if (!titleRaw) continue;
    const split = titleRaw.split(" - ");
    const source = split.length > 1 ? split.pop()!.trim() : "Google News";
    const title = split.join(" - ").trim() || titleRaw;
    const url = tag(block, "link") ?? "";
    const pub = tag(block, "pubDate");
    const publishedAt = pub ? new Date(pub).toISOString() : null;
    items.push({
      id: `${assetId}-${url || title}`.slice(0, 180),
      title,
      source,
      url,
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
      assetId,
      summary: title,
      impact: classifyImpact(title),
      importance: classifyImportance(title),
      classifiedBy: "keywords",
    });
  }
  return items;
}

const POS =
  /\b(rally|surge|jumps?|soars?|beats?|record|bullish|alza|sube|dispara|rebote|mejora|acuerdo|tregua|rate cut|recorte de tipos)\b/i;
const NEG =
  /\b(plunge|slump|crash|falls?|misses|bearish|war|attack|sanctions?|cae|hunde|desplome|guerra|ataque|tensión|hawkish|inflaci[oó]n alta)\b/i;

function classifyImpact(title: string): Impact {
  const p = POS.test(title);
  const n = NEG.test(title);
  if (p && !n) return "positivo";
  if (n && !p) return "negativo";
  return "neutral";
}

function classifyImportance(title: string): Importance {
  if (
    /\b(fed|fomc|cpi|nfp|opec|etf|war|guerra|tipos de inter[eé]s|n[oó]minas|inventarios|pib|gdp)\b/i.test(
      title,
    )
  ) {
    return "alta";
  }
  if (/\b(pmi|inventory|inventario|earnings|previsi[oó]n|forecast)\b/i.test(title)) {
    return "media";
  }
  return "baja";
}

interface YahooSearch {
  news?: Array<{
    uuid?: string;
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: number;
  }>;
}

async function yahooNews(meta: AssetMeta): Promise<NewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(meta.yahooNewsQuery)}&newsCount=8&quotesCount=0`;
  const res = await fetchJson<YahooSearch>(url, { timeoutMs: 10000, retries: 1 });
  const news = res.data?.news ?? [];
  return news
    .filter((n) => n.title)
    .map((n) => ({
      id: n.uuid ?? `${meta.id}-${n.link ?? n.title}`,
      title: n.title!,
      source: n.publisher ?? "Yahoo Finance",
      url: n.link ?? "",
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : null,
      assetId: meta.id,
      summary: n.title!,
      impact: classifyImpact(n.title!),
      importance: classifyImportance(n.title!),
      classifiedBy: "keywords" as const,
    }));
}

export async function fetchAssetNews(meta: AssetMeta): Promise<{
  items: NewsItem[];
  note: string | null;
}> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(meta.newsQuery)}&hl=es&gl=ES&ceid=ES:es`;
  const rss = await fetchText(rssUrl, { timeoutMs: 10000, retries: 1 });
  let items: NewsItem[] = [];
  if (rss.ok) items = parseRss(rss.text, meta.id);

  if (items.length < 2) {
    const extra = await yahooNews(meta);
    const seen = new Set(items.map((i) => i.title.toLowerCase()));
    for (const e of extra) {
      if (!seen.has(e.title.toLowerCase())) items.push(e);
    }
  }

  const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000;
  const fresh = items.filter((i) => {
    if (!i.publishedAt) return true;
    const t = Date.parse(i.publishedAt);
    return Number.isNaN(t) || t >= cutoff;
  });

  const uniq: NewsItem[] = [];
  const titles = new Set<string>();
  for (const n of fresh) {
    const key = n.title.toLowerCase().slice(0, 80);
    if (titles.has(key)) continue;
    titles.add(key);
    uniq.push(n);
    if (uniq.length >= 5) break;
  }

  if (uniq.length === 0) {
    return {
      items: [],
      note: "No hay titulares recientes verificables para este activo.",
    };
  }
  return { items: uniq, note: null };
}

export function applyModelImpacts(
  items: NewsItem[],
  classified: Array<{
    title: string;
    impact: Impact;
    importance: Importance;
    summary?: string;
  }>,
): NewsItem[] {
  return items.map((item) => {
    const hit = classified.find(
      (c) =>
        c.title.toLowerCase().includes(item.title.slice(0, 40).toLowerCase()) ||
        item.title.toLowerCase().includes(c.title.slice(0, 40).toLowerCase()),
    );
    if (!hit) return item;
    return {
      ...item,
      impact: hit.impact,
      importance: hit.importance,
      summary: hit.summary || item.summary,
      classifiedBy: "model",
    };
  });
}
