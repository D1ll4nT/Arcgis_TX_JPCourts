import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadBoundariesFromDisk } from "../../src/boundary/node-loader.js";
import { assessCertainty } from "../../src/resolve/certainty.js";

const features = loadBoundariesFromDisk();
const points = JSON.parse(
  readFileSync(new URL("../fixtures/near-boundary-points.json", import.meta.url), "utf8"),
) as Array<{
  label: string;
  county: string;
  lon: number;
  lat: number;
  candidatePrecincts: string[];
  sharedBoundaryGapMeters: number;
}>;

describe("near-boundary points (derived from real shared precinct edges)", () => {
  it("covers all four counties", () => {
    expect(new Set(points.map((p) => p.county))).toEqual(
      new Set(["dallas", "tarrant", "collin", "denton"]),
    );
  });

  for (const p of points) {
    it(`${p.label} → needs_verification spanning ${p.candidatePrecincts.join("/")}`, () => {
      // Precision generously covers the measured shared-boundary gap so both
      // adjacent precincts always surface, regardless of source topology.
      const precisionMeters = Math.ceil(p.sharedBoundaryGapMeters) + 60;
      const r = assessCertainty(
        { lon: p.lon, lat: p.lat, method: "census", precisionMeters },
        features,
      );
      expect(r.confidence).toBe("needs_verification");
      // Both precincts that share this boundary must surface as candidates.
      for (const precinct of p.candidatePrecincts) {
        expect(r.candidatePrecincts).toContain(precinct);
      }
    });
  }
});
