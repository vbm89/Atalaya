import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWatchHistory } from "@/lib/watch/watch.fn";
import { learningCasesFromHistory, v1EntryCases, SETUPS_VS_ENTRIES_NOTE, ENTRY_OUTCOME_NOTE } from "@/lib/learn/case";
import {
  LEARN_HISTORY_WINDOW,
  buildEvolution,
  type AssetEvolution,
  type EvolutionPhase,
  type EvolutionReport,
} from "@/lib/learn/evolution";
import { detectFindings, type Finding } from "@/lib/learn/patterns";
import { actionableProposals, proposalsFromCases, type Proposal } from "@/lib/learn/proposals";
import { runValidation, type ValidationRecord } from "@/lib/learn/validate";
import {
  NON_ENTRY_GATES,
  explainNonEntries,
  exampleChecks,
  type NonEntryGateId,
  type NonEntryReport,
} from "@/lib/learn/non-entry";
import {
  evidenceLabel,
  formatMadridDate,
  formatPct,
  periodLabel,
  summarize,
  type BucketStats,
} from "@/lib/learn/stats";
import { Sparkline } from "./sparkline";
import { GlossaryList } from "./explain-sheet";
import { cn } from "@/lib/utils";

export function LearnPanel() {
  const q = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });
  const history = q.data;
  const cases = useMemo(
    () => (history ? learningCasesFromHistory(history) : []),
    [history],
  );
  const report = useMemo(
    () => (history ? summarize(cases) : null),
    [history, cases],
  );
  const entryCases = useMemo(() => v1EntryCases(cases), [cases]);
  const entryReport = useMemo(() => summarize(entryCases), [entryCases]);
  const nonEntry = useMemo(() => explainNonEntries(cases), [cases]);
  const patterns = useMemo(
    () => (history ? detectFindings(cases) : null),
    [history, cases],
  );
  const proposals = useMemo(
    () => (history ? actionableProposals(proposalsFromCases(cases, Date.now())) : null),
    [history, cases],
  );
  const validation = useMemo(
    () => (history ? runValidation(cases, 0) : null),
    [history, cases],
  );
  const evolution = useMemo(
    () => (history && patterns && validation ? buildEvolution(cases, patterns, validation) : null),
    [history, cases, patterns, validation],
  );

  return (
    <div className="mt-2 space-y-5" data-learn-panel>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Aprendizaje</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Explica las decisiones de V1. No genera señales. No cambia el motor.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          Investigación y Shadow están separados de las señales operativas.
        </p>
      </div>

      <section className="space-y-3" data-learn-evolution>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">
          Evolución del aprendizaje
        </h2>
        {q.isLoading ? <p className="text-sm text-subtle">Cargando episodios…</p> : null}
        {q.isError ? (
          <p className="text-sm text-sell">No se ha podido leer el historial. No se inventan estadísticas.</p>
        ) : null}
        {evolution ? <EvolutionView report={evolution} /> : null}
      </section>

      <section className="space-y-3" data-learn-memory>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Memoria</h2>
        {q.isLoading ? <p className="text-sm text-subtle">Cargando episodios…</p> : null}
        {q.isError ? (
          <p className="text-sm text-sell">No se ha podido leer el historial. No se inventan estadísticas.</p>
        ) : null}
        {report ? <MemoryView report={report} entries={entryReport} nonEntry={nonEntry} /> : null}
      </section>

      <section className="space-y-3" data-learn-findings>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Hallazgos</h2>
        {patterns ? <FindingsView report={patterns} /> : null}
      </section>

      <section className="space-y-3" data-learn-proposals>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Propuestas</h2>
        {proposals ? <ProposalsView proposals={proposals} /> : null}
      </section>

      <section className="space-y-3" data-learn-validation>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Validación</h2>
        {validation ? <ValidationView report={validation} /> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Conceptos</h2>
        <GlossaryList />
      </section>
    </div>
  );
}

function phaseTone(id: EvolutionPhase["id"]): string {
  if (id === "sin_muestra") return "bg-subtle";
  if (id === "recopilando") return "bg-wait";
  if (id === "observacion") return "bg-map";
  if (id === "patron_potencial") return "bg-buy";
  return "bg-accent";
}

