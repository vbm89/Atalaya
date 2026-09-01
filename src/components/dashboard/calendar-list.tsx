import { formatTime } from "@/lib/utils";
import type { AnalysisSnapshot, AssetId } from "@/lib/trading/types";

const LABELS: Record<AssetId, string> = {
  XAUUSD: "Oro",
  BTCUSD: "BTC",
  US100: "US100",
  WTI: "WTI",
};

export function CalendarList({ snapshot }: { snapshot: AnalysisSnapshot }) {
  if (snapshot.calendar.length === 0) {
    return (
      <p className="rounded-[var(--radius-lg)] bg-surface px-4 py-4 text-sm text-muted shadow-[var(--shadow-border)]">
        {snapshot.calendarNote}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-muted">{snapshot.calendarNote}</p>
      {snapshot.calendar.map((e) => (
        <article
          key={e.id}
          className="rounded-[var(--radius-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-medium leading-snug">{e.title}</h3>
            <span
              className={
                e.impact === "alta"
                  ? "shrink-0 text-xs font-medium text-sell"
                  : "shrink-0 text-xs font-medium text-wait"
              }
            >
              {e.impact}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {e.country} · {formatTime(e.at)}
            {e.forecast ? ` · prev. ${e.forecast}` : ""}
            {e.previous ? ` · ant. ${e.previous}` : ""}
          </p>
          <p className="mt-2 text-xs text-subtle">
            Afecta: {e.assets.map((a) => LABELS[a]).join(", ")}
          </p>
        </article>
      ))}
    </div>
  );
}
