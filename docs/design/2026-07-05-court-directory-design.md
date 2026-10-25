# Court Directory (D-courts) — Design Spec

- **Date:** 2026-07-05
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Per-county precinct → JP court filing directory, owner-verified, consumed by the API Worker
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md)

## 1. Problem & context

The deployed API must return not just the JP **precinct** but the **court and filing information**
for that precinct, so a case is filed in the right place. Per the parent spec this is a
**Court Directory** we compile ourselves (not county GIS fields, which are inconsistent and change
with elections): `data/courts/<county>.json`, keyed precinct → court, with a **per-county verified
flag**. Filing addresses and e-file court-location ids are legally load-bearing — a wrong one
misfiles a case — so entries ship as **cited drafts** (`verified: false`) until the owner verifies
each county.

This is **D-courts**, the gating dependency for the Worker (**D-worker**, next spec) that serves
this data. Splitting court data from the Worker keeps the human-verification gate isolated from
deployable code.

## 2. Goals / non-goals

**Goals**
- Four `data/courts/<county>.json` files keyed by the **exact precinct identifiers the resolver
  returns** (Dallas `1`–`5`, Tarrant `1`–`8`, Collin `1`–`4`, Denton `1`–`6` — 23 entries total),
  each a cited draft with `verified: false`.
- A `CountyCourts` / `CourtEntry` type and an automated **completeness + validity** test that
  guarantees court keys align 1:1 with boundary precincts and every entry is structurally well-formed.
- A clear per-county verification workflow (owner reviews → flips `verified`).

**Non-goals**
- **No Worker / API / D1 / deploy** (that is D-worker).
- **No automated verification of factual accuracy** — filing addresses and e-file ids are verified
  by the owner (human), not by tests. The test proves structure and completeness only.
- No per-judge (place-level) filing logic — filing is per precinct; `places` is informational.
- No court data for counties outside the Core 4.

## 3. Schema & keying

Each file is an object with county-level verification metadata plus a `courts` map keyed by precinct
string:

```jsonc
// data/courts/dallas.json
{
  "county": "dallas",
  "verified": false,
  "verifiedAt": null,          // "YYYY-MM-DD" once verified, else null
  "verifiedBy": null,          // e.g. the verifier's email once verified, else null
  "courts": {
    "1": {
      "courtName": "Dallas County Justice of the Peace, Precinct 1",
      "places": ["Place 1", "Place 2"],   // informational (judges); filing is per-precinct
      "filingAddress": "…",
      "mailingAddress": "…",
      "phone": "…",
      "efilePortal": "https://efile.txcourts.gov/…",
      "ocaLocationId": "…",                // eFileTexas / OCA court-location id
      "source": "https://…"                // citation for this draft entry
    }
    // … one entry per precinct in this county
  }
}
```

- The `courts` keys MUST be exactly the precinct strings in `data/boundaries/<county>.geojson`
  (`properties.precinct`) — the values the resolver returns. This alignment is the whole point and is
  enforced by the §5 test.
- `places` is an optional informational list; the filing fields are per precinct.
- `ocaLocationId` is the eFileTexas court-location identifier used when e-filing; it is the
  highest-risk field and always owner-verified.

## 4. Types

Added to `src/types.ts` (project convention centralizes shared types):

```ts
export interface CourtEntry {
  courtName: string;
  places: string[];
  filingAddress: string;
  mailingAddress: string;
  phone: string;
  efilePortal: string;
  ocaLocationId: string;
  source: string;
}

export interface CountyCourts {
  county: County;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  courts: Record<string, CourtEntry>;
}
```

## 5. Completeness & validity test

`tests/courts/directory.test.ts` loads each `data/courts/<county>.json` and the matching
`data/boundaries/<county>.geojson` and asserts, per county:

- **Key alignment / completeness:** the set of `courts` keys equals the set of `properties.precinct`
  values in the boundary file — no missing precinct (the resolver can never return a precinct without
  a court) and no orphan court entry.
- **Structural validity:** each `CourtEntry` has `courtName`, `filingAddress`, `phone`, `efilePortal`,
  and `source` as non-empty strings; `places` is a string array.
- **Verification metadata well-formed:** `verified` is boolean; when `verified` is `false`,
  `verifiedAt`/`verifiedBy` are `null`; when `true`, both are non-empty strings.
- **County match:** the file's `county` equals the filename county and is one of the Core 4.

The test proves structure, completeness, and key alignment — **not** factual accuracy of the drafted
addresses/ids (that is §6 human verification).

## 6. Compilation & verification workflow

- **Compilation (authoring from research):** the four files are authored from public sources — county
  clerk / JP court sites and the OCA + eFileTexas court-location registry — with every field filled as
  a best-effort **draft**, a `source` URL per entry, and `verified: false`. This is judgment-heavy
  research, not a deterministic script, so it is a distinct non-TDD task. The filing addresses and
  `ocaLocationId`s are explicitly best-effort and the most error-prone.
- **Verification (owner, per county):** the owner reviews a county's entries against the cited
  sources, corrects any field, then sets `verified: true`, `verifiedAt`, and `verifiedBy` for that
  county and commits it. Until then the county's `verified` stays `false`.
- **Downstream contract:** the Worker (D-worker) returns `court.verified` = the county's flag so
  callers do not rely on unconfirmed filing details. The Worker can ship with some counties still
  unverified.

## 7. Success criteria

- All four `data/courts/<county>.json` exist, each with one court entry per boundary precinct (23
  total), every entry a cited draft (`verified: false`, non-empty `source`).
- `tests/courts/directory.test.ts` passes: keys align 1:1 with boundary precincts and every entry is
  structurally valid across all four counties.
- The verification metadata contract holds (unverified → null stamps; verified → non-empty stamps),
  enforced by the test.
- No Worker/API/deploy code in this sub-project.
