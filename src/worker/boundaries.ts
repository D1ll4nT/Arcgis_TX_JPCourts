import type { FeatureCollection } from "geojson";
import { COUNTIES } from "../types.js";
import type { PrecinctFeature } from "../types.js";

export interface AssetsFetcher {
  fetch(input: Request): Promise<Response>;
}

let cache: PrecinctFeature[] | null = null;

/** Load the 4 committed boundary GeoJSONs from the Assets binding (once per isolate). */
export async function loadBoundaries(assets: AssetsFetcher): Promise<PrecinctFeature[]> {
  if (cache) return cache;
  const all: PrecinctFeature[] = [];
  for (const county of COUNTIES) {
    const res = await assets.fetch(new Request(`https://assets.local/${county}.geojson`));
    if (!res.ok) throw new Error(`boundaries: ${county} asset ${res.status}`);
    const fc = (await res.json()) as FeatureCollection;
    all.push(...(fc.features as PrecinctFeature[]));
  }
  cache = all;
  return all;
}

/** Test-only: reset the module-level boundary cache so tests start cold. */
export function resetBoundariesCacheForTests(): void {
  cache = null;
}
