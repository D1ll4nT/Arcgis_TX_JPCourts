import { arcgisToGeoJSON } from "@esri/arcgis-to-geojson-utils";
import booleanIntersects from "@turf/boolean-intersects";
import { feature as turfFeature } from "@turf/helpers";
import type { Polygon, MultiPolygon } from "geojson";
import { parseStreetLine } from "../geocode/normalize-address.js";
import { streetKeyFromParts } from "../geocode/street-key.js";
import type { CanonicalAddress } from "../types.js";

export interface EsriParcelFeature {
  attributes: Record<string, unknown>;
  geometry?: unknown;
}
export interface EsriParcelSet {
  features?: EsriParcelFeature[];
  error?: unknown;
  exceededTransferLimit?: boolean;
}

/** Street portion of a situs value (before any newline — Collin's situs_disp is multi-line). */
function situsStreet(situs: string): string {
  return situs.split(/\r?\n/)[0] ?? "";
}

function toPolygon(geom: unknown): Polygon | MultiPolygon | null {
  if (!geom) return null;
  const g = arcgisToGeoJSON(geom) as { type?: string };
  return g?.type === "Polygon" || g?.type === "MultiPolygon" ? (g as Polygon | MultiPolygon) : null;
}

/** Combine co-located parcels into one MultiPolygon (their footprints share a precinct). */
function combine(polys: (Polygon | MultiPolygon)[]): Polygon | MultiPolygon {
  if (polys.length === 1) return polys[0]!;
  const coordinates: number[][][][] = [];
  for (const p of polys) {
    if (p.type === "Polygon") coordinates.push(p.coordinates);
    else coordinates.push(...p.coordinates);
  }
  return { type: "MultiPolygon", coordinates };
}

/**
 * Select the parcel(s) whose situs exactly matches the input by
 * (primaryNumber, streetKeyFromParts) — the same shared key the whole pipeline
 * uses. Returns one polygon, a MultiPolygon of co-located matches, or null
 * (no match / ambiguous divergent match / non-polygon).
 */
export function matchParcel(
  features: EsriParcelFeature[],
  address: CanonicalAddress,
  situsField: string,
): Polygon | MultiPolygon | null {
  const wantKey = streetKeyFromParts(address);
  const wantNum = address.primaryNumber;

  const exact: (Polygon | MultiPolygon)[] = [];
  for (const f of features) {
    const situs = f.attributes[situsField];
    if (typeof situs !== "string") continue;
    const parsed = parseStreetLine(situsStreet(situs));
    if (parsed.primaryNumber !== wantNum) continue;
    if (streetKeyFromParts(parsed) !== wantKey) continue;
    const poly = toPolygon(f.geometry);
    if (poly) exact.push(poly);
  }

  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0]!;

  const first = turfFeature(exact[0]!);
  // Anchor-to-first (not full pairwise) is intentional and safe: `combine` only
  // ever ENLARGES the footprint, and an enlarged footprint spanning >1 precinct is
  // downgraded to needs_verification by assessCertainty — never a wrong `high`.
  // Do not change `combine` to drop this property.
  const allColocated = exact.slice(1).every((p) => booleanIntersects(first, turfFeature(p)));
  return allColocated ? combine(exact) : null;
}
