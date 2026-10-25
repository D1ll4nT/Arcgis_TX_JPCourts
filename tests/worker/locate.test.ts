import { describe, it, expect } from "vitest";
import type { Polygon } from "geojson";
import { locate, type LocatorDeps } from "../../src/worker/locate.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import { twoCounties } from "../fixtures/two-counties.js";
import type { CanonicalAddress, CountyCourts, County, SegmentRow } from "../../src/types.js";
import type { ParcelClient } from "../../src/parcel/parcel-client.js";
import type { SegmentQuerier } from "../../src/geocode/geocode.js";

// twoPrecincts: WEST square precinct "1" (-96.80..-96.75, 32.70..32.80), EAST "2" (-96.75..-96.70).
// A TIGER segment for CHURCH RD placing 100 CHURCH RD at the WEST interior (-96.775, 32.745).
const churchSeg: SegmentRow = {
  street_key: "|CHURCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
  lon1: -96.775, lat1: 32.745, lon2: -96.775, lat2: 32.745,
};
const tiger: SegmentQuerier = {
  async query(k, _z) { return k === "|CHURCH|RD|" ? [churchSeg] : []; },
  async queryByName(n, _z) { return n === "CHURCH" ? [churchSeg] : []; },
};

const court = (n: string) => ({ courtName: n, places: [], filingAddress: "A", mailingAddress: "", phone: "P", efilePortal: "E", ocaLocationId: "", source: "S" });
const courts = {
  dallas: { county: "dallas", verified: false, verifiedAt: null, verifiedBy: null, courts: { "1": court("d1"), "2": court("d2") } },
} as unknown as Record<County, CountyCourts>;

// Parcel fully inside WEST square → high; a fake client that returns it only for the dallas hint.
const parcelInWest: Polygon = { type: "Polygon", coordinates: [[[-96.776, 32.744], [-96.774, 32.744], [-96.774, 32.746], [-96.776, 32.746], [-96.776, 32.744]]] };
const parcelClient = (geom: Polygon | null): ParcelClient => ({
  async lookup(addr: CanonicalAddress) { return addr.countyHint === "DALLAS" ? geom : null; },
});

const deps = (parcel: Polygon | null): LocatorDeps => ({
  tigerQuerier: tiger, parcel: parcelClient(parcel), boundaries: twoPrecincts, courts,
});

