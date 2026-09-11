import { useQuery } from "@tanstack/react-query";
import { getShadowRadar } from "@/lib/learn/shadow-radar.fn";

function pct(v: number | null) { return v == null ? "—" : `${v.toFixed(1)}%`; }
function r(v: number | null) { return v == null ? "—" : `${v.toFixed(2)}R`; }
function label(v: string) {
  if (v === "BASELINE_V1") return "V1 BASELINE";
  return v.replaceAll("_", " ");
}

export function ShadowAssetRankingPanel() {
  const q = useQuery({ queryKey: ["shadow-asset-ranking"], queryFn: () => getShadowRadar(), staleTime: 30_000, retry: 0 });
  const rankings = q.data?.assetRanking ?? [];

  return <section className="space-y-3">
    <div>
      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-cyan">ATALAYA · SHADOW V2</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Métodos por activo</h1>
      <p className="mt-1 text-sm text-subtle">Catálogo descriptivo. TEST no elige un campeón. No cambia V1 ni selecciona una estrategia live.</p>
    </div>
    {q.isLoading ? <p className="text-sm text-subtle">Analizando casos…</p> : q.isError ? <p className="text-sm text-sell">No se ha podido leer Shadow.</p> : rankings.length === 0 ? <p className="text-sm text-subtle">Aún no hay casos suficientes.</p> : <div className="space-y-3">
      {rankings.map((asset) => <div key={asset.assetId} className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{asset.assetId}</h2><span className="text-[11px] font-mono text-subtle">sin ranking</span></div>
          {asset.best ? <p className="mt-1 text-xs text-subtle">Referencia: <span className="font-medium text-fg">{label(asset.best.variant)}</span></p> : <p className="mt-1 text-xs text-subtle">Sin campeón. TEST es juez de muestra, no de puesto.</p>}
        </div>
        <div className="divide-y divide-border">
          {asset.methods.slice(0, 6).map((m) => <div key={m.variant} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3"><div className="min-w-0"><span className="text-sm font-medium">{label(m.variant)}</span></div><span className="text-[11px] font-mono text-subtle">{m.evidence}</span></div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-subtle"><span>{m.decided} decididos</span><span>{pct(m.successPct)} éxito</span><span>{r(m.meanR)}</span></div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-subtle"><span>EXTRA {m.extraDecided}</span><span>EXTRA éxito {pct(m.extraSuccessPct)}</span><span>{m.earlierThanV1} antes que V1</span></div>
          </div>)}
        </div>
      </div>)}
    </div>}
    <p className="text-[11px] leading-relaxed text-subtle">Ningún método se promociona por R o acierto observados. TEST solo indica si hay muestra suficiente. V1 no se modifica.</p>
  </section>;
}
