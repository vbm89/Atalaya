import type { ReactNode } from "react";
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
} from "lucide-react";
import { AtalayaMark } from "./marks";
import { cn } from "@/lib/utils";

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
        <MoreRow icon={<FlaskConical className="size-4 text-muted" />} title="Estado del laboratorio" hint="Captura e integridad" onClick={onLab} />
        <MoreRow icon={<Bell className="size-4 text-muted" />} title="Alertas" hint="Notificaciones" onClick={onAlerts} />
        <MoreRow icon={<CalendarDays className="size-4 text-muted" />} title="Calendario" hint="Eventos de mercado" onClick={onCalendar} />
        <MoreRow icon={<Settings className="size-4 text-muted" />} title="Configuración" hint="Preferencias" onClick={onSettings} />
        <MoreRow icon={<Activity className="size-4 text-buy" />} title="Estado del sistema" hint={statusHint} onClick={onStatus} last />
      </div>
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
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("atalaya-more-row", !last && "border-b border-border/70")}
    >
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-surface">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-subtle">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-subtle" />
    </button>
  );
}
