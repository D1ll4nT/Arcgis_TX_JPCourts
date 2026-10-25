# Address Normalizer (Geocoder C1) — Design Spec

- **Date:** 2026-07-04
- **Status:** Approved — ready for implementation plan
- **Owner:** Dillan Thrasher
- **Topic:** Standardize structured intake address fields into a canonical form for offline geocoding
- **Parent spec:** [2026-06-23-jp-precinct-finder-design.md](./2026-06-23-jp-precinct-finder-design.md)

## 1. Problem & context

The JP Precinct Finder is being made **self-sufficient**: the external Census geocoder is being
replaced with an **offline geocoder** built on the project's own datasets. The agreed roadmap is:

- **C1 — Address normalizer** (this spec). Pure function: structured intake fields → canonical address.
- **C2 — Geocoder data + storage.** Build local Census TIGER street-range data into Cloudflare D1.
- **C3 — Geocoder lookup.** Canonical address → `{lon, lat, method, precisionMeters}` via TIGER interpolation.
- **D — API Worker.** Cloudflare Worker wrapping geocoder + existing resolver + certainty; `wrangler deploy`.

Chosen precision tier: **street-level first (TIGER)**, parcel-grade "high" as a later upgrade.

C1 is foundational: every later piece matches addresses against TIGER street data, and reliable
matching requires a **canonical, USPS-standardized** address. This spec covers C1 only.

### Intake shape (from the owner's case-submission flow)

The website collects four **structured** fields (no free-text single-line parsing needed):
`street`, `city`, `zip`, `county`. Apartment/unit numbers are **not** collected or parsed. All
addresses are **assumed Texas** (no state field).

## 2. Goals / non-goals

**Goals**
- Standardize the four intake fields into a `CanonicalAddress` whose components (number,
  directional, street name, USPS suffix, ZIP5) are shaped for reliable TIGER matching in C3.
- Be **forgiving**: never throw; flag low-confidence parses rather than failing.
- Zero dependencies, pure, Workers-safe, fully unit-testable.

**Non-goals**
- No free-text single-line address parsing (intake is already structured).
- No apartment/unit modeling (not collected; units never change the precinct).
- No PO Box / rural-route / highway-contract special forms (not in scope for DFW rental premises).
- No network, no data files, no I/O. (TIGER data + lookup are C2/C3.)
- No county/city authority: these are **hints only** (see §5).

## 3. Overriding principle: county & city are non-authoritative

