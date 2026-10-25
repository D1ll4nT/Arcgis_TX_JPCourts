# TIGER Geocoder Data + Storage (Geocoder C2) — Design Spec

- **Date:** 2026-07-04
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Build Census TIGER street-range data into a Cloudflare D1-loadable geocoder database
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md)
- **Prior sub-project:** [2026-07-04-address-normalizer-design.md](./2026-07-04-address-normalizer-design.md) (C1)

## 1. Problem & context

The JP Precinct Finder is being made self-sufficient with an **offline geocoder**. C1 (done) turns
intake fields into a canonical address. **C2 (this spec)** builds the local street dataset the
geocoder queries; **C3** does the in-Worker lookup + interpolation; **D** is the Worker deploy.

Chosen precision tier: **street-level (TIGER) first**, parcel-grade later. C2 fetches Census
TIGER/Line street data for the Core-4 counties, normalizes it (reusing C1), and produces a
**Cloudflare D1-loadable geocoder database** keyed for fast street lookup.

### Two decisions taken during brainstorming

1. **Offline build, defer real D1 to deploy.** C2 produces the schema + a D1-loadable dump and is
   validated against **local SQLite** (D1 *is* SQLite). Creating and loading the real D1 database
   happens once in step D. C2 requires no Cloudflare account action.
2. **Endpoints-only, linear interpolation.** Store each street segment's two endpoints; C3
   interpolates the house number linearly between them. Precincts are miles wide, so the small
   off-road error on curved streets almost never changes the resolved precinct, and near-boundary
   cases are already flagged `needs_verification` by the certainty model. C3 assigns an honest
   (larger) precision radius for this method.

## 2. Goals / non-goals

**Goals**
- A build script (`scripts/build-tiger.ts`) that fetches TIGER Edges for the 4 counties, filters to
  addressable road segments, normalizes street names via C1, and emits a **D1-loadable dataset** +
  `schema.sql` + a provenance **manifest**.
- Street keys built with **C1's `parseStreetLine`**, so C3's query keys match by construction.
- Offline-testable against local SQLite from a **small committed fixture** — no network, no
  Cloudflare account, in `npm test`.

**Non-goals**
- No interpolation math and no address→point lookup (that is C3).
- No Worker, no D1 provisioning, no `wrangler` (that is D).
- No parcel data / parcel-grade precision (a later upgrade).
- No full-side offset geometry (endpoints only, per §1.2).
- The multi-hundred-MB full dataset is **not committed to git** (see §6).

## 3. Data source & extraction

- **Source:** TIGER/Line **Edges** shapefiles, one ZIP per county, from
  `https://www2.census.gov/geo/tiger/TIGER<YEAR>/EDGES/tl_<YEAR>_<FIPS>_edges.zip`.
  County FIPS: **Dallas 48113, Tarrant 48439, Collin 48085, Denton 48121**. `<YEAR>` is pinned in
  the build config (a constant) and recorded in the manifest.
- **Geometry:** TIGER coordinates are GCS NAD83, treated as WGS84 lon/lat for our purposes — **no
  reprojection** (consistent with how boundaries were handled). Each edge is a linestring; we keep
  only its **first and last vertices** (the from/to nodes).
- **Keep filter:** an edge is included only if it is a road (`ROADFLG = 'Y'`) **and** has at least
  one side with a non-empty, numeric address range (`LFROMADD`/`LTOADD` or `RFROMADD`/`RTOADD`).
- **Per-side explosion:** each kept edge yields up to two rows — one per side that has a valid
  numeric range. `FROMADD` maps to the edge's start node, `TOADD` to the end node.

## 4. Normalization → `street_key`

Each edge's `FULLNAME` is run through **C1's `parseStreetLine`** (imported from
`src/geocode/normalize-address.ts`). The `street_key` is a deterministic join of the standardized
components:

```
street_key = `${preDirectional ?? ""}|${streetName}|${streetSuffix ?? ""}|${postDirectional ?? ""}`
```

(uppercased, already standardized by C1). C3 will build the **identical** key from the normalized
query address, guaranteeing matching. Edges whose `FULLNAME` yields an empty `streetName` are
skipped (unusable for name matching).

## 5. D1 schema

```sql
CREATE TABLE street_segments (
  street_key TEXT    NOT NULL,   -- "PRE|NAME|SUFFIX|POST"
  zip        TEXT,               -- ZIPL or ZIPR for this side (may be null)
  from_addr  INTEGER NOT NULL,   -- address at the edge START node (may be > to_addr)
  to_addr    INTEGER NOT NULL,   -- address at the edge END node
  parity     TEXT    NOT NULL,   -- 'E' | 'O' | 'B'  (even / odd / both)
  lon1 REAL NOT NULL, lat1 REAL NOT NULL,  -- start node (from_addr end)
  lon2 REAL NOT NULL, lat2 REAL NOT NULL   -- end node   (to_addr end)
);
CREATE INDEX idx_street ON street_segments (street_key, zip);
```

