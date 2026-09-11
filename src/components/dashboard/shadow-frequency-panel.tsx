import type { ShadowFrequencyDensityReport } from "../../lib/learn/shadow-frequency";

export function ShadowFrequencyPanel({ report }: { report: ShadowFrequencyDensityReport | null }) {
  if (!report) return null;
  return (
    <section aria-label="Shadow frecuencia">
      <h2>Frecuencia Shadow V2</h2>
      <p>
        Objetivo de investigación: {report.targetMin}–{report.targetMax} oportunidades/día. No es un objetivo de ejecución.
      </p>
      <p>
        Media actual: {report.averageCandidatesPerDay == null ? "—" : report.averageCandidatesPerDay.toFixed(1)}/día
        {report.averageExtraCandidatesPerDay == null ? "" : ` · EXTRA ${report.averageExtraCandidatesPerDay.toFixed(1)}/día`}
      </p>
      <p>{report.targetReached ? "Densidad objetivo alcanzada en el histórico disponible." : "Aún no hay densidad suficiente en el histórico disponible."}</p>
      <p>{report.limitation}</p>
      {report.days.length > 0 && (
        <ul>
          {report.days.slice(-7).map((d) => (
            <li key={d.day}>
              {d.day}: {d.shadowCandidates} candidatos · {d.extraCandidates} EXTRA · {d.shadowWins} TP · {d.shadowLosses} SL
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
