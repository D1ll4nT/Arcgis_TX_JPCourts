import { describe, it, expect } from "vitest";
import { calibrate } from "../../src/calibration/calibrate.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import type { CalibrationCase } from "../../src/types.js";

// Center of the WEST square (precinct "1") — far from any boundary.
const interiorWest: CalibrationCase = {
  label: "interior-west",
  lon: -96.775,
  lat: 32.75,
  method: "address-point",
  precisionMeters: 5,
  expectedCounty: "dallas",
  expectedPrecinct: "1",
};

// ~19 m west of the shared line at -96.75; precision 60 m straddles it.
const nearLine: CalibrationCase = {
  label: "near-line",
  lon: -96.7502,
  lat: 32.75,
  method: "address-point",
  precisionMeters: 60,
  expectedCounty: "dallas",
  expectedPrecinct: null,
};

describe("calibrate", () => {
  it("counts a correct high answer as trueHigh with zero falseHigh", () => {
    const r = calibrate([interiorWest], twoPrecincts);
    expect(r.falseHigh).toEqual([]);
    expect(r.trueHigh).toBe(1);
    expect(r.coveragePct).toBe(100);
  });

  it("flags a high answer with the wrong precinct as falseHigh", () => {
    const mislabel: CalibrationCase = { ...interiorWest, label: "mislabel", expectedPrecinct: "2" };
    const r = calibrate([mislabel], twoPrecincts);
    expect(r.falseHigh).toHaveLength(1);
    expect(r.falseHigh[0]).toMatchObject({
      label: "mislabel",
      expectedPrecinct: "2",
      gotPrecinct: "1",
    });
    expect(r.trueHigh).toBe(0);
  });

  it("treats a near-boundary abstention as safe, never false", () => {
    const r = calibrate([nearLine], twoPrecincts);
    expect(r.falseHigh).toEqual([]);
    expect(r.safeAbstentions).toBe(1);
  });

  it("computes coverage over in-scope cases only", () => {
    const r = calibrate([interiorWest, nearLine], twoPrecincts);
    expect(r.total).toBe(2);
    expect(r.inScope).toBe(1); // nearLine has expectedPrecinct null → out of coverage denominator
    expect(r.coveragePct).toBe(100);
  });
});
