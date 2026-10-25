import type { LocateOutcome } from "./locate.js";
import type { County } from "../types.js";

const DISCLAIMER =
  "Automated venue determination for convenience; the filer is responsible for confirming the correct court. Court filing details are unverified until confirmed.";
const SUPPORTED: County[] = ["dallas", "tarrant", "collin", "denton"];

export interface ResponseMeta {
  lookupId: string;
  boundaryAsOf: string;
  tigerYear: string;
}

export function toResponse(
  outcome: LocateOutcome,
  meta: ResponseMeta,
): { status: number; body: unknown } {
  switch (outcome.kind) {
    case "bad_input":
      return { status: 400, body: { error: { code: "bad_input", message: "Missing required fields", missing: outcome.missing } } };
    case "not_located":
      return {
        status: 422,
        body: { error: { code: "not_located", message: "Could not locate the address; check spelling or add a ZIP.", reason: outcome.reason, countyHint: outcome.countyHint } },
      };
    case "out_of_area":
      return { status: 404, body: { error: { code: "out_of_area", message: "Address is outside the supported counties.", supportedCounties: SUPPORTED } } };
    case "resolved": {
      const result: Record<string, unknown> = {
        county: outcome.county,
        precinct: outcome.precinct,
        submittedCounty: outcome.submittedCounty,
        countyMismatch: outcome.countyMismatch,
        courtDataMissing: outcome.courtDataMissing,
      };
      if (outcome.precinct !== null) result["court"] = outcome.court;
      else {
        result["candidatePrecincts"] = outcome.candidatePrecincts ?? [];
        result["courts"] = outcome.courts ?? [];
      }
      const body: Record<string, unknown> = {
        result,
        match: { normalizedAddress: outcome.normalizedAddress, lat: outcome.lat, lon: outcome.lon, method: outcome.method, precisionMeters: outcome.precisionMeters },
        confidence: outcome.confidence,
        disclaimer: DISCLAIMER,
        provenance: { boundaryAsOf: meta.boundaryAsOf, locationSource: outcome.locationSource, tigerYear: meta.tigerYear, lookupId: meta.lookupId },
      };
      if (outcome.confidence === "needs_verification") {
        body["verification"] = {
          reason: "The location is within the location method's error margin of a precinct boundary.",
          boundaryBetween: outcome.boundaryBetween ?? [],
          howToResolve: "Confirm the parcel against the precinct boundary, or contact the courts listed.",
        };
      }
      return { status: 200, body };
    }
  }
}
