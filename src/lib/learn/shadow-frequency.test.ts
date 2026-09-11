import { buildShadowFrequencyReport } from "./shadow-frequency";

test("frequency scoreboard separates V1 and EXTRA", () => {
  const day = "2026-09-10";
  const episodes = [
    { case: { episodeId: "a", openedAtMs: Date.parse(`${day}T10:00:00Z`) }, events: [{ toState: "entry", slot: 1 }] },
    { case: { episodeId: "b", openedAtMs: Date.parse(`${day}T11:00:00Z`) }, events: [] },
  ] as any;
  const results = [
    { episodeId: "a", outcome: "tp1" },
    { episodeId: "b", outcome: "expired" },
  ] as any;
  expect(buildShadowFrequencyReport(episodes, results).days[0]).toMatchObject({ v1Entries: 1, shadowCandidates: 2, shadowDecided: 1, extraCandidates: 1, extraDecided: 0 });
});
