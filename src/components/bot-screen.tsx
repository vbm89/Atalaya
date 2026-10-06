import { useEffect, useMemo, useState } from "react";
import type { AssetSnapshot, PaperViewSignal } from "@/lib/bot-paper/store";

interface BoardBody {
  updatedAt: number;
  bot: "ACTIVO" | "DETENIDO";
  lastCycleAt: number | null;
  nextBarClose: number | null;
  storageStatus: "ok" | "error";
  assets: AssetSnapshot[];
  signals: PaperViewSignal[];
}

const ORDER = ["XAUUSD", "US100", "WTI", "BTCUSD"] as const;
type Tab = "board" | "signals";

function digits(asset: string, n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const d = asset === "BTCUSD" || asset === "US100" ? 1 : 2;
  return n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function hm(unix: number | null): string {
  if (unix == null || !Number.isFinite(unix)) return "—";
  return new Date(unix * 1000).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function tone(action: string): string {
  if (action === "COMPRA") return "text-buy";
  if (action === "VENTA") return "text-sell";
  return "text-wait";
}

function venue(provider: string | null): string {
  const head = (provider ?? "").split(":")[0]?.toLowerCase() ?? "";
  if (head.includes("yahoo")) return "Yahoo";
  if (head.includes("okx")) return "OKX";
  if (head.includes("kraken")) return "Kraken";
  return head ? head : "—";
}

function dataLabel(status: AssetSnapshot["status"] | undefined): string {
  if (status === "DATA_OK") return "DATA OK";
  if (status === "DATA_STALE") return "DATA STALE";
  return "DATA ERROR";
}

function shownAction(row: AssetSnapshot | null): "COMPRA" | "VENTA" | "ESPERAR" {
  if (!row || row.status !== "DATA_OK") return "ESPERAR";
  return row.action;
}

function shownReason(row: AssetSnapshot): string {
  if (row.status === "DATA_STALE") return "Datos desactualizados";
  if (row.status === "DATA_ERROR") return row.wait || "Datos no disponibles";
  return row.wait || "Sin lectura suficiente";
}

export function BotScreen() {
  const [body, setBody] = useState<BoardBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [picked, setPicked] = useState<string>("XAUUSD");

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetch("/api/paper/view");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as BoardBody;
        if (!cancelled) {
          setBody(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "sin conexión");
      }
    }
    void pull();
    const id = window.setInterval(() => void pull(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const assets = useMemo(() => {
    const rows = body?.assets ?? [];
    return ORDER.map((id) => rows.find((row) => row.asset === id) ?? null);
  }, [body]);
  const signals = useMemo(() => {
    const rows = body?.signals ?? [];
    return [...rows].sort((a, b) => b.timestamp - a.timestamp || b.createdAt - a.createdAt);
  }, [body]);
  const trades = assets.filter((row): row is AssetSnapshot => row != null && shownAction(row) !== "ESPERAR");
  const bot = body?.bot ?? "DETENIDO";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[430px] px-4 pb-28 pt-5" data-bot="atalaya">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[32px] font-semibold leading-none tracking-tight">ATALAYA</h1>
          <p className="pt-1 text-right font-mono text-[11px] tracking-wide text-muted">PAPER · SIN EJECUCIÓN REAL</p>
        </div>
        <p className={`mt-3 font-mono text-[13px] font-semibold tracking-wide ${bot === "ACTIVO" ? "text-buy" : "text-sell"}`} data-bot-status={bot}>
          BOT PAPER · {bot}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-subtle">Última evaluación</dt>
            <dd className="mt-1 font-mono text-[15px]">{hm(body?.lastCycleAt ?? null)}</dd>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-subtle">Próxima evaluación</dt>
            <dd className="mt-1 font-mono text-[15px]">{hm(body?.nextBarClose ?? null)}</dd>
          </div>
        </dl>
      </header>

      {error && !body ? (
        <p className="mb-3 rounded-md border border-sell/40 bg-sell-dim px-3 py-3 text-sm text-sell">Sin conexión con el bot.</p>
      ) : null}
      {body?.storageStatus === "error" ? (
        <p className="mb-3 text-[12px] text-sell">No se pudieron leer las señales guardadas.</p>
      ) : null}
      {bot === "DETENIDO" && body ? (
        <p className="mb-3 text-[12px] text-sell">El bot no está evaluando. Se muestra la última lectura guardada.</p>
      ) : null}

      {tab === "board" ? (
        <>
          {trades.map((row) => (
            <TradeHero key={row.asset} row={row} />
          ))}
          <section className="flex flex-col gap-2" aria-label="Activos">
            {ORDER.map((id) => {
              const row = assets.find((item) => item?.asset === id) ?? null;
              return (
                <AssetCard
                  key={id}
                  id={id}
                  row={row}
                  active={picked === id}
                  onPick={() => {
                    setPicked(id);
                    setTab("board");
                  }}
                />
              );
            })}
          </section>
        </>
      ) : (
        <SignalBook rows={signals} />
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-[430px] border-t border-border bg-bg/95 backdrop-blur" aria-label="Secciones">
        <TabBtn active={tab === "board"} label="ATALAYA" onClick={() => setTab("board")} />
        <TabBtn active={tab === "signals"} label="SEÑALES" onClick={() => setTab("signals")} />
      </nav>
    </main>
  );
}

function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-14 flex-1 pb-[env(safe-area-inset-bottom)] font-mono text-[12px] tracking-[0.16em] ${active ? "text-fg" : "text-subtle"}`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
  );
}

function AssetCard({
  id,
  row,
  active,
  onPick,
}: {
  id: (typeof ORDER)[number];
  row: AssetSnapshot | null;
  active: boolean;
  onPick: () => void;
}) {
  const action = shownAction(row);
  const status = row ? dataLabel(row.status) : "DATA ERROR";
  return (
    <button
      type="button"
      onClick={onPick}
      data-asset={id}
      data-action={action}
      className={`rounded-xl border px-3 py-3 text-left ${active ? "border-cyan/50 bg-elevated" : "border-border bg-surface"} ${action === "COMPRA" ? "border-buy/50" : action === "VENTA" ? "border-sell/50" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[13px] tracking-wide">{id}</span>
        <span className={`font-mono text-[18px] font-semibold tracking-wide ${tone(action)}`}>{action}</span>
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[20px] leading-none">{row ? digits(id, row.price) : "—"}</span>
        <span className="text-right text-[11px] text-subtle">{venue(row?.provider ?? null)}</span>
      </span>
      <span className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{status}</span>
        <span>Vela {row?.lastBarT != null ? hm(row.lastBarT + 900) : "—"}</span>
      </span>
      {action === "ESPERAR" ? <span className="mt-2 block text-[14px] leading-snug">{row ? shownReason(row) : "Datos no disponibles"}</span> : null}
    </button>
  );
}

function TradeHero({ row }: { row: AssetSnapshot }) {
  const action = shownAction(row);
  return (
    <article
      className={`mb-4 rounded-2xl border p-4 ${action === "COMPRA" ? "border-buy/50 bg-buy-dim" : "border-sell/50 bg-sell-dim"}`}
      data-trade={row.asset}
    >
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">{row.asset} · 15m</p>
      <h2 className={`mt-1 font-mono text-[40px] font-semibold leading-none ${tone(action)}`}>{action}</h2>
      <p className="mt-2 font-mono text-[22px]">{digits(row.asset, row.price)}</p>
      <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Level k="Entrada" v={digits(row.asset, row.entry)} />
        <Level k="SL" v={digits(row.asset, row.stop)} />
        <Level k="TP" v={digits(row.asset, row.target)} />
        <Level k="R:R" v={row.rr != null ? row.rr.toFixed(2) : "—"} />
      </dl>
      <div className="mt-4 space-y-1 text-[14px] leading-snug">
        <p>
          <span className="text-subtle">Setup. </span>
          {row.setup ?? "—"}
        </p>
        <p>
          <span className="text-subtle">Razón. </span>
          {row.rationale}
        </p>
        <p className="text-[12px] text-muted">
          Fuente {venue(row.provider)} · 15m · vela {row.lastBarT != null ? hm(row.lastBarT + 900) : "—"}
        </p>
      </div>
      <CandleStrip candles={row.candles} entry={row.entry} stop={row.stop} target={row.target} />
    </article>
  );
}

function SignalBook({ rows }: { rows: PaperViewSignal[] }) {
  return (
    <section aria-label="Señales">
      <h2 className="mb-3 font-mono text-[11px] tracking-[0.18em] text-muted">SEÑALES</h2>
      {!rows.length ? (
        <p className="text-sm text-muted">Todavía no hay entradas.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((sig) => (
            <li key={sig.id} className="rounded-xl border border-border bg-surface px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] text-muted">{hm(sig.timestamp)}</span>
                <span className={`font-mono text-[16px] font-semibold ${tone(sig.direction)}`}>{sig.direction}</span>
              </div>
              <p className="mt-1 font-mono text-[13px]">
                {sig.asset}
                <span className="text-muted"> · {sig.result}</span>
              </p>
              <dl className="mt-3 grid grid-cols-4 gap-1 text-center">
                <Level k="Entrada" v={digits(sig.asset, sig.entry)} />
                <Level k="SL" v={digits(sig.asset, sig.stop)} />
                <Level k="TP" v={digits(sig.asset, sig.target)} />
                <Level k="RR" v={sig.rr.toFixed(2)} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Level({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-bg/70 px-1 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-1 font-mono text-[12px]">{v}</dd>
    </div>
  );
}

function CandleStrip({
  candles,
  entry,
  stop,
  target,
}: {
  candles: AssetSnapshot["candles"];
  entry: number | null;
  stop: number | null;
  target: number | null;
}) {
  const visible = candles.slice(-48);
  if (visible.length < 2) return null;
  const w = 360;
  const h = 148;
  const pad = 8;
  const extras = [entry, stop, target].filter((n): n is number => n != null);
  const min = Math.min(...visible.map((b) => b.l), ...extras);
  const max = Math.max(...visible.map((b) => b.h), ...extras);
  const span = max - min || 1;
  const y = (p: number) => pad + ((max - p) / span) * (h - pad * 2);
  const slot = (w - pad * 2) / visible.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-36 w-full" role="img" aria-label="Velas de 15m cerradas">
      <rect width={w} height={h} fill="var(--color-bg)" rx="8" />
      {visible.map((bar, i) => {
        const x = pad + i * slot + slot * 0.2;
        const up = bar.c >= bar.o;
        const color = up ? "var(--color-buy)" : "var(--color-sell)";
        const y1 = y(Math.max(bar.o, bar.c));
        const y2 = y(Math.min(bar.o, bar.c));
        return (
          <g key={bar.t}>
            <line x1={x + slot * 0.3} x2={x + slot * 0.3} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1" />
            <rect x={x} y={y1} width={Math.max(slot * 0.6, 1.5)} height={Math.max(y2 - y1, 1)} fill={color} />
          </g>
        );
      })}
      {entry != null ? <line x1={pad} x2={w - pad} y1={y(entry)} y2={y(entry)} stroke="var(--color-cyan)" strokeDasharray="3 3" /> : null}
      {stop != null ? <line x1={pad} x2={w - pad} y1={y(stop)} y2={y(stop)} stroke="var(--color-sell)" strokeDasharray="2 3" /> : null}
      {target != null ? <line x1={pad} x2={w - pad} y1={y(target)} y2={y(target)} stroke="var(--color-buy)" strokeDasharray="2 3" /> : null}
    </svg>
  );
}
