import { describe, it, expect } from "vitest";
import { situsWhere, parcelQueryUrl } from "../../src/parcel/situs-query.js";
import { PARCEL_SOURCES } from "../../src/parcel/parcel-sources.js";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";

const dallas = PARCEL_SOURCES.find((s) => s.county === "dallas")!;

describe("situs query", () => {
  it("builds an anchored situs LIKE from canonical components", () => {
    const a = normalizeAddress({ street: "411 N Elm St", city: "Dallas", zip: "75201", county: "Dallas" });
    expect(situsWhere(a, dallas)).toBe("SITEADDRESS LIKE '411 N ELM ST%'");
  });

  it("query url carries outSR=4326, returnGeometry, situs field, record cap", () => {
    const a = normalizeAddress({ street: "411 Elm St", city: "Dallas", zip: "75201", county: "Dallas" });
    const url = parcelQueryUrl(a, dallas);
    expect(url).toContain(`${dallas.url}/query?`);
    expect(url).toContain("outSR=4326");
    expect(url).toContain("returnGeometry=true");
    expect(url).toContain("resultRecordCount=100");
    expect(decodeURIComponent(url)).toContain("SITEADDRESS LIKE '411 ELM ST%'");
  });

  it("has all four counties with situs fields", () => {
    expect(PARCEL_SOURCES.map((s) => s.county).slice().sort()).toEqual(["collin", "dallas", "denton", "tarrant"]);
    expect(PARCEL_SOURCES.every((s) => s.situsField.length > 0 && s.url.startsWith("https://"))).toBe(true);
  });
});
