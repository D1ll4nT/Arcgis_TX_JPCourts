import { readFileSync } from "node:fs";
import type { CalibrationCase, County } from "../../src/types.js";

// Ground-truth note (spec §8): the golden interior labels are spot-checked
// against each county's own public precinct lookup, so they are independent of
// the resolver under test — not circular. Grow this corpus by adding any real
// production miss as a new permanent case.

interface GoldenPoint {
  label: string;
  lon: number;
  lat: number;
  expectedCounty: County | null;
  expectedPrecinct: string | null;
}

interface NearBoundaryPoint {
  label: string;
  county: County;
  lon: number;
  lat: number;
  candidatePrecincts: string[];
  sharedBoundaryGapMeters: number;
}

const golden = JSON.parse(
  readFileSync(new URL("./golden-points.json", import.meta.url), "utf8"),
) as GoldenPoint[];

const nearBoundary = JSON.parse(
  readFileSync(new URL("./near-boundary-points.json", import.meta.url), "utf8"),
) as NearBoundaryPoint[];

// Interior addresses would be located to an address-point/parcel in production
// (~10 m error). They must resolve `high` and correct.
const ADDRESS_POINT_PRECISION_M = 10;

export function calibrationCorpus(): CalibrationCase[] {
  const goldenCases: CalibrationCase[] = golden.map((g) => ({
    label: `golden:${g.label}`,
    lon: g.lon,
    lat: g.lat,
    method: "address-point",
    precisionMeters: ADDRESS_POINT_PRECISION_M,
    expectedCounty: g.expectedCounty,
    expectedPrecinct: g.expectedPrecinct,
  }));

  // Near-boundary points MUST abstain even at good precision. Precision
  // generously covers the measured shared-boundary gap so the point is
  // unambiguously within the error radius of the edge; expectedPrecinct is null
  // because no single precinct may be asserted.
  const nearCases: CalibrationCase[] = nearBoundary.map((p) => ({
    label: `near-boundary:${p.label}`,
    lon: p.lon,
    lat: p.lat,
    method: "address-point",
    precisionMeters: Math.ceil(p.sharedBoundaryGapMeters) + 60,
    expectedCounty: p.county,
    expectedPrecinct: null,
  }));

  return [...goldenCases, ...nearCases];
}
