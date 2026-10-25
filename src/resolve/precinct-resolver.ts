import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { validateLonLat } from "../geo/validate.js";
import type { PrecinctFeature, ResolveMatch } from "../types.js";

export function resolvePrecinct(
  lon: number,
  lat: number,
  features: PrecinctFeature[],
): ResolveMatch | null {
  validateLonLat(lon, lat);
  const pt = point([lon, lat]);
  for (const f of features) {
    if (booleanPointInPolygon(pt, f)) {
      return { county: f.properties.county, precinct: f.properties.precinct };
    }
  }
  return null;
}
