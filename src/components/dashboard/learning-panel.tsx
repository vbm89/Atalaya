import { BrainCircuit, ShieldCheck } from "lucide-react";

export function LearningPanel() {
  return (
    <section className="mt-4 space-y-3 atalaya-markets-span" data-learning-panel>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Aprendizaje</h2>
        <p className="mt-0.5 text-sm text-subtle">Atalaya aprende de las señales de papel cerradas.</p>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-4 shadow-[var(--shadow-border)]">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface text-cyan">
            <BrainCircuit className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">RECOPILANDO RESULTADOS</p>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              El bot registra las señales COMPRA y VENTA, sus niveles y el resultado posterior.
              Las reglas no se cambian automáticamente por una operación individual.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-4 shadow-[var(--shadow-border)]">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface text-cyan">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">SIN EXPERIMENTOS EN PANTALLA</p>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              Los laboratorios, backtests y análisis internos quedan fuera de la interfaz operativa.
              Aquí solo se mostrará aprendizaje basado en resultados reales del bot PAPER.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
