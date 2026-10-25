# Geocoder Lookup + Interpolation (Geocoder C3) — Design Spec

- **Date:** 2026-07-05
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** In-Worker geocoder: canonical address → point via the C2 TIGER segment DB
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md)
- **Prior sub-projects:** [C1 address normalizer](./2026-07-04-address-normalizer-design.md), [C2 TIGER data](./2026-07-04-tiger-geocoder-data-design.md)

## 1. Problem & context

The offline geocoder turns an address into coordinates without any external API. C1 canonicalizes
the intake fields; C2 built a Cloudflare D1 `street_segments` dataset (endpoints-only, keyed by
`street_key`). **C3 (this spec)** is the lookup + interpolation: given a `CanonicalAddress`, find the
matching street segment and linearly interpolate the house number's position, returning a point that
feeds the existing certainty model. **D** (next) is the Cloudflare Worker that provides the real D1
implementation and the HTTP API.

C3's output maps directly onto the resolver's `CertaintyInput` (`{lon, lat, method, precisionMeters}`).
TIGER street interpolation is the **`census`** location method — excluded from the model's
high-precision set — so it yields `review` when clear of a precinct boundary and `needs_verification`
when near one. It never yields `high`; that is reserved for the future parcel tier.

## 2. Goals / non-goals

**Goals**
- `geocode(address, db)` → a `GeocodeResult` (matched point or a typed miss) using the C2 segment DB
  through a small `SegmentQuerier` seam, so it runs on D1 in the Worker and on local SQLite in tests.
- A pure, fully-tested `interpolateSegment` core.
- A **single shared `street_key` builder** used by both C2 and C3, so the stored keys and the query
  keys are guaranteed identical.
- Offline-testable in `npm test` (local SQLite; no network, no Cloudflare account).

**Non-goals**
- No D1 adapter and no Worker/HTTP layer (that is D). C3 defines the `SegmentQuerier` interface and a
  test adapter only.
- No miss-fallback policy (fall back to county hint / 404 / 422 lives in D, per the parent design).
- No perpendicular side offset — endpoints-only centerline interpolation (C2 decision).
- No parcel-grade precision (a later tier).
- No ZIP-centroid or fuzzy street matching in this version.

## 3. Contract & result type

New module `src/geocode/geocode.ts`.

```ts
export interface SegmentQuerier {
  query(streetKey: string, zip: string | null): Promise<SegmentRow[]>;
}

export type GeocodeResult =
  | { status: "matched"; lon: number; lat: number; method: "census"; precisionMeters: 150 }
  | { status: "miss"; reason: "street_not_found" | "house_out_of_range" };

export function geocode(address: CanonicalAddress, db: SegmentQuerier): Promise<GeocodeResult>;
```

- A `matched` result's `{lon, lat, method, precisionMeters}` are exactly the fields of `CertaintyInput`
  (`src/resolve/certainty.ts`); the caller passes them straight through.
