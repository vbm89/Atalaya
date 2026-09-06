import type { AssetAnalysis } from "@/lib/trading/types";
import { forecastAll } from "@/lib/learn/day-forecast";

const LABELS = {
  XAUUSD: "Oro",
  BTCUSD: "Bitcoin",
  US100: "US100",
  WTI: "Petróleo",
} as const;

export function DayForecastPanel({ assets }: { assets: AssetAnalysis[] }) {
  const forecasts = forecastAll(assets);

  return (
    <section className="space-y-3" data-day-forecast>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Previsión del día</h2>
        <p className="mt-0.5 text-sm text-subtle">Shadow V2 · lectura direccional experimental</p>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]">
        {forecasts.map((f, index) => (
          <div key={f.assetId} className={`px-4 py-3 ${index ? "border-t border-border/70" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.assetId}</p>
                <p className="text-xs text-subtle">{LABELS[f.assetId]}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${f.direction === "subir" ? "text-buy" : f.direction === "bajar" ? "text-sell" : "text-muted"}`}>
                  {f.direction === "subir" ? "SUBIR" : f.direction === "bajar" ? "BAJAR" : "NEUTRO"}
                </p>
                <p className="text-[11px] text-subtle">Confianza técnica {f.confidence}%</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {f.reasons.map((reason) => (
                <span key={reason} className="rounded-full bg-surface px-2 py-1 text-[11px] text-subtle">
                  {reason}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-subtle">
        Experimental: esta lectura no genera ENTRADAS ni modifica V1. M15 sigue siendo el trigger de V1.
        La confianza todavía no está calibrada con TRAIN/TEST.
      </p>
    </section>
  );
}
