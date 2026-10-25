import { COUNTIES } from "../types.js";
import type { County, CountyCourts, RawAddressInput } from "../types.js";
import { loadBoundaries } from "./boundaries.js";
import { d1SegmentQuerier } from "./d1-querier.js";
import { checkAuth, sha256Hex } from "./auth.js";
import { locate } from "./locate.js";
import { toResponse } from "./response.js";
import { createParcelClient } from "../parcel/parcel-client.js";
import type { Env } from "./env.js";
import boundaryManifest from "../../data/boundaries/manifest.json" with { type: "json" };
import geocoderManifest from "../../data/geocoder/manifest.json" with { type: "json" };
import dallasCourts from "../../data/courts/dallas.json" with { type: "json" };
import tarrantCourts from "../../data/courts/tarrant.json" with { type: "json" };
import collinCourts from "../../data/courts/collin.json" with { type: "json" };
import dentonCourts from "../../data/courts/denton.json" with { type: "json" };

const COURTS = { dallas: dallasCourts, tarrant: tarrantCourts, collin: collinCourts, denton: dentonCourts } as unknown as Record<County, CountyCourts>;
const BOUNDARY_AS_OF = String((boundaryManifest as { fetchedAt: string }[])[0]?.fetchedAt ?? "").slice(0, 10);
const TIGER_YEAR = (geocoderManifest as { tigerYear: string }).tigerYear;
const MAX_BODY = 4096;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return json(200, { ok: true, boundaryAsOf: BOUNDARY_AS_OF, tigerYear: TIGER_YEAR });
      }

      if (!(await checkAuth(request, env.KEYS))) return json(401, { error: { code: "unauthorized", message: "Missing or invalid API key." } });

      if (request.method === "GET" && url.pathname === "/v1/counties") {
        const counts = boundaryManifest as { county: string; featureCount: number }[];
        return json(200, {
          counties: COUNTIES.map((c) => ({ county: c, precincts: counts.find((m) => m.county === c)?.featureCount ?? 0 })),
          boundaryAsOf: BOUNDARY_AS_OF,
        });
      }

      if (url.pathname === "/v1/precinct") {
        if (request.method !== "POST") return json(405, { error: { code: "method_not_allowed", message: "Use POST." } });

        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > MAX_BODY) return json(400, { error: { code: "bad_input", message: "Request body too large." } });
        let input: RawAddressInput;
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
          input = {
            street: typeof parsed["street"] === "string" ? parsed["street"] : "",
            city: typeof parsed["city"] === "string" ? parsed["city"] : "",
            zip: typeof parsed["zip"] === "string" ? parsed["zip"] : "",
            county: typeof parsed["county"] === "string" ? parsed["county"] : "",
          };
        } catch {
          return json(400, { error: { code: "bad_input", message: "Body must be JSON with string fields." } });
        }

        const keyHash = await sha256Hex(presentedKeyFor(request));
        const { success } = await env.RL.limit({ key: keyHash });
        if (!success) return json(429, { error: { code: "rate_limited", message: "Too many requests." } });

        const boundaries = await loadBoundaries(env.ASSETS);
        const outcome = await locate(input, {
          tigerQuerier: d1SegmentQuerier(env.DB),
          // Parcel is the primary tier (runs first), so cap it well under the
          // downstream 2.5s client budget — leaves room for the TIGER fallback.
          parcel: createParcelClient({ timeoutMs: 1500 }),
          boundaries,
          courts: COURTS,
        });

        const lookupId = crypto.randomUUID();
        const { status, body } = toResponse(outcome, { lookupId, boundaryAsOf: BOUNDARY_AS_OF, tigerYear: TIGER_YEAR });

        // PII-free usage log (never the address).
        const county = outcome.kind === "resolved" ? outcome.county : "";
        const precinct = outcome.kind === "resolved" ? (outcome.precinct ?? "") : "";
        const confidence = outcome.kind === "resolved" ? outcome.confidence : "";
        env.AE.writeDataPoint({ blobs: [lookupId, keyHash, county, precinct, confidence, outcome.kind], indexes: [county] });

        return json(status, body);
      }

      return json(404, { error: { code: "not_found", message: "Unknown endpoint." } });
    } catch (err) {
      // Log the error class + message + stack so 503s are diagnosable in
      // `wrangler tail` / observability. A swallowed 503 is a silent failure.
      // The thrown error carries no address/PII (code or geometry errors), so
      // this does not leak the filer's address.
      console.error(
        "[v1/precinct] unhandled error:",
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err),
      );
      return json(503, { error: { code: "unavailable", message: "Temporarily unavailable." } });
    }
  },
};

function presentedKeyFor(request: Request): string {
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key") ?? "";
}
