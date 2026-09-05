import type { AssetId, DataStatus, SetupState } from "@/lib/trading/types";
import { cn } from "@/lib/utils";
import {
  episodeMarketView,
  marketSessionKind,
  marketSessionLabel,
  type MarketSessionKind,
} from "@/lib/watch/market-session";

export function SessionBadge({
  id,
  dataStatus,
  now,
  compact = true,
}: {
  id: AssetId;
  dataStatus?: DataStatus | null;
  now?: number;
  compact?: boolean;
}) {
  const kind = marketSessionKind({ id, dataStatus, now });
  return <SessionKindBadge kind={kind} compact={compact} />;
}

export function SessionKindBadge({
  kind,
  compact = true,
}: {
  kind: MarketSessionKind;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "atalaya-badge",
        kind === "open" && "atalaya-badge-open",
        kind === "closed" && "atalaya-badge-closed",
        kind === "unknown" && "atalaya-badge-unknown",
      )}
      data-session-badge={kind}
    >
      <span
        className={cn(
          "atalaya-session-dot",
          kind === "open" && "is-open",
          kind === "closed" && "is-closed",
          kind === "unknown" && "is-unknown",
        )}
        aria-hidden
      />
      {kind === "closed"
        ? compact
          ? "CERRADO"
          : "MERCADO CERRADO"
        : marketSessionLabel(kind, compact)}
    </span>
  );
}

export function ClosedPendingNotice({
  id,
  setupState,
  dataStatus,
  now,
}: {
  id: AssetId;
  setupState: SetupState;
  dataStatus?: DataStatus | null;
  now?: number;
}) {
  const view = episodeMarketView({ id, setupState, dataStatus, now });
  if (!view.closedPending) return null;
  return (
    <div
      className="atalaya-closed-pending"
      data-market-closed-pending="1"
      data-operable="0"
    >
      <SessionKindBadge kind="closed" compact={false} />
      <p className="text-sm font-medium">Estado de Atalaya: {view.episodeLabel}</p>
      <p className="text-xs leading-snug text-subtle">{view.explain}</p>
    </div>
  );
}
