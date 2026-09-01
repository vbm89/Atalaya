import { cn } from "@/lib/utils";
import type { WatchPhase } from "@/lib/watch/memory";
import type { RiskBand, SetupQuality, Signal, TradeDecision } from "@/lib/trading/types";

const SIGNAL: Record<Signal, { label: string; className: string; dot: string }> = {
  buy: {
    label: "COMPRA",
    className: "bg-buy-dim text-buy",
    dot: "bg-buy",
  },
  sell: {
    label: "VENTA",
    className: "bg-sell-dim text-sell",
    dot: "bg-sell",
  },
  wait: {
    label: "ESPERAR",
    className: "bg-wait-dim text-wait",
    dot: "bg-wait",
  },
  map: {
    label: "MAPA",
    className: "bg-map-dim text-map",
    dot: "bg-map",
  },
  pending: {
    label: "TRIGGER PENDIENTE",
    className: "bg-wait-dim text-wait",
    dot: "bg-wait",
  },
};

export function SignalBadge({
  signal,
  large,
}: {
  signal: Signal;
  large?: boolean;
}) {
  const s = SIGNAL[signal];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium tracking-wide",
        large ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
        s.className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function WatchPhaseBadge({
  phase,
  signal,
  large,
}: {
  phase: WatchPhase;
  signal: Signal;
  large?: boolean;
}) {
  if (phase === "expired") {
    return (
      <span
        data-watch-phase="expired"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium tracking-wide bg-wait-dim text-wait",
          large ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs",
        )}
      >
        <span className="size-1.5 rounded-full bg-wait" />
        CADUCADA
      </span>
    );
  }
  return <SignalBadge signal={signal} large={large} />;
}

const DECISION: Record<TradeDecision, { label: string; className: string }> = {
  yes: { label: "Sí", className: "text-buy" },
  wait: { label: "Tú decides", className: "text-wait" },
  no: { label: "No", className: "text-sell" },
};

export function DecisionBadge({ decision }: { decision: TradeDecision }) {
  const d = DECISION[decision];
  return (
    <span className={cn("font-semibold", d.className)}>{d.label}</span>
  );
}

export function QualityBadge({ quality }: { quality: SetupQuality }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium tracking-wide",
        quality === "alta" ? "bg-buy-dim text-buy" : "bg-elevated text-muted",
      )}
    >
      {quality === "alta" ? "ALTA" : "MEDIA"}
    </span>
  );
}

const RISK: Record<RiskBand, { label: string; className: string }> = {
  bajo: { label: "BAJO", className: "bg-buy-dim text-buy" },
  medio: { label: "MEDIO", className: "bg-wait-dim text-wait" },
  alto: { label: "ALTO", className: "bg-wait-dim text-wait" },
  muy_alto: { label: "MUY ALTO", className: "bg-sell-dim text-sell" },
  extremo: { label: "EXTREMO", className: "bg-sell-dim text-sell" },
};

export function RiskBadge({ band }: { band: RiskBand }) {
  const r = RISK[band];
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium tracking-wide",
        r.className,
      )}
    >
      {r.label}
    </span>
  );
}
