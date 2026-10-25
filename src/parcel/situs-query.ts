import type { CanonicalAddress } from "../types.js";
import type { ParcelSource } from "./parcel-sources.js";

/** Street body without the house number, C1-standardized ("N ELM ST"). */
function streetBody(a: CanonicalAddress): string {
  return [a.preDirectional, a.streetName, a.streetSuffix, a.postDirectional]
    .filter((p): p is string => p !== null && p !== "")
    .join(" ");
}

/** Anchored situs clause: "<situsField> LIKE '<number> <streetBody>%'". */
export function situsWhere(address: CanonicalAddress, source: ParcelSource): string {
  const num = address.primaryNumber.replace(/'/g, "''");
  const body = streetBody(address).replace(/'/g, "''");
  return `${source.situsField} LIKE '${num} ${body}%'`;
}

/** Full ArcGIS query URL: WGS84 geometry, situs field, capped record count. */
export function parcelQueryUrl(address: CanonicalAddress, source: ParcelSource): string {
  const params = new URLSearchParams({
    where: situsWhere(address, source),
    outFields: source.situsField,
    outSR: "4326",
    returnGeometry: "true",
    resultRecordCount: "100", // high cap so a divergent same-situs parcel can't be silently truncated out of the exact-match set (a well-behaved ArcGIS server also sets exceededTransferLimit, which the client treats as ambiguous → null)
    f: "json",
  });
  // Replace + with %20 so decodeURIComponent properly decodes spaces
  const queryString = params.toString().replace(/\+/g, "%20");
  return `${source.url}/query?${queryString}`;
}
