import type { County } from "../types.js";

export interface CountySource {
  county: County;
  /** Layer base URL (no trailing `/query`). */
  url: string;
  /** Attribute field (by NAME, not alias) holding the precinct. */
  precinctField: string;
  nativeWkid: number;
}

export const SOURCES: readonly CountySource[] = [
  {
    county: "dallas",
    url: "https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/JP/FeatureServer/0",
    precinctField: "DISTRICT",
    nativeWkid: 102100,
  },
  {
    county: "tarrant",
    url: "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/JusticeOfThePeace/MapServer/0",
    precinctField: "JP",
    nativeWkid: 2276,
  },
  {
    county: "collin",
    url: "https://maps.collincountytx.gov/server/rest/services/Election/Find_Elected_Representative/MapServer/1",
    precinctField: "name",
    nativeWkid: 3857,
  },
  {
    county: "denton",
    url: "https://gis.dentoncounty.gov/arcgis/rest/services/PoliticalBoundaries_GC/MapServer/5",
    precinctField: "JP_C",
    nativeWkid: 2276,
  },
];
