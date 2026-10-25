import { arcgisToGeoJSON } from "@esri/arcgis-to-geojson-utils";
import type { Polygon, MultiPolygon } from "geojson";
import type { County, PrecinctFeature } from "../types.js";
import { extractPrecinct } from "./precinct-fields.js";

export interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: unknown;
}

export interface EsriFeatureSet {
  features?: EsriFeature[];
  exceededTransferLimit?: boolean;
  error?: unknown;
}

export function featureSetToNormalized(county: County, fs: EsriFeatureSet): PrecinctFeature[] {
  if (fs.error) throw new Error(`ArcGIS error for ${county}: ${JSON.stringify(fs.error)}`);
  if (fs.exceededTransferLimit) {
    throw new Error(`${county}: exceededTransferLimit — the query must paginate (resultOffset)`);
  }
  const features = fs.features ?? [];
  if (features.length === 0) throw new Error(`${county}: zero features returned`);

  return features.map((f) => {
    const precinct = extractPrecinct(county, f.attributes);
    const geometry = arcgisToGeoJSON(f.geometry) as Polygon | MultiPolygon;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      throw new Error(`${county} precinct ${precinct}: expected Polygon/MultiPolygon geometry`);
    }
    return { type: "Feature", properties: { county, precinct }, geometry };
  });
}
