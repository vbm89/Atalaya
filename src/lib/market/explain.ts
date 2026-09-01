import type {
  AnalysisSnapshot,
  AssetAnalysis,
  Impact,
  Importance,
  NewsItem,
} from "@/lib/trading/types";
import { applyModelImpacts } from "./news";

interface ModelNews {
  assetId: string;
  title: string;
  impact: Impact;
  importance: Importance;
  summary: string;
}

interface ModelAsset {
  assetId: string;
  wouldTradeReason?: string;
  technicalCommentary?: string;
}

interface ModelPayload {
  news?: ModelNews[];
  assets?: ModelAsset[];
}

export async function enrichWithModel(
  snapshot: AnalysisSnapshot,
): Promise<AnalysisSnapshot> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return snapshot;

  const compact = snapshot.assets.map((a) => ({
    id: a.id,
    price: a.price,
    dayChangePct: a.dayChangePct,
    trend: a.trend,
    signal: a.signal,
    confidence: a.confidence,
    technicalSummary: a.technicalSummary,
    waitReason: a.waitReason,
    wouldTrade: a.wouldTrade,
    wouldTradeReason: a.wouldTradeReason,
    news: a.news.map((n) => ({
      title: n.title,
      source: n.source,
      publishedAt: n.publishedAt,
    })),
  }));

  const body = {
    model: "grok-4.5",
    max_tokens: 900,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Eres un analista técnico. NO inventes precios, noticias ni datos. Usa SOLO el JSON que recibes. Responde JSON.",
      },
      {
        role: "user",
        content: `Clasifica el impacto de cada titular real (positivo/negativo/neutral para el precio del activo) y reescribe wouldTradeReason en español (máx 4 frases) sin cambiar la decisión. Si un titular no es claramente direccional, impacto=neutral.
Datos:
${JSON.stringify({ generatedAt: snapshot.generatedAt, assets: compact })}
Devuelve: {"news":[{"assetId":"XAUUSD","title":"...","impact":"positivo|negativo|neutral","importance":"alta|media|baja","summary":"una frase"}],"assets":[{"assetId":"XAUUSD","wouldTradeReason":"...","technicalCommentary":"una frase"}]}`,
      },
    ],
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18000);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!res.ok) return snapshot;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content;
    if (!text) return snapshot;
    const parsed = JSON.parse(extractJson(text)) as ModelPayload;
    return mergeModel(snapshot, parsed);
  } catch {
    return snapshot;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function mergeModel(
  snapshot: AnalysisSnapshot,
  payload: ModelPayload,
): AnalysisSnapshot {
  const newsByAsset = new Map<string, ModelNews[]>();
  for (const n of payload.news ?? []) {
    const list = newsByAsset.get(n.assetId) ?? [];
    list.push(n);
    newsByAsset.set(n.assetId, list);
  }
  const assetNotes = new Map(
    (payload.assets ?? []).map((a) => [a.assetId, a] as const),
  );

  const assets: AssetAnalysis[] = snapshot.assets.map((asset) => {
    const classified = (newsByAsset.get(asset.id) ?? []).map((n) => ({
      title: n.title,
      impact: n.impact,
      importance: n.importance,
      summary: n.summary,
    }));
    const news: NewsItem[] = classified.length
      ? applyModelImpacts(asset.news, classified)
      : asset.news;
    const note = assetNotes.get(asset.id);
    return {
      ...asset,
      news,
      wouldTradeReason: note?.wouldTradeReason || asset.wouldTradeReason,
      technicalSummary: note?.technicalCommentary
        ? `${asset.technicalSummary}. ${note.technicalCommentary}`
        : asset.technicalSummary,
    };
  });

  return { ...snapshot, assets };
}
