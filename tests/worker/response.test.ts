import { describe, it, expect } from "vitest";
import { toResponse } from "../../src/worker/response.js";
import type { LocateOutcome } from "../../src/worker/locate.js";

const meta = { lookupId: "L1", boundaryAsOf: "2026-06-25", tigerYear: "2024" };
const base = {
  kind: "resolved" as const, county: "dallas" as const, precinct: "1", confidence: "high" as const,
  method: "parcel" as const, precisionMeters: 5, lon: -96.7, lat: 32.7,
  normalizedAddress: "100 CHURCH RD, DALLAS, TX 75201", locationSource: "county appraisal parcel",
  submittedCounty: "Dallas", countyMismatch: false,
  court: { courtName: "d1", places: [], filingAddress: "A", mailingAddress: "", phone: "P", efilePortal: "E", ocaLocationId: "", source: "S" },
  courtDataMissing: false,
};

describe("toResponse", () => {
  it("maps a resolved high outcome to 200 with provenance + disclaimer", () => {
    const { status, body } = toResponse(base as LocateOutcome, meta);
    expect(status).toBe(200);
    const b = body as any;
    expect(b.result.precinct).toBe("1");
    expect(b.confidence).toBe("high");
    expect(b.provenance.lookupId).toBe("L1");
    expect(typeof b.disclaimer).toBe("string");
    expect(b.match.method).toBe("parcel");
  });
  it("maps bad_input → 400, not_located → 422, out_of_area → 404 with a clean error envelope (no address)", () => {
    const bi = toResponse({ kind: "bad_input", missing: ["street"] }, meta);
    expect(bi.status).toBe(400);
    expect((bi.body as any).provenance).toBeUndefined();
    expect((bi.body as any).error?.provenance).toBeUndefined();

    const nl = toResponse({ kind: "not_located", reason: "street_not_found", normalizedAddress: "X", countyHint: "DALLAS" }, meta);
    expect(nl.status).toBe(422);
    expect((nl.body as any).error.code).toBe("not_located");
    expect((nl.body as any).provenance).toBeUndefined();
    expect((nl.body as any).error.provenance).toBeUndefined();
    expect((nl.body as any).error.recognized).toBeUndefined();
    expect(JSON.stringify(nl.body)).not.toContain("CHURCH"); // no normalized address leaked

    const oa = toResponse({ kind: "out_of_area" }, meta);
    expect(oa.status).toBe(404);
    expect((oa.body as any).provenance).toBeUndefined();
    expect((oa.body as any).error?.provenance).toBeUndefined();
  });
  it("ambiguous → 200 needs_verification with candidates + courts", () => {
    const amb = { ...base, precinct: null, confidence: "needs_verification" as const, court: null,
      candidatePrecincts: ["1", "2"], boundaryBetween: ["1", "2"],
      courts: [base.court, { ...base.court, courtName: "d2" }], courtDataMissing: false };
    const { status, body } = toResponse(amb as LocateOutcome, meta);
    expect(status).toBe(200);
    expect((body as any).result.candidatePrecincts).toEqual(["1", "2"]);
    expect((body as any).result.courts).toHaveLength(2);
    expect((body as any).verification).toBeDefined();
    expect((body as any).verification.boundaryBetween).toEqual(["1", "2"]);
    expect(typeof (body as any).verification.reason).toBe("string");
  });
});
