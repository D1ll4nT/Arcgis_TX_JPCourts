import type { CanonicalAddress, RawAddressInput, StreetParts } from "../types.js";

/** USPS directional forms (abbrev + spelled-out) → standard abbreviation. */
const DIRECTIONALS: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W",
  NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

/** USPS Publication 28 street-suffix forms → standard abbreviation. */
const SUFFIXES: Record<string, string> = {
  RD: "RD", ROAD: "RD",
  ST: "ST", STREET: "ST",
  AVE: "AVE", AV: "AVE", AVENUE: "AVE",
  BLVD: "BLVD", BOULEVARD: "BLVD",
  LN: "LN", LANE: "LN",
  DR: "DR", DRIVE: "DR",
  CT: "CT", COURT: "CT",
  PKWY: "PKWY", PKY: "PKWY", PARKWAY: "PKWY",
  CIR: "CIR", CIRCLE: "CIR",
  TRL: "TRL", TRAIL: "TRL",
  PL: "PL", PLACE: "PL",
  HWY: "HWY", HIGHWAY: "HWY",
  WAY: "WAY",
};

/** Tokens that begin a unit/secondary designator — everything from here on is dropped. */
const UNIT_MARKERS = new Set([
  "APT", "UNIT", "STE", "SUITE", "RM", "ROOM", "FL", "FLOOR", "BLDG", "BUILDING",
]);

/**
 * Split a single street line into standardized components. Uppercases, strips
 * punctuation and any trailing unit designator, then pulls the leading house
 * number, an optional leading/trailing directional, and a trailing USPS suffix.
 * The remaining middle tokens are the street name. Never throws; empty/garbage
 * input yields empty number/name.
 */
export function parseStreetLine(street: string): StreetParts {
  const cleaned = String(street ?? "")
    .toUpperCase()
    // ASCII-only normalization: accented/non-ASCII characters are dropped,
    // not transliterated. Known, accepted limitation.
    .replace(/[^A-Z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let tokens = cleaned ? cleaned.split(" ") : [];

  // Drop a unit tail: first unit marker (or a "#..." token) and everything after.
  const unitIdx = tokens.findIndex((t) => UNIT_MARKERS.has(t) || t.startsWith("#"));
  if (unitIdx !== -1) tokens = tokens.slice(0, unitIdx);

  // Leading house number: digits, optionally one trailing letter (e.g. 123A).
  let primaryNumber = "";
  if (tokens.length > 0 && /^\d+[A-Z]?$/.test(tokens[0]!)) {
    primaryNumber = tokens.shift()!;
  }

  // Trailing directional — only if a street-name token would remain.
  // Runs before the leading-directional check so a street name that is
  // itself a directional word (e.g. "Northwest Hwy") isn't mistaken for a
  // leading directional + a lost name.
  let postDirectional: string | null = null;
  if (tokens.length > 1 && DIRECTIONALS[tokens[tokens.length - 1]!]) {
    postDirectional = DIRECTIONALS[tokens.pop()!]!;
  }

  // Trailing USPS suffix — only if a street-name token would remain.
  let streetSuffix: string | null = null;
  if (tokens.length > 1 && SUFFIXES[tokens[tokens.length - 1]!]) {
    streetSuffix = SUFFIXES[tokens.pop()!]!;
  }

  // Leading directional — only if a street-name token would remain.
  let preDirectional: string | null = null;
  if (tokens.length > 1 && DIRECTIONALS[tokens[0]!]) {
    preDirectional = DIRECTIONALS[tokens.shift()!]!;
  }

  return {
    primaryNumber,
    preDirectional,
    streetName: tokens.join(" "),
    streetSuffix,
    postDirectional,
  };
}

/** Uppercase + collapse whitespace; empty → null. */
function normalizeToken(s: string): string | null {
  const v = String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  return v || null;
}

/** County hint: standardized, with a trailing " COUNTY" word dropped. Non-authoritative. */
function normalizeCounty(s: string): string | null {
  const v = normalizeToken(String(s ?? ""));
  if (!v) return null;
  return v.replace(/\s+COUNTY$/, "").trim() || null;
}

/** First 5 consecutive digits, else null (so "75231-1234" → "75231"). */
function normalizeZip(zip: string): string | null {
  const m = String(zip ?? "").match(/\d{5}/);
  return m?.[0] ?? null;
}

/** Reassemble "STREET, CITY, TX ZIP" from standardized parts, omitting empty segments. */
function buildCanonicalLine(parts: StreetParts, city: string | null, zip5: string | null): string {
  const street = [
    parts.primaryNumber,
    parts.preDirectional,
    parts.streetName,
    parts.streetSuffix,
    parts.postDirectional,
  ]
    .filter((p): p is string => p !== null && p !== "")
    .join(" ");

  const segments: string[] = [];
  if (street) segments.push(street);
  if (city) segments.push(city);
  segments.push(["TX", zip5].filter((p): p is string => !!p).join(" "));
  return segments.join(", ");
}

/**
 * Standardize the four structured intake fields into a canonical address for
 * offline geocoding. County and city are standardized but NON-authoritative —
 * the spatial resolver determines the true county from coordinates. Never throws.
 */
export function normalizeAddress(input: RawAddressInput): CanonicalAddress {
  const parts = parseStreetLine(input.street);
  const city = normalizeToken(input.city);
  const zip5 = normalizeZip(input.zip);
  const countyHint = normalizeCounty(input.county);
  const confident = parts.primaryNumber !== "" && parts.streetName !== "";

  return {
    ...parts,
    city,
    state: "TX",
    zip5,
    countyHint,
    canonicalLine: buildCanonicalLine(parts, city, zip5),
    confident,
  };
}
