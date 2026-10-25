# Calibration Harness + Boundary-Integrity Guard — Design Spec

- **Date:** 2026-07-03
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Prove the "cannot be wrong" certainty claim (calibration) and guarantee the county
  boundary snapshots never drift (integrity guard)
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md)

## 1. Problem & context

The JP Precinct Finder's output is legally load-bearing: a wrong precinct exposes an eviction
filing to a venue challenge and dismissal. The parent spec established a three-tier certainty
model (`high` / `review` / `needs_verification`) whose whole purpose is **"never be confidently
wrong."** Today that is a *claim*. This spec makes it a **measured, gated, and continuously
enforced number**, and hardens the data the claim rests on against silent drift.

This is **sub-project A** of a three-part sequence agreed with the owner:

- **A — Calibration harness + integrity guard** (this spec). The regression safety net.
- **B — Provenance + staleness** (future spec). Thread data source/version/effective-date from
  `manifest.json` into every answer; flag answers from stale boundaries.
- **C — Offline geocoder** (future spec, itself decomposed into C1 address-normalizer / C2 TIGER
  interpolation tier / C3 parcel situs index + D1/R2 storage + footprint test).

A is built first deliberately: it is the tripwire that C must pass. You do not change how points
get resolved (sub-project C) without an automated false-`high` guard already in place.

### Scope boundary — "ready to deploy"

This spec makes the app **trustworthy and drift-proof** — the foundation of deploy-readiness. It
does **not** by itself make the product fully deployable; that still requires B (provenance in
every answer) and C (the offline geocoder plus the actual Worker/API endpoint that serves
lookups). Cramming B and C in here is exactly what produces the unclean, drift-prone build we are
trying to avoid. This spec is A only, built cleanly.

## 2. Overriding invariant: the county polygons are immutable

The ArcGIS boundary polygons in `data/boundaries/*.geojson` are provided by the counties and are
**read-only ground truth**. Nothing in this project — least of all the calibration harness — may
alter them. They change **only** when a county publishes an update, and only via the sanctioned
path (§6). Two structural guarantees enforce this:

1. **Calibration is structurally incapable of touching boundary data.** `calibrate()` receives the
   boundary `features` as an input parameter and returns a report object. It has **no write path to
   disk**. The calibration corpus (points + expected answers) lives entirely under `tests/fixtures/`,
   a separate tree from `data/boundaries/`. Calibration and boundary data never share a writer.
2. **A boundary-integrity test catches *any* drift.** `tests/boundary/integrity.test.ts` recomputes
   each geojson's SHA-256 and asserts it equals the `geometryHash` already recorded in
   `manifest.json`. Any accidental edit, bad merge, or bug that alters a polygon fails `npm test`.

This complements — does not replace — the existing live **smoke tests**, which detect *upstream*
drift (the county changed their published data). The integrity test detects *local* drift (our
committed copy changed without going through the build). Belt and suspenders.

## 3. Goals / non-goals

**Goals**
- A single, gated metric — **false-`high` count** — that fails the build if it is ever > 0.
- A reported (not gated) **coverage %** so the system can't game the gate by silently abstaining
  on everything.
- A drift guard that makes the immutable-boundary invariant machine-enforced, not a convention.
- Reuse the existing labeled fixtures; grow the corpus from real-world misses over time.

**Non-goals**
- No new networked dependencies. The harness is pure and offline.
- No changes to `certainty.ts` resolution logic. This spec *observes* the resolver; it does not
  change its behavior. (If calibration reveals a false-`high`, fixing it is a separate change.)
- No coverage floor gate (see §7, decided).
- No provenance, staleness, or geocoder work (sub-projects B and C).

## 4. Architecture & components

Follows the established house pattern: a pure module plus a thin test wrapper.

| Component | Path | Role |
| --- | --- | --- |
| Calibration engine | `src/calibration/calibrate.ts` | Pure. `(cases, features) → CalibrationReport`. No I/O. |
| Calibration types | `src/types.ts` | `CalibrationCase`, `CalibrationReport`, outcome enum — added to the existing shared types file, matching current convention. |
| Corpus loader | `tests/fixtures/calibration-corpus.ts` | Maps existing golden + near-boundary fixtures onto the unified `CalibrationCase` schema. |
| Gate test | `tests/calibration/calibration.test.ts` | Hard-asserts `report.falseHigh.length === 0`; logs coverage/breakdown. |
| Report script | `scripts/calibrate.ts` + `npm run calibrate` | Prints the standalone report (same pure function) for watching coverage trend. |
| Integrity guard | `tests/boundary/integrity.test.ts` | Recompute each geojson SHA-256, assert equals `manifest.geometryHash`. |

