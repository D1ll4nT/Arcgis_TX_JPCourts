# Texas JP Court Finder

Address in, Justice of the Peace precinct and filing court out, with an honest confidence label.

Texas eviction suits must be filed in the JP precinct where the property sits. File in the wrong one and the case gets dismissed or transferred, costing the filer weeks. County lookup tools are inconsistent, cities straddle county lines, and filers routinely mislabel the county. This service resolves the precinct from authoritative geometry and says plainly when an address is too close to a boundary to call.

**Coverage:** Dallas, Tarrant, Collin, and Denton counties (the DFW "Core 4").
**Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), KV, Turf.js, Vitest.
**Status:** Built for production filing work. 190 tests, typecheck clean.

## How it resolves an address

```
POST /v1/precinct { street, city, zip, county }
        │
        ▼
 1. Normalize      USPS-style parse: number, directional, name, suffix, unit
        │
        ▼
 2. Locate         Tier 1: county appraisal-district parcel (ArcGIS), ~10 m
                   Tier 2: Census TIGER street-segment interpolation (D1), ~150 m
        │
        ▼
 3. Resolve        Point-in-polygon against county JP precinct boundaries
        │
        ▼
 4. Certainty      Distance to nearest boundary vs. the locate method's error
                   margin → "high" or "needs_verification" with both candidates
        │
        ▼
 5. Court          Precinct → court name, filing address, phone
```

Design choices that matter:

- **Abstain over guess.** When the location's error margin crosses a precinct line, the response returns both candidate precincts and courts instead of a confident wrong answer.
- **Never trust the submitted county.** The resolver uses geometry, then flags `countyMismatch` (The Colony is Denton County; filers often say Dallas).
- **Never widen what the filer typed.** ZIP relaxation and variant matching only fill in omitted components. An explicit `W` is never rewritten to `E`.
- **Ambiguous twins resolve only when safe.** If `224 Dallas St` could be `E` or `W Dallas St`, it resolves only when every interpretation lands in the same precinct.
- **Provenance on every answer.** Boundary snapshot date, TIGER year, locate method, precision, and a lookup ID for audit.

## Example response

```json
{
  "result": {
    "county": "tarrant", "precinct": "1",
    "submittedCounty": "tarrant", "countyMismatch": false,
    "court": { "courtName": "Tarrant County Justice of the Peace, Precinct 1", "filingAddress": "..." }
  },
  "match": { "normalizedAddress": "100 W WEATHERFORD ST, FORT WORTH, TX 76196", "method": "address-point", "precisionMeters": 10 },
  "confidence": "high",
  "provenance": { "boundaryAsOf": "...", "locationSource": "...", "tigerYear": 2024, "lookupId": "..." }
}
```

## Accuracy harness

`npm run calibrate` runs a corpus of public landmarks (city halls, courthouses) with independently checked answers, plus synthetic points placed on shared precinct boundaries. Every production miss becomes a permanent test case. The near-boundary points must come back `needs_verification`, never a confident single precinct.

## Run it

```bash
npm ci
npm test               # unit + golden + calibration tests
npm run typecheck
npm run build:tiger    # build the street-segment geocoder DB (Census TIGER)
npm run dev            # local Worker
```

To deploy, create a D1 database and KV namespace, put their IDs in `wrangler.jsonc`, load `data/geocoder/tiger.sql` into D1, and store a SHA-256 hashed API key in KV.

## Repo map

| Path | What |
|---|---|
| `src/geocode/` | Address normalizer and TIGER interpolation |
| `src/parcel/` | Appraisal-district parcel lookups |
| `src/resolve/` | Point-in-polygon resolver and certainty model |
| `src/worker/` | HTTP API, auth (hashed keys, fail-closed), rate limit |
| `scripts/` | Boundary, TIGER, and fixture build pipelines |
| `data/` | Precinct boundaries (GeoJSON) and court directory |
| `docs/design/` | Design specs written before each component was built |

## Data sources

County JP precinct boundaries from public county GIS services; U.S. Census TIGER/Line street segments; county appraisal-district parcel layers. Court directory compiled from county websites.

## Disclaimer

Informational tool, not legal advice. Confirm the precinct with the court before filing.

## License

MIT