- **`parity`** is derived from the side's `FROMADD`/`TOADD`: both even → `'E'`, both odd → `'O'`,
  otherwise `'B'`. C3 uses it to prefer the side matching the house number's parity.
- `from_addr`/`to_addr` preserve the side's TIGER direction so C3's interpolation fraction
  `(house - from_addr) / (to_addr - from_addr)` maps onto `(lon1,lat1)→(lon2,lat2)`.
- The schema lives in a committed `scripts/tiger/schema.sql`, applied verbatim to local SQLite in
  tests and to real D1 at deploy — one source of truth.

## 6. Artifact strategy (the size problem)

The full 4-county dataset is ~hundreds of MB (~500k–1M rows) — too large to commit to git (unlike
the tiny boundary polygons). Therefore:

- **Committed to the repo:** `scripts/build-tiger.ts`, `scripts/tiger/schema.sql`, a **small
  fixture** (`tests/fixtures/tiger-sample-edges.json` — a handful of hand-verified DFW edge records
  covering both parities, both sides, and a skip case), tests, and a **manifest**
  (`data/geocoder/manifest.json`: TIGER year, per-county kept-row counts, content hash — the same
  provenance discipline as `data/boundaries/manifest.json`).
- **Generated, git-ignored:** the full loadable dump `data/geocoder/tiger.sql` (and any
  intermediate `data/geocoder/tiger.db`), regenerated by running the build and loaded into real D1
  in step D. Add `data/geocoder/tiger.sql` and `data/geocoder/tiger.db` to `.gitignore` (the
  committed `data/geocoder/manifest.json` stays tracked).

"Self-sufficient" here means the data lives in **your own D1**, not necessarily in-repo files.

## 7. Architecture & components

Build-time only — none of this enters the deployed Worker bundle (the Worker uses the D1 binding at
runtime; the runtime stays dependency-lean).

| Component | Path | Responsibility |
| --- | --- | --- |
| Edge → rows transform | `src/geocode/tiger-edge.ts` | Pure: one parsed TIGER edge record → 0/1/2 `SegmentRow`s (filter, per-side explosion, `street_key`, parity). Unit-testable without I/O. |
| SQLite loader | `src/geocode/segment-store.ts` | Apply `schema.sql` + bulk-insert `SegmentRow[]` into a `better-sqlite3` database; used by both the build and the tests. |
| Build script | `scripts/build-tiger.ts` | Orchestrate: download + unzip + parse shapefiles → `tigerEdgeToRows` → loader → emit dump + manifest. Not in `npm test`. |
| Schema | `scripts/tiger/schema.sql` | The one canonical DDL. |
| Fixture | `tests/fixtures/tiger-sample-edges.json` | Small hand-verified edge set for offline tests. |

Types (in `src/types.ts`, per convention): `TigerEdge` (the parsed fields we use) and `SegmentRow`
(a D1 row).

## 8. Dependencies (build-time devDependencies only)

Added to `devDependencies` — they run in the build script and tests, **never** in the Worker:
- `shapefile` — parse TIGER `.shp`/`.dbf` (pure JS).
- `adm-zip` — unzip the downloaded TIGER archives (pure JS).
- `better-sqlite3` — build/query the local SQLite that mirrors D1 (native; dev/test only).

The deployed Worker's runtime dependencies are unchanged (D1 binding + `@turf/*` for resolve).

## 9. Testing (offline, in `npm test`)

- **`tigerEdgeToRows` unit tests** (`tests/geocode/tiger-edge.test.ts`): from a sample edge record,
  assert per-side explosion, `street_key` via C1, parity derivation, from/to→node mapping, and the
  skip cases (no road flag, no numeric range, empty street name).
- **Loader + query test** (`tests/geocode/segment-store.test.ts`): build a local SQLite from the
  committed fixture via `schema.sql` + the loader; assert row counts and that a
  `SELECT … WHERE street_key = ? AND zip = ?` returns the expected segment. This validates the exact
  schema and keys C3 will query — without any interpolation (that is C3) and without network/D1.
- The full network build (`scripts/build-tiger.ts`) is **not** run in `npm test` (like
  `build:boundaries`); a separate `npm run build:tiger` produces the real artifact.

## 10. Success criteria

- `npm run build:tiger` produces, from live TIGER, a D1-loadable dump for all 4 counties plus a
  manifest with per-county row counts + content hash + TIGER year; no reprojection artifacts.
- `tigerEdgeToRows` yields correct per-side rows with C1-consistent `street_key`s and correct parity,
  verified by unit tests.
- A local SQLite built from the fixture via the committed `schema.sql` answers a
  `street_key`+`zip` lookup with the expected segment row — proving the schema/keys C3 depends on.
- No generated bulk data is committed to git; the Worker runtime dependency set is unchanged.
