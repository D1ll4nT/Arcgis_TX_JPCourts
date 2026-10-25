import type { County } from "../types.js";

export interface ParcelSource {
  county: County;
  /** Appraisal parcel layer base URL (no trailing `/query`). */
  url: string;
  /** Situs/property-address attribute field (by NAME). */
  situsField: string;
}

/** Verified public county appraisal parcel layers (parent spec §5). */
export const PARCEL_SOURCES: readonly ParcelSource[] = [
  {
    county: "dallas",
    url: "https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4",
    situsField: "SITEADDRESS",
  },
  // TADParcels = the full Tarrant Appraisal District roll (~758k parcels).
  // The earlier Tax/TCProperty/MapServer/0 held only ~110 county-OWNED parcels,
  // so every residential Tarrant lookup missed and fell back to TIGER (census).
  {
    county: "tarrant",
    url: "https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/MapServer/0",
    situsField: "SITUS_ADDR",
  },
  {
    county: "collin",
    url: "https://maps.collincountytx.gov/server/rest/services/InteractiveMap/Appraisal_District/MapServer/1",
    situsField: "situs_disp",
  },
  {
    county: "denton",
    url: "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0",
    situsField: "SITUS",
  },
];
