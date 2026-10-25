import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";
import { snapshotHash } from "../src/boundary/snapshot-hash.js";
import { SOURCES, type CountySource } from "../src/boundary/sources.js";
import { featureSetToNormalized } from "../src/boundary/esri-to-geojson.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data", "boundaries");

function queryUrl(src: CountySource): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: src.precinctField,
    outSR: "4326", // server reprojects to WGS84 — no manual reprojection
    returnGeometry: "true",
    f: "json",
  });
  return `${src.url}/query?${params.toString()}`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  let total = 0;

  for (const src of SOURCES) {
    const res = await fetch(queryUrl(src));
    if (!res.ok) throw new Error(`${src.county}: HTTP ${res.status} from ${src.url}`);
    const json = (await res.json()) as Parameters<typeof featureSetToNormalized>[1];
    const features = featureSetToNormalized(src.county, json);
    const fc: FeatureCollection = { type: "FeatureCollection", features };

    await writeFile(join(OUT_DIR, `${src.county}.geojson`), JSON.stringify(fc) + "\n");
    manifest.push({
      county: src.county,
      sourceUrl: src.url,
      precinctField: src.precinctField,
      fetchedAt: new Date().toISOString(),
      featureCount: features.length,
      snapshotHash: snapshotHash(features),
      nativeWkid: src.nativeWkid,
    });
    total += features.length;
    console.log(`${src.county}: ${features.length} precinct(s)`);
  }

  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${SOURCES.length} counties, ${total} features total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
