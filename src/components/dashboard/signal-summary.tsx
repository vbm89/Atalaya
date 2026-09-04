import type { ReactNode } from "react";
import type { AssetAnalysis } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import { displayEntryPrice } from "@/lib/chart/labels";
import { setupStateEs } from "@/lib/watch/memory";
import type { FrozenChartLevels } from "@/lib/chart/setup-overlay";


function sessionLabel(asset: AssetAnalysis): string {
  if (asset.dataStatus === "session_closed") return "Sesión cerrada";
  if (asset.id === "BTCUSD") return "Cripto 24h";
  if (asset.id === "XAUUSD") return "Spot";
  if (asset.id === "US100" || asset.id === "WTI") return "CME";
  return "No disponible";
}

function volumeLabel(asset: AssetAnalysis): { text: string; ok: boolean | null } {
  const tf15 = asset.timeframes.find((t) => t.timeframe === "15m");
  const ratio = tf15?.indicators.volumeRatio ?? null;
  const available = tf15?.indicators.volumeAvailable ?? false;
  if (!available || ratio == null) return { text: "No disponible", ok: null };
  const ok = ratio >= 1;
  return {
    text: ok ? "Válido" : "Por debajo",
    ok,
  };
}

function t2Label(asset: AssetAnalysis): { text: string; tone: string } {
  const missing = asset.setup?.missingForEntry ?? "";
  if (asset.setupState === "entry") return { text: "Confirmado", tone: "text-buy" };
  if (asset.setupState === "pending") return { text: "Pendiente", tone: "text-wait" };
  if (asset.setupState === "map") return { text: "En zona", tone: "text-map" };
  if (/toque|T2|retorno|retest/i.test(missing)) return { text: "Falta", tone: "text-wait" };
  return { text: "No disponible", tone: "text-subtle" };
}

export function SignalSummary({
  asset,
  freeze,
}: {
  asset: AssetAnalysis | null;
  freeze?: FrozenChartLevels | null;
}) {
  const setup = asset?.setup ?? null;
  const state = freeze?.state ?? asset?.setupState ?? "wait";
  const direction = freeze?.direction ?? setup?.direction;
  const digits = asset?.digits ?? 2;
  const entry =
    freeze?.entry ??
    (setup ? displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high) : null);
  const sl = freeze?.stopLoss ?? setup?.stopLoss ?? null;
  const tp1 = freeze?.takeProfit1 ?? setup?.takeProfit1 ?? null;
  const tp2 = freeze?.takeProfit2 ?? setup?.takeProfit2 ?? null;
  const rr = setup?.riskReward ?? null;
  const vol = asset ? volumeLabel(asset) : { text: "No disponible", ok: null };
  const t2 = asset ? t2Label(asset) : { text: "No disponible", tone: "text-subtle" };
  const structure = asset?.bias4hLabel?.trim() || "No disponible";
  const quality = setup?.quality ?? null;

  return (
    <dl className="atalaya-summary-grid" data-signal-summary>
      <Row
        label="Estado"
        value={
          <span
            className={cn(
              "atalaya-badge",
              state === "entry"
                ? "atalaya-badge-entry"
                : state === "pending"
                  ? "atalaya-badge-wait"
                  : state === "map"
                    ? "atalaya-badge-map"
                    : "atalaya-badge-muted",
            )}
          >
            {state === "entry" ? "ENTRY" : setupStateEs(state)}
          </span>
        }
      />
      <Row
        label="Dirección"
        value={
          direction ? (
            <span className={direction === "buy" ? "text-buy" : "text-sell"}>
              {direction === "buy" ? "BUY ↗" : "SELL ↘"}
            </span>
          ) : (
            "—"
          )
        }
      />
      <Row label="Precio entrada" value={entry != null ? formatPrice(entry, digits) : "—"} mono />
      <Row label="R:R" value={rr != null ? rr.toFixed(2).replace(".", ",") : "—"} mono />
      <Row
        label="SL"
        value={sl != null ? formatPrice(sl, digits) : "—"}
        mono
        className="text-sell"
      />
      <Row
        label="Calidad"
        value={
          quality ? (
            <span className={quality === "alta" ? "text-buy" : "text-muted"}>
              {quality === "alta" ? "Alta" : "Media"}
            </span>
          ) : (
            "—"
          )
        }
      />
      <Row
        label="TP1"
        value={tp1 != null ? formatPrice(tp1, digits) : "—"}
        mono
        className="text-buy"
      />
      <Row label="Sesión" value={asset ? sessionLabel(asset) : "No disponible"} />
      <Row
        label="TP2"
        value={tp2 != null ? formatPrice(tp2, digits) : "n/d"}
        mono
        className={tp2 != null ? "text-buy" : "text-subtle"}
      />
      <Row
        label="Estructura 4H"
        value={<span className="text-buy">{structure}</span>}
      />
      <Row label="T2" value={<span className={t2.tone}>{t2.text}</span>} />
      <Row
        label="Volumen"
        value={
          <span
            className={
              vol.ok === true ? "text-buy" : vol.ok === false ? "text-wait" : "text-subtle"
            }
          >
            {vol.text}
          </span>
        }
      />
    </dl>
  );
}

function Row({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="atalaya-summary-cell">
      <dt>{label}</dt>
      <dd className={cn(mono && "font-mono tabular", className)}>{value}</dd>
    </div>
  );
}
