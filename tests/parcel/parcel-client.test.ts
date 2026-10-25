import { describe, it, expect } from "vitest";
import { createParcelClient } from "../../src/parcel/parcel-client.js";
import { normalizeAddress } from "../../src/geocode/normalize-address.js";
import { esriSquare } from "../fixtures/esri-parcel.js";

const addr = normalizeAddress({ street: "411 Elm St", city: "Dallas", zip: "75201", county: "Dallas" });
const okBody = JSON.stringify({ features: [{ attributes: { SITEADDRESS: "411 ELM ST" }, geometry: esriSquare(-96.78, 32.745, 0.001) }] });
const jsonResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

describe("createParcelClient", () => {
  it("returns a parcel polygon on a successful match", async () => {
    const client = createParcelClient({ fetchImpl: async () => jsonResponse(okBody) });
    expect((await client.lookup(addr))?.type).toBe("Polygon");
  });

  it("returns null on a non-200 response", async () => {
    const client = createParcelClient({ fetchImpl: async () => jsonResponse("{}", 500) });
    expect(await client.lookup(addr)).toBeNull();
  });

  it("returns null on an ArcGIS error payload", async () => {
    const client = createParcelClient({ fetchImpl: async () => jsonResponse(JSON.stringify({ error: { code: 400 } })) });
    expect(await client.lookup(addr)).toBeNull();
  });

  it("returns null when the fetch throws (network/timeout)", async () => {
    const client = createParcelClient({ fetchImpl: async () => { throw new Error("abort"); } });
    expect(await client.lookup(addr)).toBeNull();
  });

  it("returns null for an unknown county hint and for a missing house number", async () => {
    const never = createParcelClient({ fetchImpl: async () => { throw new Error("should not be called"); } });
    const outOfArea = normalizeAddress({ street: "411 Elm St", city: "X", zip: "00000", county: "Rockwall" });
    expect(await never.lookup(outOfArea)).toBeNull();
    const noNumber = normalizeAddress({ street: "Elm St", city: "Dallas", zip: "75201", county: "Dallas" });
    expect(await never.lookup(noNumber)).toBeNull();
  });
});
