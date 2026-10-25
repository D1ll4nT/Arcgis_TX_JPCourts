declare module "@esri/arcgis-to-geojson-utils" {
  import type { GeoJSON } from "geojson";

  export function arcgisToGeoJSON(arcgisGeometry: unknown): GeoJSON | null;
}
