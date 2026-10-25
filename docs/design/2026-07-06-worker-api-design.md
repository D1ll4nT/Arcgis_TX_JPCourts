# API Worker (D-worker) — Design Spec (production-hardened)

- **Date:** 2026-07-06 (production revision after the parcel tier + prod-readiness review)
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** The Cloudflare Worker that assembles the full pipeline into a live `POST /v1/precinct` API and deploys
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md) (§9 API contract)
- **Consumes:** C1 normalize, C2 D1 street data, C3 TIGER geocode, the parcel tier, the resolver + certainty model, the D-courts directory.

## 1. Problem & context

Everything upstream is built and merged. **D-worker** is the final piece: a Cloudflare Worker that
wires the pipeline behind an authenticated HTTP API and deploys. This production revision folds in the
parcel tier (unblocking `high`) and the fixes from the FAANG-level production-readiness review
(recorded earlier as B2–B4 / H1–H6).

**Owner decisions (2026-07-06):** the site calls the API **server-side only** (the API key is a
backend secret, never in the browser — no CORS surface); launch required **parcel-grade `high`**, now
available. Testing: a **pure `locate()`** tested with fakes + the fetch handler tested against a fake
`Env`; real bindings smoke-tested via `wrangler dev`. The **response shape is the integration seam** —
isolated in a response-mapping layer so site-driven tweaks never touch resolution logic.

## 2. Goals / non-goals

**Goals**
- A deployable Worker exposing `POST /v1/precinct`, `GET /v1/counties`, `GET /v1/health`.
- A pure `locate(input, deps)` core implementing the "cannot be wrong" pipeline + error map, unit-tested
  across every confidence and error path with no bindings.
- Hashed-key auth (KV), per-key native rate limiting, PII-free Analytics Engine logging, boundaries
  from the Assets binding (lazy cache + bbox pre-filter), courts bundled, `street_segments` via D1,
  parcel upgrade via the live `ParcelClient`.
- A deploy runbook (D1 provision + `wrangler d1 import`, KV key, `wrangler deploy`) executed with the owner.

**Non-goals**
- No free-text `{address}` or `{lon,lat}` request forms (structured intake only).
- No CORS/browser support (server-side-only); no multi-tenant key UI (KV, single key, extensible).
- No USPS normalization; no offline parcel store; no automated production deploy (owner-run runbook).

## 3. Request / response contract

`POST /v1/precinct` body is exactly C1's `RawAddressInput`:
```json
{ "street": "9250 Church Rd", "city": "Dallas", "zip": "75231", "county": "Dallas" }
```
Only `street` is required; a non-object body, a non-string field, a missing `street`, or an oversized
body (> 4 KB) → `400`.

Response (resolved):
```jsonc
{
  "result": {
    "county": "tarrant",
    "precinct": "4",
    "submittedCounty": "tarrant",      // the raw submitted county, echoed
    "countyMismatch": false,           // true when case-folded submitted != resolved county
    "court": { /* D-courts CourtEntry, incl. "verified": false */ },
    "courtDataMissing": false          // true only in the defensive no-court case (§4 step 7)
  },
  "match": {
    "normalizedAddress": "624 SADDLEWAY DR, FORT WORTH, TX 76179",
    "lat": 32.8467, "lon": -97.3735,
    "method": "parcel",                // "parcel" (high) | "census" (review/needs_verification)
    "precisionMeters": 5
  },
  "confidence": "high",                // high | review | needs_verification
  "disclaimer": "Automated venue determination for convenience; the filer is responsible for confirming the correct court. Court filing details are unverified until confirmed.",
  "provenance": {
    "boundaryAsOf": "2026-06-25",
    "locationSource": "county appraisal parcel",   // or "Census TIGER 2024 street interpolation"
    "tigerYear": "2024",
    "lookupId": "<uuid>"
  }
}
```
Ambiguous (safety) response: `result.precinct: null`, `result.candidatePrecincts: string[]`,
`result.courts: CourtEntry[]` (one per candidate, looked up per §4 step 7), `confidence:
"needs_verification"`, and a `verification` block (`reason`, `boundaryBetween`, `howToResolve`).
Error responses use a clean envelope `{ error: { code, message, ...context } }` with **no stack and no
address**; errors do not carry `provenance`.

## 4. Pipeline & the "cannot be wrong" error map

`locate(input, deps)` — deps = `{ tigerQuerier: SegmentQuerier; parcel: ParcelClient; boundaries:
PrecinctFeature[]; courts: Record<County, CountyCourts> }` — runs:

1. **Validate.** `street` non-empty after trim; else `bad_input` → `400`.
2. **Normalize** → `CanonicalAddress`.
3. **TIGER geocode (authoritative location).** `geocode(canonical, tigerQuerier)`. A miss
   (`street_not_found` / `house_out_of_range`) → `not_located` → `422` (no point ⇒ no answer; never
   guess a precinct).
