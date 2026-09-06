import type { ReactNode } from "react";
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
} from "lucide-react";
import { AtalayaMark } from "./marks";
import { cn } from "@/lib/utils";
import { getMarketAnalysis } from "@/lib/market/analysis.fn";
import { forecastAll } from "@/lib/learn/day-forecast";

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
      <DayForecastSummary forecasts={forecasts} loading={forecast.isLoading} />
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
}: {
  forecasts: ReturnType<typeof forecastAll>;
  loading: boolean;
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
            <div key={f.assetId} className="rounded-[var(--radius-md)] bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{f.assetId}</span>
                <span className={`text-[11px] font-bold ${f.direction === "subir" ? "text-buy" : f.direction === "bajar" ? "text-sell" : "text-muted"}`}>
                  {f.direction === "subir" ? "SUBIR" : f.direction === "bajar" ? "BAJAR" : "NEUTRO"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-subtle">Confianza técnica {f.confidence}%</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-subtle">
        No genera ENTRADAS ni modifica V1. La confianza aún no está calibrada con TRAIN/TEST.
      </p>
    </section>
  );
}

function MoreRow({
  icon,
  title,
  hint,
  onClick,
  last,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick?: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn("atalaya-more-row", !last && "border-b border-border/70", !onClick && "cursor-default opacity-90")}
    >
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-surface">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-subtle">{hint}</span>
      </span>
      {onClick ? <ChevronRight className="size-4 text-subtle" /> : null}
    </button>
  );
}
