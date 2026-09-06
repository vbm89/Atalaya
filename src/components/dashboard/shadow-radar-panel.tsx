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

export function ShadowRadarPanel() {
  const q = useQuery<RadarProps>({
    queryKey: ["shadow-radar"],
    queryFn: () => getShadowRadar(),
    staleTime: 30_000,
    retry: 0,
  });

  if (q.isLoading) return <p className="text-sm text-subtle">Calculando radar de oportunidades…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-subtle">Radar no disponible. No se inventan resultados.</p>;

  const { stats, cases, rule } = q.data;
  const top = cases.slice(0, 8);

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
      <p className="text-[11px] leading-relaxed text-subtle">{rule} Solo investigación; no genera señales.</p>
    </section>
  );
}
