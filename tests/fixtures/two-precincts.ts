import type { PrecinctFeature } from "../../src/types.js";

const west: PrecinctFeature = {
  type: "Feature",
  properties: { county: "dallas", precinct: "1" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-96.80, 32.70], [-96.75, 32.70], [-96.75, 32.80], [-96.80, 32.80], [-96.80, 32.70]]],
  },
};

const east: PrecinctFeature = {
  type: "Feature",
  properties: { county: "dallas", precinct: "2" },
  geometry: {
    type: "Polygon",
    coordinates: [[[-96.75, 32.70], [-96.70, 32.70], [-96.70, 32.80], [-96.75, 32.80], [-96.75, 32.70]]],
  },
};

export const twoPrecincts: PrecinctFeature[] = [west, east];
