# Parcel Tier (parcel-grade `high`) — Design Spec

- **Date:** 2026-07-06
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Resolve an address to its county-appraisal **parcel polygon** so the footprint test yields `high` confidence
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md) (§5 verified parcel endpoints)
- **Unblocks:** the D-worker launch gate (owner requires parcel-grade `high` before production).

## 1. Problem & context

The offline pipeline (C1 normalize → C2 TIGER data → C3 geocode → resolver → certainty) tops out at
`review` confidence, because street-level interpolation is the `census` method. The certainty model
**already** grants `high` when given a **parcel polygon** whose footprint sits inside one precinct
(`assessCertainty` footprint test, `src/resolve/certainty.ts`). The parcel tier supplies that
polygon.

**Chosen approach (owner decision 2026-07-06):** a **live parcel query** against the county appraisal
ArcGIS layer per request, **degrading to the offline TIGER street point** on any miss/timeout/error.
So `high` is available when the county server is reachable, and the system always returns a safe
answer offline (never blocks on an external server). This matches the parent spec's original verified
approach (§5) and keeps the offline baseline intact.

## 2. Goals / non-goals

**Goals**
- A `src/parcel/` module exposing an injectable `ParcelClient` that maps a `CanonicalAddress` to a
  parcel `Polygon`/`MultiPolygon` (WGS84) or `null` (no confident parcel).
- Reuse C1 normalization + the shared `streetKeyFromParts` so parcel situs matching is consistent
  with the rest of the pipeline.
- The "cannot be wrong" matching discipline: never return an uncertain/ambiguous parcel — return
  `null` and let the caller fall back to TIGER.
- Offline-unit-testable pure logic (query building, matching/selection, Esri→GeoJSON) + a separate
  live smoke test per county endpoint.

**Non-goals**
- **No offline parcel store** (the ~2–2.5M-parcel offline dataset was rejected as too heavy; live
  query + TIGER fallback chosen).
- **No fallback orchestration here** — the "parcel hit → high / parcel null → TIGER → review"
  wiring lives in D-worker's `locate()` (resumed later). This tier only produces the parcel (or null).
- No parcel-level owner/tax data — geometry + situs only, for the footprint test.
- No new counties beyond the Core 4.

## 3. Architecture & the `ParcelClient` seam

```ts
export interface ParcelClient {
  /** Parcel polygon for the address, or null when no parcel can be matched with confidence. */
  lookup(address: CanonicalAddress): Promise<Polygon | MultiPolygon | null>;
}
```

- The **pure logic** — building the anchored situs query, matching/selecting the returned parcels,
  converting Esri geometry to GeoJSON — is unit-tested with fixture ArcGIS responses.
- The **networked fetch** is a thin layer (one `fetch` per lookup) behind the same interface, covered
  by a live smoke test.
- D-worker injects a real `ParcelClient` in production and a fake in its own tests. Because the
  interface returns `null` on any non-confident outcome, the caller's fallback logic is trivial.

## 4. Sources & anchored query (reuse C1)

`src/parcel/parcel-sources.ts` — the four verified endpoints (parent spec §5):

| County | Endpoint | Situs field |
| --- | --- | --- |
| dallas | `https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4` | `SITEADDRESS` |
| tarrant | `https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0` | `SITUS_ADDR` |
| collin | `https://maps.collincountytx.gov/server/rest/services/InteractiveMap/Appraisal_District/MapServer/1` | `situs_disp` (multi-line) |
| denton | `https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0` | `SITUS` |

The county is chosen from the resolved county (or the `countyHint` before resolution — see §7). The
query is **anchored** and built from C1's canonical components:

