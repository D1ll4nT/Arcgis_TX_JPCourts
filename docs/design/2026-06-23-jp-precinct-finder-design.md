# JP Precinct Finder API — Design Spec

- **Date:** 2026-06-23 (decisions resolved 2026-06-25)
- **Status:** Approved — deferred decisions resolved; ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Address → Justice of the Peace court precinct lookup API

### Resolved decisions (2026-06-25)
Decisions the original draft deferred "to the plan," now locked:
1. **Boundary storage → Cloudflare Workers static assets** (the Assets binding), not R2. 23
   full-res polygons are a few MB; loaded into isolate memory + module-scope cache. Removes the
   §15 bundle-size risk. R2 reconsidered only if data volume grows.
2. **Rate limiting → Cloudflare native Rate Limiting binding**, per API key — not hand-rolled KV
   counters or a Durable Object. (DO revisited only if exact cross-edge counts become necessary.)
3. **Usage log sink → Analytics Engine**, not KV/D1. Retention: **90 days** (audit/debug window).
4. **Court Directory sourcing → we compile, owner verifies.** Built from county clerk +
   OCA/eFileTexas sources into `data/courts/<county>.json`; **owner confirms each county before
   that county's court info is treated as load-bearing.** Until a county is verified, its
   lookups return the precinct but mark `court.verified: false`.
5. **Golden test fixtures → generated from the verified live endpoints**, with hand-picked
   near-boundary, cross-county, and parcel-straddle cases (§13), then committed.

---

## 1. Problem & context

Texas eviction (forcible detainer) suits must be filed in the Justice of the Peace (JP)
court for the **precinct** in which the rental premises is located. Filing in the wrong
precinct exposes the case to a venue challenge and dismissal. We need a tool that takes a
property address and returns the **exact JP precinct** (and the court/filing information for
that precinct), with accuracy we can stand behind in a legal filing.

The tool is **API-first**: a hosted HTTP endpoint with controlled (API-key) access that our
own webapp and other internal software can call. A UI is explicitly out of scope for phase 1.

**Coverage (phase 1):** Dallas, Tarrant, Collin, Denton counties ("Core 4").

### Overriding requirement: we cannot be wrong

The output is legally load-bearing. The design's central principle is therefore:

> **Be precise where we can, and never return a confident answer we cannot stand behind.**
> When an address is close enough to a precinct boundary that the determination is genuinely
> uncertain, the API returns `needs_verification` with the candidate precincts and the
> information required to resolve it by hand — it does **not** guess.

A tool that always emits a single precinct *will* eventually be confidently wrong at some
boundary. A tool that flags the rare ambiguous case is never confidently wrong. That is the
trade we are deliberately making.

---

## 2. Goals / non-goals

**Goals**
- Address in → JP precinct + court/filing info out, for the Core 4 counties.
- Court-grade precision: authoritative boundaries + rooftop/parcel-grade address location.
- Honest certainty model: confident answers are trustworthy; uncertain cases are flagged, not guessed.
- Controlled API access (keys, rate limiting, usage logging).
- Auditable: every response carries provenance (sources, data version, lookup id).
- Self-hosted boundary data so live lookups never depend on county servers being up.

**Non-goals (phase 1)**
- End-user UI / public website widget (phase 2).
- Resolving the individual "Place" seat within a precinct (precinct determines venue; place is
  administrative — see §8).
- Counties beyond the Core 4 (phase 2+).
- Geocodio / commercial geocoder integration on day 1 (interface is pluggable; Census first).

---

## 3. Architecture

A single **Cloudflare Worker** is the API. A **separate scheduled Worker** performs
change-detection on the upstream county sources and never sits in the request path.

