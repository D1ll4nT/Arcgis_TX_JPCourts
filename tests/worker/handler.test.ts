import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../src/worker/index.js";
import { sha256Hex } from "../../src/worker/auth.js";
import { resetBoundariesCacheForTests } from "../../src/worker/boundaries.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import type { Env } from "../../src/worker/env.js";
import type { SegmentRow } from "../../src/types.js";

const seg: SegmentRow = { street_key: "|CHURCH|RD|", zip: "75201", from_addr: 100, to_addr: 100, parity: "E", lon1: -96.775, lat1: 32.745, lon2: -96.775, lat2: 32.745 };
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });

async function fakeEnv(): Promise<Env> {
  const hash = await sha256Hex("test-key");
  return {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [seg] }) }) }) },
    KEYS: { get: async (k: string) => (k === hash ? JSON.stringify({ enabled: true }) : null) },
    ASSETS: { fetch: async (req: Request) => {
      const p = new URL(req.url).pathname;
      const map: Record<string, unknown> = {
        "/dallas.geojson": fc([twoPrecincts[0]]),
        "/tarrant.geojson": fc([twoPrecincts[1]]),
        "/collin.geojson": fc([]), "/denton.geojson": fc([]),
      };
      return new Response(JSON.stringify(map[p] ?? fc([])), { status: 200 });
    } },
    RL: { limit: async () => ({ success: true }) },
    AE: { writeDataPoint: () => {} },
  } as unknown as Env;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://api/v1/precinct", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("worker handler", () => {
  beforeEach(() => resetBoundariesCacheForTests());

  it("health is unauthenticated 200", async () => {
    const res = await worker.fetch(new Request("https://api/v1/health"), await fakeEnv());
    expect(res.status).toBe(200);
  });
  it("401 without a valid key", async () => {
    const res = await worker.fetch(post({ street: "100 Church Rd", county: "Dallas" }), await fakeEnv());
    expect(res.status).toBe(401);
  });
  it("503 when a binding throws", async () => {
    const env = await fakeEnv(); (env.ASSETS as any).fetch = async () => { throw new Error("assets down"); };
    const res = await worker.fetch(post({ street: "100 Church Rd", county: "Dallas" }, { authorization: "Bearer test-key" }), env);
    expect(res.status).toBe(503);
  });
  it("200 resolved with a valid key", async () => {
    const res = await worker.fetch(post({ street: "100 Church Rd", city: "Dallas", zip: "75201", county: "Dallas" }, { authorization: "Bearer test-key" }), await fakeEnv());
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.result.precinct).toBe("1");
    expect(b.provenance.lookupId).toBeTruthy();
  });
  it("429 when rate-limited", async () => {
    const env = await fakeEnv(); (env.RL as any).limit = async () => ({ success: false });
    const res = await worker.fetch(post({ street: "100 Church Rd", county: "Dallas" }, { authorization: "Bearer test-key" }), env);
    expect(res.status).toBe(429);
  });
  it("400 on malformed JSON", async () => {
    const req = new Request("https://api/v1/precinct", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: "{not json" });
    expect((await worker.fetch(req, await fakeEnv())).status).toBe(400);
  });
  it("405 on GET /v1/precinct (wrong method)", async () => {
    const res = await worker.fetch(new Request("https://api/v1/precinct", { method: "GET", headers: { authorization: "Bearer test-key" } }), await fakeEnv());
    expect(res.status).toBe(405);
  });
  it("404 on an unknown path", async () => {
    const res = await worker.fetch(new Request("https://api/v1/nope", { headers: { authorization: "Bearer test-key" } }), await fakeEnv());
    expect(res.status).toBe(404);
  });
  it("400 when the body exceeds 4 KB", async () => {
    const big = { street: "1 Church Rd".padEnd(5000, "x"), city: "Dallas", zip: "75201", county: "Dallas" };
    const res = await worker.fetch(post(big, { authorization: "Bearer test-key" }), await fakeEnv());
    expect(res.status).toBe(400);
  });
  it("GET /v1/counties returns precinct counts from the manifest", async () => {
    const res = await worker.fetch(new Request("https://api/v1/counties", { headers: { authorization: "Bearer test-key" } }), await fakeEnv());
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    const tarrant = b.counties.find((c: any) => c.county === "tarrant");
    expect(tarrant.precincts).toBe(8);
  });
});
