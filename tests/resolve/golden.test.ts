import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadBoundariesFromDisk } from "../../src/boundary/node-loader.js";
import { resolvePrecinct } from "../../src/resolve/precinct-resolver.js";

const golden = JSON.parse(
  readFileSync(new URL("../fixtures/golden-points.json", import.meta.url), "utf8"),
) as Array<{
  label: string;
  lon: number;
  lat: number;
  expectedCounty: string | null;
  expectedPrecinct: string | null;
}>;

const features = loadBoundariesFromDisk();

describe("golden points (public DFW landmarks)", () => {
  it("has coverage for all four counties + an out-of-scope case", () => {
    const counties = new Set(golden.map((g) => g.expectedCounty));
    expect(counties).toContain("dallas");
    expect(counties).toContain("tarrant");
    expect(counties).toContain("collin");
    expect(counties).toContain("denton");
    expect(counties).toContain(null); // Rockwall negative
  });

  for (const g of golden) {
    it(`${g.label} → ${g.expectedCounty ?? "null"}/${g.expectedPrecinct ?? "-"}`, () => {
      const match = resolvePrecinct(g.lon, g.lat, features);
      expect(match?.county ?? null).toBe(g.expectedCounty);
      expect(match?.precinct ?? null).toBe(g.expectedPrecinct);
    });
  }

  it("corrects a common county mislabel (The Colony is Denton, not Dallas)", () => {
    const colony = golden.find((g) => g.label.startsWith("denton-the-colony"))!;
    expect(colony.expectedCounty).toBe("denton"); // fixture sanity
    const match = resolvePrecinct(colony.lon, colony.lat, features);
    expect(match?.county ?? null).toBe("denton"); // resolver actually corrects it
  });
});
