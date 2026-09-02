import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckItem, CheckStatus, ExplainView } from "@/lib/learn/explain";
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
            <p className="text-xs font-medium tracking-wider text-muted uppercase">
              {view.assetId} · {view.direction} · {view.timeframe}
            </p>
            <h2 id="atalaya-explain-title" className={cn("text-lg font-semibold tracking-tight", tone(view.state))}>
              {view.stateLabel}
            </h2>
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

function ExplainBody({
  view,
  onViewChart,
  onGlossary,
}: {
  view: ExplainView;
  onViewChart?: () => void;
  onGlossary: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed">{view.headline}</p>
      <p className="text-sm leading-relaxed text-muted">{view.motive}</p>

      <ul className="space-y-2" data-explain-checks>
        {view.checks.map((c) => (
          <CheckRow key={c.id} item={c} />
        ))}
      </ul>

      {view.levels ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-sm">
          <Level label="ENTRADA" value={view.levels.entry ?? "—"} />
          <Level label="SL" value={view.levels.sl} />
          <Level label="TP1" value={view.levels.tp1} />
          <Level label="TP2" value={view.levels.tp2} />
          <Level label="R:R" value={view.levels.rr} />
        </dl>
      ) : null}

      {view.extras.length ? (
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

      <button
        type="button"
        onClick={onGlossary}
        className="flex h-11 w-full items-center justify-center rounded-[var(--radius-md)] bg-elevated text-sm font-medium shadow-[var(--shadow-border)]"
      >
        Conceptos
      </button>

      <p className="text-[11px] leading-snug tracking-wide text-subtle uppercase">{view.disclaimer}</p>
    </div>
  );
}

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <li className="rounded-[var(--radius-md)] bg-elevated px-3 py-2.5" data-check={item.id} data-check-status={item.status}>
      <p className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>{item.label}</span>
        <span className={cn("text-xs font-medium", statusClass(item.status))}>{statusLabel(item.status)}</span>
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{item.meaning}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-subtle">{item.seeing}</p>
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

function statusLabel(s: CheckStatus): string {
  if (s === "ok") return "Cumple";
  if (s === "fail") return "Falta";
  if (s === "pending") return "Pendiente";
  return "No aplica";
}

function statusClass(s: CheckStatus): string {
  if (s === "ok") return "text-buy";
  if (s === "fail") return "text-sell";
  if (s === "pending") return "text-wait";
  return "text-subtle";
}