4. **Resolve the true county/precinct** from the TIGER point. `resolvePrecinct(tigerPoint)` → `null`
   (point in no Core-4 precinct) → `out_of_area` → `404`. Otherwise this is the **authoritative county**.
5. **Parcel upgrade — queried BY THE RESOLVED COUNTY, never the hint (H6).** Call
   `parcel.lookup({ ...canonical, countyHint: <resolvedCounty uppercased> })`. If it returns a polygon,
   take an interior point via turf `pointOnFeature` and run `assessCertainty({ point, method: "parcel",
   precisionMeters: 5, parcelGeometry }, boundaries)` → `high` (footprint in one precinct) or
   `needs_verification` (straddle, with candidates). Querying by the *resolved* county means a wrong
   `countyHint` can never fetch a wrong-county parcel.
6. **No parcel → TIGER point.** `assessCertainty({ tigerPoint, method: "census", precisionMeters: 150 },
   boundaries)` → `review` (clear of boundaries) or `needs_verification` (near a boundary, with candidates).
7. **Court lookup (H2/H3).** For a resolved precinct, `courts[resolvedCounty].courts[precinct]`. For
   ambiguous candidates, parse each `"county/precinct"` (or bare `"precinct"` in the resolved county)
   and look up `courts[county].courts[precinct]`. If a resolved precinct has no court entry (defensive
   — the D-courts completeness test prevents it), return `court: null` + `courtDataMissing: true`, not
   a 500.
8. **countyMismatch (H1).** `countyMismatch = submittedCounty != null && caseFold(submittedCounty) !=
   resolvedCounty`; `submittedCounty` echoes the raw input county.

`court.verified` passes straight through; the disclaimer always states the venue is automated and
court details unverified.

| Situation | Outcome / HTTP |
| --- | --- |
| `street` missing/blank | `bad_input` → `400` |
| TIGER geocode miss | `not_located` → `422` |
| Point in no Core-4 precinct | `out_of_area` → `404` |
| Parcel footprint in one precinct | `resolved` / `high` → `200` |
| Parcel straddles, or no parcel + near boundary | `resolved` / `needs_verification` → `200` |
| No parcel, clear of boundary | `resolved` / `review` → `200` |

## 5. Worker HTTP layer, bindings & security

- **Routing:** `POST /v1/precinct`, `GET /v1/counties` (supported counties + precinct counts +
  `boundaryAsOf`), `GET /v1/health` (ok + boundary/manifest + tiger versions). Unknown path → `404`;
  wrong method → `405`. Versioned `/v1/`.
- **Auth (server-side-only, hashed keys — H5/security):** read `Authorization: Bearer <key>` or
  `X-API-Key`; SHA-256 the presented key (`crypto.subtle.digest`) and look it up in **KV** by that hash
  (KV never stores the raw key). Missing/unknown/disabled → `401`. **Fail closed:** any KV error →
  `401`/`503`, never allow. `/v1/health` is unauthenticated. No CORS/`OPTIONS` (no browser callers).
- **Rate limiting:** the **native Rate Limiting binding**, per key → `429`.
- **Usage log (PII-free):** one **Analytics Engine** datapoint per lookup — `lookupId`, key hash,
  county, precinct, confidence, outcome, latency. **Never the address** (raw or normalized) — not in
  Analytics, logs, or exceptions.
- **Boundaries (B2 + B3):** **lazy-init** a module-level cache on first request from the **Assets
  binding** (`env.ASSETS.fetch`), parsing the 4 geojson + manifest into `PrecinctFeature[]` and
  precomputing each feature's **bounding box**. The resolve/certainty path **bbox-pre-filters** before
  the expensive turf point-in-polygon / distance work. A cold/warm worst-case (near-boundary) CPU
  benchmark on the real full-res polygons is a launch gate.
- **Courts:** **bundled** (imported JSON — 4 tiny files).
- **`tigerQuerier`:** a D1-backed `SegmentQuerier` over the `street_segments` binding, honoring the C3
  contract (`query(key, null)` ignores ZIP incl. NULL-zip rows).
- **`parcel`:** the merged `ParcelClient` (live query, 2.5 s timeout, degrade to null).
- **5xx (H5):** a top-level catch wraps the handler → clean `503` envelope (no stack/PII). A
  boundary-load or D1 failure returns `503`, never a wrong `out_of_area`.

## 6. Components (file structure)

Worker code under `src/worker/` (separate from the pure `src/` libraries it consumes):

