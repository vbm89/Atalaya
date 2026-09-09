type FeedQuote = {
  source: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  latencyMs: number | null;
  status: "ok" | "unavailable" | "not_configured";
};

type FeedHistory = {
  source: string;
  samples: number;
  avgMid: number | null;
  minMid: number | null;
  maxMid: number | null;
};

export type XauFeedComparatorData = {
  generatedAt: string;
  quotes: FeedQuote[];
  history24h: FeedHistory[];
  history7d: FeedHistory[];
  mt4: { status: "not_connected"; note: string };
};

function price(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function statusLabel(status: FeedQuote["status"]): string {
  if (status === "ok") return "OK";
  if (status === "not_configured") return "NO CONFIGURADO";
  return "SIN DATO";
}

function rowRank(history: FeedHistory[]): FeedHistory[] {
  return [...history].sort((a, b) => (b.samples - a.samples) || a.source.localeCompare(b.source));
}

export function XauFeedComparator({ data }: { data: XauFeedComparatorData | undefined }) {
  if (!data) {
    return <div className="px-4 py-4 text-sm text-subtle">Aún no hay muestras de feeds XAU.</div>;
  }
  const quotes = data.quotes;
  const history = rowRank(data.history24h);
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-elevated shadow-[var(--shadow-border)]" data-xau-feed-comparator>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Comparador de feeds XAUUSD</h3>
          <span className="text-xs font-mono text-subtle">Shadow · solo DEV</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          Compara fuentes externas y guarda muestras cada ciclo de Shadow. No cambia el precio de V1.
        </p>
      </div>
      <div className="divide-y divide-border">
        {quotes.map((q) => (
          <div key={q.source} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{q.source}</p>
                <p className="mt-0.5 text-[10px] text-subtle">{statusLabel(q.status)}{q.latencyMs != null ? ` · ${q.latencyMs} ms` : ""}</p>
              </div>
              <div className="text-right font-mono text-xs tabular">
                <div>Mid {price(q.mid)}</div>
                <div className="text-subtle">B {price(q.bid)} · A {price(q.ask)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">Muestras últimas 24 h</p>
        {history.length ? (
          <div className="mt-2 space-y-2">
            {history.map((h) => (
              <div key={h.source} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                <div className="min-w-0 truncate">
                  <span className="font-medium">{h.source}</span>
                  <span className="text-subtle"> · {h.samples} muestras</span>
                </div>
                <div className="font-mono text-right tabular">
                  {price(h.avgMid)} <span className="text-subtle">({price(h.minMid)}–{price(h.maxMid)})</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-subtle">Todavía no hay histórico capturado.</p>}
      </div>
      <div className="border-t border-border px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">Referencia MT4 / T4Trade</p>
        <p className="mt-1 text-xs leading-relaxed text-wait">{data.mt4.note}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">
          Para saber cuál se parece realmente a tu broker necesitamos capturar Bid/Ask de tu MT4, no asumir que GoldAPI o Bitget representan a T4Trade.
        </p>
      </div>
      <p className="border-t border-border px-4 py-3 text-[10px] text-subtle">Última captura: {new Date(data.generatedAt).toLocaleString("es-ES")}. Histórico conservado: 7 días.</p>
    </div>
  );
}
