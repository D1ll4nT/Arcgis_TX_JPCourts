import pointOnFeature from "@turf/point-on-feature";
import { normalizeAddress } from "../geocode/normalize-address.js";
import { geocode, type SegmentQuerier } from "../geocode/geocode.js";
import { resolvePrecinct } from "../resolve/precinct-resolver.js";
import { assessCertainty } from "../resolve/certainty.js";
import type { ParcelClient } from "../parcel/parcel-client.js";
import { lookupCourt, lookupCandidateCourts } from "./courts-lookup.js";
import type {
  CanonicalAddress,
  CertaintyResult,
  Confidence,
  CountyCourts,
  County,
  CourtEntry,
  PrecinctFeature,
  RawAddressInput,
} from "../types.js";

export interface LocatorDeps {
  tigerQuerier: SegmentQuerier;
  parcel: ParcelClient;
  boundaries: PrecinctFeature[];
  courts: Record<County, CountyCourts>;
}

export type LocateOutcome =
  | {
      kind: "resolved";
      county: County; precinct: string | null; confidence: Confidence;
      method: "parcel" | "census"; precisionMeters: number; lon: number; lat: number;
      normalizedAddress: string; locationSource: string;
      submittedCounty: string | null; countyMismatch: boolean;
      candidatePrecincts?: string[]; boundaryBetween?: string[];
      court: CourtEntry | null; courts?: CourtEntry[]; courtDataMissing: boolean;
    }
  | { kind: "bad_input"; missing: string[] }
  | { kind: "not_located"; reason: string; normalizedAddress: string; countyHint: string | null }
  | { kind: "out_of_area" };

/** [minLon,minLat,maxLon,maxLat] of a precinct feature. */
function bboxOf(f: PrecinctFeature): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const ring of rings) for (const [lon, lat] of ring as [number, number][]) {
    if (lon < a) a = lon; if (lon > c) c = lon; if (lat < b) b = lat; if (lat > d) d = lat;
  }
  return [a, b, c, d];
}

/**
 * B3 CPU pre-filter: features whose bbox, expanded by ~0.05° (~5.5 km — far
 * larger than any location precision radius), contains the point. Conservatively
 * prunes far-away precincts before the expensive turf point-in-polygon / distance
 * work, without ever dropping a feature the resolve/certainty path could need.
 */
function nearbyFeatures(features: PrecinctFeature[], lon: number, lat: number): PrecinctFeature[] {
  const m = 0.05;
  return features.filter((f) => {
    const [minLon, minLat, maxLon, maxLat] = bboxOf(f);
    return lon >= minLon - m && lon <= maxLon + m && lat >= minLat - m && lat <= maxLat + m;
  });
}

/** Assemble the resolved outcome (court lookup + county-mismatch flag) from a
 * certainty result and its location metadata. Shared by both location tiers. */
function toResolved(
  certainty: CertaintyResult,
  method: "parcel" | "census",
  precisionMeters: number,
  lon: number,
  lat: number,
  locationSource: string,
  addr: CanonicalAddress,
  input: RawAddressInput,
  courts: Record<County, CountyCourts>,
): LocateOutcome {
  let court: CourtEntry | null = null;
  let courtsList: CourtEntry[] | undefined;
  let courtDataMissing = false;
  if (certainty.precinct !== null) {
    court = lookupCourt(courts, certainty.county, certainty.precinct);
    courtDataMissing = court === null;
  } else if (certainty.candidatePrecincts) {
    courtsList = lookupCandidateCourts(courts, certainty.county, certainty.candidatePrecincts);
  }

  const submittedCounty = input.county && input.county.trim() !== "" ? input.county : null;
  const countyMismatch = addr.countyHint !== null && addr.countyHint !== certainty.county.toUpperCase();

  return {
    kind: "resolved",
    county: certainty.county, precinct: certainty.precinct, confidence: certainty.confidence,
    method, precisionMeters, lon, lat,
    normalizedAddress: addr.canonicalLine, locationSource,
    submittedCounty, countyMismatch,
    candidatePrecincts: certainty.candidatePrecincts, boundaryBetween: certainty.boundaryBetween,
    court, courts: courtsList, courtDataMissing,
  };
}