`calibrate()` is pure and deterministic — unit-testable in isolation and reusable by both the gate
test and the report script.

## 5. Data model

One labeled-case schema that **both** existing fixtures map onto:

```ts
type CalibrationCase = {
  label: string;
  lon: number;
  lat: number;
  method: LocationMethod;          // e.g. "address-point" to exercise the high path today
  expectedCounty: County | null;   // null = out-of-scope (e.g. the Rockwall negative)
  expectedPrecinct: string | null; // null = out-of-scope OR abstention-expected
};
```

Mapping the existing fixtures:
- **`golden-points.json`** (interior truth: `expectedCounty` / `expectedPrecinct`) → high-precision
  method; expect `high` **and** correct precinct. These drive coverage.
- **`near-boundary-points.json`** (abstention truth: `candidatePrecincts`, `expectedConfidence`) →
  same high-precision method; expect the logic to **still abstain**. This proves precision alone
  does not override a boundary — the core safety property.

The corpus is **additive and fixture-only**; it never reads or writes `data/boundaries/`.

### Why the `high` path is meaningfully testable today

Under the current census-only inputs, `assessCertainty` never returns `high` (`high` is reserved
for `parcel` / `address-point` methods — `certainty.ts:115`). The harness exercises the `high` path
**now** by feeding synthetic high-precision inputs (`method: "address-point"`) at known interior
points, proving:
- interior high-precision point → `high` **and** correct precinct (coverage), and
- near-boundary high-precision point → still **abstains** (no false-`high`).

So the tripwire does real work today, and is already guarding when sub-project C begins producing
real `high` answers from parcel footprints.

## 6. Sanctioned boundary-update flow (interaction with the integrity guard)

When a county legitimately updates its boundaries:

1. Re-run `npm run build:boundaries`, which re-fetches and rewrites both the `*.geojson` **and** the
   `geometryHash` in `manifest.json` together.
2. Review the diff and commit both in one reviewed commit.

The integrity test compares committed-geojson against committed-manifest, so it passes after a
sanctioned update (both moved together) and fails on any *unsanctioned* change (only the geojson
moved). This is the only path by which a polygon is allowed to change.

## 7. Decisions (resolved during brainstorming)

1. **Gate = zero false-`high` only.** Fail the build if any case is answered `high` but wrong.
   Coverage is measured and reported, not gated. Rationale: the "cannot be wrong" system optimizes
   for *calibration* (never confidently wrong), and a coverage floor adds a number to defend/maintain
   without adding safety. Coverage is watched manually so it can't silently collapse to zero.
2. **Corpus = reuse + unify existing fixtures.** Combine `golden-points.json` and
   `near-boundary-points.json` into one labeled corpus; adopt the discipline that **every real-world
   miss becomes a new permanent labeled case** (a false-`high` in production is a P0 that gets a
   permanent fixture). Lowest effort; grows from reality.
3. **Immutability is machine-enforced** via the integrity test, not left as convention (§2).

## 8. Risks & mitigations

- **Circular ground truth.** If a golden `expectedPrecinct` was originally produced by the resolver
  under test, the case cannot catch a resolver error. *Mitigation:* one-time spot-check of a few
  golden labels against the counties' own public lookups, documented in the corpus file; treat
  independently-verified labels as the trustworthy core and grow from real misses.
- **Trivially-passing gate.** With census-only inputs nothing is `high`, so false-`high` is
  vacuously zero. *Mitigation:* §5 — the harness feeds synthetic `address-point` inputs so the
  `high` path is actually exercised, and coverage is reported so a 0%-coverage regression is visible.
- **Manifest/geojson hash-format mismatch.** The integrity test must hash the geojson the same way
  `build:boundaries` did (same canonicalization/serialization) or it will false-fail. *Mitigation:*
  the integrity test reuses the exact hashing helper from the build script rather than
  reimplementing it.

## 9. Success criteria

- `npm test` includes both the calibration gate and the integrity guard, and passes on the current
  tree (false-`high` = 0; all committed hashes match the manifest).
- `npm run calibrate` prints a report: false-`high` list (empty), coverage %, and outcome breakdown.
- Deliberately corrupting a `data/boundaries/*.geojson` byte makes `npm test` fail on the integrity
  test.
- Deliberately introducing a labeled case that the resolver answers `high`-but-wrong makes
  `npm test` fail on the calibration gate.
- No file under `data/boundaries/` is written by any calibration code path.
