import { describe, it, expect } from "vitest";
import { lookupCourt, lookupCandidateCourts } from "../../src/worker/courts-lookup.js";
import type { CountyCourts, County } from "../../src/types.js";

const entry = (name: string) => ({
  courtName: name, places: [], filingAddress: "A", mailingAddress: "", phone: "P",
  efilePortal: "E", ocaLocationId: "", source: "S",
});
const cc = (county: County, precincts: string[]): CountyCourts => ({
  county, verified: false, verifiedAt: null, verifiedBy: null,
  courts: Object.fromEntries(precincts.map((p) => [p, entry(`${county}-${p}`)])),
});
const courts = { dallas: cc("dallas", ["1", "2"]), denton: cc("denton", ["4"]) } as unknown as Record<County, CountyCourts>;

describe("courts lookup", () => {
  it("resolves a court by county + precinct", () => {
    expect(lookupCourt(courts, "dallas", "2")?.courtName).toBe("dallas-2");
    expect(lookupCourt(courts, "dallas", "9")).toBeNull();
  });
  it("resolves bare candidates in the resolved county", () => {
    const r = lookupCandidateCourts(courts, "dallas", ["1", "2"]);
    expect(r.map((e) => e.courtName)).toEqual(["dallas-1", "dallas-2"]);
  });
  it("resolves cross-county 'county/precinct' candidates", () => {
    const r = lookupCandidateCourts(courts, "dallas", ["dallas/1", "denton/4"]);
    expect(r.map((e) => e.courtName)).toEqual(["dallas-1", "denton-4"]);
  });
  it("drops candidates with no court entry", () => {
    expect(lookupCandidateCourts(courts, "dallas", ["9", "denton/9"])).toEqual([]);
  });
});