/**
 * Address → JP precinct, most-accurate-source-first:
 *
 *   1. Parcel (county appraisal): the exact property footprint. Keyed by the
 *      county hint (the parcel client picks the appraisal endpoint from
 *      addr.countyHint). Trusted only when it geographically resolves to the
 *      county we queried — a parcel that lands nowhere or in a different county
 *      is untrustworthy and falls through to TIGER. Address-precise → "high".
 *   2. TIGER (offline Census street interpolation via D1): the resilient
 *      fallback when the appraisal DB has no match, errors, or times out.
 *      Street-level → "census"/"review" (never "high").
 *
 * This ordering matches the parcel tier's documented contract (parcel primary,
 * "the caller falls back to the offline TIGER geocoder").
 */
export async function locate(input: RawAddressInput, deps: LocatorDeps): Promise<LocateOutcome> {
  if (!input.street || input.street.trim() === "") return { kind: "bad_input", missing: ["street"] };

  const addr = normalizeAddress(input);

  // 1. Parcel first — most accurate.
  const parcelGeom = await deps.parcel.lookup(addr);
  if (parcelGeom) {
    const [plon, plat] = pointOnFeature(parcelGeom).geometry.coordinates as [number, number];
    const parcelNear = nearbyFeatures(deps.boundaries, plon, plat);
    const pm = resolvePrecinct(plon, plat, parcelNear);
    // Integrity guard: trust the parcel only when it resolves to a precinct AND
    // to the same county whose appraisal DB we queried. Otherwise discard and
    // fall through to TIGER (never blindly trust a cross-county parcel).
    const queried = addr.countyHint ? addr.countyHint.toLowerCase() : null;
    if (pm && (queried === null || pm.county === queried)) {
      const certainty = assessCertainty(
        { lon: plon, lat: plat, method: "parcel", precisionMeters: 5, parcelGeometry: parcelGeom },
        parcelNear,
      );
      return toResolved(certainty, "parcel", 5, plon, plat, "county appraisal parcel", addr, input, deps.courts);
    }
    // Parcel untrustworthy → fall through to TIGER.
  }

  // 2. TIGER fallback — offline street interpolation.
  const g = await geocode(addr, deps.tigerQuerier);
  if (g.status !== "matched") {
    // Ambiguous variant twins (e.g. the filer wrote "224 Dallas St" and both
    // E DALLAS ST and W DALLAS ST carry a 224 in the ZIP): still resolvable
    // when EVERY candidate interpretation independently lands in the same
    // single precinct — then no interpretation could make the answer wrong.
    if (g.reason === "ambiguous" && g.candidates && g.candidates.length > 0) {
      const assessed = g.candidates.map((c) => {
        const cNear = nearbyFeatures(deps.boundaries, c.lon, c.lat);
        if (!resolvePrecinct(c.lon, c.lat, cNear)) return null;
        return { point: c, certainty: assessCertainty({ lon: c.lon, lat: c.lat, method: "census", precisionMeters: 150 }, cNear) };
      });
      const first = assessed[0];
      const unanimous =
        first !== null &&
        first !== undefined &&
        first.certainty.precinct !== null &&
        assessed.every(
          (a) => a !== null && a.certainty.county === first.certainty.county && a.certainty.precinct === first.certainty.precinct,
        );
      if (unanimous) {
        return toResolved(first.certainty, "census", 150, first.point.lon, first.point.lat, "Census TIGER 2024 street interpolation", addr, input, deps.courts);
      }
    }
    return { kind: "not_located", reason: g.reason, normalizedAddress: addr.canonicalLine, countyHint: addr.countyHint };
  }
  const near = nearbyFeatures(deps.boundaries, g.lon, g.lat);
  const tigerMatch = resolvePrecinct(g.lon, g.lat, near);
  if (!tigerMatch) return { kind: "out_of_area" };
  // Integrity guard (mirrors the parcel tier's): an unanchored match — found
  // only after relaxing the submitted ZIP, or with no ZIP submitted — has no
  // independent geographic corroboration. Trust it only when it resolves to the
  // county the filer submitted; otherwise a same-named street elsewhere in the
  // metroplex could return a confidently-wrong precinct (the Dallas-St bug).
  if (!g.anchored) {
    const queried = addr.countyHint ? addr.countyHint.toLowerCase() : null;
    if (queried === null || tigerMatch.county !== queried) {
      return {
        kind: "not_located",
        reason: "location_unverified",
        normalizedAddress: addr.canonicalLine,
        countyHint: addr.countyHint,
      };
    }
  }
  const certainty = assessCertainty({ lon: g.lon, lat: g.lat, method: "census", precisionMeters: 150 }, near);
  return toResolved(certainty, "census", 150, g.lon, g.lat, "Census TIGER 2024 street interpolation", addr, input, deps.courts);
}
