// tests/smoke/parcel.smoke.test.ts
import { describe, it, expect } from "vitest";
import { createParcelClient } from "../../src/parcel/parcel-client.js";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";
import type { RawAddressInput } from "../../src/types.js";

// Known real addresses, one per county. If a county returns null, replace with
// another known-good appraisal address for that county and re-run.
const CASES: RawAddressInput[] = [
  { street: "411 Elm St", city: "Dallas", zip: "75202", county: "Dallas" },
  { street: "100 E Weatherford St", city: "Fort Worth", zip: "76196", county: "Tarrant" },
  { street: "2501 Coit Rd", city: "Plano", zip: "75023", county: "Collin" },
  { street: "110 W Oak St", city: "Denton", zip: "76201", county: "Denton" },
];

describe("live parcel sources", () => {
  const client = createParcelClient({ timeoutMs: 15_000 });
  for (const raw of CASES) {
    it(`${raw.county} returns a parcel polygon for ${raw.street}`, async () => {
      const parcel = await client.lookup(normalizeAddress(raw));
      expect(parcel, `${raw.county}: no parcel matched — pick another known address`).not.toBeNull();
      expect(["Polygon", "MultiPolygon"]).toContain(parcel!.type);
    });
  }
});
