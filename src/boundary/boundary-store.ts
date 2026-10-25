import type { County, PrecinctFeature } from "../types.js";

export interface BoundaryStore {
  all(): PrecinctFeature[];
  byCounty(county: County): PrecinctFeature[];
}

export function createBoundaryStore(features: PrecinctFeature[]): BoundaryStore {
  return {
    all: () => features,
    byCounty: (county) => features.filter((f) => f.properties.county === county),
  };
}
