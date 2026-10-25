import { describe, it, expect } from "vitest";
import { matchParcel } from "../../src/parcel/parcel-match.js";
import { assessCertainty } from "../../src/resolve/certainty.js";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import { esriSquare } from "../fixtures/esri-parcel.js";

const addr = normalizeAddress({ street: "411 Elm St", city: "Dallas", zip: "75201", county: "Dallas" });

describe("matchParcel", () => {
  it("returns the parcel for an exact situs match", () => {
    const fs = [{ attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.78, 32.745, 0.001) }];
    expect(matchParcel(fs, addr, "SITEADDRESS")?.type).toBe("Polygon");
  });

  it("rejects the anchored over-match (4411 ELM ST)", () => {
    const fs = [{ attributes: { SITEADDRESS: "4411 ELM ST" }, geometry: esriSquare(-96.7, 32.7, 0.001) }];
    expect(matchParcel(fs, addr, "SITEADDRESS")).toBeNull();
  });

  it("matches Collin multi-line situs on the street portion only", () => {
    const fs = [{ attributes: { situs_disp: "411 ELM ST \r\nMCKINNEY, TX 75069" }, geometry: esriSquare(-96.6, 33.1, 0.001) }];
    expect(matchParcel(fs, addr, "situs_disp")?.type).toBe("Polygon");
  });

  it("combines co-located duplicate parcels into one footprint", () => {
    const fs = [
      { attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.78, 32.745, 0.001) },
      { attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.7805, 32.745, 0.001) }, // overlaps the first
    ];
    expect(matchParcel(fs, addr, "SITEADDRESS")?.type).toBe("MultiPolygon");
  });

  it("returns null when exact matches are divergent (ambiguous)", () => {
    const fs = [
      { attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.78, 32.745, 0.001) },
      { attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.5, 32.9, 0.001) }, // far away
    ];
    expect(matchParcel(fs, addr, "SITEADDRESS")).toBeNull();
  });

  it("returns null for no matches and for non-polygon geometry", () => {
    expect(matchParcel([], addr, "SITEADDRESS")).toBeNull();
    const pointGeom = [{ attributes: { SITEADDRESS: "411 ELM ST" }, geometry: { x: -96.78, y: 32.745 } }];
    expect(matchParcel(pointGeom, addr, "SITEADDRESS")).toBeNull();
  });

  it("a matched parcel inside one precinct yields high via assessCertainty (wiring)", () => {
    // Parcel fully inside the WEST square (precinct "1": -96.80..-96.75, 32.70..32.80).
    const fs = [{ attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.775, 32.745, 0.002) }];
    const parcel = matchParcel(fs, addr, "SITEADDRESS")!;
    // D-worker derives the point via turf pointOnFeature; here the fixture's center is a known interior point.
    const r = assessCertainty(
      { lon: -96.775, lat: 32.745, method: "parcel", precisionMeters: 5, parcelGeometry: parcel },
      twoPrecincts,
    );
    expect(r.confidence).toBe("high");
    expect(r.precinct).toBe("1");
  });
});
