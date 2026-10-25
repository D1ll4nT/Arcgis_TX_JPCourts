import { describe, it, expect } from "vitest";
import { featureSetToNormalized } from "../../src/boundary/esri-to-geojson.js";

// A minimal Esri polygon ring (a unit square) in WGS84.
const squareRings = [[[-96.8, 32.7], [-96.7, 32.7], [-96.7, 32.8], [-96.8, 32.8], [-96.8, 32.7]]];

describe("featureSetToNormalized", () => {
  it("maps Dallas DISTRICT features to normalized GeoJSON", () => {
    const out = featureSetToNormalized("dallas", {
      features: [{ attributes: { DISTRICT: 1 }, geometry: { rings: squareRings } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.properties).toEqual({ county: "dallas", precinct: "1" });
    expect(out[0]!.geometry.type).toBe("Polygon");
    expect(out[0]!.geometry.coordinates[0]![0]).toEqual([-96.8, 32.7]);
  });

  it("throws on an ArcGIS error payload", () => {
    expect(() => featureSetToNormalized("dallas", { error: { code: 400 } })).toThrow(/ArcGIS error/);
  });

  it("throws on exceededTransferLimit (never silently truncate)", () => {
    expect(() =>
      featureSetToNormalized("dallas", { features: [], exceededTransferLimit: true }),
    ).toThrow(/exceededTransferLimit/);
  });

  it("throws when zero features come back", () => {
    expect(() => featureSetToNormalized("tarrant", { features: [] })).toThrow(/zero features/);
  });
});
