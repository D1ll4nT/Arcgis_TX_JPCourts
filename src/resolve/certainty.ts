import booleanWithin from "@turf/boolean-within";
import booleanIntersects from "@turf/boolean-intersects";
import { feature as turfFeature } from "@turf/helpers";
import type { Polygon, MultiPolygon } from "geojson";
import { validateLonLat } from "../geo/validate.js";
import { resolvePrecinct } from "./precinct-resolver.js";
import { distanceToPolygonBoundary } from "../geo/boundary-distance.js";
import type { CertaintyResult, County, LocationMethod, PrecinctFeature } from "../types.js";

export interface CertaintyInput {
  lon: number;
  lat: number;
  method: LocationMethod;
  precisionMeters: number;
  parcelGeometry?: Polygon | MultiPolygon | null;
}

const HIGH_PRECISION: LocationMethod[] = ["parcel", "address-point"];

interface CandidateRef {
  county: County;
  precinct: string;
}

function dedupeCandidates(items: CandidateRef[]): CandidateRef[] {
  const seen = new Set<string>();
  const out: CandidateRef[] = [];
  for (const it of items) {
    const key = `${it.county}/${it.precinct}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

/** Bare precinct strings when all candidates share one county; "county/precinct"
 * when they span multiple counties — so a cross-county straddle is never
 * disclosed as a meaningless bare precinct number. */
function formatCandidates(items: CandidateRef[]): string[] {
  const multiCounty = new Set(items.map((i) => i.county)).size > 1;
  return items
    .map((i) => (multiCounty ? `${i.county}/${i.precinct}` : i.precinct))
    .sort((a, b) => a.localeCompare(b));
}

/** Whole-parcel containment that also accepts a MultiPolygon (co-located
 * same-situs parcels, e.g. a duplex or split lot). @turf/boolean-within rejects
 * a MultiPolygon first arg, so decompose it and require EVERY part to be within
 * the container — a stricter, correct read of "the whole parcel sits inside". */
function parcelWithin(geom: Polygon | MultiPolygon, container: PrecinctFeature): boolean {
  const polys: Polygon[] =
    geom.type === "Polygon"
      ? [geom]
      : geom.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  return polys.every((p) => booleanWithin(turfFeature(p), container));
}

export function assessCertainty(
  input: CertaintyInput,
  features: PrecinctFeature[],
): CertaintyResult {
  const { lon, lat, method, precisionMeters, parcelGeometry } = input;
  validateLonLat(lon, lat);

  const containing = features.find((f) => resolvePrecinct(lon, lat, [f]) !== null);
  if (!containing) {
    return {
      county: features[0]!.properties.county,
      precinct: null,
      confidence: "needs_verification",
      candidatePrecincts: [],
    };
  }
  const county = containing.properties.county;
  const precinct = containing.properties.precinct;

  // --- Footprint test (most court-faithful): is the whole parcel in one precinct? ---
  if (parcelGeometry) {
    const parcelFeat = turfFeature(parcelGeometry);
    const hits = dedupeCandidates(
      features
        .filter((f) => booleanIntersects(parcelFeat, f))
        .map((f) => ({ county: f.properties.county, precinct: f.properties.precinct })),
    );

    if (parcelWithin(parcelGeometry, containing) || hits.length <= 1) {
      return { county, precinct, confidence: "high" };
    }
    const candidatePrecincts = formatCandidates(hits);
    return {
      county,
      precinct: null,
      candidatePrecincts,
      boundaryBetween: candidatePrecincts,
      confidence: "needs_verification",
    };
  }

  // --- Point-only: boundary proximity vs the method's precision ---
  const distanceMeters = distanceToPolygonBoundary(lon, lat, containing.geometry);
  if (distanceMeters < precisionMeters) {
    // Every precinct whose boundary is within the error radius is a genuine candidate
    // (handles tri-points where three precincts meet, not just the single nearest).
    const near = features
      .filter(
        (f) => f !== containing && distanceToPolygonBoundary(lon, lat, f.geometry) < precisionMeters,
      )
      .map((f) => ({ county: f.properties.county, precinct: f.properties.precinct }));
    const candidatePrecincts = formatCandidates(
      dedupeCandidates([{ county, precinct }, ...near]),
    );
    return {
      county,
      precinct: null,
      candidatePrecincts,
      boundaryBetween: candidatePrecincts,
      confidence: "needs_verification",
      distanceMeters,
    };
  }

  return {
    county,
    precinct,
    confidence: HIGH_PRECISION.includes(method) ? "high" : "review",
    distanceMeters,
  };
}
