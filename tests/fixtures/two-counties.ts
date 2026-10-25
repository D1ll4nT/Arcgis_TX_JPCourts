import type { PrecinctFeature } from "../../src/types.js";

// Two precincts in DIFFERENT counties that share precinct number "2",
// sharing the line lon=-96.75 — the cross-county straddle hazard.
const dallasP2: PrecinctFeature = {
  type: "Feature",
  properties: { county: "dallas", precinct: "2" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-96.80, 32.70], [-96.75, 32.70], [-96.75, 32.80], [-96.80, 32.80], [-96.80, 32.70]]],
  },
};
const collinP2: PrecinctFeature = {
  type: "Feature",
  properties: { county: "collin", precinct: "2" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-96.75, 32.70], [-96.70, 32.70], [-96.70, 32.80], [-96.75, 32.80], [-96.75, 32.70]]],
  },
};

export const twoCounties: PrecinctFeature[] = [dallasP2, collinP2];
