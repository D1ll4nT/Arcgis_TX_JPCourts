import { parseStreetLine } from "./normalize-address.js";
import { streetKeyFromParts } from "./street-key.js";
import type { SegmentRow, TigerEdge } from "../types.js";
import type { Feature, LineString } from "geojson";

/** "PRE|NAME|SUFFIX|POST" from C1's standardized components. */
function streetKey(fullName: string): string | null {
  const p = parseStreetLine(fullName);
  if (p.streetName === "") return null;
  return streetKeyFromParts(p);
}

function parity(from: number, to: number): "E" | "O" | "B" {
  const fromEven = from % 2 === 0;
  const toEven = to % 2 === 0;
  if (fromEven && toEven) return "E";
  if (!fromEven && !toEven) return "O";
  return "B";
}

/** A side row if the from/to strings are both integers, else null. */
function sideRow(
  key: string,
  edge: TigerEdge,
  fromStr: string,
  toStr: string,
  zip: string | null,
): SegmentRow | null {
  if (!/^\d+$/.test(fromStr) || !/^\d+$/.test(toStr)) return null;
  const from = Number(fromStr);
  const to = Number(toStr);
  return {
    street_key: key,
    zip,
    from_addr: from,
    to_addr: to,
    parity: parity(from, to),
    lon1: edge.start[0],
    lat1: edge.start[1],
    lon2: edge.end[0],
    lat2: edge.end[1],
  };
}

/** One TIGER road edge → 0/1/2 street-segment rows (one per addressed side). */
export function tigerEdgeToRows(edge: TigerEdge): SegmentRow[] {
  if (!edge.roadFlag) return [];
  const key = streetKey(edge.fullName);
  if (key === null) return [];
  const rows: SegmentRow[] = [];
  const left = sideRow(key, edge, edge.lFromAdd, edge.lToAdd, edge.zipL);
  if (left) rows.push(left);
  const right = sideRow(key, edge, edge.rFromAdd, edge.rToAdd, edge.zipR);
  if (right) rows.push(right);
  return rows;
}

/** Read one field from a TIGER DBF properties bag as a string (missing → ""). */
function attr(props: Record<string, unknown> | null, key: string): string {
  const v = props?.[key];
  return v === null || v === undefined ? "" : String(v);
}

/** A parsed TIGER Edges shapefile feature → our TigerEdge input. Never throws. */
export function featureToTigerEdge(feature: Feature<LineString>): TigerEdge {
  const props = (feature.properties ?? null) as Record<string, unknown> | null;
  const coords = feature.geometry.coordinates;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const zipL = attr(props, "ZIPL");
  const zipR = attr(props, "ZIPR");
  return {
    fullName: attr(props, "FULLNAME"),
    roadFlag: attr(props, "ROADFLG") === "Y",
    lFromAdd: attr(props, "LFROMADD"),
    lToAdd: attr(props, "LTOADD"),
    rFromAdd: attr(props, "RFROMADD"),
    rToAdd: attr(props, "RTOADD"),
    zipL: zipL === "" ? null : zipL,
    zipR: zipR === "" ? null : zipR,
    start: [first[0]!, first[1]!],
    end: [last[0]!, last[1]!],
  };
}
