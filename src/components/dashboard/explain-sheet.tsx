import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckItem, ExplainView } from "@/lib/learn/explain";
import { GLOSSARY, type GlossaryEntry } from "@/lib/learn/glossary";

export function ExplainSheet({
  view,
  open,
  onClose,
  onViewChart,
}: {
  view: ExplainView | null;
  open: boolean;
  onClose: () => void;
  onViewChart?: () => void;
}) {
  const [glossary, setGlossary] = useState(false);

  useEffect(() => {
    if (!open) setGlossary(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (glossary) setGlossary(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, glossary, onClose]);

  if (!open || !view) return null;

  return (
    <div
      className="atalaya-explain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atalaya-explain-title"
      data-explain-state={view.state}
    >
      <button type="button" className="atalaya-explain-backdrop" aria-label="Cerrar explicación" onClick={onClose} />
      <div className="atalaya-explain-panel">
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wider text-muted uppercase">¿Por qué Atalaya está aquí?</p>
            <h2 id="atalaya-explain-title" className={cn("text-lg font-semibold tracking-tight", tone(view.state))}>
              {view.stateLabel}
            </h2>
            <p className="mt-0.5 text-xs text-subtle">Condiciones que han llevado a esta señal</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-elevated text-muted"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {glossary ? (
            <GlossaryList onBack={() => setGlossary(false)} />
          ) : (
            <ExplainBody view={view} onViewChart={onViewChart} onGlossary={() => setGlossary(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

export function ExplainInline({ view }: { view: ExplainView }) {
  return (
    <div data-explain-inline data-explain-state={view.state}>
      <p className="text-base font-semibold tracking-tight">¿Por qué Atalaya está aquí?</p>
      <p className="mt-0.5 text-xs text-subtle">Condiciones que han llevado a esta señal</p>
      <ExplainBody view={view} compact />
    </div>
  );
}

function ExplainBody({
  view,
  onViewChart,
  onGlossary,
  compact,
}: {
  view: ExplainView;
  onViewChart?: () => void;
  onGlossary?: () => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      {compact ? null : (
        <>
          <p className="text-sm leading-relaxed">{view.headline}</p>
          <p className="text-sm leading-relaxed text-muted">{view.motive}</p>
        </>
      )}

      <ul className="atalaya-why-list" data-explain-checks>
        {(compact ? view.checks.filter((c) => c.status !== "na") : view.checks).map((c) => (
          <CheckRow key={c.id} item={c} />
        ))}
      </ul>

      <Conclusion view={view} />

      {view.levels && !compact ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-sm">
          <Level label="ENTRADA" value={view.levels.entry ?? "—"} />
          <Level label="SL" value={view.levels.sl} />
          <Level label="TP1" value={view.levels.tp1} />
          <Level label="TP2" value={view.levels.tp2} />
          <Level label="R:R" value={view.levels.rr} />
        </dl>
      ) : null}

      {view.extras.length && !compact ? (
        <ul className="space-y-1 text-xs text-subtle">
          {view.extras.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {onViewChart ? (
        <button
          type="button"
          data-ver-grafico="explain"
          onClick={onViewChart}
          className="flex h-11 w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
        >
          VER GRÁFICO
          <ChevronRight className="size-4" />
        </button>
      ) : null}

      {onGlossary ? (
        <button
          type="button"
          onClick={onGlossary}
          className="flex h-11 w-full items-center justify-center rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
        >
          Conceptos
        </button>
      ) : null}

      {compact ? null : (
        <p className="text-[11px] leading-snug tracking-wide text-subtle uppercase">{view.disclaimer}</p>
      )}
    </div>
  );
}

function Conclusion({ view }: { view: ExplainView }) {
  const ok = view.checks.filter((c) => c.status === "ok").length;
  const fail = view.checks.filter((c) => c.status === "fail").length;
  const title =
    view.state === "entry"
      ? "Condiciones compatibles con ENTRADA."
      : view.state === "pending"
        ? "Condiciones casi completas. No es una ENTRADA."
        : view.state === "map"
          ? "Zona en vigilancia. No es una ENTRADA."
          : "Atalaya espera. No hay entrada vigente.";
  return (
    <div
      className={cn(
        "atalaya-conclusion",
        view.state === "entry" ? "is-entry" : fail ? "is-wait" : "is-map",
      )}
      data-explain-conclusion={view.state}
    >
      <p className="text-sm font-semibold text-buy">Conclusión</p>
      <p className="mt-1 text-sm leading-snug">{title}</p>
      <p className="mt-1 text-xs text-subtle">
        {ok} condiciones cumplidas
        {fail ? ` · ${fail} pendientes` : ""}. {view.headline}
      </p>
    </div>
  );
}

function CheckRow({ item }: { item: CheckItem }) {
  const mark =
    item.status === "ok" ? "✓" : item.status === "fail" ? "!" : item.status === "pending" ? "·" : "–";
  const markClass =
    item.status === "ok"
      ? "is-ok"
      : item.status === "fail"
        ? "is-fail"
        : item.status === "pending"
          ? "is-pending"
          : "is-na";
  return (
    <li className="atalaya-why-row" data-check={item.id} data-check-status={item.status}>
      <span className={cn("atalaya-why-mark", markClass)} aria-hidden>
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">{item.seeing}</p>
      </div>
    </li>
  );
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="font-mono text-sm tabular">{value}</dd>
    </div>
  );
}

export function GlossaryList({ onBack }: { onBack?: () => void }) {
  return (
    <div className="space-y-2" data-glossary>
      {onBack ? (
        <button type="button" onClick={onBack} className="text-sm text-muted">
          ← Volver a la explicación
        </button>
      ) : null}
      <p className="text-sm text-muted">Qué significa cada palabra que usa Atalaya. No cambia V1.</p>
      {GLOSSARY.map((g) => (
        <GlossaryCard key={g.id} entry={g} />
      ))}
    </div>
  );
}

function GlossaryCard({ entry }: { entry: GlossaryEntry }) {
  return (
    <details className="rounded-[var(--radius-md)] bg-elevated px-3 py-2" data-glossary-id={entry.id}>
      <summary className="cursor-pointer text-sm font-medium">{entry.title}</summary>
      <div className="mt-2 space-y-1.5 pb-1 text-xs leading-relaxed text-muted">
        <p>{entry.what}</p>
        <p>{entry.forAtalaya}</p>
        <p className="text-subtle">{entry.example}</p>
      </div>
    </details>
  );
}

function tone(state: ExplainView["state"]): string {
  if (state === "entry") return "text-buy";
  if (state === "pending") return "text-wait";
  if (state === "map") return "text-map";
  return "text-wait";
}
