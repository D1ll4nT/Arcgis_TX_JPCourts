import { describe, it, expect } from "vitest";
import { interpolateSegment } from "../../src/geocode/geocode.js";
import type { SegmentRow } from "../../src/types.js";

// Vertical segment: addresses 9200..9300 map to lat 32.800..32.900 at lon -96.700.
const even: SegmentRow = {
  street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9200, to_addr: 9300, parity: "E",
  lon1: -96.7, lat1: 32.8, lon2: -96.7, lat2: 32.9,
};
const odd: SegmentRow = {
  street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9201, to_addr: 9301, parity: "O",
  lon1: -96.6, lat1: 32.8, lon2: -96.6, lat2: 32.9,
};

describe("interpolateSegment", () => {
  it("interpolates the house number to the midpoint", () => {
    const result = interpolateSegment([even], 9250);
    expect(result).not.toBeNull();
    expect(result!.lon).toBe(-96.7);
    expect(result!.lat).toBeCloseTo(32.85);
  });

  it("maps the from/to addresses to the endpoints", () => {
    const result200 = interpolateSegment([even], 9200);
    expect(result200).not.toBeNull();
    expect(result200!.lon).toBe(-96.7);
    expect(result200!.lat).toBeCloseTo(32.8);

    const result300 = interpolateSegment([even], 9300);
    expect(result300).not.toBeNull();
    expect(result300!.lon).toBe(-96.7);
    expect(result300!.lat).toBeCloseTo(32.9);
  });

  it("prefers the parity-matching side", () => {
    const result250 = interpolateSegment([even, odd], 9250);
    expect(result250).not.toBeNull();
    expect(result250!.lon).toBe(-96.7); // even house → even row

    const result251 = interpolateSegment([even, odd], 9251);
    expect(result251).not.toBeNull();
    expect(result251!.lon).toBe(-96.6); // odd house → odd row
  });

  it("handles a reversed range (from_addr > to_addr)", () => {
    const rev: SegmentRow = { ...even, from_addr: 9300, to_addr: 9200 };
    const result = interpolateSegment([rev], 9250);
    expect(result).not.toBeNull();
    expect(result!.lon).toBe(-96.7);
    expect(result!.lat).toBeCloseTo(32.85);
  });

  it("returns null when no range contains the number", () => {
    expect(interpolateSegment([even], 9999)).toBeNull();
  });

  it("returns null for a NaN house number", () => {
    expect(interpolateSegment([even], Number.NaN)).toBeNull();
  });

  it("uses a containing row even when no parity side matches (coverage fallback)", () => {
    // Only an ODD-parity row exists; an even house within its range still resolves.
    const oddOnly = { ...even, parity: "O" as const };
    const p = interpolateSegment([oddOnly], 9250); // 9250 even, row parity odd
    expect(p).not.toBeNull();
    expect(p!.lon).toBe(-96.7);
  });
});
