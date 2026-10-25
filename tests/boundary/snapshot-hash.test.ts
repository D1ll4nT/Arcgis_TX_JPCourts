import { describe, it, expect } from "vitest";
import { snapshotHash } from "../../src/boundary/snapshot-hash.js";
import type { PrecinctFeature } from "../../src/types.js";

const a: PrecinctFeature = {
  type: "Feature",
  properties: { county: "dallas", precinct: "1" },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
};
const b: PrecinctFeature = {
  type: "Feature",
  properties: { county: "dallas", precinct: "2" },
  geometry: { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] },
};

describe("snapshotHash", () => {
  it("is prefixed with sha256: and 64 hex chars", () => {
    expect(snapshotHash([a, b])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of input feature order (sorts by precinct)", () => {
    expect(snapshotHash([a, b])).toBe(snapshotHash([b, a]));
  });

  it("changes when a geometry changes", () => {
    const b2: PrecinctFeature = {
      ...b,
      geometry: { type: "Polygon", coordinates: [[[9, 9], [8, 9], [8, 8], [9, 8], [9, 9]]] },
    };
    expect(snapshotHash([a, b])).not.toBe(snapshotHash([a, b2]));
  });

  it("changes when a precinct's county label changes (not just geometry)", () => {
    const relabeled: PrecinctFeature = { ...a, properties: { ...a.properties, county: "collin" } };
    expect(snapshotHash([a, b])).not.toBe(snapshotHash([relabeled, b]));
  });
});
