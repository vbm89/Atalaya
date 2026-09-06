import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
/**
 * HOME Más screen. Research items (Aprendizaje, Estado del laboratorio,
 * Previsión del día) are rows here — they must not replace the HOME shell.
 * See docs/HOME_SHELL.md.
 */
import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  FlaskConical,
  GraduationCap,
  Info,
  Settings,
  Activity,
  Compass,
  ArrowLeft,
} from "lucide-react";
import { AtalayaMark } from "./marks";
import { cn } from "@/lib/utils";
import { getMarketAnalysis } from "@/lib/market/analysis.fn";
import { getDailyForecastTracking } from "@/lib/watch/watch.fn";
import { forecastAll, type DailyForecast } from "@/lib/learn/day-forecast";
import type { AssetAnalysis } from "@/lib/trading/types";

const LABELS: Record<string, string> = {
  XAUUSD: "Oro",
  BTCUSD: "Bitcoin",
  US100: "US100",
  WTI: "Petróleo",
};

export function MorePanel({
  onInfo,
  onHistory,
  onLearn,
  onAlerts,
  onCalendar,
  onSettings,
  onStatus,
  onLab,
  statusHint,
}: {
  onInfo: () => void;
  onHistory: () => void;
  onLearn: () => void;
  onAlerts: () => void;
  onCalendar: () => void;
  onSettings: () => void;
  onStatus: () => void;
  onLab: () => void;
  statusHint: string;
}) {
  const forecast = useQuery({
    queryKey: ["day-forecast"],
    queryFn: () => getMarketAnalysis({ data: { force: false } }),
    staleTime: 45_000,
    retry: 1,
  });
  const forecasts = forecast.data ? forecastAll(forecast.data.assets, forecast.data.generatedAt) : [];
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-more-panel>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Más</h2>
        <p className="mt-0.5 text-sm text-subtle">Configuración y sistema</p>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]">
        <MoreRow icon={<Info className="size-4 text-cyan" />} title="Información" hint="Sobre Atalaya" onClick={onInfo} />
        <MoreRow icon={<BookOpen className="size-4 text-muted" />} title="Historial" hint="Episodios registrados" onClick={onHistory} />
        <MoreRow icon={<GraduationCap className="size-4 text-muted" />} title="Aprendizaje" hint="Shadow y análisis" onClick={onLearn} />
        <MoreRow icon={<Compass className="size-4 text-cyan" />} title="Previsión del día" hint="Sesgo diario experimental" />
        <MoreRow icon={<FlaskConical className="size-4 text-muted" />} title="Estado del laboratorio" hint="Captura e integridad" onClick={onLab} />
        <MoreRow icon={<Bell className="size-4 text-muted" />} title="Alertas" hint="Notificaciones" onClick={onAlerts} />
        <MoreRow icon={<CalendarDays className="size-4 text-muted" />} title="Calendario" hint="Eventos de mercado" onClick={onCalendar} />
        <MoreRow icon={<Settings className="size-4 text-muted" />} title="Configuración" hint="Preferencias" onClick={onSettings} />
        <MoreRow icon={<Activity className="size-4 text-buy" />} title="Estado del sistema" hint={statusHint} onClick={onStatus} last />
      </div>
      {selectedAsset && forecast.data ? (
        <DayForecastDetail
          asset={forecast.data.assets.find((a) => a.id === selectedAsset) ?? null}
          forecast={forecasts.find((f) => f.assetId === selectedAsset) ?? null}
          onBack={() => setSelectedAsset(null)}
        />
      ) : (
        <DayForecastSummary forecasts={forecasts} loading={forecast.isLoading} onSelect={setSelectedAsset} />
      )}
      <div className="flex items-center justify-between rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <div className="flex items-center gap-2 text-cyan">
          <AtalayaMark className="size-6" />
          <div>
            <p className="text-sm font-semibold tracking-tight">Atalaya V1</p>
            <p className="text-[11px] text-subtle">{statusHint}</p>
          </div>
        </div>
        <p className="font-mono text-[11px] tabular text-subtle">V1</p>
      </div>
    </div>
  );
}

