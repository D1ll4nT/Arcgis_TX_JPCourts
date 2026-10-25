// tests/boundary/integrity.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";
import { snapshotHash } from "../../src/boundary/snapshot-hash.js";
import type { PrecinctFeature } from "../../src/types.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "boundaries");

interface ManifestEntry {
  county: string;
  featureCount: number;
  snapshotHash: string;
}

const manifest = JSON.parse(
  readFileSync(join(DATA_DIR, "manifest.json"), "utf8"),
) as ManifestEntry[];

describe("boundary integrity (committed snapshots are immutable)", () => {
  it("manifest covers all four counties", () => {
    expect(new Set(manifest.map((m) => m.county))).toEqual(
      new Set(["dallas", "tarrant", "collin", "denton"]),
    );
  });

  for (const entry of manifest) {
    it(`${entry.county}.geojson matches its manifest hash + feature count`, () => {
      const fc = JSON.parse(
        readFileSync(join(DATA_DIR, `${entry.county}.geojson`), "utf8"),
      ) as FeatureCollection;
      const features = fc.features as PrecinctFeature[];
      expect(features.length).toBe(entry.featureCount);
      expect(snapshotHash(features)).toBe(entry.snapshotHash);
    });
  }
});