| Unit | Responsibility |
| --- | --- |
| `src/worker/locate.ts` | Pure `locate(input, deps): Promise<LocateOutcome>` — the §4 pipeline + error map. No bindings. |
| `src/worker/response.ts` | Map `LocateOutcome` → `{ status, body }` (the isolated response-shaping seam). |
| `src/worker/courts-lookup.ts` | Bundled-courts helpers: resolved lookup + `"county/precinct"` candidate parsing (H2/H3). |
| `src/worker/d1-querier.ts` | `SegmentQuerier` over the D1 binding. |
| `src/worker/boundaries.ts` | Lazy-load + cache `PrecinctFeature[]` from Assets; bbox pre-filter (B2/B3). |
| `src/worker/auth.ts` | Hashed-key extraction + KV check, fail-closed (H5). |
| `src/worker/index.ts` | `fetch` handler: routing, auth, rate limit, Analytics, wiring deps → `locate` → `response`, top-level 503 catch. |
| `wrangler.jsonc` | Bindings: D1, Assets, KV, Rate Limiting, Analytics Engine. |

`lookupId` via `crypto.randomUUID()`; hashing via `crypto.subtle.digest` (Workers-native).

## 7. D1 data & the import (B4)

`street_segments` is loaded from the C2 dump. **The dump must build the index AFTER the inserts** (a
per-row-maintained index over 397k inserts times out): adjust `scripts/build-tiger.ts` to emit
`CREATE TABLE …; <inserts>; CREATE INDEX idx_street …;` (index last) and regenerate `tiger.sql`. The
runbook loads it with **`wrangler d1 import`** (not `d1 execute --file`), then verifies the row count
equals `data/geocoder/manifest.json` `generatedRows` (396865).

## 8. Testing (offline)

- **`locate()` unit tests** (fakes: in-memory `SegmentQuerier`, a fake `ParcelClient`, a few
  `PrecinctFeature`s, a courts map): parcel → `high`; parcel straddle → `needs_verification`; no-parcel
  clear → `review`; no-parcel near-boundary → `needs_verification` (+candidates); geocode miss →
  `not_located`; out-of-area → `out_of_area`; **H6** the parcel is queried by the resolved county (a
  fake `ParcelClient` returns a parcel only for the resolved county, `null` for the wrong hint); **H1**
  countyMismatch true/false (case-folded); **H2** cross-county candidate court lookup; **H3**
  missing-court → `courtDataMissing`; `court.verified` passthrough; PII-free outcome.
- **Response mapping tests:** each `LocateOutcome` → status + body (disclaimer/provenance present;
  clean error envelope for errors).
- **`boundaries` tests:** the bbox pre-filter returns the same containing feature as the full turf test.
- **Handler tests** (fake `Env`): `401` (no/invalid key; KV-error fail-closed), `429` (rate-limit fake),
  `400` (non-JSON / missing street / oversized), routing (`/v1/health` unauthenticated ok; unknown →
  `404`; wrong method → `405`), top-level `503` on a thrown binding, and a happy-path `POST /v1/precinct`.
- **`wrangler dev` smoke** (manual, pre-deploy): a real `POST /v1/precinct` against local D1/Assets/KV.

## 9. Deploy runbook (owner-executed — account actions)

1. `wrangler d1 create jp-precinct` → put the id in `wrangler.jsonc`.
2. Regenerate `tiger.sql` (index-last, §7) if stale; `wrangler d1 import jp-precinct --file=data/geocoder/tiger.sql --remote`; verify `SELECT COUNT(*)` == 396865.
3. `wrangler kv namespace create KEYS`; generate a strong random key, store its **SHA-256** →
   `wrangler kv key put --binding=KEYS <sha256hex> '{"enabled":true}'`; hand the raw key to the owner as a backend secret.
4. Configure the Assets binding (the 4 boundary geojson + manifest), the Rate Limiting binding, and an Analytics Engine dataset.
5. `wrangler deploy`; capture the live URL (custom domain + WAF preferred over raw `*.workers.dev`).
6. Verify: authenticated `POST /v1/precinct` for `100 W Weatherford St, Fort Worth, TX 76196` (Tarrant County Courthouse) → Tarrant precinct 1; run the CPU benchmark gate; confirm no address appears in any log.

## 10. Success criteria

- `locate()` returns the correct outcome for every §4 row, proven by unit tests with fakes — including
  parcel→`high`, the H6 resolved-county parcel query, H1/H2/H3, and PII-free behavior.
- The handler enforces hashed-key auth (fail-closed `401`), rate limiting (`429`), `400` validation,
  routing, and a top-level `503`, tested against a fake `Env`; no CORS.
- The response contract lives only in `response.ts`; resolution logic is untouched by shape tweaks.
- `wrangler dev` serves a real `POST /v1/precinct` locally; the deploy runbook yields a live
  authenticated endpoint returning Tarrant precinct 4 for the Fort Worth address, with the CPU
  benchmark within budget and no address in any log.