- `where = <situsField> LIKE '<primaryNumber> <streetBody>%'`, where `<streetBody>` is the
  standardized `preDirectional streetName streetSuffix postDirectional` (spaces collapsed, C1's
  ALL-CAPS USPS form — which matches how situs is stored). **Never** a leading `%…%` (the parent
  spec's live test showed `%411 ELM%` also matches `4411 ELM ST`).
- `outFields = <situsField>`, `outSR = 4326` (WGS84 directly — no reprojection), `returnGeometry =
  true`, `f = json`, and a `resultRecordCount` cap (guard `exceededTransferLimit`).

## 5. Matching & selection — the "cannot be wrong" discipline

For each returned parcel, take its situs string, isolate the **street portion only** (for Collin's
multi-line `situs_disp`, the part before the first `\r\n`; never match across the newline), run it
through the **same C1 `parseStreetLine`**, and compare to the input by
`(primaryNumber, streetKeyFromParts(parsed))` — the exact shared key from C3/geocode, so matching is
consistent with the whole pipeline. Owner-mailing city/zip are never used to filter.

Selection rule:

1. **No exact `(primaryNumber, street_key)` match** → return `null` (fall back to TIGER; the anchored
   `LIKE` over-matches, so the exact post-filter is mandatory).
2. **One or more exact matches, all co-located** (their geometries intersect / share a footprint —
   condos, splits, dupes) → return that footprint (any of them; the precinct footprint test resolves
   them identically). Merge into a single geometry if the county returns split polygons.
3. **Exact matches with divergent, non-intersecting geometry** (the same street number appears at
   genuinely different places) → **ambiguous → return `null`** (never guess a parcel).

Esri geometry converts via the existing `arcgisToGeoJSON` (reused from `src/boundary/esri-to-geojson`
patterns). A non-polygon or empty geometry → treated as no match (`null`).

## 6. Timeout, degrade & caching

- **Hard timeout** on the live fetch (default **2500 ms**, a module constant) via `AbortController`;
  a timeout resolves the lookup to `null` (degrade to TIGER) rather than stalling the request.
- Any network error, HTTP non-200, ArcGIS `error`, or `exceededTransferLimit` → `null`.
- **Caching is a D-worker concern**, not built here: because `lookup` is a pure function of the
  `CanonicalAddress`, D-worker may wrap it in a KV/Cache-API layer keyed by `canonicalLine`. This tier
  stays cache-agnostic.

## 7. County selection (note for D-worker)

`lookup` needs a county to pick the endpoint. Before the precinct is resolved we only have the
non-authoritative `countyHint`. D-worker's `locate()` will call the parcel client with the
`countyHint`; if the hint is wrong the situs match usually fails (→ `null` → TIGER fallback, which
resolves the true county from coordinates).

**Precondition / D-worker requirement (final-review Important, 2026-07-06):** a wrong hint degrades
safely **only when the same `(house-number, street-key)` does not also exist in the wrongly-hinted
county's appraisal layer.** If it does, `lookup` returns a real, confident parcel in the *wrong*
county → `high` → a case filed in the wrong court. This tier is contract-correct (it returns the
parcel for the county it was asked to query); the fix belongs in D-worker's orchestration:
**gate parcel-grade `high` on a cross-check that the county resolved from the parcel's point equals
the `ParcelSource.county` that was queried; otherwise discard the parcel and fall back to TIGER.**
D-worker should surface the queried `source.county` from `lookup` (or recompute it from the hint) to
perform this check. This is recorded as a blocker in the D-worker spec §10.

## 8. Testing

- **Unit (offline, fixtures)** — `tests/parcel/`:
  - Query building: a `CanonicalAddress` → the correct anchored `where` clause + params per county.
  - Matching/selection over fixture Esri `FeatureSet`s: anchored over-match rejected (`4411 ELM ST`
    when asking `411 ELM`), Collin multi-line street-only match, N>1 co-located → single footprint,
    divergent geometry → `null`, non-polygon → `null`.
  - Esri→GeoJSON conversion of a sample parcel ring.
- **Live smoke** (separate config, like `tests/smoke/sources.smoke.test.ts`) — each county endpoint
  still returns a parcel with polygon geometry for a known address, using the current situs field.
- No network in `npm test`; the live smoke runs via its own script (e.g. `npm run smoke`).

## 9. Success criteria

- `ParcelClient.lookup(canonicalAddress)` returns a WGS84 `Polygon`/`MultiPolygon` for a well-formed
  in-county address that exists in the appraisal layer, and `null` for a miss, an ambiguous match, a
  timeout, or any error — proven by unit tests with fixtures.
- Passing the returned polygon to `assessCertainty` (with `method:"parcel"`, plus an interior point
  from the parcel via turf `pointOnFeature`) yields `high` when the parcel sits in one precinct and
  `needs_verification` when it straddles (footprint test already implemented; a parcel-tier test
  confirms the wiring). D-worker uses the same `pointOnFeature`-derived point when it integrates.
- The anchored-match over-catch and Collin multi-line gotchas are covered by tests.
- Live smoke confirms all four county endpoints still answer with the expected situs field + geometry.
- Nothing here depends on an offline parcel store, and a county-server outage degrades to `null`
  (never throws, never stalls past the timeout).
