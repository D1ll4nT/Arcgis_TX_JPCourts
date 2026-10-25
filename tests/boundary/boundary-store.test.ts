import { describe, it, expect } from "vitest";
import { loadBoundariesFromDisk } from "../../src/boundary/node-loader.js";
import { createBoundaryStore } from "../../src/boundary/boundary-store.js";

describe("boundary store (committed snapshots)", () => {
  const store = createBoundaryStore(loadBoundariesFromDisk());

  it("loads all 23 precincts", () => {
    expect(store.all()).toHaveLength(23);
  });

  it("has the right per-county counts", () => {
    expect(store.byCounty("dallas")).toHaveLength(5);
    expect(store.byCounty("tarrant")).toHaveLength(8);
    expect(store.byCounty("collin")).toHaveLength(4);
    expect(store.byCounty("denton")).toHaveLength(6);
  });

  it("every feature has a county + non-empty precinct + polygon geometry", () => {
    for (const f of store.all()) {
      expect(["dallas", "tarrant", "collin", "denton"]).toContain(f.properties.county);
      expect(f.properties.precinct).toMatch(/^\d+$/);
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry.type);
    }
  });
});
