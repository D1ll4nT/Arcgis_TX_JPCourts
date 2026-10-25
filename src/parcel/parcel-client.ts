import type { Polygon, MultiPolygon } from "geojson";
import type { CanonicalAddress, County } from "../types.js";
import { PARCEL_SOURCES, type ParcelSource } from "./parcel-sources.js";
import { parcelQueryUrl } from "./situs-query.js";
import { matchParcel, type EsriParcelSet } from "./parcel-match.js";

export interface ParcelClient {
  lookup(address: CanonicalAddress): Promise<Polygon | MultiPolygon | null>;
}

export interface ParcelClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Map a non-authoritative countyHint ("DALLAS") to its parcel source. */
function sourceForHint(hint: string | null): ParcelSource | null {
  if (!hint) return null;
  const county = hint.toLowerCase() as County;
  return PARCEL_SOURCES.find((s) => s.county === county) ?? null;
}

/**
 * Live parcel lookup with graceful degradation: any miss/timeout/error yields
 * null so the caller (D-worker) falls back to the offline TIGER geocoder.
 */
export function createParcelClient(opts: ParcelClientOptions = {}): ParcelClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2500;
  return {
    async lookup(address) {
      if (address.primaryNumber === "") return null; // nothing to anchor on
      const source = sourceForHint(address.countyHint);
      if (!source) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(parcelQueryUrl(address, source), { signal: controller.signal });
        if (!res.ok) return null;
        const json = (await res.json()) as EsriParcelSet;
        if (json.error || json.exceededTransferLimit) return null;
        return matchParcel(json.features ?? [], address, source.situsField);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
