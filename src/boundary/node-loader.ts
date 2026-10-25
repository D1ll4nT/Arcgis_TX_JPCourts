import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";
import { COUNTIES } from "../types.js";
import type { PrecinctFeature } from "../types.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "boundaries");

/** Read the committed snapshots from disk. For build scripts + tests only (uses fs). */
export function loadBoundariesFromDisk(): PrecinctFeature[] {
  const features: PrecinctFeature[] = [];
  for (const county of COUNTIES) {
    const fc = JSON.parse(
      readFileSync(join(DATA_DIR, `${county}.geojson`), "utf8"),
    ) as FeatureCollection;
    features.push(...(fc.features as PrecinctFeature[]));
  }
  return features;
}
