import { describe, it, expect } from "vitest";
import { loadBoundaries } from "../../src/worker/boundaries.js";
import { twoPrecincts } from "../fixtures/two-precincts.js";
import type { FeatureCollection } from "geojson";

// Fake Assets: serves a FeatureCollection per county path.
function fakeAssets(byPath: Record<string, FeatureCollection>) {
  return {
    async fetch(req: Request): Promise<Response> {
      const path = new URL(req.url).pathname;
      const fc = byPath[path];
      if (!fc) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(fc), { status: 200 });
    },
  };
}
const fc = (features: unknown[]): FeatureCollection => ({ type: "FeatureCollection", features: features as never });

describe("boundaries", () => {
  it("loads and concatenates features from the Assets binding", async () => {
    const assets = fakeAssets({
      "/dallas.geojson": fc([twoPrecincts[0]]),
      "/tarrant.geojson": fc([twoPrecincts[1]]),
      "/collin.geojson": fc([]),
      "/denton.geojson": fc([]),
    });
    const feats = await loadBoundaries(assets);
    expect(feats.length).toBe(2);
  });
});
