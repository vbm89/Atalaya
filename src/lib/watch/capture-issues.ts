import type { EpisodeDraft } from "./episode";

/** Capture gaps detected after a tick. Log only — never repair or backfill. */
export type CaptureIssueKind = "missing_freeze" | "missing_tape_15m" | "missing_context";

export interface CaptureIssue {
  episodeId: string;
  kind: CaptureIssueKind;
}

export function diagnoseBornFreeze(born: readonly EpisodeDraft[]): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  for (const ep of born) {
    if (ep.freeze == null) {
      issues.push({ episodeId: ep.episodeId, kind: "missing_freeze" });
    }
  }
  return issues;
}

export function diagnoseBornSidecar(
  born: readonly { episodeId: string; tape15mCount: number; hasContext: boolean }[],
): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  for (const row of born) {
    if (row.tape15mCount <= 0) {
      issues.push({ episodeId: row.episodeId, kind: "missing_tape_15m" });
    }
    if (!row.hasContext) {
      issues.push({ episodeId: row.episodeId, kind: "missing_context" });
    }
  }
  return issues;
}

export function logCaptureIssues(issues: readonly CaptureIssue[]): void {
  for (const issue of issues) {
    console.info("[capture] gap", {
      episodeId: issue.episodeId,
      kind: issue.kind,
      repair: false,
    });
  }
}
