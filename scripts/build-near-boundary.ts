import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ringsOf, distanceToPolygonBoundary } from "../src/geo/boundary-distance.js";
import { loadBoundariesFromDisk } from "../src/boundary/node-loader.js";
import { COUNTIES } from "../src/types.js";
import type { County, PrecinctFeature } from "../src/types.js";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "tests", "fixtures", "near-boundary-points.json",
);

/** The vertex of one county precinct that sits closest to another precinct of the
 * same county — i.e. a point on (or essentially on) their shared boundary.
 *
 * Optimised: iterates all unordered pairs but breaks out of the inner vertex loops
 * as soon as gap == 0 (coincident topology), so each county typically finishes
 * after examining only a small fraction of the total vertex set.
 */
function deriveSharedBoundaryPoint(county: County, features: PrecinctFeature[]) {
  const inCounty = features.filter((f) => f.properties.county === county);
  let best: { lon: number; lat: number; a: string; b: string; dist: number } | null = null;

  outer:
  for (const a of inCounty) {
    for (const b of inCounty) {
      if (a.properties.precinct >= b.properties.precinct) continue; // each unordered pair once
      for (const ring of ringsOf(a.geometry)) {
        for (const coord of ring) {
          const lon = coord[0]!;
          const lat = coord[1]!;
          const dist = distanceToPolygonBoundary(lon, lat, b.geometry);
          if (!best || dist < best.dist) {
            best = { lon, lat, a: a.properties.precinct, b: b.properties.precinct, dist };
          }
          // Coincident topology: vertex is ON the boundary of the neighbour — no need
          // to search further, this is the tightest possible result.
          if (best.dist === 0) break outer;
        }
      }
    }
  }
  return best;
}

async function main() {
  const features = loadBoundariesFromDisk();
  const out: Array<{
    label: string; county: County; lon: number; lat: number;
    candidatePrecincts: string[]; expectedConfidence: string; sharedBoundaryGapMeters: number;
  }> = [];
  for (const county of COUNTIES) {
    const p = deriveSharedBoundaryPoint(county, features);
    if (!p) throw new Error(`${county}: could not find a precinct pair`);
    out.push({
      label: `${county}-near-boundary`,
      county,
      lon: p.lon,
      lat: p.lat,
      candidatePrecincts: [p.a, p.b].sort((x, y) => x.localeCompare(y)),
      expectedConfidence: "needs_verification",
      sharedBoundaryGapMeters: Number(p.dist.toFixed(2)),
    });
    console.log(`${county}: precincts ${p.a}/${p.b}, shared-boundary gap ${p.dist.toFixed(2)} m`);
  }
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${out.length} near-boundary points`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