describe("locate", () => {
  it("bad_input when street is blank", async () => {
    const r = await locate({ street: "  ", city: "", zip: "", county: "" }, deps(parcelInWest));
    expect(r.kind).toBe("bad_input");
  });

  it("not_located only when neither parcel nor TIGER can locate", async () => {
    const r = await locate({ street: "1 Nowhere St", city: "Dallas", zip: "75201", county: "Dallas" }, deps(null));
    expect(r.kind).toBe("not_located");
  });

  it("parcel-first: resolves via appraisal even when TIGER lacks the street", async () => {
    // "999 Unlisted Ave" is NOT in the TIGER fixture (querier returns []), but
    // the parcel client returns a valid Dallas parcel. Parcel-first must resolve
    // it high — the inverted TIGER-first pipeline returned not_located here.
    const r = await locate({ street: "999 Unlisted Ave", city: "Dallas", zip: "75201", county: "Dallas" }, deps(parcelInWest));
    if (r.kind !== "resolved") throw new Error("expected resolved, got " + r.kind);
    expect(r.method).toBe("parcel");
    expect(r.confidence).toBe("high");
    expect(r.precinct).toBe("1");
  });

  it("parcel match → high, method parcel, resolved court", async () => {
    const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "75201", county: "Dallas" }, deps(parcelInWest));
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.confidence).toBe("high");
    expect(r.method).toBe("parcel");
    expect(r.precinct).toBe("1");
    expect(r.court?.courtName).toBe("d1");
    expect(r.countyMismatch).toBe(false);
  });

  it("no parcel → census review", async () => {
    const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "75201", county: "Dallas" }, deps(null));
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.method).toBe("census");
    expect(r.confidence).toBe("review");
    expect(r.precinct).toBe("1");
  });

  it("countyMismatch true when submitted county differs from resolved", async () => {
    const r = await locate({ street: "100 Church Rd", city: "The Colony", zip: "75056", county: "Denton" }, deps(null));
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.county).toBe("dallas");          // resolver wins
    expect(r.submittedCounty).toBe("Denton");
    expect(r.countyMismatch).toBe(true);
  });

  it("near-boundary (no parcel) → needs_verification with candidate precincts + courts", async () => {
    // A segment placing 100 BORDER RD ~28 m west of the shared line at lon -96.75.
    const borderSeg = { street_key: "|BORDER|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
      lon1: -96.7503, lat1: 32.75, lon2: -96.7503, lat2: 32.75 } as unknown as SegmentRow;
    const borderTiger: SegmentQuerier = {
      async query(k) { return k === "|BORDER|RD|" ? [borderSeg] : []; },
      async queryByName(n) { return n === "BORDER" ? [borderSeg] : []; },
    };
    const d: LocatorDeps = { tigerQuerier: borderTiger, parcel: parcelClient(null), boundaries: twoPrecincts, courts };
    const r = await locate({ street: "100 Border Rd", city: "Dallas", zip: "75201", county: "Dallas" }, d);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.confidence).toBe("needs_verification");
    expect(r.precinct).toBeNull();
    expect(r.candidatePrecincts).toEqual(["1", "2"]);
    expect(r.courts).toHaveLength(2);
  });

  describe("unanchored (ZIP-relaxed) TIGER matches require county corroboration", () => {
    // Zip-AWARE stub: the church segment only exists under 75201. A filer with a
    // different ZIP forces the ZIP-relaxed (unanchored) path.
    const zipAwareTiger: SegmentQuerier = {
      async query(k, z) { return k === "|CHURCH|RD|" && (z === null || z === "75201") ? [churchSeg] : []; },
      async queryByName(n, z) { return n === "CHURCH" && (z === null || z === "75201") ? [churchSeg] : []; },
    };
    const d: LocatorDeps = { tigerQuerier: zipAwareTiger, parcel: parcelClient(null), boundaries: twoPrecincts, courts };

    it("rejects a ZIP-relaxed match that resolves outside the submitted county (the 202-Dallas-St bug)", async () => {
      // Point resolves in DALLAS, filer said TARRANT: a same-named street in
      // another county must not become a usable answer.
      const r = await locate({ street: "100 Church Rd", city: "Mansfield", zip: "99999", county: "Tarrant" }, d);
      expect(r.kind).toBe("not_located");
    });

    it("rejects a ZIP-relaxed match when no county was submitted (nothing to corroborate)", async () => {
      const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "99999", county: "" }, d);
      expect(r.kind).toBe("not_located");
    });

    it("accepts a ZIP-relaxed match when the resolved county corroborates the submitted county", async () => {
      const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "99999", county: "Dallas" }, d);
      if (r.kind !== "resolved") throw new Error("expected resolved, got " + r.kind);
      expect(r.precinct).toBe("1");
      expect(r.method).toBe("census");
    });
  });

  describe("ambiguous variant twins (e.g. E/W same-name streets)", () => {
    // Both E CHURCH RD and W CHURCH RD exist in the ZIP with house 100 in range.
    const eSeg: SegmentRow = { street_key: "E|CHURCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
      lon1: -96.78, lat1: 32.745, lon2: -96.78, lat2: 32.745 };   // west square → precinct 1
    const wSegSamePrecinct: SegmentRow = { street_key: "W|CHURCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
      lon1: -96.77, lat1: 32.745, lon2: -96.77, lat2: 32.745 };   // also west square → precinct 1
    const wSegOtherPrecinct: SegmentRow = { street_key: "W|CHURCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
      lon1: -96.72, lat1: 32.745, lon2: -96.72, lat2: 32.745 };   // east square → precinct 2

    const twinTiger = (wSeg: SegmentRow): SegmentQuerier => ({
      async query(k, _z) { return k === "E|CHURCH|RD|" ? [eSeg] : k === "W|CHURCH|RD|" ? [wSeg] : []; },
      async queryByName(n, _z) { return n === "CHURCH" ? [eSeg, wSeg] : []; },
    });

    it("resolves when every variant interpretation lands in the SAME precinct", async () => {
      const d: LocatorDeps = { tigerQuerier: twinTiger(wSegSamePrecinct), parcel: parcelClient(null), boundaries: twoPrecincts, courts };
      const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "75201", county: "Dallas" }, d);
      if (r.kind !== "resolved") throw new Error("expected resolved, got " + r.kind);
      expect(r.precinct).toBe("1");
      expect(r.confidence).toBe("review");
      expect(r.method).toBe("census");
    });

    it("stays not_located when variant interpretations land in DIFFERENT precincts", async () => {
      const d: LocatorDeps = { tigerQuerier: twinTiger(wSegOtherPrecinct), parcel: parcelClient(null), boundaries: twoPrecincts, courts };
      const r = await locate({ street: "100 Church Rd", city: "Dallas", zip: "75201", county: "Dallas" }, d);
      expect(r.kind).toBe("not_located");
    });
  });

  it("discards a parcel that resolves to a different county than TIGER (H6 residual guard) → census fallback", async () => {
    // TIGER places 100 Ranch Rd on the DALLAS side (-96.775); the (bad) parcel geometry lies in COLLIN.
    const ranchSeg: SegmentRow = { street_key: "|RANCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E",
      lon1: -96.775, lat1: 32.745, lon2: -96.775, lat2: 32.745 };
    const ranchTiger: SegmentQuerier = {
      async query(k) { return k === "|RANCH|RD|" ? [ranchSeg] : []; },
      async queryByName(n) { return n === "RANCH" ? [ranchSeg] : []; },
    };
    const collinParcel: Polygon = { type: "Polygon", coordinates: [[[-96.72, 32.749], [-96.71, 32.749], [-96.71, 32.751], [-96.72, 32.751], [-96.72, 32.749]]] };
    const twoCountyCourts = {
      dallas: { county: "dallas", verified: false, verifiedAt: null, verifiedBy: null, courts: { "2": court("d2") } },
      collin: { county: "collin", verified: false, verifiedAt: null, verifiedBy: null, courts: { "2": court("c2") } },
    } as unknown as Record<County, CountyCourts>;
    const d: LocatorDeps = { tigerQuerier: ranchTiger, parcel: parcelClient(collinParcel), boundaries: twoCounties, courts: twoCountyCourts };
    const r = await locate({ street: "100 Ranch Rd", city: "Dallas", zip: "75201", county: "Dallas" }, d);
    if (r.kind !== "resolved") throw new Error("expected resolved");
    expect(r.method).toBe("census");       // parcel was discarded (collin != dallas)
    expect(r.county).toBe("dallas");        // TIGER-authoritative county wins
    expect(r.precinct).toBe("2");
  });
});