function GateBar({ current, target, reached }: { current: number; target: number; reached: boolean }) {
  const pct = target <= 0 ? 0 : Math.min(100, Math.round((current / target) * 100));
  return (
    <div className="mt-2">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={current}
        aria-label="Progreso hacia el siguiente umbral de evidencia"
      >
        <div
          className={cn("h-full rounded-full", reached ? "bg-accent" : "bg-map")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function EvolutionView({ report }: { report: EvolutionReport }) {
  const spark =
    report.series.length === 0
      ? []
      : report.series.length === 1
        ? [0, report.series[0]!.trainable]
        : report.series.map((d) => d.trainable);
  return (
    <div className="space-y-3">
      <article className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Estado general</p>
        <div className="mt-2 flex items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", phaseTone(report.phase.id))} />
          <p className="text-sm font-medium">{report.phase.label}</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{report.phase.hint}</p>
        <p className="mt-3 text-xs text-muted">{report.gate.label}</p>
        <p className="tabular text-sm">
          {report.gate.current} / {report.gate.target}
          <span className="text-muted"> casos decididos (TP1+TP2+SL)</span>
        </p>
        <GateBar current={report.gate.current} target={report.gate.target} reached={report.gate.reached} />
        <p className="mt-2 text-xs leading-relaxed text-wait">{report.barNotice}</p>
        <p className="mt-2 text-xs text-subtle">
          Ventana: últimos {LEARN_HISTORY_WINDOW} episodios
          {report.truncated ? " · puede haber anteriores no incluidos" : ""}.
        </p>
      </article>

      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Episodios registrados" value={report.observed} />
        <StatTile label="Episodios trainable" value={report.trainable} />
        <StatTile label="Patrones detectados" value={report.detected} />
        <StatTile label="Patrones validados" value={report.validated} />
      </div>

      <div className="space-y-2">
        {report.byAsset.map((a) => (
          <AssetEvolutionCard key={a.assetId} asset={a} />
        ))}
      </div>

      <article className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Evolución temporal</p>
        {report.series.length === 0 ? (
          <p className="mt-2 text-sm text-subtle">Todavía no hay fechas de apertura para dibujar una serie.</p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted">Casos trainable acumulados (Madrid)</p>
            <Sparkline values={spark} positive={null} />
            <ul className="mt-2 space-y-1">
              {report.series.map((d) => (
                <li key={d.day} className="flex justify-between gap-3 text-xs text-muted">
                  <span>{d.label}</span>
                  <span className="tabular">
                    {d.observed} reg · {d.trainable} train · {d.detected} det · {d.validated} val
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <p className="text-xs leading-relaxed text-wait">{report.notice}</p>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 tabular text-xl font-medium">{value}</p>
    </div>
  );
}

function AssetEvolutionCard({ asset }: { asset: AssetEvolution }) {
  return (
    <article
      className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
      data-learn-asset={asset.assetId}
    >
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", phaseTone(asset.phase.id))} />
        <p className="text-sm font-medium">{asset.assetId}</p>
      </div>
      <p className="mt-1 text-xs text-wait">{asset.phase.label}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Registrados</dt>
          <dd className="tabular">{asset.observed}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Trainable</dt>
          <dd className="tabular">{asset.trainable}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Detectados</dt>
          <dd className="tabular">{asset.detected}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Validados</dt>
          <dd className="tabular">{asset.validated}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-subtle">
        {asset.gate.current} / {asset.gate.target} decididos
      </p>
    </article>
  );
}

function FindingsView({ report }: { report: ReturnType<typeof detectFindings> }) {
  if (!report.highlighted.length) {
    return <p className="text-sm text-subtle">{report.emptyLabel}</p>;
  }
  return (
    <div className="space-y-3">
      {report.highlighted.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
      <p className="text-[11px] leading-snug text-subtle">
        Los hallazgos no ocultan señales ni cambian V1. Cortes cerrados: activo, dirección, tipo, calidad, R:R,
        impacto, franja horaria Madrid.
      </p>
    </div>
  );
}

function ValidationView({ report }: { report: ReturnType<typeof runValidation> }) {
  if (!report.records.length) {
    return (
      <p className="text-sm text-subtle">
        Aún no hay hipótesis descubiertas en TRAIN para validar. Split {Math.round(report.split.trainRatio * 100)}/
        {100 - Math.round(report.split.trainRatio * 100)}.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Train {report.split.train.length} · Test {report.split.test.length} · Probadas {report.tried} ·
        Validated {report.validated} · Rejected {report.rejected} · Inconclusas {report.inconclusive}
      </p>
      {report.records.map((r) => (
        <ValidationCard key={r.validationId} rec={r} />
      ))}
      <p className="text-[11px] leading-snug text-subtle">{report.notice}</p>
    </div>
  );
}

function ValidationCard({ rec }: { rec: ValidationRecord }) {
  const label =
    rec.verdict === "VALIDATED"
      ? "Hipótesis validada"
      : rec.verdict === "REJECTED"
        ? "Hipótesis rechazada"
        : rec.verdict === "INCONCLUSIVE"
          ? "Inconclusa"
          : "Pendiente de validación";
  const period = (from: number | null, to: number | null) =>
    from != null && to != null ? `${formatMadridDate(from)} – ${formatMadridDate(to)}` : "Sin periodo";
  const d = (v: number | null) =>
    v == null ? "n/d" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)} pp`;
  return (
    <article className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]" data-validation={rec.validationId}>
      <p className="text-[11px] font-medium tracking-wider text-muted uppercase">{label}</p>
      <p className="mt-1 text-sm font-medium">{rec.asset} · {rec.cut}</p>
      <p className="mt-2 text-xs font-medium text-muted">TRAIN n={rec.train.n} · {period(rec.train.periodFromMs, rec.train.periodToMs)}</p>
      <p className="text-sm">V1: {formatPct(rec.train.baseline)} · Hipótesis: {formatPct(rec.train.hypothesis)} · Δ {d(rec.train.deltaPp)}</p>
      <p className="mt-2 text-xs font-medium text-muted">TEST n={rec.test.n} · {period(rec.test.periodFromMs, rec.test.periodToMs)}</p>
      <p className="text-sm">V1: {formatPct(rec.test.baseline)} · Hipótesis: {formatPct(rec.test.hypothesis)} · Δ {d(rec.test.deltaPp)}</p>
      <p className="mt-2 text-xs text-wait">Estado: {rec.verdict}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{rec.reason}</p>
      <p className="mt-1 text-[11px] text-subtle">{rec.notice}</p>
    </article>
  );
}

function ProposalsView({ proposals }: { proposals: Proposal[] }) {
  if (!proposals.length) {
    return (
      <p className="text-sm text-subtle">
        Aún no hay propuestas accionables. Hace falta un hallazgo con n suficiente y una dimensión observable.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {proposals.map((p) => (
        <ProposalCard key={p.proposalId} proposal={p} />
      ))}
    </div>
  );
}

function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const tag = p.tone === "negative" ? "Posible aprendizaje · debilidad" : "Posible aprendizaje · fortaleza";
  return (
    <article
      className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
      data-proposal={p.proposalId}
    >
      <p className="text-[11px] font-medium tracking-wider text-muted uppercase">{tag}</p>
      <p className="mt-1 text-sm font-medium">Origen: {p.asset} {p.cut}</p>
      <p className="mt-1 text-sm">Evidencia: {p.trainN} casos · {formatPct(p.observedRate)}</p>
      <p className="text-sm text-muted">Baseline: {formatPct(p.baselineRate)}</p>
      {p.deltaPp != null ? (
        <p className="text-sm">Δ: {p.deltaPp >= 0 ? "+" : "−"}{Math.abs(p.deltaPp).toFixed(0)} pp</p>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed">{p.hypothesis}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{p.proposedChange}</p>
      <p className="mt-2 text-xs text-wait">Estado: PENDIENTE DE VALIDACIÓN</p>
      <p className="text-[11px] text-subtle">{p.notice} {p.needsOutOfSample}</p>
    </article>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  const ev =
    f.evidence === "observation"
      ? "OBSERVACIÓN"
      : f.evidence === "potential_pattern"
        ? "PATRÓN POTENCIAL"
        : f.evidence === "stronger"
          ? "EVIDENCIA MÁS SÓLIDA"
          : "EVIDENCIA INSUFICIENTE";
  const delta =
    f.deltaPp == null ? "n/d" : `${f.deltaPp >= 0 ? "+" : ""}${f.deltaPp.toFixed(0).replace("-", "−")} pp`;
  const period =
    f.periodFromMs != null && f.periodToMs != null
      ? `${formatMadridDate(f.periodFromMs)} – ${formatMadridDate(f.periodToMs)}`
      : "Sin periodo";
  return (
    <article
      className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
      data-finding={f.id}
    >
      <p className="text-[11px] font-medium tracking-wider text-muted uppercase">
        {f.tone === "negative" ? "Hallazgo negativo" : "Hallazgo"}
      </p>
      <p className="mt-1 text-sm font-medium">{f.label}</p>
      <p className="mt-1 text-sm">TP1: {formatPct(f.groupRate)}</p>
      <p className="text-sm text-muted">Baseline {f.assetId}: {formatPct(f.baselineRate)}</p>
      <p className="text-sm">Diferencia: {delta}</p>
      <p className="text-xs text-muted">n: {f.groupN} · Periodo: {period}</p>
      <p className="mt-1 text-xs text-wait">Evidencia: {ev}</p>
      {f.wilsonCaution ? (
        <p className="text-xs text-subtle">
          Diferencia observada, pero los intervalos se solapan: evidencia insuficiente para concluir que el
          comportamiento sea realmente distinto.
        </p>
      ) : null}
      {f.limitedInTime ? <p className="text-xs text-wait">Patrón temporalmente limitado.</p> : null}
      <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
      <p className="mt-1 text-[11px] text-subtle">{f.notice}</p>
    </article>
  );
}

function NonEntryView({ report }: { report: NonEntryReport }) {
  const [gate, setGate] = useState<NonEntryGateId | "multiple" | "unknown" | null>(null);
  const sample =
    gate === "unknown"
      ? report.rows.filter((r) => r.unknown).slice(0, 3)
      : gate === "multiple"
        ? report.rows.filter((r) => !r.unknown && r.gates.length > 1).slice(0, 3)
        : gate
          ? report.rows.filter((r) => r.gates.includes(gate)).slice(0, 3)
          : report.rows.slice(0, 1);

  return (
    <article className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]" data-learn-non-entry>
      <h3 className="text-xs font-medium tracking-wider text-muted uppercase">¿Por qué no entró V1?</h3>
      <p className="mt-1 text-sm">
        {report.total} setups sin ENTRY
      </p>
      <p className="mt-1 text-[11px] leading-snug text-subtle">{report.notice}</p>
      <ul className="mt-3 space-y-1">
        {NON_ENTRY_GATES.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => setGate((cur) => (cur === g.id ? null : g.id))}
              className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm"
            >
              <span className={gate === g.id ? "text-fg" : "text-muted"}>{g.label}</span>
              <span className="tabular">{report.gateHits[g.id]}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setGate((cur) => (cur === "multiple" ? null : "multiple"))}
            className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm"
          >
            <span className={gate === "multiple" ? "text-fg" : "text-muted"}>Múltiples filtros (setups)</span>
            <span className="tabular">{report.exclusiveMultiple}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setGate((cur) => (cur === "unknown" ? null : "unknown"))}
            className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm"
          >
            <span className={gate === "unknown" ? "text-fg" : "text-muted"}>Sin reconstruir</span>
            <span className="tabular">{report.unknown}</span>
          </button>
        </li>
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-subtle">{report.hitsNote}</p>
      <p className="text-[11px] text-subtle">
        Setups exclusivos: 1 filtro {report.exclusiveSingle} · varios {report.exclusiveMultiple} · desconocido {report.unknown}
      </p>
      {sample.length ? (
        <ul className="mt-3 space-y-3 border-t border-border pt-3">
          {sample.map((row) => {
            const checks = exampleChecks(row);
            return (
              <li key={row.episodeId} className="text-sm">
                <p className="font-medium">
                  {row.assetId} · {row.direction === "buy" ? "BUY" : "SELL"} · {row.openedState.toUpperCase()}
                </p>
                {row.unknown ? (
                  <p className="mt-1 text-xs text-wait">Motivo no reconstruible con el freeze.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {checks.filter((c) => c.missing).map((c) => (
                      <li key={c.id}>Faltaba {c.label}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}

function MemoryView({
  report,
  entries,
  nonEntry,
}: {
  report: ReturnType<typeof summarize>;
  entries: ReturnType<typeof summarize>;
  nonEntry: NonEntryReport;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-wait">{report.mixWarning}</p>
      <p className="text-xs leading-relaxed text-subtle">{SETUPS_VS_ENTRIES_NOTE}</p>

      <h3 className="text-xs font-medium tracking-wider text-muted uppercase">Setups V1</h3>
      {report.byAsset.map((b) => (
        <AssetMemory key={b.key} bucket={b} kind="setups" />
      ))}

      <h3 className="text-xs font-medium tracking-wider text-muted uppercase">Entradas V1</h3>
      <p className="text-[11px] leading-snug text-subtle">{ENTRY_OUTCOME_NOTE}</p>
      {entries.byAsset.map((b) => (
        <AssetMemory key={`entry-${b.key}`} bucket={b} kind="entries" />
      ))}

      <NonEntryView report={nonEntry} />

      <details className="rounded-[var(--radius-md)] bg-elevated px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Combinado (todos los activos)</summary>
        <div className="mt-2">
          <BucketBody bucket={report.global} />
        </div>
      </details>
      <details className="rounded-[var(--radius-md)] bg-elevated px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Dirección, tipo, R:R</summary>
        <div className="mt-2 space-y-3">
          {report.byDirection.map((b) => (
            <MiniBucket key={b.key} bucket={b} />
          ))}
          {report.byKind.filter((b) => b.total > 0).map((b) => (
            <MiniBucket key={b.key} bucket={b} />
          ))}
          {report.byRr.map((b) => (
            <MiniBucket key={b.key} bucket={b} />
          ))}
        </div>
      </details>
      {report.byMonth.length ? (
        <details className="rounded-[var(--radius-md)] bg-elevated px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Por mes (apertura, Madrid)</summary>
          <ul className="mt-2 space-y-2">
            {report.byMonth.map((b) => (
              <li key={b.key} className="text-xs text-muted">
                {b.label} · TP1 {b.tp1} · TP2 {b.tp2} · SL {b.sl} · EXP {b.expired} · {formatPct(b.success)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-subtle">No es una curva de capital. Atalaya no ejecuta órdenes.</p>
        </details>
      ) : null}
      <p className="mt-1 text-[11px] leading-snug tracking-wide text-subtle uppercase">{report.disclaimer}</p>
    </div>
  );
}

function AssetMemory({ bucket, kind }: { bucket: BucketStats; kind: "setups" | "entries" }) {
  return (
    <article
      className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
      data-stats-asset={bucket.key}
      data-learn-kind={kind}
    >
      <p className="text-sm font-medium">{bucket.label}</p>
      <BucketBody bucket={bucket} kind={kind} />
    </article>
  );
}

function MiniBucket({ bucket }: { bucket: BucketStats }) {
  return (
    <div>
      <p className="text-xs font-medium">{bucket.label}</p>
      <p className="text-xs text-muted">
        n = {bucket.trainable} trainable · TP1 {bucket.tp1} · SL {bucket.sl} · {formatPct(bucket.success)}
      </p>
    </div>
  );
}

function BucketBody({ bucket, kind }: { bucket: BucketStats; kind?: "setups" | "entries" }) {
  const period = periodLabel(bucket.periodFromMs, bucket.periodToMs);
  const decided = bucket.success.n;
  const insufficient = kind === "entries" && decided < 20;
  return (
    <div className="mt-1 space-y-1.5 text-sm">
      <p className="text-muted">
        {kind === "entries" ? "Entradas" : "Casos"}: {bucket.total} · trainable {bucket.trainable} · excluidos {bucket.excluded}
      </p>
      <p>
        TP1: {bucket.tp1} · TP2: {bucket.tp2} · SL: {bucket.sl} · EXPIRADA: {bucket.expired}
        {bucket.pending ? ` · PENDIENTE: ${bucket.pending}` : ""}
      </p>
      <p>
        WR (TP1+TP2) / (TP1+TP2+SL): {formatPct(bucket.success)}
        {insufficient ? ` · INSUFICIENTE (n = ${decided})` : ""}
      </p>
      <p className="text-muted">SL: {formatPct(bucket.fail)} · TP2 (dentro del decidido): {formatPct(bucket.tp2Share)}</p>
      {bucket.success.n >= 20 && bucket.success.wilsonLow != null && bucket.success.wilsonHigh != null ? (
        <p className="text-xs text-subtle">
          Wilson 95 %: {(bucket.success.wilsonLow * 100).toFixed(1).replace(".", ",")}–
          {(bucket.success.wilsonHigh * 100).toFixed(1).replace(".", ",")} %
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Periodo:{" "}
        {bucket.periodFromMs != null
          ? `${formatMadridDate(bucket.periodFromMs)} – ${formatMadridDate(bucket.periodToMs ?? bucket.periodFromMs)}`
          : period}
      </p>
      <p className="text-xs text-wait">{evidenceLabel(bucket.evidence)}</p>
    </div>
  );
}
