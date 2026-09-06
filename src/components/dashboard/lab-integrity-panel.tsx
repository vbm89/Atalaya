import { useQuery } from "@tanstack/react-query";
import { getLabIntegrity } from "@/lib/watch/watch.fn";
import { getShadowRadar } from "@/lib/learn/shadow-radar.fn";
import { displayLabValue, LAB_UNAVAILABLE, type LabIntegrity } from "@/lib/watch/lab-integrity";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 text-right font-medium leading-snug break-words font-mono tabular">{value}</dd>
    </div>
  );
}

function values(data: LabIntegrity | undefined) {
  const d = data;
  return {
    tick: d?.tick ?? LAB_UNAVAILABLE,
    persistence: d?.persistence ?? LAB_UNAVAILABLE,
    v1Sha: d?.v1Sha ?? LAB_UNAVAILABLE,
    episodes: displayLabValue(d?.episodes),
    v1Entries: displayLabValue(d?.v1Entries),
    entriesWithTape: displayLabValue(d?.entriesWithTape),
    tapeGaps: displayLabValue(d?.tapeGaps),
    withEntryGates: displayLabValue(d?.withEntryGates),
    withoutEntryGates: displayLabValue(d?.withoutEntryGates),
    withPostEntry: displayLabValue(d?.withPostEntry),
    withoutPostEntry: displayLabValue(d?.withoutPostEntry),
    technical: displayLabValue(d?.technicalOutcomesWithoutEntry),
    lastReplay: displayLabValue(d?.lastShadowReplayAt),
    lastReplayResult: displayLabValue(d?.lastShadowReplayResult),
    extraTestN: displayLabValue(d?.extraTestN),
    insufficient: d?.lastReplayInsufficient == null ? LAB_UNAVAILABLE : d.lastReplayInsufficient ? "INSUFFICIENT" : "suficiente",
    gitSha: displayLabValue(d?.gitSha),
  };
}

export function LabIntegrityPanel() {
  const q = useQuery({ queryKey: ["lab-integrity"], queryFn: () => getLabIntegrity(), staleTime: 30_000, retry: 0 });
  const radar = useQuery({ queryKey: ["shadow-radar"], queryFn: () => getShadowRadar(), staleTime: 30_000, retry: 0 });
  const v = values(q.data);
  const r = radar.data;

  return (
    <section className="mt-2 space-y-3" data-lab-integrity>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Estado del laboratorio</h2>
        <p className="mt-0.5 text-sm text-subtle">Diagnóstico de captura. No genera señales ni cambia V1.</p>
      </div>
      {q.isLoading ? <p className="text-sm text-subtle">Leyendo métricas…</p> : q.isError ? <p className="text-sm text-sell">No se ha podido leer el laboratorio. No se inventan cifras.</p> : (
        <>
          <dl className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
            <Row label="Tick" value={v.tick} /><Row label="Persistencia" value={v.persistence} /><Row label="SHA V1" value={v.v1Sha} /><Row label="Git SHA (último tick)" value={v.gitSha} />
          </dl>
          <dl className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
            <Row label="Episodios acumulados" value={v.episodes} /><Row label="ENTRY V1 reales" value={v.v1Entries} /><Row label="ENTRY con cinta 15M" value={v.entriesWithTape} /><Row label="Tape gaps" value={v.tapeGaps} /><Row label="Con entryGates" value={v.withEntryGates} /><Row label="Sin entryGates" value={v.withoutEntryGates} /><Row label="Con postEntry" value={v.withPostEntry} /><Row label="Sin postEntry" value={v.withoutPostEntry} /><Row label="Outcomes técnicos sin ENTRY" value={v.technical} />
          </dl>
          <dl className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
            <Row label="Último replay Shadow" value={v.lastReplay} /><Row label="Resultado del replay" value={v.lastReplayResult} /><Row label="extraTestN" value={v.extraTestN} /><Row label="Evidencia" value={v.insufficient} />
          </dl>
          <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Radar de oportunidades perdidas</h3><span className="text-xs font-mono text-subtle">Shadow · descriptivo</span></div>
            {radar.isLoading ? <p className="mt-2 text-sm text-subtle">Analizando historial…</p> : radar.isError || !r ? <p className="mt-2 text-sm text-subtle">Radar no disponible.</p> : <>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><div className="text-lg font-semibold">{r.evaluated}</div><div className="text-[11px] text-subtle">evaluados</div></div><div><div className="text-lg font-semibold">{r.opportunities}</div><div className="text-[11px] text-subtle">≥1R</div></div><div><div className="text-lg font-semibold">{r.opportunityRate.toFixed(1)}%</div><div className="text-[11px] text-subtle">tasa</div></div></div>
              {r.cases.slice(0, 5).map((c) => <div key={c.episodeId} className="mt-2 rounded-md border border-current/10 px-3 py-2 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{c.assetId} · {c.direction.toUpperCase()}</span><span className="font-mono">{c.mfeR.toFixed(2)}R</span></div><p className="mt-1 text-xs text-subtle">{c.reason}</p></div>)}
              {r.cases.length === 0 && <p className="mt-2 text-sm text-subtle">Todavía no hay oportunidades ≥1R detectadas.</p>}
            </>}
          </div>
          <p className="text-[11px] leading-relaxed text-subtle">Replay Shadow no se persiste. Si falta un dato se muestra «No disponible». Ausencia de entryGates en episodios antiguos significa «no capturado entonces», no false.</p>
        </>
      )}
    </section>
  );
}
