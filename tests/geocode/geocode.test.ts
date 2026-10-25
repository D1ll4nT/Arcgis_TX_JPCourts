import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { geocode, type SegmentQuerier } from "../../src/geocode/geocode.js";
import { segmentValuesSql } from "../../src/geocode/segment-store.js";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";
import type { SegmentRow } from "../../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(HERE, "..", "..", "scripts", "tiger", "schema.sql"), "utf8");

// One CHURCH RD segment: 9200..9300 (even) → lat 32.800..32.900 at lon -96.700, zip 75231.
const churchRd: SegmentRow = {
  street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9200, to_addr: 9300, parity: "E",
  lon1: -96.7, lat1: 32.8, lon2: -96.7, lat2: 32.9,
};

function querier(rows: SegmentRow[]): SegmentQuerier {
  const db = new Database(":memory:");
  db.exec(schemaSql);
  db.exec(segmentValuesSql(rows));
  return {
    async query(streetKey, zip) {
      return (
        zip === null
          ? db.prepare("SELECT * FROM street_segments WHERE street_key = ?").all(streetKey)
          : db.prepare("SELECT * FROM street_segments WHERE street_key = ? AND zip = ?").all(streetKey, zip)
      ) as SegmentRow[];
    },
    // Coarse name fetch (may over-fetch; geocode filters precisely) — mirrors
    // the d1SegmentQuerier LIKE contract.
    async queryByName(streetName, zip) {
      const pat = `%|${streetName}|%`;
      return (
        zip === null
          ? db.prepare("SELECT * FROM street_segments WHERE street_key LIKE ?").all(pat)
          : db.prepare("SELECT * FROM street_segments WHERE street_key LIKE ? AND zip = ?").all(pat, zip)
      ) as SegmentRow[];
    },
  };
}

