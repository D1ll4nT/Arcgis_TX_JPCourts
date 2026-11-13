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

/** Minimal error envelope used by every non-200 path. */
function errorJson(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

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

      if (!(await checkAuth(request, env.KEYS))) return errorJson(401, "unauthorized", "Missing or invalid API key.");

      if (request.method === "GET" && url.pathname === "/v1/counties") {
        const counts = boundaryManifest as { county: string; featureCount: number }[];
        return json(200, {
          counties: COUNTIES.map((c) => ({ county: c, precincts: counts.find((m) => m.county === c)?.featureCount ?? 0 })),
          boundaryAsOf: BOUNDARY_AS_OF,
        });
      }

      if (url.pathname === "/v1/precinct") {
        if (request.method !== "POST") return errorJson(405, "method_not_allowed", "Use POST.");

        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > MAX_BODY) return errorJson(400, "bad_input", "Request body too large.");
        const input = parseRawAddressInput(raw);
        if (input === null) return errorJson(400, "bad_input", "Body must be JSON with string fields.");

        const keyHash = await sha256Hex(presentedKeyFor(request));
        const { success } = await env.RL.limit({ key: keyHash });
        if (!success) return errorJson(429, "rate_limited", "Too many requests.");

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

      return errorJson(404, "not_found", "Unknown endpoint.");
    } catch (err) {
      // Log the error class + message + stack so 503s are diagnosable in
      // `wrangler tail` / observability. A swallowed 503 is a silent failure.
      // The thrown error carries no address/PII (code or geometry errors), so
      // this does not leak the filer's address.
      console.error(
        "[v1/precinct] unhandled error:",
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err),
      );
      return errorJson(503, "unavailable", "Temporarily unavailable.");
    }
  },
};

/** Parse the request body into intake fields; null when it isn't a JSON object. */
function parseRawAddressInput(raw: string): RawAddressInput | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return { street: str(o["street"]), city: str(o["city"]), zip: str(o["zip"]), county: str(o["county"]) };
  } catch {
    return null;
  }
}

function presentedKeyFor(request: Request): string {
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key") ?? "";
}
