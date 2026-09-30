import { BrainCircuit, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PaperSignal = {
  id: string;
  asset: string;
  timestamp: number;
  direction: "COMPRA" | "VENTA";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  setup: string;
  tier: "FULL" | "PARTIAL";
  result: "ABIERTA" | "SL" | "TP";
};

type PaperView = { signals: PaperSignal[]; bot: "ACTIVO" | "DETENIDO" };

const ASSETS = ["XAUUSD", "BTCUSD", "US100", "WTI"] as const;

function hm(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function resultTone(result: PaperSignal["result"]): string {
  return result === "TP" ? "text-buy" : result === "SL" ? "text-sell" : "text-wait";
}

export function LearningPanel() {
  const [data, setData] = useState<PaperView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/bot", { cache: "no-store" });
        if (!res.ok) throw new Error("paper");
        const next = (await res.json()) as PaperView;
        if (!cancelled) { setData(next); setError(false); }
      } catch { if (!cancelled) setError(true); }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 20_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const signals = data?.signals ?? [];
  const closed = signals.filter((s) => s.result !== "ABIERTA");
  const tp = closed.filter((s) => s.result === "TP").length;
  const sl = closed.filter((s) => s.result === "SL").length;
  const open = signals.filter((s) => s.result === "ABIERTA").length;
  const byAsset = useMemo(() => ASSETS.map((asset) => {
    const rows = signals.filter((s) => s.asset === asset);
    const done = rows.filter((s) => s.result !== "ABIERTA");
    return { asset, total: rows.length, tp: done.filter((s) => s.result === "TP").length,
      sl: done.filter((s) => s.result === "SL").length, open: rows.filter((s) => s.result === "ABIERTA").length };
  }), [signals]);

  return (
    <section className="mt-4 space-y-3 atalaya-markets-span" data-learning-panel>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Aprendizaje</h2>
        <p className="mt-0.5 text-sm text-subtle">Resultados reales registrados por el bot PAPER.</p>
      </div>
      {error && !data ? <p className="rounded-[var(--radius-lg)] bg-sell-dim px-4 py-3 text-sm text-sell">No se han podido leer los resultados del bot.</p> : null}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Cerradas" value={closed.length} />
        <Stat label="TP" value={tp} tone="buy" />
        <Stat label="SL" value={sl} tone="sell" />
      </div>

      <div className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Estado</p>
          <span className={data?.bot === "ACTIVO" ? "text-buy" : "text-sell"}>{data?.bot ?? "—"}</span>
        </div>
        <p className="mt-2 text-xs text-subtle">{open} {open === 1 ? "señal abierta" : "señales abiertas"} · Edge validado: NO</p>
      </div>

      <div className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">Por activo</p>
        <div className="mt-3 space-y-2">
          {byAsset.map((row) => (
            <div key={row.asset} className="rounded-md bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm">{row.asset}</span><span className="text-xs text-muted">{row.total} señales</span>
              </div>
              <div className="mt-1 flex gap-3 text-xs">
                <span className="text-buy">{row.tp} TP</span><span className="text-sell">{row.sl} SL</span><span className="text-wait">{row.open} abiertas</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
        <div className="flex items-center gap-2"><BrainCircuit className="size-4 text-cyan" /><p className="text-xs font-medium tracking-wider text-muted uppercase">Últimas señales</p></div>
        {!signals.length ? <p className="mt-3 text-sm text-subtle">Todavía no hay señales registradas.</p> : (
          <ul className="mt-3 space-y-2">
            {signals.slice(0, 12).map((sig) => (
              <li key={sig.id} className="rounded-md bg-surface px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{sig.asset} · {hm(sig.timestamp)}</span>
                  <span className={sig.direction === "COMPRA" ? "text-buy" : "text-sell"}>{sig.direction}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-subtle"><span>{sig.setup} · {sig.tier}</span><span className={resultTone(sig.result)}>{sig.result}</span></div>
                <div className="mt-1 text-[11px] text-subtle">Entrada {sig.entry} · SL {sig.stop} · TP {sig.target} · RR {sig.rr.toFixed(2)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated px-4 py-4 shadow-[var(--shadow-border)]">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface text-cyan"><ShieldCheck className="size-5" /></span>
          <div>
            <p className="text-sm font-semibold">SIN EXPERIMENTOS EN PANTALLA</p>
            <p className="mt-1 text-xs leading-relaxed text-subtle">Los laboratorios, backtests y análisis internos quedan fuera de la interfaz. Esta pantalla solo refleja resultados registrados por PAPER.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "buy" | "sell" }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className={tone === "buy" ? "mt-1 tabular text-xl font-medium text-buy" : tone === "sell" ? "mt-1 tabular text-xl font-medium text-sell" : "mt-1 tabular text-xl font-medium"}>{value}</p>
    </div>
  );
}