describe("geocode", () => {
  const db = querier([churchRd]);

  it("matches an in-range address and returns a census point at precision 150", async () => {
    const addr = normalizeAddress({ street: "9250 Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    const r = await geocode(addr, db);
    expect(r.status).toBe("matched");
    if (r.status !== "matched") throw new Error("expected match");
    expect(r).toMatchObject({ method: "census", precisionMeters: 150, lon: -96.7 });
    expect(r.lat).toBeCloseTo(32.8 + 0.5 * 0.1, 6); // (9250-9200)/100 = 0.5
  });

  it("falls back to street-key-only when the submitted ZIP differs from the segment ZIP", async () => {
    const addr = normalizeAddress({ street: "9250 Church Rd", city: "Dallas", zip: "99999", county: "Dallas" });
    const r = await geocode(addr, db);
    expect(r.status).toBe("matched");
  });

  it("misses street_not_found for an unknown street", async () => {
    const addr = normalizeAddress({ street: "100 Nowhere St", city: "Dallas", zip: "75231", county: "Dallas" });
    expect(await geocode(addr, db)).toEqual({ status: "miss", reason: "street_not_found" });
  });

  it("misses house_out_of_range for a number outside every segment range", async () => {
    const addr = normalizeAddress({ street: "500 Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    expect(await geocode(addr, db)).toEqual({ status: "miss", reason: "house_out_of_range" });
  });

  it("recovers a cross-ZIP-seam address the filer mis-zipped (fallback on no-point, not no-rows)", async () => {
    // Same street key under two ZIPs; the 9400-block lives under a DIFFERENT zip
    // than the filer wrote. The zip-qualified query returns the wrong block.
    const churchLow = { street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9200, to_addr: 9300, parity: "E",
      lon1: -96.7, lat1: 32.8, lon2: -96.7, lat2: 32.9 } as const;
    const churchHigh = { street_key: "|CHURCH|RD|", zip: "75002", from_addr: 9400, to_addr: 9500, parity: "E",
      lon1: -96.5, lat1: 33.0, lon2: -96.5, lat2: 33.1 } as const;
    const seam = querier([churchLow, churchHigh] as unknown as import("../../src/types.js").SegmentRow[]);
    const addr = normalizeAddress({ street: "9450 Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    const r = await geocode(addr, seam);
    expect(r.status).toBe("matched");
    if (r.status !== "matched") throw new Error("expected match");
    expect(r.lon).toBeCloseTo(-96.5, 6); // the 9400-block segment, under the other zip
  });

  it("selects the correct block among disjoint same-key ranges", async () => {
    const block1 = { street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9200, to_addr: 9300, parity: "E",
      lon1: -96.7, lat1: 32.8, lon2: -96.7, lat2: 32.9 } as const;
    const block2 = { street_key: "|CHURCH|RD|", zip: "75231", from_addr: 9400, to_addr: 9500, parity: "E",
      lon1: -96.5, lat1: 33.0, lon2: -96.5, lat2: 33.1 } as const;
    const db2 = querier([block1, block2] as unknown as import("../../src/types.js").SegmentRow[]);
    const addr = normalizeAddress({ street: "9450 Church Rd", city: "Dallas", zip: "75231", county: "Dallas" });
    const r = await geocode(addr, db2);
    expect(r.status).toBe("matched");
    if (r.status !== "matched") throw new Error("expected match");
    expect(r.lon).toBeCloseTo(-96.5, 6); // block2
  });

  it("matches with a single query when the address has no ZIP (zip5 null)", async () => {
    const addr = normalizeAddress({ street: "9250 Church Rd", city: "Dallas", zip: "", county: "Dallas" });
    expect(addr.zip5).toBeNull();
    const r = await geocode(addr, db); // `db` is the existing single-churchRd querier
    expect(r.status).toBe("matched");
  });
});

describe("geocode street-key variants (relax the key within the ZIP before relaxing the ZIP)", () => {
  // A production Dallas-St miss: Mansfield's street is E DALLAS ST (76063),
  // and a plain DALLAS ST exists in Grand Prairie under another ZIP. The filer
  // omitted the directional. The old zip-relax-first order matched Grand Prairie —
  // 30 km away in another county.
  const eDallasMansfield: SegmentRow = {
    street_key: "E|DALLAS|ST|", zip: "76063", from_addr: 200, to_addr: 298, parity: "E",
    lon1: -97.14, lat1: 32.563, lon2: -97.13, lat2: 32.563,
  };
  const dallasGrandPrairie: SegmentRow = {
    street_key: "|DALLAS|ST|", zip: "75050", from_addr: 100, to_addr: 998, parity: "B",
    lon1: -97.0, lat1: 32.743, lon2: -97.01, lat2: 32.744,
  };

  it("recovers a filer-omitted pre-directional within the submitted ZIP instead of relaxing the ZIP", async () => {
    const q = querier([eDallasMansfield, dallasGrandPrairie]);
    const addr = normalizeAddress({ street: "224 Dallas St", city: "Mansfield", zip: "76063", county: "Tarrant" });
    const r = await geocode(addr, q);
    expect(r.status).toBe("matched");
    if (r.status !== "matched") throw new Error("expected match");
    expect(r.lon).toBeCloseTo(-97.14, 2); // the Mansfield segment, NOT Grand Prairie (-97.0)
    expect(r.anchored).toBe(true); // matched inside the submitted ZIP
  });

  it("recovers a filer-omitted suffix within the submitted ZIP", async () => {
    const oakParkDr: SegmentRow = {
      street_key: "|OAK PARK|DR|", zip: "75217", from_addr: 1200, to_addr: 1298, parity: "B",
      lon1: -96.68, lat1: 32.71, lon2: -96.67, lat2: 32.71,
    };
    const q = querier([oakParkDr]);
    const addr = normalizeAddress({ street: "1240 Oak Park", city: "Dallas", zip: "75217", county: "Dallas" });
    const r = await geocode(addr, q);
    expect(r.status).toBe("matched");
  });

  it("abstains (ambiguous) when the house number exists on two distinct variant keys in the ZIP", async () => {
    const wDallas: SegmentRow = {
      street_key: "W|DALLAS|ST|", zip: "76063", from_addr: 200, to_addr: 298, parity: "E",
      lon1: -97.15, lat1: 32.563, lon2: -97.16, lat2: 32.563,
    };
    const q = querier([eDallasMansfield, wDallas]);
    const addr = normalizeAddress({ street: "224 Dallas St", city: "Mansfield", zip: "76063", county: "Tarrant" });
    const r = await geocode(addr, q);
    expect(r).toMatchObject({ status: "miss", reason: "ambiguous" });
    if (r.status !== "miss") throw new Error("expected miss");
    expect(r.candidates).toHaveLength(2); // both interpretations surfaced for same-precinct resolution
  });

  it("never widens a component the filer DID provide", async () => {
    const q = querier([eDallasMansfield]);
    const addr = normalizeAddress({ street: "224 W Dallas St", city: "Mansfield", zip: "76063", county: "Tarrant" });
    const r = await geocode(addr, q);
    expect(r.status).toBe("miss"); // W ≠ E: the explicit directional must not be overridden
  });

  it("reports anchored=false on a ZIP-relaxed match and anchored=true on an in-ZIP match", async () => {
    const q = querier([eDallasMansfield]);
    const wrongZip = normalizeAddress({ street: "224 E Dallas St", city: "Mansfield", zip: "99999", county: "Tarrant" });
    const relaxed = await geocode(wrongZip, q);
    expect(relaxed.status).toBe("matched");
    if (relaxed.status !== "matched") throw new Error("expected match");
    expect(relaxed.anchored).toBe(false);

    const rightZip = normalizeAddress({ street: "224 E Dallas St", city: "Mansfield", zip: "76063", county: "Tarrant" });
    const anchored = await geocode(rightZip, q);
    if (anchored.status !== "matched") throw new Error("expected match");
    expect(anchored.anchored).toBe(true);
  });
});
