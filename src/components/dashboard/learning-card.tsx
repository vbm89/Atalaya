import {
  LEARNING_SERIOUS_EPISODES,
  LEARNING_SETUP_MIN,
  entryHint,
  hypothesisRadar,
  learningRowsFrom,
  summarizeEpisodes,
  summarizeLearning,
} from "@/lib/learn/home-learning";

function formatR(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return `${sign}${Math.abs(value).toFixed(1).replace(".", ",")}R`;
}

function formatMean(value: number | null): string {
  return formatR(value);
}

export function LearningCard({ signals, ready }: { signals: unknown; ready: boolean }) {
  const rows = ready ? learningRowsFrom(signals) : [];
  const summary = summarizeLearning(rows);
  const episodes = summarizeEpisodes(rows);
  const radar = hypothesisRadar(episodes);
  const shownEpisodes = episodes.rows.slice(0, 6);
  const hiddenEpisodes = episodes.rows.length - shownEpisodes.length;
  const count = ready ? `${summary.complete} / ${summary.min}` : "—";

  return (
    <section className="atalaya-best atalaya-markets-span is-compact mt-3" data-learning-panel>
      <p className="text-[11px] font-semibold tracking-[0.14em] text-wait uppercase">🧠 Aprendizaje</p>
      <p className="mt-1 text-sm font-medium" data-learning-sample>
        {count} operaciones con telemetría
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">TP / SL</dt>
          <dd>{summary.tp == null || summary.sl == null ? "—" : `${summary.tp} / ${summary.sl}`}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">MFE medio</dt>
          <dd>{formatMean(summary.meanMfeR)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">MAE medio</dt>
          <dd>{formatMean(summary.meanMaeR)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">R acumulado</dt>
          <dd>{formatR(summary.netR)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Días</dt>
          <dd>{summary.days == null ? "—" : summary.days}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">SL con +0,5R previo</dt>
          <dd>{summary.slReachedPct == null ? "—" : `${summary.slReachedPct}%`}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-snug text-subtle" data-learning-entry>
        {ready ? entryHint(summary) : "Evidencia insuficiente"}
      </p>

      <div className="mt-3 border-t border-border/70 pt-2" data-learning-episodes>
        <p className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Por episodio</p>
        <p className="mt-1 text-xs text-subtle">
          {ready
            ? `${episodes.episodes} episodios · ${episodes.repeatedSignals} señales repetidas · ${episodes.withoutEpisodeId} sin episodeId`
            : "—"}
        </p>
        {shownEpisodes.length ? (
          <ul className="mt-1 space-y-1">
            {shownEpisodes.map((episode) => (
              <li key={episode.episodeId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">
                  {episode.asset} · {episode.setup}
                  {episode.signals > 1 ? ` · ${episode.signals} señales` : ""}
                </span>
                <span className="shrink-0 text-subtle">
                  {episode.result} {formatR(episode.resultR)} · MFE {formatMean(episode.mfeR)} · MAE {formatMean(episode.maeR)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-subtle">—</p>
        )}
        {hiddenEpisodes > 0 ? <p className="mt-1 text-[11px] text-subtle">y {hiddenEpisodes} episodios más</p> : null}
      </div>

      <div className="mt-3 border-t border-border/70 pt-2" data-learning-radar>
        <p className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">🔬 Radar de hipótesis</p>
        {radar.length ? (
          <ul className="mt-1 space-y-1.5">
            {radar.map((item) => (
              <li key={item.setup} className="text-xs leading-snug">
                <span className="font-medium">{item.setup}</span>
                <span className="text-subtle">
                  {" "}
                  · {item.episodes} episodios · {formatR(item.netR)}
                </span>
                <span className="mt-0.5 block text-subtle">{item.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-subtle">Evidencia insuficiente: 0 / 40 episodios mínimos</p>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-subtle">
        Referencia: {summary.min} cierres para el primer diagnóstico MFE/MAE. {LEARNING_SETUP_MIN} para activo y setup.{" "}
        {LEARNING_SERIOUS_EPISODES}–100 episodios para un análisis serio. Nada de esto cambia una entrada.
      </p>
    </section>
  );
}
