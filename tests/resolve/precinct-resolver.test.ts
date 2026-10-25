import { describe, it, expect } from "vitest";
import { resolvePrecinct } from "../../src/resolve/precinct-resolver.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";

describe("resolvePrecinct", () => {
  it("returns the containing precinct (west square)", () => {
    expect(resolvePrecinct(-96.78, 32.75, twoPrecincts)).toEqual({ county: "dallas", precinct: "1" });
  });
  it("returns the containing precinct (east square)", () => {
    expect(resolvePrecinct(-96.72, 32.75, twoPrecincts)).toEqual({ county: "dallas", precinct: "2" });
  });
  it("returns null when the point is in no precinct", () => {
    expect(resolvePrecinct(-95.0, 32.75, twoPrecincts)).toBeNull();
  });
  it("throws on invalid coordinates", () => {
    expect(() => resolvePrecinct(NaN, 32.75, twoPrecincts)).toThrow(RangeError);
    expect(() => resolvePrecinct(-200, 32.75, twoPrecincts)).toThrow(RangeError);
  });
  it("throws on out-of-range latitude", () => {
    expect(() => resolvePrecinct(-96.78, 200, twoPrecincts)).toThrow(RangeError);
  });
});
