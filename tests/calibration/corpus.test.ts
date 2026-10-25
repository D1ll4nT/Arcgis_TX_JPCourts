import { describe, it, expect } from "vitest";
import { calibrationCorpus } from "../fixtures/calibration-corpus.js";

describe("calibrationCorpus", () => {
  const cases = calibrationCorpus();

  it("is non-empty and covers all four counties", () => {
    const counties = new Set(cases.map((c) => c.expectedCounty));
    for (const c of ["dallas", "tarrant", "collin", "denton"]) {
      expect(counties).toContain(c);
    }
  });

  it("includes at least one out-of-scope negative (expectedCounty null)", () => {
    expect(cases.some((c) => c.expectedCounty === null)).toBe(true);
  });

  it("includes near-boundary abstention cases (a county, but expectedPrecinct null)", () => {
    expect(cases.some((c) => c.expectedCounty !== null && c.expectedPrecinct === null)).toBe(true);
  });

  it("gives every case a positive precision and a method", () => {
    for (const c of cases) {
      expect(c.precisionMeters).toBeGreaterThan(0);
      expect(c.method).toBe("address-point");
    }
  });
});
