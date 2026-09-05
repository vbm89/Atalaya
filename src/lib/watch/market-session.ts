import type { DataStatus, SetupState } from "../trading/types";

/**
 * UI-only reading of the existing feed DataStatus.
 * Does not invent hours, sessions or V1 states.
 *
 *   session_closed → closed
 *   ok | stale     → open  (stale is delayed, not closed)
 *   anything else  → unknown
 */
export type MarketSessionKind = "open" | "closed" | "unknown";

export function marketSessionKind(status: DataStatus | null | undefined): MarketSessionKind {
  if (status === "session_closed") return "closed";
  if (status === "ok" || status === "stale") return "open";
  return "unknown";
}

export function marketSessionLabel(kind: MarketSessionKind, compact = false): string {
  if (kind === "open") return compact ? "ABIERTO" : "MERCADO ABIERTO";
  if (kind === "closed") return compact ? "CERRADO" : "MERCADO CERRADO";
  return compact ? "NO DISPONIBLE" : "ESTADO NO DISPONIBLE";
}

export interface SessionChip {
  kind: MarketSessionKind;
  label: string;
}

export interface SetupChip {
  key: "entry" | "pending" | "map" | "wait" | "dir";
  label: string;
  current: boolean;
}

/**
 * Visual hierarchy for a home tile. ENTRY stays first-class even if the
 * underlying is closed. MAPA/PENDING stay visible as last recorded data
 * but are not presented as an active hunt while closed/unknown.
 * WAIT/"Vigilando" only appears when the session is open.
 */
export function tileStatusChips(args: {
  dataStatus: DataStatus | null | undefined;
  setupState: SetupState;
  direction?: "buy" | "sell" | null;
}): {
  session: SessionChip;
  setups: SetupChip[];
  hunting: boolean;
  dim: boolean;
} {
  const kind = marketSessionKind(args.dataStatus);
  const hunting = kind === "open";
  const setups: SetupChip[] = [];

  if (args.setupState === "entry") {
    setups.push({ key: "entry", label: "ENTRY", current: true });
  } else if (args.setupState === "pending") {
    setups.push({ key: "pending", label: "PENDING", current: hunting });
  } else if (args.setupState === "map") {
    setups.push({ key: "map", label: "MAPA", current: hunting });
  } else if (hunting) {
    setups.push({ key: "wait", label: "Vigilando", current: true });
  }

  if (args.direction && args.setupState !== "wait") {
    setups.push({
      key: "dir",
      label: args.direction === "buy" ? "BUY ↗" : "SELL ↘",
      current: hunting || args.setupState === "entry",
    });
  }

  return {
    session: {
      kind,
      label: kind === "unknown" ? marketSessionLabel(kind, false) : marketSessionLabel(kind, true),
    },
    setups,
    hunting,
    dim: kind === "closed" && args.setupState !== "entry",
  };
}
