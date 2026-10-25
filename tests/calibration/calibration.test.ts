// tests/calibration/calibration.test.ts
import { describe, it, expect } from "vitest";
import { calibrate } from "../../src/calibration/calibrate.js";
import { calibrationCorpus } from "../fixtures/calibration-corpus.js";
import { loadBoundariesFromDisk } from "../../src/boundary/node-loader.js";

describe("calibration gate (cannot be confidently wrong)", () => {
  const report = calibrate(calibrationCorpus(), loadBoundariesFromDisk());

  it("has ZERO false-high answers", () => {
    // A false-high is a `high` answer with the wrong or out-of-scope precinct —
    // the one catastrophic outcome for a legally load-bearing lookup. If this
    // fails, the message lists exactly which cases regressed.
    expect(report.falseHigh).toEqual([]);
  });

  it("surfaces coverage (reported, not gated)", () => {
    console.log(
      `[calibration] coverage ${report.coveragePct}% ` +
        `(${report.trueHigh}/${report.inScope} in-scope high), ` +
        `${report.safeAbstentions} safe abstentions, ${report.total} cases`,
    );
    expect(report.total).toBeGreaterThan(0);
    expect(report.trueHigh).toBeGreaterThan(0);
  });
});