```
caller (our webapp / internal software)
   │  POST /v1/precinct  { address }   + API key
   ▼
┌─ API Worker ──────────────────────────────────────────────┐
│ 1  auth        validate key (KV) + per-key rate limit      │
│ 2  locate      address → point/parcel (see §8 precision)   │
│ 3  resolve     point/parcel vs. JP polygons (Turf.js)      │
│ 4  certainty   footprint test + boundary-proximity check   │
│ 5  enrich      (county, precinct) → Court Directory entry  │
│ 6  respond     result + confidence + provenance            │
└────────────────────────────────────────────────────────────┘

scheduled Worker (cron, weekly):
   re-fetch 4 county JP layers → recompute geometry hash → alert on change
```

**Isolated, independently testable units:**

| Unit | Responsibility | Depends on |
|---|---|---|
| `api` | HTTP routing, auth, rate limit, response shaping | KV |
| `address-normalizer` | raw input → canonical USPS-style form + validity (internal table; USPS in 1.5) | external (USPS, 1.5) |
| `locator` | normalized address → `{lon, lat, parcelGeometry?, method, precisionMeters}` | normalizer + geocoder + parcel sources |
| `geocoder` | pluggable address→coords (Census impl; Geocodio later) | external |
| `precinct-resolver` | point/parcel → `{county, precinct}` via spatial test | boundary-store |
| `boundary-store` | versioned JP polygons (WGS84 GeoJSON), loaded + cached | Workers static assets |
| `certainty` | footprint containment + distance-to-boundary → confidence | boundary-store |
| `court-directory` | `(county, precinct)` → court/filing info | our maintained data |
| `refresh-job` | scheduled change-detection + alerting | external county sources |

**Stack choices**
- **Cloudflare Workers** — serverless, edge, cheap, scales to zero; API keys + caching via KV.
- **Turf.js** — pure-JS spatial ops (point-in-polygon, polygon containment, distance-to-line);
  runs in Workers. Use the modular `@turf/*` packages to keep bundle small.
- **Boundary data** stored as versioned GeoJSON in **Workers static assets** (the Assets
  binding), loaded into isolate memory and cached at module scope. Keeps the Worker bundle small
  while retaining **full-resolution geometry** (no lossy simplification — precision near precinct
  lines is the entire point).
- **Static assets (Assets binding)** — the 23 boundary GeoJSON files + manifest, fetched at
  runtime and module-cached.
- **Native Rate Limiting binding** — per-key request limits (replaces KV rate-limit counters).
- **Analytics Engine** — append-only usage log (§10), 90-day retention.
- **KV** — API keys (+ enabled flag + per-key limits) and an optional short-TTL result cache
  keyed by normalized address + boundary version.

---

## 4. Verified data sources — JP precinct boundaries (authoritative)

