import { describe, it, expect } from "vitest";
import type { Feature, LineString } from "geojson";
import { featureToTigerEdge } from "../../src/geocode/tiger-edge.js";

const feature: Feature<LineString> = {
  type: "Feature",
  properties: {
    FULLNAME: "Church Rd", ROADFLG: "Y",
    LFROMADD: "9200", LTOADD: "9298", RFROMADD: "9201", RTOADD: "9299",
    ZIPL: "75231", ZIPR: "75231",
  },
  geometry: { type: "LineString", coordinates: [[-96.732, 32.885], [-96.731, 32.886], [-96.730, 32.887]] },
};

describe("featureToTigerEdge", () => {
  it("maps DBF attributes and edge endpoints", () => {
    expect(featureToTigerEdge(feature)).toEqual({
      fullName: "Church Rd", roadFlag: true,
      lFromAdd: "9200", lToAdd: "9298", rFromAdd: "9201", rToAdd: "9299",
      zipL: "75231", zipR: "75231",
      start: [-96.732, 32.885], end: [-96.730, 32.887],
    });
  });

  it("coerces missing attributes safely (never throws)", () => {
    const bare: Feature<LineString> = {
      type: "Feature", properties: null,
      geometry: { type: "LineString", coordinates: [[-96, 32], [-96, 33]] },
    };
    const e = featureToTigerEdge(bare);
    expect(e).toMatchObject({ fullName: "", roadFlag: false, lFromAdd: "", zipL: null });
  });
});