function DayForecastSummary({
  forecasts,
  loading,
  onSelect,
}: {
  forecasts: ReturnType<typeof forecastAll>;
  loading: boolean;
  onSelect: (assetId: string) => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]" data-day-forecast>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Previsión del día</h3>
          <p className="mt-0.5 text-[11px] text-subtle">Shadow V2 · lectura experimental</p>
        </div>
        <Compass className="size-4 text-cyan" />
      </div>
      {loading && !forecasts.length ? (
        <p className="mt-3 text-xs text-subtle">Calculando…</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {forecasts.map((f) => (
            <button key={f.assetId} type="button" onClick={() => onSelect(f.assetId)} className="rounded-[var(--radius-md)] bg-surface px-3 py-2 text-left transition-opacity active:opacity-70" aria-label={`Abrir previsión de ${f.assetId}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{f.assetId}</span>
                <span className={`text-[11px] font-bold ${f.direction === "subir" ? "text-buy" : f.direction === "bajar" ? "text-sell" : "text-muted"}`}>
                  {f.direction === "subir" ? "SUBIR" : f.direction === "bajar" ? "BAJAR" : "NEUTRO"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-subtle">Confianza técnica {f.confidence}%</p>
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-subtle">No genera ENTRADAS ni modifica V1. La confianza aún no está calibrada con TRAIN/TEST.</p>
    </section>
  );
}

function DayForecastDetail({ asset, forecast, onBack }: { asset: AssetAnalysis | null; forecast: DailyForecast | null; onBack: () => void }) {
  const tracking = useQuery({ queryKey: ["day-forecast-tracking", asset?.id], queryFn: () => getDailyForecastTracking(), enabled: Boolean(asset), staleTime: 30_000, retry: 1 });
  if (!asset || !forecast) return null;

  const directionLabel = forecast.direction === "subir" ? "SUBIR" : forecast.direction === "bajar" ? "BAJAR" : "NEUTRO";
  const directionClass = forecast.direction === "subir" ? "text-buy" : forecast.direction === "bajar" ? "text-sell" : "text-muted";
  const tracked = tracking.data?.find((row) => row.assetId === asset.id) ?? null;
  const frozenV1 = tracked?.snapshot.signal ? tracked.snapshot.signal.toUpperCase() : "NO DISPONIBLE";
  const currentMove = tracked ? ((tracked.lastPrice - tracked.referencePrice) / tracked.referencePrice) * 100 : null;

  return (
    <section className="space-y-3" data-day-forecast-detail>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs font-medium text-subtle"><ArrowLeft className="size-3.5" /> Volver a Previsión del día</button>

      <div className="rounded-[var(--radius-lg)] bg-elevated px-4 py-4 shadow-[var(--shadow-border)]">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] text-subtle">{LABELS[asset.id] ?? asset.name}</p><h3 className="text-xl font-semibold tracking-tight">{asset.id}</h3></div>
          <div className="text-right"><p className={`text-lg font-bold ${directionClass}`}>{directionLabel}</p><p className="text-[11px] text-subtle">Confianza {forecast.confidence}%</p></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center"><Metric label="Sesgo alcista" value={`${forecast.bullishScore}%`} /><Metric label="Sesgo bajista" value={`${forecast.bearishScore}%`} /></div>
      </div>

      <DetailSection title="Seguimiento de la previsión">
        {tracked ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Estado" value={tracked.outcome === "acierto" ? "ACIERTO" : tracked.outcome === "fallo" ? "FALLO" : "EN CURSO"} />
              <Metric label="Movimiento" value={currentMove == null ? "—" : `${currentMove >= 0 ? "+" : ""}${currentMove.toFixed(2)}%`} />
              <Metric label="MFE" value={`${tracked.mfePct >= 0 ? "+" : ""}${tracked.mfePct.toFixed(2)}%`} />
              <Metric label="MAE" value={`-${Math.max(0, tracked.maePct).toFixed(2)}%`} />
            </div>
            <p className="text-[11px] text-subtle">Previsión congelada: {new Date(tracked.generatedAt).toLocaleString("es-ES")}</p>
            <p className="text-[11px] text-subtle">Precio de referencia: {formatPrice(tracked.referencePrice)} · último observado: {formatPrice(tracked.lastPrice)}</p>
            {tracked.outcome === "acierto" || tracked.outcome === "fallo" ? (
              <div className="rounded-[var(--radius-md)] bg-surface px-3 py-2 text-xs leading-relaxed">
                <span className="font-semibold">Autopsia:</span> {tracked.outcome === "acierto" ? `El precio terminó moviéndose a favor del sesgo ${tracked.direction}.` : `El precio se movió en contra del sesgo ${tracked.direction}. Revisar qué temporalidad perdió la confluencia.`}
              </div>
            ) : <p className="text-[11px] text-subtle">La autopsia aparecerá al cerrar la observación. No se ajusta la fórmula automáticamente.</p>}
          </div>
        ) : <p className="text-sm text-subtle">Aún no hay fotografía persistida para hoy. La primera ejecución de análisis la registra automáticamente.</p>}
      </DetailSection>

      <DetailSection title="Shadow vs V1">
        <div className="grid grid-cols-2 gap-2"><Metric label="Shadow" value={directionLabel} /><Metric label="V1 congelada" value={frozenV1} /></div>
        <p className="mt-2 text-xs leading-relaxed text-subtle">Esta comparación es descriptiva: no cambia V1 ni convierte Shadow en una señal operativa.</p>
      </DetailSection>

      <DetailSection title="Escenario del día">
        <p className="text-sm leading-relaxed">{asset.technicalSummary}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{forecast.reasons.map((reason) => <Tag key={reason}>{reason}</Tag>)}</div>
      </DetailSection>

      <DetailSection title="Confluencia por temporalidad">
        <div className="space-y-2">{asset.timeframes.map((tf) => (
          <div key={tf.timeframe} className="rounded-[var(--radius-md)] bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{tf.timeframe.toUpperCase()}</span><span className="text-xs font-medium">{tf.trend}</span></div>
            <p className="mt-1 text-[11px] text-subtle">{tf.structure}</p>
            <p className="mt-1 text-[10px] text-subtle">Score {tf.score} · {tf.barCount} velas{tf.sufficient ? "" : " · datos insuficientes"}</p>
            {tf.notes.length > 0 && <p className="mt-1 text-[10px] text-subtle">{tf.notes.join(" · ")}</p>}
          </div>
        ))}</div>
      </DetailSection>

      <DetailSection title="Niveles y contexto">
        <div className="grid grid-cols-2 gap-2"><Metric label="Precio" value={formatPrice(asset.price)} /><Metric label="Cambio día" value={asset.dayChangePct == null ? "—" : `${asset.dayChangePct >= 0 ? "+" : ""}${asset.dayChangePct.toFixed(2)}%`} /><Metric label="Volatilidad" value={asset.volatility} /><Metric label="ATR %" value={asset.atrPct == null ? "—" : `${asset.atrPct.toFixed(2)}%`} /></div>
        <div className="mt-2 grid grid-cols-2 gap-2"><LevelList title="Soportes" values={asset.supports} /><LevelList title="Resistencias" values={asset.resistances} /></div>
      </DetailSection>

      <DetailSection title="Qué tiene que pasar / invalidación">
        {asset.setup ? <div className="space-y-1.5 text-xs"><p><span className="text-subtle">Estado:</span> {asset.setup.state.toUpperCase()}</p><p><span className="text-subtle">Dirección:</span> {asset.setup.direction === "buy" ? "COMPRA" : "VENTA"}</p><p><span className="text-subtle">Zona:</span> {formatPrice(asset.setup.zone.low)} – {formatPrice(asset.setup.zone.high)}</p><p><span className="text-subtle">Invalidación:</span> {formatPrice(asset.setup.invalidation)}</p><p><span className="text-subtle">Falta para entrada:</span> {asset.setup.missingForEntry ?? "Nada adicional indicado"}</p>{asset.setup.warnings.length > 0 && <p className="text-subtle">⚠ {asset.setup.warnings.join(" · ")}</p>}</div> : <p className="text-sm text-subtle">No hay setup activo. {asset.waitReason ?? "No existe confirmación suficiente ahora mismo."}</p>}
      </DetailSection>

      <DetailSection title="V1 ahora mismo">
        <div className="grid grid-cols-2 gap-2"><Metric label="Señal" value={asset.signal.toUpperCase()} /><Metric label="Estado" value={asset.setupState.toUpperCase()} /><Metric label="Confianza V1" value={`${asset.confidence}%`} /><Metric label="Operable" value={asset.wouldTrade === "yes" ? "SÍ" : asset.wouldTrade === "wait" ? "ESPERAR" : "NO"} /></div>
        <p className="mt-2 text-xs leading-relaxed text-subtle">{asset.wouldTradeReason}</p>
      </DetailSection>

      <DetailSection title="Noticias">
        {asset.news.length ? <div className="space-y-2">{asset.news.slice(0, 6).map((news) => <div key={news.id} className="rounded-[var(--radius-md)] bg-surface px-3 py-2"><p className="text-xs font-medium">{news.title}</p><p className="mt-1 text-[10px] text-subtle">{news.source} · {news.impact} · importancia {news.importance}</p>{news.summary ? <p className="mt-1 text-[11px] leading-relaxed text-subtle">{news.summary}</p> : null}</div>)}</div> : <p className="text-sm text-subtle">Sin noticias relevantes disponibles.</p>}
      </DetailSection>

      <p className="px-1 text-[10px] leading-relaxed text-subtle">Shadow V2 · lectura experimental. No genera ENTRADAS ni modifica V1. La confianza no está calibrada con TRAIN/TEST.</p>
    </section>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"><h4 className="text-sm font-semibold">{title}</h4><div className="mt-2">{children}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[var(--radius-md)] bg-surface px-3 py-2"><p className="text-[10px] text-subtle">{label}</p><p className="mt-0.5 text-xs font-semibold">{value}</p></div>;
}

function LevelList({ title, values }: { title: string; values: number[] }) {
  return <div className="rounded-[var(--radius-md)] bg-surface px-3 py-2"><p className="text-[10px] text-subtle">{title}</p><p className="mt-1 text-xs font-mono">{values.length ? values.map(formatPrice).join(" · ") : "—"}</p></div>;
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full bg-surface px-2 py-1 text-[11px] text-subtle">{children}</span>;
}

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

function MoreRow({ icon, title, hint, onClick, last }: { icon: ReactNode; title: string; hint: string; onClick?: () => void; last?: boolean }) {
  return <button type="button" onClick={onClick} disabled={!onClick} className={cn("atalaya-more-row", !last && "border-b border-border/70", !onClick && "cursor-default opacity-90")}><span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-surface">{icon}</span><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-subtle">{hint}</span></span>{onClick ? <ChevronRight className="size-4 text-subtle" /> : null}</button>;
}
