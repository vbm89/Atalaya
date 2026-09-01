import { useQuery } from "@tanstack/react-query";
import { getWatchHistory } from "@/lib/watch/watch.fn";
import { learningCasesFromHistory } from "@/lib/learn/case";
import { detectFindings, type Finding } from "@/lib/learn/patterns";
import { actionableProposals, proposalsFromCases, type Proposal } from "@/lib/learn/proposals";
import { runValidation, type ValidationRecord } from "@/lib/learn/validate";
import {
  evidenceLabel,
  formatMadridDate,
  formatPct,
  periodLabel,
  summarize,
  type BucketStats,
} from "@/lib/learn/stats";
import { GlossaryList } from "./explain-sheet";

export function LearnPanel() {
  const q = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });
  const cases = q.data ? learningCasesFromHistory(q.data) : [];
  const report = q.data ? summarize(cases) : null;
  const patterns = q.data ? detectFindings(cases) : null;
  const proposals = q.data ? actionableProposals(proposalsFromCases(cases, Date.now())) : null;
  const validation = q.data ? runValidation(cases, 0) : null;

  return (
    <div className="mt-4 space-y-5" data-learn-panel>
      <p className="text-sm leading-relaxed text-muted">
        Escuela de Atalaya. Explica las decisiones de V1. No genera señales. No cambia el motor.
      </p>
      <p className="text-xs leading-relaxed text-subtle">
        En cada ficha, «¿Por qué?» abre la explicación del análisis actual. Aquí están los conceptos, la
        memoria y los hallazgos históricos.
      </p>

      <section className="space-y-3" data-learn-memory>
        <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Memoria</h2>
        {q.isLoading ? <p className="text-sm text-subtle">Cargando episodios…</p> : null}
        {q.isError ? (
          <p className="text-sm text-sell">No se ha podido leer el historial. No se inventan estadísticas.</p>
        ) : null}
        {report ? <MemoryView report={report} /> : null}
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

function MemoryView({ report }: { report: ReturnType<typeof summarize> }) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-wait">{report.mixWarning}</p>
      {report.byAsset.map((b) => (
        <AssetMemory key={b.key} bucket={b} />
      ))}
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

function AssetMemory({ bucket }: { bucket: BucketStats }) {
  return (
    <article className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]" data-stats-asset={bucket.key}>
      <p className="text-sm font-medium">{bucket.label}</p>
      <BucketBody bucket={bucket} />
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

function BucketBody({ bucket }: { bucket: BucketStats }) {
  const period = periodLabel(bucket.periodFromMs, bucket.periodToMs);
  return (
    <div className="mt-1 space-y-1.5 text-sm">
      <p className="text-muted">
        Casos: {bucket.total} · trainable {bucket.trainable} · excluidos {bucket.excluded}
      </p>
      <p>
        TP1: {bucket.tp1} · TP2: {bucket.tp2} · SL: {bucket.sl} · EXPIRADA: {bucket.expired}
        {bucket.pending ? ` · PENDIENTE: ${bucket.pending}` : ""}
      </p>
      <p>Éxito (TP1 o TP2, una operación): {formatPct(bucket.success)}</p>
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
