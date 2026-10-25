import { point, lineString } from "@turf/helpers";
import pointToLineDistance from "@turf/point-to-line-distance";
import type { Polygon, MultiPolygon } from "geojson";

/** All linear rings (outer + holes) of a polygon/multipolygon as coordinate arrays. */
export function ringsOf(geom: Polygon | MultiPolygon): number[][][] {
  return geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
}

/** Distance in meters from [lon,lat] to a polygon's nearest boundary ring. */
export function distanceToPolygonBoundary(
  lon: number,
  lat: number,
  geom: Polygon | MultiPolygon,
): number {
  const pt = point([lon, lat]);
  return Math.min(
    ...ringsOf(geom).map((r) => pointToLineDistance(pt, lineString(r), { units: "meters" })),
  );
}