All four were tested end-to-end (live point-in-polygon returning the correct, distinct precinct
for known coordinates). All are **public (no token)** and accept `inSR=4326` (we pass
`lon,lat`). These are each county's own Commissioners-Court-adopted layers — the same data the
counties themselves use (e.g. Dallas County's public "What Precinct?" locator uses this exact JP layer).

| County | Precincts | Endpoint | Precinct field | Native SR |
|---|---|---|---|---|
| **Dallas** | 5 | `https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/JP/FeatureServer/0` | `DISTRICT` (int 1–5) | 102100 |
| **Tarrant** | 8 | `https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/JusticeOfThePeace/MapServer/0` | `JP` (str "1"–"8") | 2276 (ft) |
| **Collin** | 4 | `https://maps.collincountytx.gov/server/rest/services/Election/Find_Elected_Representative/MapServer/1` | `name` ("JP: Precinct N") | 3857 |
| **Denton** | 6 | `https://gis.dentoncounty.gov/arcgis/rest/services/PoliticalBoundaries_GC/MapServer/5` | `JP_C` (str "1"–"6") | 2276 (ft) |

**Per-county field mapping & gotchas (locked from recon):**
- **Dallas** — precinct = `DISTRICT`. Judge/constable fields (`JUDGE_1`, `JUDGE_2`, `CONSTABLE`)
  contain **HTML anchors**, not plain text — do not use them directly. Avoid decoys:
  `DC_CCs_*` (County Commissioner precincts) and `2013VotingPrecincts` (stale, city-owned).
- **Tarrant** — precinct = field **name** `JP` (its *alias* is the generic "District_N"; query by
  name). **Must** send `inSR=4326` or the lat/lon point lands outside all polygons. No
  court/judge fields — we supply our own. `Constable` number coincides with JP number.
- **Collin** — pin **layer `/1`** ("County Justices of the Peace"). Layer 0 = Commissioner,
  layer 2 = Constable, and a separate `VotingPrecincts*` service exists — do not use those. The
  sibling `/Justice` folder requires a token; the `/Election` path used here is anonymous.
  Precinct number is embedded in the `name` string ("JP: Precinct 3") — parse the digit.
- **Denton** — precinct = `JP_C` (string). Layer 5 only ("JP / Constable"); layer 4 = Commissioner,
  layers 0/7/8/9/10 = Voter precincts. Ignore the `OBJECTID_1` field (its alias is misleadingly
  "OBJECTID" and it returns null). `NAME_JP` / `NAME_CONST` are present but volatile (change with
  elections) — we maintain our own.

**Total:** 23 polygons. Trivial data volume.

### Build-time normalization
A build script fetches each layer, maps the county-specific precinct field to a common schema,
**reprojects to WGS84 (EPSG:4326)**, and writes a versioned GeoJSON file per county plus a
manifest. This makes the runtime uniform (one CRS, one field name) regardless of each source's
native projection (102100 / 3857 / 2276).

```jsonc
// normalized feature schema
{ "type": "Feature",
  "properties": { "county": "dallas", "precinct": "1" },
  "geometry": { /* full-resolution polygon, WGS84 */ } }
```

```jsonc
// data/boundaries/manifest.json (one entry per county)
{ "county": "dallas",
  "sourceUrl": "https://services3.arcgis.com/.../JP/FeatureServer/0",
  "precinctField": "DISTRICT",
  "fetchedAt": "2026-06-23T00:00:00Z",
  "featureCount": 5,
  "geometryHash": "sha256:…",     // change-detection key
  "nativeWkid": 102100 }
```

---

## 5. Verified data sources — address location (parcel polygons)

These power the **parcel-grade location** that makes the answer court-precise. All four county
appraisal parcel layers were **live-tested**: public (no token), polygon geometry with `rings`,
and an attribute query on the situs field returns the parcel. Reproject via `outSR=4326`.

| County | Parcel endpoint | Situs/address field | Native SR |
|---|---|---|---|
| **Dallas** | `https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4` | `SITEADDRESS` (string) | 102100 |
| **Tarrant** | `https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0` | `SITUS_ADDR` (string) | 2276 (ft) |
| **Collin** | `https://maps.collincountytx.gov/server/rest/services/InteractiveMap/Appraisal_District/MapServer/1` | `situs_disp` (multi-line) | 102100 |
| **Denton** | `https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0` | `SITUS` (string) | 2276 (ft) |

**Address-matching is the real remaining problem (not endpoint discovery).** Every layer stores
situs as **ALL-CAPS, abbreviated** (`ST` not STREET, directionals `N/S/E/W` inline). Gotchas the
matching layer must handle:
- **Anchor the match.** `SITEADDRESS LIKE '%411 ELM%'` is greedy — it also returned "4411 ELM ST",
  "1411 ELMS RD", "3411 ELMWOOD CIR" (live Dallas test). Match on `<number> <street>%` anchored at
  the start, then post-filter, rather than a loose `%...%`.
- **Normalize input** to caps + USPS-style abbreviations; strip unit/suite/apt numbers (situs
  generally omits them; they live in owner-mailing fields).
- **Multiple parcels per address is real** (condos, splits — Dallas returned "411 ELM ST" twice).
  Co-located parcels resolve to the same precinct; handle N>1 gracefully.
- **Collin `situs_disp` is multi-line**: `"<num> <st> \r\nCITY, TX <zip>"` — match only the street
  portion, never across the `\r\n`. Do **not** filter situs by the owner-mailing `CITY`/`ZIP`.
- Use `outSR=4326` for WGS84 directly; cap responses (`resultRecordCount`) since some layers flag
  `exceededTransferLimit`.

**Normalization layer (`AddressNormalizer`).** Raw input is canonicalized before any `situs` query,
behind a pluggable interface. **Phase 1:** an internal normalizer (uppercase + USPS abbreviation
table + unit/suite stripping). **Phase 1.5:** USPS Addresses 3.0 (OAuth2, token cached in KV) as
the preferred implementation, adding ZIP+4 correction and DPV deliverability — it returns **no
coordinates**, so it feeds matching only, never location. Guardrail: USPS is used for
formatting/validity; if it *materially* changes the property (different number/street), surface it
and lower confidence rather than re-querying a different parcel. If USPS reports deliverable but no
parcel matches, route to `needs_verification`.

**Fallback tiers** (per §8): if a parcel can't be matched → county E911 address points, or the
public-domain **TxGIO/TNRIS StratMap** statewide address-point/parcel layers (`feature.tnris.org`,
covers all four counties) → **US Census geocoder** (street-range interpolation; lowest precision,
triggers a wider uncertainty zone). NCTCOG NG911 address points exist but may be account-gated —
not relied upon.

### Geocoding (verified)
- **US Census geocoder** (primary, verified): `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<addr>&benchmark=Public_AR_Current&format=json`
  → returns `coordinates {x:lon, y:lat}` (WGS84), normalized `matchedAddress`, parsed components.
  Free, no key, batch endpoint up to 10k records, and — unlike Google/Mapbox — **its terms permit
  storing results**.
- **Geocodio** (phase-2 paid fallback): US rooftop quality, cheap, **permits storing results**.
- **Avoid** Google / Mapbox: their ToS restrict caching/storing coordinates and displaying on
  non-native maps — incompatible with caching precinct results.

---

## 6. Lookup flow

1. `POST /v1/precinct` with `{ address }` (or structured `{ street, city, state, zip }`, or a
   pre-resolved `{ lat, lon }` to skip normalization + location).
2. **Auth** — validate API key (KV), check rate limit. Bad key → `401`; over limit → `429`.
3. **Normalize** (§5) — canonicalize input via the `AddressNormalizer` (internal abbreviation
   table in Phase 1; USPS Addresses 3.0 in Phase 1.5). If a normalizer *materially* changes the
   property identity (different primary number/street), do not silently accept it — carry both
   forms and lower confidence.
4. **Locate** (§8) — resolve the normalized address to the most precise available location:
   parcel polygon → address point → Census interpolation. Record `method` + `precisionMeters`.
   No usable location → `422` with the components we parsed + guidance.
5. **Resolve** — spatial test against the 23 normalized JP polygons. The containing polygon
   yields **both** county and precinct (no separate county step needed at this scale). In none →
   `404` "outside supported counties (Dallas/Tarrant/Collin/Denton)".
   **Caller-supplied county/city/ZIP are matching hints only** — venue (county *and* precinct) is
   always derived from the resolved location's containing polygon, never from caller-provided
   fields. (Real intake data routinely mislabels county: e.g., a property in The Colony tagged
   "Dallas" is actually Denton; a Grand Prairie property tagged "Dallas" may fall in Tarrant.)
6. **Certainty** (§8) — footprint containment and/or distance-to-boundary vs. the
   method's precision. Produces `confidence` ∈ {`high`, `review`, `needs_verification`}.
7. **Enrich** — `(county, precinct)` → Court Directory entry (court name, places, filing address,
   e-file court id, phone).
8. **Respond** — result + confidence + disclaimer + provenance.

---

## 7. Spatial engine (Turf.js) & coordinate handling

All geometry is normalized to **WGS84 (EPSG:4326)**: county sources are 102100, 3857, or 2276;
ArcGIS reprojects via `outSR=4326`/`inSR=4326`, and the boundary build reprojects snapshots once.
Runtime spatial ops use modular `@turf/*` packages (small, Workers-compatible):
- **Point-in-polygon** — `booleanPointInPolygon` (resolved point → precinct).
- **Footprint containment** — `booleanWithin` / `booleanContains` (is the whole parcel inside one precinct?).
- **Boundary proximity** — `polygonToLine` + `pointToLineDistance` (distance from the location to the
  nearest precinct line, compared against the method's `precisionMeters` in §8).

All inputs are validated as finite WGS84 lon/lat before any spatial call.

---

## 8. Precision & certainty model — the heart of "cannot be wrong"

**Where the error is.** The boundary polygons are authoritative and full-resolution — they are
*the court's answer*. The risk is **locating the address**. The Census geocoder uses TIGER
**street-range interpolation**: it estimates a position along a street from address-number
ranges and offsets it to one side. Because precinct boundaries frequently run **down the
centerline of a street**, a small sideways interpolation error can place the point on the *wrong
side of the boundary street* → wrong precinct. This is the failure mode we must engineer out.

**Three mechanisms, in order:**

1. **Locate by parcel/rooftop, not interpolation.** Resolve the address against the county
   parcel layer (or E911 address points) before falling back to Census. These tie to the
   property's true location, eliminating street-side guessing. `precisionMeters` reflects the
   method used (parcel/address-point ≈ a few metres; Census interpolation ≈ tens of metres+).

2. **Test the parcel *footprint*, not just a dot.** When a parcel polygon is available, test
   whether the *entire parcel* lies within one precinct (`booleanWithin`/`booleanContains`).
   - Parcel fully inside one precinct → **certain** (`confidence: high`).
   - Parcel intersects two precincts → **genuinely ambiguous** → `needs_verification` with the
     candidate precincts.
   This is the most court-faithful test possible: the property's actual extent against the
   actual boundary.

3. **Never guess inside the uncertainty zone.** Compute distance from the resolved location to
   the matched precinct's boundary (`polygonToLine` + `pointToLineDistance`). If that distance is
   **less than the location method's `precisionMeters`** (i.e., the error bar overlaps the line),
   we cannot be sure → `confidence: needs_verification`, returning both adjacent precincts and the
   data to resolve by hand (which boundary, which courts). The "buffer" is therefore **not a fixed
   75 m** — it is **sized to the precision of the method actually used**: tight for a rooftop
   parcel match, wider only when we fall back to Census.

**Confidence levels:**
- `high` — parcel fully within one precinct, or point well clear of any boundary relative to method precision.
- `review` — point clear of boundary but located by a lower-precision method (advisory; single precinct returned).
- `needs_verification` — within the uncertainty zone or parcel straddles a line. **No single precinct asserted.** Returns candidate precincts + resolution info.

Rooftop precision makes `needs_verification` rare; the flag makes every confident answer trustworthy.

---

## 9. API contract

### `POST /v1/precinct`
Request:
```jsonc
{ "address": "123 Main St, Dallas, TX 75201" }
// or { "street": "...", "city": "...", "state": "TX", "zip": "..." }
// or { "lat": 32.78, "lon": -96.79 }   // skip location step
```
Response (confident):
```jsonc
{
  "result": {
    "county": "Dallas",
    "precinct": "1",
    "court": {
      "name": "Dallas County Justice of the Peace, Precinct 1",
      "places": ["Place 1", "Place 2"],
      "filingAddress": "…",
      "mailingAddress": "…",
      "phone": "…",
      "efile": { "portal": "eFileTexas.gov", "courtLocationId": "…" },
      "verified": true            // false until owner confirms this county's court data
    }
  },
  "match": {
    "normalizedAddress": "123 MAIN ST, DALLAS, TX, 75202",
    "normalizedBy": "internal",  // internal | usps (Phase 1.5)
    "lat": 32.78, "lon": -96.79,
    "method": "parcel",          // parcel | address-point | census
    "precisionMeters": 5
  },
  "confidence": "high",          // high | review | needs_verification
  "boundaryWarning": false,
  "disclaimer": "Automated venue determination for convenience; the filer is responsible for confirming the correct court.",
  "provenance": {
    "boundarySource": "Dallas County GIS (JP FeatureServer)",
    "boundaryAsOf": "2026-06-23",
    "locationSource": "Dallas Central Appraisal District parcels",
    "lookupId": "01J…"
  }
}
```
Response (ambiguous — the safety path):
```jsonc
{
  "result": {
    "county": "Dallas",
    "precinct": null,
    "candidatePrecincts": ["1", "2"],
    "courts": [ /* Court Directory entries for each candidate */ ]
  },
  "match": { "normalizedAddress": "…", "lat": …, "lon": …, "method": "census", "precisionMeters": 60 },
  "confidence": "needs_verification",
  "boundaryWarning": true,
  "verification": {
    "reason": "Resolved location is within the location method's error margin of the precinct boundary.",
    "boundaryBetween": ["1", "2"],
    "howToResolve": "Confirm the property's parcel against the precinct boundary, or contact the courts listed."
  },
  "disclaimer": "…",
  "provenance": { … }
}
```

### Other endpoints
- `GET /v1/counties` — supported counties, precinct counts, `boundaryAsOf` per county.
- `GET /v1/health` — status + boundary data versions/hashes.

### Conventions
- Auth: `Authorization: Bearer <key>` (also accept `X-API-Key`).
- Errors: `400` bad input · `401` bad/missing key · `404` outside supported counties ·
  `422` could not locate address · `429` rate limited · `5xx` internal.
- All responses include `disclaimer` and `provenance`.
- Versioned path (`/v1/`) from day one.

---

## 10. Data model

- **Boundary snapshots** — `data/boundaries/<county>.geojson` (normalized, WGS84, full-res) +
  `data/boundaries/manifest.json` (§4). Versioned in git and deployed as Workers static assets.
- **Court Directory** — `data/courts/<county>.json`, keyed by precinct → court name, place seats,
  filing + mailing address, phone, e-file portal, **e-file court location id / OCA identifier**,
  plus a per-county `verified` flag + `verifiedAt`/`verifiedBy`. **Deliberately our own data**,
  not the county GIS fields, because those are inconsistent (Dallas = HTML, Tarrant = none) and
  judge names change with elections. We own accuracy of the filing-relevant fields.
  **Sourcing (resolved):** we compile each county from the county clerk / JP court sites and the
  OCA / eFileTexas court-location registry; the **owner verifies each county** before its entries
  are treated as load-bearing. An unverified county still returns its precinct but carries
  `court.verified: false` so callers don't rely on unconfirmed filing details.
- **API keys** — KV: `key → { enabled, label, rateLimitPerMin, createdAt }`.
- **Usage log** — per-lookup record (lookupId, timestamp, key, county, precinct, confidence,
  method) for audit/debugging. **Sink: Cloudflare Analytics Engine**, 90-day retention.

---

## 11. Error handling & legal safety

- **Geocode/location miss** → `422` with the components we recognized + guidance (add ZIP, check spelling).
- **Outside Core 4** → `404` with the explicit supported-county list.
- **Boundary uncertainty** → `needs_verification` (§8): candidate precincts, the boundary in
  question, and resolution guidance. Never a silent guess.
- **Disclaimer** on every response (and required in any future UI): automated determination for
  convenience; filer confirms venue.
- **Provenance** on every response: boundary source + `asOf`, location source, `lookupId` — for
  auditability and legal defensibility ("as of date X, against boundary version Y, the property
  resolved to precinct Z by method M").
- **Source outage** affects only the weekly refresh job (which alerts), never live lookups,
  because boundaries are self-hosted.

---

## 12. Security & access control

- API-key auth; keys stored in KV with an `enabled` flag and per-key rate limit.
- Rate limiting per key via Cloudflare's **native Rate Limiting binding**.
- No PII beyond the queried address; **usage log retention: 90 days** (Analytics Engine).
- CORS: locked to our own origins for browser callers; server-to-server unrestricted by key.

---

## 13. Testing strategy

- **Golden point-in-polygon suite (core):** known addresses → expected precinct for all four
  counties, run **offline** against committed GeoJSON fixtures. Must include:
  - at least one **near-boundary** case per county (expected `needs_verification`),
  - one **cross-county** case,
  - one **parcel-straddles-line** case (expected `needs_verification`).
  - **Fixture generation (resolved):** expected precincts are produced by querying the verified
    live county endpoints (the same authoritative tools from §4), then committed. To avoid
    circular validation — testing our snapshot against the snapshot's own source — each
    expected answer is cross-checked against the county's **public "what precinct/court" locator**
    where one exists, and near-boundary cases are hand-confirmed. Owner-supplied real filing
    cases can be layered in later as stronger ground truth (deferred, not blocking).
- **Unit:** per-county precinct-field normalizers (HTML strip, "JP: Precinct N" parse, string/int);
  WGS84 reprojection; Census response parsing; distance-to-boundary + footprint math; confidence
  derivation from `precisionMeters` vs. boundary distance.
- **Contract:** response schema, auth rejection, rate limiting, each error code.
- **Live-source smoke test (separate, weekly/CI — not per-run):** confirm the 4 JP endpoints (and
  the chosen location endpoints) still respond and field names are unchanged. Keeps the main
  suite offline, fast, deterministic.
- **Boundary fixtures** are committed so tests don't hit the network.

---

## 14. Phasing

**Phase 1 (this build) — deployable keyed API**
1. **Address-matching layer** (build task #1): parcel endpoints are verified (§5); build the
   `AddressNormalizer` interface with a Phase-1 internal normalizer (uppercase + USPS abbreviation
   table + unit stripping) + anchored-query + multi-parcel/multi-line handling against all four,
   with a county E911 / StratMap → Census fallback chain.
2. Build-time boundary fetch + normalize (WGS84) + manifest + commit fixtures; serve via Workers
   static assets.
3. Worker API: key auth, native rate-limit binding, `/v1/precinct`, `/v1/counties`, `/v1/health`.
4. Locator (Census + parcel) behind a pluggable interface.
5. Precinct resolver + certainty model (§8), incl. footprint test and `needs_verification`.
6. Court Directory compiled for all four counties (incl. e-file court ids), each carrying a
   `verified` flag — **owner verifies each county before its court data is load-bearing**;
   unverified counties return `court.verified: false`.
7. Golden test suite (fixtures generated from live endpoints) + contract tests. Deploy.

**Phase 1.5 — USPS normalization**
- Add USPS Addresses 3.0 as the preferred `AddressNormalizer` implementation (OAuth2 onboarding:
  consumer key/secret + CRID + MID; token cached in KV), with the material-change guardrail (§5)
  and DPV deliverability signal. Internal normalizer remains the fallback if USPS is unconfigured/down.

**Phase 2 (later)**
- Geocodio fallback; scheduled change-detection/alerting Worker; usage dashboard; thin internal
  UI / webapp integration; expand counties (Full DFW metro).

---

## 15. Open items / risks

- **Address matching** (the main remaining risk) — situs fields are all-caps/abbreviated, greedy
  `LIKE` over-matches, some addresses map to multiple parcels, and Collin's situs is multi-line.
  Mitigation: a dedicated normalization + anchored-query layer (build task #1) with unit tests
  (USPS normalization in Phase 1.5 lifts the hit-rate further); and the certainty model means a bad
  or ambiguous match yields `needs_verification`, never a wrong confident answer. All four parcel
  endpoints are live-verified (§5), so endpoint discovery is no longer a risk.
- **Court Directory accuracy** — hand-maintained; we compile + owner-verify per county (§10), and
  unverified counties self-flag via `court.verified: false`. Establish an ongoing update cadence
  (e-file ids, addresses).
- **Worker bundle size** vs. full-res polygons — resolved: served from Workers static assets +
  isolate cache, so geometry never enters the Worker bundle.
- **Source re-publishing** (e.g., Dallas JP layer is labeled for "Elections/redistricting") — the
  weekly change-detection job covers boundary changes; endpoint URL changes need manual follow-up.
