import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundariesFromDisk } from "../src/boundary/node-loader.js";
import { resolvePrecinct } from "../src/resolve/precinct-resolver.js";
import type { County } from "../src/types.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "golden-points.json");

// Golden points are PUBLIC landmarks only (city halls, county courthouses), never
// case or customer addresses. Coordinates are approximate building locations; the
// expected county/precinct is filled from the committed boundaries and then
// spot-checked against each county's own public precinct lookup, so the corpus is
// independent of the resolver under test.
const LANDMARKS: Array<{ label: string; lon: number; lat: number; note?: string }> = [
  { label: "dallas-city-hall", lon: -96.7969, lat: 32.7763 },
  { label: "dallas-mesquite-city-hall", lon: -96.5995, lat: 32.7695 },
  { label: "dallas-desoto-town-center", lon: -96.8569, lat: 32.5896 },
  { label: "dallas-garland-city-hall", lon: -96.6363, lat: 32.9128 },
  { label: "tarrant-county-courthouse", lon: -97.3326, lat: 32.7569 },
  { label: "tarrant-arlington-city-hall", lon: -97.1078, lat: 32.7364 },
  { label: "tarrant-mansfield-city-hall", lon: -97.1225, lat: 32.5636 },
  { label: "collin-wylie-city-hall", lon: -96.5280, lat: 33.0349 },
  { label: "collin-county-courthouse", lon: -96.6366, lat: 33.2195 },
  { label: "denton-county-courthouse", lon: -97.1331, lat: 33.2148 },
  { label: "denton-the-colony-city-hall", lon: -96.8856, lat: 33.0898,
    note: "The Colony is Denton County; case data often mislabels it Dallas." },
  { label: "grandprairie-city-hall-straddle", lon: -96.9977, lat: 32.7457,
    note: "Grand Prairie straddles Dallas/Tarrant; commit whatever the boundary resolves to." },
  { label: "outside-core4-rockwall-courthouse", lon: -96.4527, lat: 32.9097,
    note: "Rockwall County: outside Core 4, expect null (HTTP 404)." },
];

async function main() {
  const features = loadBoundariesFromDisk();
  const out = LANDMARKS.map((p) => {
    const match = resolvePrecinct(p.lon, p.lat, features);
    console.log(`${p.label}: ${match ? `${match.county}/${match.precinct}` : "NULL (outside Core 4)"}`);
    return {
      label: p.label,
      lon: p.lon,
      lat: p.lat,
      expectedCounty: (match?.county ?? null) as County | null,
      expectedPrecinct: match?.precinct ?? null,
      ...(p.note ? { note: p.note } : {}),
    };
  });
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${out.length} golden points`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
