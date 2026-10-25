import type { CountyCourts, CourtEntry, County } from "../types.js";

export function lookupCourt(
  courts: Record<County, CountyCourts>,
  county: County,
  precinct: string,
): CourtEntry | null {
  return courts[county]?.courts[precinct] ?? null;
}

export function lookupCandidateCourts(
  courts: Record<County, CountyCourts>,
  resolvedCounty: County,
  candidates: string[],
): CourtEntry[] {
  const out: CourtEntry[] = [];
  for (const c of candidates) {
    const slash = c.indexOf("/");
    const county = (slash === -1 ? resolvedCounty : c.slice(0, slash)) as County;
    const precinct = slash === -1 ? c : c.slice(slash + 1);
    const entry = lookupCourt(courts, county, precinct);
    if (entry) out.push(entry);
  }
  return out;
}
