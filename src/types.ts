import type { Feature, Polygon, MultiPolygon } from "geojson";

export type County = "dallas" | "tarrant" | "collin" | "denton";

export const COUNTIES: readonly County[] = ["dallas", "tarrant", "collin", "denton"];

export interface PrecinctProps {
  county: County;
  precinct: string;
}

export type PrecinctFeature = Feature<Polygon | MultiPolygon, PrecinctProps>;

export type Confidence = "high" | "review" | "needs_verification";

export type LocationMethod = "parcel" | "address-point" | "census";

export interface ResolveMatch {
  county: County;
  precinct: string;
}

export interface CertaintyResult {
  county: County;
  precinct: string | null;
  candidatePrecincts?: string[];
  confidence: Confidence;
  boundaryBetween?: string[];
  distanceMeters?: number;
}

export interface CalibrationCase {
  label: string;
  lon: number;
  lat: number;
  method: LocationMethod;
  precisionMeters: number;
  expectedCounty: County | null;
  expectedPrecinct: string | null;
}

export interface FalseHighRecord {
  label: string;
  expectedCounty: County | null;
  expectedPrecinct: string | null;
  gotCounty: County;
  gotPrecinct: string | null;
}

export interface CalibrationReport {
  total: number;
  inScope: number;
  trueHigh: number;
  falseHigh: FalseHighRecord[];
  safeAbstentions: number;
  coveragePct: number;
}

export interface StreetParts {
  primaryNumber: string;
  preDirectional: string | null;
  streetName: string;
  streetSuffix: string | null;
  postDirectional: string | null;
}

export interface RawAddressInput {
  street: string;
  city: string;
  zip: string;
  county: string;
}

export interface CanonicalAddress extends StreetParts {
  city: string | null;
  state: "TX";
  zip5: string | null;
  countyHint: string | null;
  canonicalLine: string;
  confident: boolean;
}

export interface TigerEdge {
  fullName: string;
  roadFlag: boolean;
  lFromAdd: string;
  lToAdd: string;
  rFromAdd: string;
  rToAdd: string;
  zipL: string | null;
  zipR: string | null;
  start: [number, number]; // [lon, lat] first vertex
  end: [number, number];   // [lon, lat] last vertex
}

export interface SegmentRow {
  street_key: string;
  zip: string | null;
  from_addr: number;
  to_addr: number;
  parity: "E" | "O" | "B";
  lon1: number;
  lat1: number;
  lon2: number;
  lat2: number;
}

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
