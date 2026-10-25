import { describe, it, expect } from "vitest";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";

describe("normalizeAddress", () => {
  it("produces a canonical DFW address", () => {
    const r = normalizeAddress({ street: "9250 Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    expect(r).toMatchObject({
      primaryNumber: "9250", streetName: "CHURCH", streetSuffix: "RD",
      city: "DALLAS", state: "TX", zip5: "75231", countyHint: "DALLAS",
      canonicalLine: "9250 CHURCH RD, DALLAS, TX 75231", confident: true,
    });
  });

  it("carries a WRONG county as a non-authoritative hint, unchanged", () => {
    // The Colony is really Denton; the client mislabels it Dallas. The normalizer must NOT 'fix' it.
    const r = normalizeAddress({ street: "5000 Main St", city: "The Colony", zip: "75056", county: "Dallas" });
    expect(r.countyHint).toBe("DALLAS"); // carried as-is; the resolver corrects it later
    expect(r.city).toBe("THE COLONY");
  });

  it("drops a trailing 'County' word from the county hint", () => {
    const r = normalizeAddress({ street: "1 Elm St", city: "X", zip: "75000", county: "Denton County" });
    expect(r.countyHint).toBe("DENTON");
  });

  it("takes the 5-digit ZIP from a ZIP+4", () => {
    const r = normalizeAddress({ street: "1 Elm St", city: "X", zip: "75231-1234", county: "Dallas" });
    expect(r.zip5).toBe("75231");
  });

  it("nulls an invalid ZIP", () => {
    const r = normalizeAddress({ street: "1 Elm St", city: "X", zip: "ABC", county: "Dallas" });
    expect(r.zip5).toBeNull();
  });

  it("flags confident=false when the street has no house number", () => {
    const r = normalizeAddress({ street: "Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    expect(r.confident).toBe(false);
    expect(r.primaryNumber).toBe("");
  });

  it("never throws on empty input and still sets state=TX", () => {
    const r = normalizeAddress({ street: "", city: "", zip: "", county: "" });
    expect(r.confident).toBe(false);
    expect(r.state).toBe("TX");
    expect(r.canonicalLine).toBe("TX");
  });

  it("never throws when a form field is missing at runtime", () => {
    // Types say string, but a web form can send undefined/null.
    const bad = { street: undefined, city: null, zip: undefined, county: null } as unknown as import("../../src/types.js").RawAddressInput;
    expect(() => normalizeAddress(bad)).not.toThrow();
    const r = normalizeAddress(bad);
    expect(r.confident).toBe(false);
    expect(r.state).toBe("TX");
  });
});
