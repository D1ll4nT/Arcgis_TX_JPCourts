import { describe, it, expect } from "vitest";
import type { Polygon } from "geojson";
import { distanceToPolygonBoundary, ringsOf } from "../../src/geo/boundary-distance.js";

const square: Polygon = {
  type: "Polygon",
  coordinates: [[[-96.80, 32.70], [-96.75, 32.70], [-96.75, 32.80], [-96.80, 32.80], [-96.80, 32.70]]],
};

describe("distanceToPolygonBoundary", () => {
  it("is ~0 for a point on the boundary", () => {
    expect(distanceToPolygonBoundary(-96.75, 32.75, square)).toBeLessThan(1);
  });
  it("returns a sensible distance for an interior point near one edge", () => {
    const d = distanceToPolygonBoundary(-96.751, 32.75, square); // ~0.001deg lon inside the -96.75 edge
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(150);
  });
  it("ringsOf returns one ring of 5 coords for a simple square", () => {
    expect(ringsOf(square)).toHaveLength(1);
    expect(ringsOf(square)[0]).toHaveLength(5);
  });
});
