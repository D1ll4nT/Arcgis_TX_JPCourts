import { describe, it, expect } from "vitest";
import { streetKeyFromParts } from "../../src/geocode/street-key.js";
import type { StreetParts } from "../../src/types.js";

const parts = (over: Partial<StreetParts>): StreetParts => ({
  primaryNumber: "", preDirectional: null, streetName: "", streetSuffix: null, postDirectional: null, ...over,
});

describe("streetKeyFromParts", () => {
  it("joins name + suffix with empty directional slots", () => {
    expect(streetKeyFromParts(parts({ streetName: "CHURCH", streetSuffix: "RD" }))).toBe("|CHURCH|RD|");
  });

  it("includes leading and trailing directionals", () => {
    expect(
      streetKeyFromParts(parts({ preDirectional: "N", streetName: "FIELD", streetSuffix: "ST", postDirectional: "W" })),
    ).toBe("N|FIELD|ST|W");
  });

  it("renders a suffixless street name", () => {
    expect(streetKeyFromParts(parts({ streetName: "BROADWAY" }))).toBe("|BROADWAY||");
  });
});
