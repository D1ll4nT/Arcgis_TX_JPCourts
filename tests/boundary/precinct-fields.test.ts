import { describe, it, expect } from "vitest";
import { extractPrecinct } from "../../src/boundary/precinct-fields.js";
import { SOURCES } from "../../src/boundary/sources.js";

describe("SOURCES", () => {
  it("has the Core 4 with the locked precinct fields", () => {
    expect(SOURCES.map((s) => [s.county, s.precinctField])).toEqual([
      ["dallas", "DISTRICT"],
      ["tarrant", "JP"],
      ["collin", "name"],
      ["denton", "JP_C"],
    ]);
  });
});

describe("extractPrecinct", () => {
  it("Dallas: stringifies integer DISTRICT", () => {
    expect(extractPrecinct("dallas", { DISTRICT: 3 })).toBe("3");
  });
  it("Tarrant: passes through string JP", () => {
    expect(extractPrecinct("tarrant", { JP: "8" })).toBe("8");
  });
  it("Denton: passes through string JP_C", () => {
    expect(extractPrecinct("denton", { JP_C: "6" })).toBe("6");
  });
  it("Collin: parses the digit out of 'JP: Precinct N'", () => {
    expect(extractPrecinct("collin", { name: "JP: Precinct 3" })).toBe("3");
  });
  it("Collin: throws when name has no precinct number", () => {
    expect(() => extractPrecinct("collin", { name: "Constable 2" })).toThrow(/parse/i);
  });
  it("throws when the precinct field is missing/non-numeric", () => {
    expect(() => extractPrecinct("dallas", { DISTRICT: null })).toThrow(/DISTRICT/);
    expect(() => extractPrecinct("tarrant", { JP: "n/a" })).toThrow(/JP/);
  });
});