- `method` is always `"census"`; `precisionMeters` is always **`150`** (decided: conservative radius so
  boundary-adjacent TIGER geocodes are flagged `needs_verification` rather than silently answered —
  comfortably covers TIGER's ~50–100 m interpolation error plus the endpoints-only approximation).
- A `miss` carries a typed `reason` for observability; the caller (D) decides the fallback.

## 4. Shared `street_key` (refactor of merged C2 code)

C3 must produce the byte-identical `street_key` C2 stored, or lookups fail silently. Today C2's key
builder is a private function in `src/geocode/tiger-edge.ts`. Extract it into a shared module
`src/geocode/street-key.ts`:

```ts
export function streetKeyFromParts(parts: StreetParts): string {
  // streetName is a non-nullable string in StreetParts, so no `?? ""` on it.
  return `${parts.preDirectional ?? ""}|${parts.streetName}|${parts.streetSuffix ?? ""}|${parts.postDirectional ?? ""}`;
}
```

- **C2** (`tiger-edge.ts`) keys from `streetKeyFromParts(parseStreetLine(FULLNAME))` (behavior unchanged;
  its existing tests must still pass, proving byte-identical output).
- **C3** keys from `streetKeyFromParts(address)` — the `CanonicalAddress` already has the parsed
  components (it extends `StreetParts`).

This makes the C1↔C2↔C3 key contract a single source of truth. An empty `streetName` yields a key that
cannot match a real segment (→ `street_not_found`), which is the correct outcome.

## 5. Matching & fallback

1. **House number:** parse leading digits of `address.primaryNumber` (`"123A"` → `123`). If there are
   no leading digits the house number is `NaN`, which is handled uniformly by the range check in §5.3
   (it will contain no range → a normal typed miss) — no special-casing needed.
2. **Query:** `db.query(streetKey, address.zip5)`. **If it returns no rows, retry `db.query(streetKey, null)`**
   (street-key-only) — TIGER's per-segment `ZIPL/ZIPR` can differ from the ZIP a filer writes, so ZIP
   must not be a hard requirement (flagged in the C2 review). A `SegmentQuerier` treats a `null` zip as
   "any zip".
3. **Select the segment row:** among returned rows, keep those whose inclusive range
   `[min(from_addr,to_addr), max(from_addr,to_addr)]` contains the house number. Prefer a row whose
   `parity` matches the house number (even → `E` or `B`; odd → `O` or `B`); if a range contains the
   number but no parity side matches, use any containing row (coverage). No rows at all →
   `miss: "street_not_found"`; rows exist but none contains the number → `miss: "house_out_of_range"`.

## 6. Interpolation (pure core)

`interpolateSegment(rows: SegmentRow[], houseNumber: number): { lon: number; lat: number } | null`
performs the selection of §5.3 and the math:

- `span = to_addr − from_addr`. If `span === 0`, `f = 0` (degenerate single-address segment → its start
  node). Else `f = (houseNumber − from_addr) / span`, **clamped to `[0, 1]`** (handles reversed
  direction and small out-of-exact-range slop; §5.3 already guaranteed the number is within range).
- `lon = lon1 + f · (lon2 − lon1)`, `lat = lat1 + f · (lat2 − lat1)`.
- Returns `null` when no row contains the house number (drives the §5 `house_out_of_range` miss).

`geocode` wraps this: build key → query (with fallback) → `interpolateSegment` → `matched`/`miss`. It
distinguishes the two miss reasons by row count: if the query (after the street-key-only fallback)
returned **zero rows**, the miss is `street_not_found`; if rows came back but `interpolateSegment`
returned `null` (no range contained the number), the miss is `house_out_of_range`.
`interpolateSegment` is pure and deterministic; `geocode` is thin async glue over it and the querier.

## 7. Testing (offline, in `npm test`)

- **`streetKeyFromParts` unit tests** — format from parts incl. null directionals/suffix; and a test
  asserting C2's `tiger-edge` output is unchanged (the refactor is byte-faithful).
- **`interpolateSegment` unit tests** (pure): midpoint house → segment midpoint; from/to-endpoint
  houses → the respective endpoints; parity selection between an even-side and odd-side row; reversed
  range (`from_addr > to_addr`); out-of-range → `null`.
- **`geocode` end-to-end** against a **local SQLite** built from a small fixture (the C2
  `segment-store` pattern) via a `better-sqlite3` test adapter implementing `SegmentQuerier`: a known
  address interpolates to the expected point with `method:"census"`, `precisionMeters:150`; a
  ZIP-mismatch address still matches via the street-key-only fallback; a missing street →
  `street_not_found`; an out-of-range number → `house_out_of_range`.

## 8. Success criteria

- `geocode` returns a `matched` point for an in-range DFW address whose street exists in the fixture,
  with `method:"census"` and `precisionMeters:150`, and the point lies between the segment endpoints at
  the correct fraction.
- The street-key-only fallback recovers a match when the submitted ZIP differs from the segment ZIP.
- Misses return the correct typed reason and never throw.
- C2's existing `tiger-edge` tests still pass after the shared-key refactor (keys byte-identical).
- No network, no Cloudflare account, no D1 adapter, and no Worker code in this sub-project.
