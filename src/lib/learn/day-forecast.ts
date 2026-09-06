import type { AssetAnalysis, AssetId, Trend } from "@/lib/trading/types";

export type DailyForecastDirection = "subir" | "bajar" | "neutro";

export interface DailyForecast {
  assetId: AssetId;
  direction: DailyForecastDirection;
  confidence: number;
  bullishScore: number;
  bearishScore: number;
  reasons: string[];
  generatedAt: string;
  methodology: "shadow-experimental";
}

const TF_WEIGHT: Record<string, number> = { "4h": 0.4, "1h": 0.3, "15m": 0.2, "5m": 0.1 };

function trendValue(trend: Trend): number {
  if (trend === "alcista") return 1;
  if (trend === "bajista") return -1;
  return 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Research-only daily directional read. It never creates or changes V1 signals.
 * The score is deliberately transparent and is NOT a calibrated probability yet.
 * TRAIN/TEST calibration belongs to a later Shadow phase.
 */
export function forecastDay(asset: AssetAnalysis, generatedAt = new Date().toISOString()): DailyForecast {
  let score = 0;
  const reasons: string[] = [];

  for (const tf of asset.timeframes) {
    const weight = TF_WEIGHT[tf.timeframe] ?? 0;
    if (!weight || !tf.sufficient) continue;
    score += trendValue(tf.trend) * weight;
    if (tf.trend !== "lateral") {
      reasons.push(`${tf.timeframe.toUpperCase()}: ${tf.trend}`);
    }
    if (Number.isFinite(tf.score)) score += clamp(tf.score, -100, 100) * weight * 0.002;
  }

  if (asset.dayChangePct != null && Number.isFinite(asset.dayChangePct)) {
    score += clamp(asset.dayChangePct, -3, 3) * 0.08;
    if (Math.abs(asset.dayChangePct) >= 0.35) {
      reasons.push(`Sesión: ${asset.dayChangePct >= 0 ? "+" : ""}${asset.dayChangePct.toFixed(2)}%`);
    }
  }

  const positiveNews = asset.news.filter((n) => n.impact === "positivo" && n.importance !== "baja").length;
  const negativeNews = asset.news.filter((n) => n.impact === "negativo" && n.importance !== "baja").length;
  if (positiveNews || negativeNews) {
    score += clamp(positiveNews - negativeNews, -2, 2) * 0.08;
    if (positiveNews !== negativeNews) {
      reasons.push(`Noticias: ${positiveNews > negativeNews ? "sesgo positivo" : "sesgo negativo"}`);
    }
  }

  const direction: DailyForecastDirection = score >= 0.18 ? "subir" : score <= -0.18 ? "bajar" : "neutro";
  const confidence = direction === "neutro" ? clamp(50 + Math.abs(score) * 20, 50, 60) : clamp(50 + Math.abs(score) * 42, 51, 88);
  const finalReasons = reasons.slice(0, 4);
  if (!finalReasons.length) finalReasons.push("Sin ventaja direccional suficiente en los datos disponibles");

  return {
    assetId: asset.id,
    direction,
    confidence: Math.round(confidence),
    bullishScore: Math.round(clamp((score + 1) * 50, 0, 100)),
    bearishScore: Math.round(clamp((1 - score) * 50, 0, 100)),
    reasons: finalReasons,
    generatedAt,
    methodology: "shadow-experimental",
  };
}

export function forecastAll(assets: AssetAnalysis[], generatedAt = new Date().toISOString()): DailyForecast[] {
  return assets.map((asset) => forecastDay(asset, generatedAt));
}
