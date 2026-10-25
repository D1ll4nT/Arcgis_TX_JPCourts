import { describe, it, expect } from "vitest";
import type { Polygon, MultiPolygon } from "geojson";
import { assessCertainty } from "../../src/resolve/certainty.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import { twoCounties } from "../fixtures/two-counties.js";

// Small parcel fully inside the WEST square (precinct "1").
const parcelInside: Polygon = {
  type: "Polygon",
  coordinates: [[[-96.78, 32.74], [-96.77, 32.74], [-96.77, 32.75], [-96.78, 32.75], [-96.78, 32.74]]],
};
// Parcel straddling the shared line lon=-96.75 (precincts "1" and "2").
const parcelStraddle: Polygon = {
  type: "Polygon",
  coordinates: [[[-96.755, 32.74], [-96.745, 32.74], [-96.745, 32.75], [-96.755, 32.75], [-96.755, 32.74]]],
};

describe("assessCertainty", () => {
  it("parcel fully within one precinct → high", () => {
    const r = assessCertainty(
      { lon: -96.775, lat: 32.745, method: "parcel", precisionMeters: 5, parcelGeometry: parcelInside },
      twoPrecincts,
    );
    expect(r.confidence).toBe("high");
    expect(r.precinct).toBe("1");
  });

  it("MultiPolygon parcel (co-located same-situs parcels) within one precinct → high, no throw", () => {
    // matchParcel combines co-located same-situs parcels (duplex / split lot)
    // into a MultiPolygon. @turf/boolean-within rejects a MultiPolygon first
    // arg, which used to throw → top-level 503. Both parts sit inside WEST ("1").
    const multi: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [[[-96.78, 32.74], [-96.775, 32.74], [-96.775, 32.745], [-96.78, 32.745], [-96.78, 32.74]]],
        [[[-96.775, 32.745], [-96.77, 32.745], [-96.77, 32.75], [-96.775, 32.75], [-96.775, 32.745]]],
      ],
    };
    const r = assessCertainty(
      { lon: -96.775, lat: 32.745, method: "parcel", precisionMeters: 5, parcelGeometry: multi },
      twoPrecincts,
    );
    expect(r.confidence).toBe("high");
    expect(r.precinct).toBe("1");
  });

  it("parcel straddling the line → needs_verification with both candidates", () => {
    const r = assessCertainty(
      { lon: -96.75, lat: 32.745, method: "parcel", precisionMeters: 5, parcelGeometry: parcelStraddle },
      twoPrecincts,
    );
    expect(r.confidence).toBe("needs_verification");
    expect(r.precinct).toBeNull();
    expect(r.candidatePrecincts).toEqual(["1", "2"]);
  });

  it("point near the boundary within method precision → needs_verification", () => {
    // ~25 m west of the shared line; census precision 60 m straddles it.
    const r = assessCertainty(
      { lon: -96.7503, lat: 32.75, method: "census", precisionMeters: 60 },
      twoPrecincts,
    );
    expect(r.confidence).toBe("needs_verification");
    expect(r.candidatePrecincts).toEqual(["1", "2"]);
  });

  it("point clear of boundary but census-located → review", () => {
    const r = assessCertainty(
      { lon: -96.79, lat: 32.75, method: "census", precisionMeters: 60 },
      twoPrecincts,
    );
    expect(r.confidence).toBe("review");
    expect(r.precinct).toBe("1");
  });

  it("point well clear of boundary, high-precision method → high", () => {
    const r = assessCertainty(
      { lon: -96.79, lat: 32.75, method: "parcel", precisionMeters: 5 },
      twoPrecincts,
    );
    expect(r.confidence).toBe("high");
    expect(r.precinct).toBe("1");
  });
});

describe("assessCertainty — cross-county straddle (same precinct number)", () => {
  it("parcel straddling a county line is needs_verification, never high", () => {
    const parcel: Polygon = {
      type: "Polygon",
      coordinates: [[[-96.755, 32.74], [-96.745, 32.74], [-96.745, 32.75], [-96.755, 32.75], [-96.755, 32.74]]],
    };
    const r = assessCertainty(
      { lon: -96.75, lat: 32.745, method: "parcel", precisionMeters: 5, parcelGeometry: parcel },
      twoCounties,
    );
    expect(r.confidence).toBe("needs_verification");
    expect(r.precinct).toBeNull();
    expect(r.candidatePrecincts).toEqual(["collin/2", "dallas/2"]);
  });

  it("point near the county line discloses both counties", () => {
    const r = assessCertainty(
      { lon: -96.7503, lat: 32.75, method: "census", precisionMeters: 60 },
      twoCounties,
    );
    expect(r.confidence).toBe("needs_verification");
    expect(r.candidatePrecincts).toEqual(["collin/2", "dallas/2"]);
  });
});
