import { createHash } from "node:crypto";
import type { PrecinctFeature } from "../types.js";

/**
 * Stable content hash of a county's precinct snapshot. Covers each feature's
 * county + precinct labels AND geometry — the full legally load-bearing content
 * of a precinct, not just its shape — so a mislabeled county/precinct is caught
 * as drift, not only a moved boundary. Sorted by precinct so it is independent
 * of feature order. Shared by build-boundaries (writes the manifest) and the
 * integrity guard (verifies committed snapshots) so the two can never diverge.
 */
export function snapshotHash(features: PrecinctFeature[]): string {
  const canonical = [...features]
    .sort((a, b) => a.properties.precinct.localeCompare(b.properties.precinct))
    .map((f) => ({
      county: f.properties.county,
      precinct: f.properties.precinct,
      geometry: f.geometry,
    }));
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
