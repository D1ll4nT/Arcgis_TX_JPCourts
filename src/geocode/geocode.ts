import { streetKeyFromParts } from "./street-key.js";
import type { CanonicalAddress, SegmentRow } from "../types.js";

function contains(r: SegmentRow, house: number): boolean {
  const lo = Math.min(r.from_addr, r.to_addr);
  const hi = Math.max(r.from_addr, r.to_addr);
  return house >= lo && house <= hi;
}

function parityMatches(r: SegmentRow, house: number): boolean {
  const even = house % 2 === 0;
  return even ? r.parity === "E" || r.parity === "B" : r.parity === "O" || r.parity === "B";
}

/**
 * Linearly interpolate a house number's position along the matching street
 * segment (endpoints only). Selects the containing row (parity-preferred), then
 * f = (house - from)/(to - from) clamped to [0,1] mapped onto (lon1,lat1)→(lon2,lat2).
 * Returns null when no row's address range contains the number (incl. NaN).
 */
export function interpolateSegment(
  rows: SegmentRow[],
  houseNumber: number,
): { lon: number; lat: number } | null {
  const containing = rows.filter((r) => contains(r, houseNumber));
  if (containing.length === 0) return null;
  const preferred = containing.filter((r) => parityMatches(r, houseNumber));
  // containing.length > 0 checked above, so one of these is defined
  const row = (preferred[0] ?? containing[0])!;
  const span = row.to_addr - row.from_addr;
  const f = span === 0 ? 0 : Math.min(1, Math.max(0, (houseNumber - row.from_addr) / span));
  return {
    lon: row.lon1 + f * (row.lon2 - row.lon1),
    lat: row.lat1 + f * (row.lat2 - row.lat1),
  };
}

export interface SegmentQuerier {
  /** Rows for a street key; a null zip means "any zip". */
  query(streetKey: string, zip: string | null): Promise<SegmentRow[]>;
  /**
   * Coarse fetch of rows whose key's NAME component equals streetName (any
   * directionals/suffix); a null zip means "any zip". May over-fetch (e.g. a
   * key whose SUFFIX field collides with the name) — geocode filters precisely.
   */
  queryByName(streetName: string, zip: string | null): Promise<SegmentRow[]>;
}

export type GeocodeResult =
  | {
      status: "matched"; lon: number; lat: number; method: "census"; precisionMeters: 150;
      /** True when the match came from a query constrained to the submitted ZIP
       * — i.e. it has independent geographic corroboration. ZIP-relaxed and
       * no-ZIP matches are unanchored and must be county-checked by the caller. */
      anchored: boolean;
    }
  | {
      status: "miss"; reason: "street_not_found" | "house_out_of_range" | "ambiguous";
      /** On "ambiguous": the interpolated point of each variant interpretation
       * (all inside the submitted ZIP). The caller may still resolve the lookup
       * when every candidate lands in the same precinct. */
      candidates?: { lon: number; lat: number }[];
    };

/** "PRE|NAME|SUFFIX|POST" key is compatible with the input when the name is
 * equal and every component the filer PROVIDED matches; components the filer
 * omitted (null) are wildcards. Never widens an explicit component. */
function keyCompatible(streetKey: string, a: CanonicalAddress): boolean {
  const [pre = "", name = "", suffix = "", post = ""] = streetKey.split("|");
  if (name !== a.streetName) return false;
  if (a.preDirectional !== null && pre !== a.preDirectional) return false;
  if (a.streetSuffix !== null && suffix !== a.streetSuffix) return false;
  if (a.postDirectional !== null && post !== a.postDirectional) return false;
  return true;
}

/**
 * Offline geocode: canonical address → point via the TIGER segment store.
 * Relaxation order (most- to least-geographically-anchored):
 *
 *   1. exact street_key within the submitted ZIP;
 *   2. compatible key VARIANTS within the submitted ZIP — recovers a
 *      filer-omitted directional/suffix without leaving the ZIP. Trusted only
 *      when exactly one variant key contains the house number; two or more →
 *      "ambiguous" miss (never guess between E/W twins);
 *   3. exact street_key ignoring ZIP (TIGER's segment ZIP can differ from the
 *      filer's — ZIP seams, NULL-zip rows). Unanchored: reported with
 *      anchored=false so the caller can demand county corroboration.
 *
 * Relaxing the KEY before the ZIP is deliberate: a same-named street elsewhere
 * in the metroplex is a worse candidate than a directional variant of the
 * requested street on the filer's own block.
 * Street-level → the "census" method at a conservative 150 m precision (never "high").
 */
export async function geocode(address: CanonicalAddress, db: SegmentQuerier): Promise<GeocodeResult> {
  const key = streetKeyFromParts(address);
  const house = parseInt(address.primaryNumber, 10); // NaN when there are no leading digits

  // 1. Exact key, zip-qualified (or any-zip when no ZIP was submitted).
  let rows = await db.query(key, address.zip5);
  let point = interpolateSegment(rows, house);
  if (point !== null) {
    return { status: "matched", ...point, method: "census", precisionMeters: 150, anchored: address.zip5 !== null };
  }
  let sawRows = rows.length > 0;

  if (address.zip5 !== null) {
    // 2. Compatible key variants, still inside the submitted ZIP.
    if (address.streetName !== "") {
      const variantRows = (await db.queryByName(address.streetName, address.zip5)).filter((r) =>
        keyCompatible(r.street_key, address),
      );
      sawRows ||= variantRows.length > 0;
      const byKey = new Map<string, SegmentRow[]>();
      for (const r of variantRows) byKey.set(r.street_key, [...(byKey.get(r.street_key) ?? []), r]);
      const hits: { lon: number; lat: number }[] = [];
      for (const keyRows of byKey.values()) {
        const p = interpolateSegment(keyRows, house);
        if (p !== null) hits.push(p);
      }
      if (hits.length === 1) {
        return { status: "matched", ...hits[0]!, method: "census", precisionMeters: 150, anchored: true };
      }
      if (hits.length > 1) return { status: "miss", reason: "ambiguous", candidates: hits };
    }

    // 3. Exact key, ZIP relaxed — unanchored.
    rows = await db.query(key, null);
    point = interpolateSegment(rows, house);
    if (point !== null) {
      return { status: "matched", ...point, method: "census", precisionMeters: 150, anchored: false };
    }
    sawRows ||= rows.length > 0;
  }

  // No point. Distinguish by whether the street matched any rows at all.
  return sawRows
    ? { status: "miss", reason: "house_out_of_range" }
    : { status: "miss", reason: "street_not_found" };
}
