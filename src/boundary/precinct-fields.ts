import type { County } from "../types.js";

function requireDigits(value: unknown, field: string): string {
  const s = String(value ?? "").trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`${field}: expected a numeric precinct, got ${JSON.stringify(value)}`);
  }
  return s;
}

/** Map a raw ArcGIS attribute bag to the normalized precinct string. */
export function extractPrecinct(county: County, attrs: Record<string, unknown>): string {
  switch (county) {
    case "dallas":
      return requireDigits(attrs.DISTRICT, "DISTRICT");
    case "tarrant":
      return requireDigits(attrs.JP, "JP");
    case "denton":
      return requireDigits(attrs.JP_C, "JP_C");
    case "collin": {
      const raw = attrs.name;
      if (typeof raw !== "string") {
        throw new Error(`Collin: expected string 'name', got ${JSON.stringify(raw)}`);
      }
      const m = raw.match(/Precinct\s+(\d+)/i);
      if (!m) throw new Error(`Collin: could not parse precinct from name=${JSON.stringify(raw)}`);
      return m[1]!;
    }
  }
}
