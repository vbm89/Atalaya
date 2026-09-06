import { describe, expect, it } from "vitest";
import { buildShadowPatternReport } from "./shadow-patterns";

const base = { key: "k", label: "patrón", cases: 4, tp1OrBetter: 2, avgMfeR: 1.6, avgMaeR: 0.4 };

describe("buildShadowPatternReport", () => {
  it("keeps pattern evidence descriptive", () => {
    const result = buildShadowPatternReport({ groups: [base], cases: [], conclusion: "" });
    expect(result.totalCases).toBe(0);
    expect(result.patterns[0].tpRate).toBe(50);
    expect(result.patterns[0].evidence).toBe("DESCRIPTIVE");
  });
});
