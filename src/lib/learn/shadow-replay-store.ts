import type { SqlQuery } from "@/lib/watch/store";
import type { ShadowAnalysisReport } from "./shadow-analysis";

export const SHADOW_REPLAY_METHODOLOGY = "shadow-v2-phase-a-1";

export interface StoredShadowReplayReport {
  id: number;
  methodologyVersion: string;
  generatedAt: string;
  episodesAnalyzed: number;
  episodesWith15mTape: number;
  episodesWithGaps: number;
  extraTestN: number;
  evidenceLabel: string;
  report: ShadowAnalysisReport;
}

export async function saveShadowReplayReport(
  sql: SqlQuery,
  report: ShadowAnalysisReport,
  generatedAt = new Date().toISOString(),
): Promise<void> {
  const extraTestN = Math.max(0, ...report.comparisons.map((c) => c.extraTestN));
  const evidenceLabel = report.comparisons.length
    ? report.comparisons.reduce((best, c) => c.extraTestN > best.extraTestN ? c : best).evidenceLabel
    : "INSUFFICIENT";
  await sql.query(
    `insert into shadow_replay_reports
      (methodology_version, generated_at, episodes_analyzed, episodes_with_15m_tape,
       episodes_with_gaps, extra_test_n, evidence_label, report)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      SHADOW_REPLAY_METHODOLOGY,
      generatedAt,
      report.replay.episodesAnalyzed,
      report.replay.episodesWith15mTape,
      report.replay.episodesWithGaps,
      extraTestN,
      evidenceLabel,
      JSON.stringify(report),
    ],
  );
}

export async function getLatestShadowReplayReport(sql: SqlQuery): Promise<StoredShadowReplayReport | null> {
  try {
    const rows = await sql.query<Record<string, unknown>>(
      `select id, methodology_version, generated_at, episodes_analyzed, episodes_with_15m_tape,
              episodes_with_gaps, extra_test_n, evidence_label, report
       from shadow_replay_reports
       order by generated_at desc, id desc limit 1`,
    );
    const row = rows[0];
    if (!row) return null;
    const report = typeof row.report === "string" ? JSON.parse(row.report) : row.report;
    return {
      id: Number(row.id),
      methodologyVersion: String(row.methodology_version),
      generatedAt: new Date(String(row.generated_at)).toISOString(),
      episodesAnalyzed: Number(row.episodes_analyzed),
      episodesWith15mTape: Number(row.episodes_with_15m_tape),
      episodesWithGaps: Number(row.episodes_with_gaps),
      extraTestN: Number(row.extra_test_n),
      evidenceLabel: String(row.evidence_label),
      report: report as ShadowAnalysisReport,
    };
  } catch {
    return null;
  }
}
