import { useQuery } from "@tanstack/react-query";
import { getShadowRadar } from "@/lib/learn/shadow-radar.fn";
import { LAB_UNAVAILABLE } from "@/lib/watch/lab-integrity";

type RadarProps = Awaited<ReturnType<typeof getShadowRadar>>;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 text-right font-medium leading-snug break-words font-mono tabular">{value}</dd>
    </div>
  );
}

function pct(value: number | null | undefined) {
  return value == null ? LAB_UNAVAILABLE : `${value.toFixed(1)}%`;
}

function rr(value: number | null | undefined) {
  return value == null ? LAB_UNAVAILABLE : `${value.toFixed(2)}R`;
}

export function ShadowRadarPanel() {
  const q = useQuery<RadarProps>({
    queryKey: ["shadow-radar", "v2"],
    queryFn: () => getShadowRadar(),
    staleTime: 30_000,
    retry: 0,
  });

  if (q.isLoading) return <p className="text-sm text-subtle">Calculando radar de oportunidades…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-subtle">Radar no disponible. No se inventan resultados.</p>;

  // Backward-compatible with a cached client/server response from the previous
  // radar shape. This prevents the lab page from crashing during deployment
  // propagation while the new { radar, latestReplay } response is cached in.
  const payload = q.data as RadarProps & { radar?: RadarProps; latestReplay?: RadarProps extends { latestReplay: infer T } ? T : never };
  const radar = payload.radar ?? (q.data as unknown as { stats?: RadarProps["radar"]["stats"]; cases?: RadarProps["radar"]["cases"]; rule?: string });
  const stats = radar.stats;
  const cases = radar.cases ?? [];
  const rule = radar.rule ?? "Solo investigación; no genera señales.";
  const latestReplay = payload.radar ? payload.latestReplay : undefined;
  const top = cases.slice(0, 8);
  const comparisons = latestReplay?.report?.comparisons ?? [];
  const listed = [...comparisons].sort((a, b) => {
    if (a.variant === "BASELINE_V1") return -1;
    if (b.variant === "BASELINE_V1") return 1;
    return String(a.variant).localeCompare(String(b.variant));
  });

  if (!stats) return <p className="text-sm text-subtle">Radar no disponible. La respuesta no contiene estadísticas válidas.</p>;

  return (
    <section className="space-y-3" data-shadow-radar>
      <div>
        <h3 className="text-base font-semibold tracking-tight">Radar de oportunidades perdidas</h3>
        <p className="mt-0.5 text-xs text-subtle">V1 no entró y después el mercado avanzó al menos 1R.</p>
      </div>
      <dl className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <Row label="Casos evaluados" value={String(stats.evaluated)} />
        <Row label="Oportunidades ≥ 1R" value={String(stats.missed)} />
        <Row label="Tasa" value={stats.favorableRate == null ? LAB_UNAVAILABLE : `${stats.favorableRate}%`} />
        <Row label="TP1/TP2 alcanzado" value={String(stats.tp1OrBetter)} />
      </dl>
      {top.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold text-subtle">Últimas oportunidades</div>
          <div className="divide-y divide-border">
            {top.map((c) => (
              <div key={c.episodeId} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{c.assetId} · {c.direction === "buy" ? "BUY" : "SELL"}</span>
                  <span className="font-mono font-semibold">{c.mfeR == null ? "—" : `${c.mfeR.toFixed(1)}R`}</span>
                </div>
                <div className="mt-1 text-xs text-subtle">
                  {c.firstTouch ? c.firstTouch.toUpperCase() : "sin toque final"}
                  {c.missingForEntry ? ` · faltaba: ${c.missingForEntry}` : ""}
                  {c.highImpact ? " · noticia alta" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-subtle">Todavía no hay oportunidades ≥ 1R para mostrar.</p>
      )}

      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]" data-shadow-comparator>
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold tracking-tight">Comparador Shadow</h3>
          <p className="mt-0.5 text-xs text-subtle">Orden alfabético. TEST es juez, no leaderboard. V1 sigue siendo el baseline.</p>
        </div>
        {!latestReplay ? (
          <div className="px-4 py-4 text-sm text-subtle">Aún no hay un replay automático guardado. Aparecerá tras el próximo ciclo de Watch.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
              <div className="bg-elevated px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-subtle">Episodios</div>
                <div className="mt-1 font-mono text-lg font-semibold">{latestReplay.episodesAnalyzed}</div>
              </div>
              <div className="bg-elevated px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-subtle">Casos EXTRA TEST</div>
                <div className="mt-1 font-mono text-lg font-semibold">{latestReplay.extraTestN}</div>
              </div>
            </div>
            <div className="divide-y divide-border">
              {listed.map((c) => (
                <div key={c.variant} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{c.variant}</span>
                        {c.variant === "BASELINE_V1" ? <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-subtle shadow-[var(--shadow-border)]">V1</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-subtle">
                        TEST: {c.test.n} casos · éxito {pct(c.test.successRate)} · {c.evidenceLabel}
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs tabular">
                      <div>{c.decided} decididos</div>
                      <div>{rr(c.meanOutcomeRr)}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] text-subtle">
                    <span>TP1 {c.tp1}</span>
                    <span>TP2 {c.tp2}</span>
                    <span>SL {c.sl}</span>
                    <span>EXTRA {c.additionalOpportunities}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-subtle">
              Último replay: {new Date(latestReplay.generatedAt).toLocaleString("es-ES")}. Una ventaja con pocos casos no se considera evidencia suficiente: el laboratorio mantiene el estado INSUFFICIENT hasta alcanzar el tamaño mínimo definido.
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-subtle">{rule} Solo investigación; no genera señales.</p>
    </section>
  );
}
