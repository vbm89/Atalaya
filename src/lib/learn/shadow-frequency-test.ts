import { buildShadowFrequencyReport } from "./shadow-frequency";

const ep = (id: string, day: string, entry = false) => ({
  case: { episodeId: id, openedAtMs: Date.parse(`${day}T10:00:00Z`) },
  events: entry ? [{ episodeId: id, fromState: "pending", toState: "entry", atMs: Date.parse(`${day}T10:15:00Z`), slot: 1 }] : [],
  bars: [],
} as any);

describe("buildShadowFrequencyReport", () => {
  it("separates V1 entries from EXTRA candidates and counts expired as undecided", () => {
    const episodes = [ep("a", "2026-09-10", true), ep("b", "2026-09-10", false)];
    const results = [
      { episodeId: "a", outcome: "tp1" },
      { episodeId: "b", outcome: "expired" },
    ] as any;
    const report = buildShadowFrequencyReport(episodes, results);
    expect(report.days[0]).toMatchObject({ v1Entries: 1, shadowCandidates: 2, shadowDecided: 1, extraCandidates: 1, extraDecided: 0 });
  });
});
