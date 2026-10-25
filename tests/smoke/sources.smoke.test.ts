import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SOURCES } from "../../src/boundary/sources.js";
import { featureSetToNormalized, type EsriFeatureSet } from "../../src/boundary/esri-to-geojson.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../data/boundaries/manifest.json", import.meta.url), "utf8"),
) as Array<{ county: string; featureCount: number }>;

// Live network check — run on demand via `npm run smoke`, NOT in the default suite.
describe("live JP sources", () => {
  for (const src of SOURCES) {
    it(`${src.county} still returns its expected precinct count + field`, async () => {
      const url =
        `${src.url}/query?where=1%3D1&outFields=${src.precinctField}` +
        `&outSR=4326&returnGeometry=true&f=json`;
      const res = await fetch(url);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as EsriFeatureSet;
      const features = featureSetToNormalized(src.county, json);
      const expected = manifest.find((m) => m.county === src.county)!;
      expect(features.length).toBe(expected.featureCount);
    });
  }
});