This tool exists to **correct** a wrong county — the canonical example is an address the client
labels "The Colony, Dallas" that is actually in **Denton** county. Therefore the normalizer must
**never** treat the submitted `county` (or `city`, or ZIP) as authoritative or use it to infer
location. It standardizes them for display/logging and carries the submitted county as a
non-authoritative `countyHint` (useful later as a geocoder-miss fallback and for a "wrong county
submitted" flag in the Worker). The spatial resolver's county — derived from coordinates — always
wins downstream.

## 4. Contract & data model

Pure module: `src/geocode/normalize-address.ts` (new `src/geocode/` area).

```ts
export interface RawAddressInput {
  street: string;   // "9250 Church Rd" (house number + name + suffix)
  city: string;
  zip: string;
  county: string;   // claimed county — a HINT, not authoritative
}

export interface CanonicalAddress {
  primaryNumber: string;            // "9250" ("" when no leading number found)
  preDirectional: string | null;    // "N","S","E","W","NE","NW","SE","SW" (USPS)
  streetName: string;               // "CHURCH"
  streetSuffix: string | null;      // "RD" (USPS Publication 28)
  postDirectional: string | null;
  city: string | null;              // "DALLAS" (standardized; non-authoritative)
  state: "TX";                      // constant — all addresses assumed TX
  zip5: string | null;              // "75231" (null when not exactly 5 digits)
  countyHint: string | null;        // "DALLAS" standardized; non-authoritative
  canonicalLine: string;            // "9250 CHURCH RD, DALLAS, TX 75231"
  confident: boolean;               // false when the street line can't be split cleanly
}

export function normalizeAddress(input: RawAddressInput): CanonicalAddress;
```

`canonicalLine` is assembled from the standardized parts (omitting `null` segments) and is the
value C3 matches on and the Worker logs.

## 5. Normalization rules (USPS Publication 28 subset)

Applied to a pre-cleaned token stream (uppercased, punctuation stripped except the ZIP hyphen,
internal whitespace collapsed):

1. **Street line → components:**
   - Strip a trailing unit tail first: any of `APT|UNIT|STE|SUITE|#|RM|FL|BLDG` and everything
     after it is removed (units never affect the precinct; defensive — intake shouldn't include them).
   - Leading run of digits (optionally with a single trailing letter, e.g. `123A`) → `primaryNumber`.
   - Of the remaining tokens: a **leading** directional token → `preDirectional`; a **trailing**
     directional token → `postDirectional`; the **last remaining** token, if it is a known USPS
     suffix, → `streetSuffix`; everything left in the middle → `streetName`.
   - Directionals accept USPS abbreviations and spelled-out forms (`NORTH`→`N`, …).
   - Suffixes map common long forms to the USPS standard (`ROAD`→`RD`, `STREET`→`ST`, `AVENUE`→`AVE`,
     `BOULEVARD`→`BLVD`, `LANE`→`LN`, `DRIVE`→`DR`, `COURT`→`CT`, `PARKWAY`→`PKWY`, `CIRCLE`→`CIR`,
     `TRAIL`→`TRL`, `PLACE`→`PL`, `WAY`→`WAY`, and the already-abbreviated forms map to themselves).
2. **ZIP:** first 5 consecutive digits → `zip5`; otherwise `null` (a `12345-6789` input yields `12345`).
3. **City:** uppercased + whitespace-collapsed only. Non-authoritative.
4. **County:** uppercased + whitespace-collapsed; a trailing " COUNTY" word is dropped
   (`"Denton County"` → `"DENTON"`). Non-authoritative → `countyHint`.
5. **State:** always the literal `"TX"`.

The suffix/directional/unit tables are small hardcoded maps in the module — no external data.

## 6. Forgiveness (cannot be wrong)

`normalizeAddress` never throws. When the street line cannot be split confidently, it returns the
best-effort components with `confident: false`, so downstream (C3/Worker) can treat it like a
geocoder miss (lower confidence / human verification) rather than trusting a bad parse. Specifically
`confident` is `false` when **either** `primaryNumber` is empty (no leading house number) **or**
`streetName` is empty (nothing left after stripping number/directional/suffix) — the two decisive
signals that the input was not a real street address. A **missing suffix does NOT reduce
confidence**: many valid streets legitimately have none (e.g. `BROADWAY`, `MAIN`), and C3 matches
suffix-optionally — over-flagging these would needlessly route good addresses to human verification.
Empty or whitespace-only `street` yields empty street parts, `confident: false`, and a
`canonicalLine` built from whatever city/ZIP exist — never an exception.

## 7. Architecture & testing

- Single pure module, one exported function, small internal lookup tables. One clear
  responsibility; no I/O; holds in context at once.
- **Table-driven unit tests** (`tests/geocode/normalize-address.test.ts`): real DFW cases
  (`9250 Church Rd` → `9250`/`CHURCH`/`RD`; `1600 N Field St` directional; `Road`/`RD`/`road`
  suffix variants; `"The Colony"`/`"Denton County"` county-hint standardization; stray
  `Apt 101` stripped from the street line; messy casing/whitespace; `confident: false` on
  unparseable street lines; empty input). Pure → trivially testable, deterministic.

## 8. Success criteria

- `normalizeAddress` returns a fully-populated `CanonicalAddress` for well-formed DFW inputs, with
  USPS-standardized suffix/directional and a correct `canonicalLine`.
- Submitted `county`/`city` never influence any component beyond their own standardized fields
  (verified by a test where a deliberately wrong county is carried as `countyHint` unchanged).
- Unparseable / empty street lines return `confident: false` and never throw.
- No new npm dependencies; module imports nothing outside `src/types` (if anything) and Node/TS
  built-ins; runs unchanged in a Workers isolate (no Node-only APIs).
