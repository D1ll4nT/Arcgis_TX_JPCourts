import { describe, it, expect } from "vitest";
import { parseStreetLine } from "../../src/geocode/normalize-address.js";

describe("parseStreetLine", () => {
  it("splits number + name + USPS suffix", () => {
    expect(parseStreetLine("9250 Church Rd")).toEqual({
      primaryNumber: "9250", preDirectional: null, streetName: "CHURCH",
      streetSuffix: "RD", postDirectional: null,
    });
  });

  it("standardizes a long suffix and a leading directional", () => {
    expect(parseStreetLine("1600 North Field Street")).toEqual({
      primaryNumber: "1600", preDirectional: "N", streetName: "FIELD",
      streetSuffix: "ST", postDirectional: null,
    });
  });

  it("captures a trailing directional", () => {
    expect(parseStreetLine("100 Main St N")).toEqual({
      primaryNumber: "100", preDirectional: null, streetName: "MAIN",
      streetSuffix: "ST", postDirectional: "N",
    });
  });

  it("keeps a suffixless street name intact (no over-parsing)", () => {
    expect(parseStreetLine("1600 Broadway")).toEqual({
      primaryNumber: "1600", preDirectional: null, streetName: "BROADWAY",
      streetSuffix: null, postDirectional: null,
    });
  });

  it("strips an apartment/unit tail", () => {
    expect(parseStreetLine("9250 Church Rd Apt 101")).toEqual({
      primaryNumber: "9250", preDirectional: null, streetName: "CHURCH",
      streetSuffix: "RD", postDirectional: null,
    });
  });

  it("handles a multi-word street name", () => {
    expect(parseStreetLine("500 Las Colinas Blvd")).toEqual({
      primaryNumber: "500", preDirectional: null, streetName: "LAS COLINAS",
      streetSuffix: "BLVD", postDirectional: null,
    });
  });

  it("preserves a house number with a trailing letter", () => {
    expect(parseStreetLine("123A Oak Ln")).toEqual({
      primaryNumber: "123A", preDirectional: null, streetName: "OAK",
      streetSuffix: "LN", postDirectional: null,
    });
  });

  it("returns empty number/name for empty input (never throws)", () => {
    expect(parseStreetLine("")).toEqual({
      primaryNumber: "", preDirectional: null, streetName: "",
      streetSuffix: null, postDirectional: null,
    });
  });

  it("does not eat a directional-named street (Northwest Highway)", () => {
    expect(parseStreetLine("6116 Northwest Hwy")).toEqual({
      primaryNumber: "6116", preDirectional: null, streetName: "NORTHWEST",
      streetSuffix: "HWY", postDirectional: null,
    });
  });

  it("keeps a real leading directional AND a directional-named street", () => {
    expect(parseStreetLine("1600 W Northwest Hwy")).toEqual({
      primaryNumber: "1600", preDirectional: "W", streetName: "NORTHWEST",
      streetSuffix: "HWY", postDirectional: null,
    });
  });

  it("parses a numbered street with a leading directional", () => {
    expect(parseStreetLine("100 W 7th St")).toEqual({
      primaryNumber: "100", preDirectional: "W", streetName: "7TH",
      streetSuffix: "ST", postDirectional: null,
    });
  });
});
