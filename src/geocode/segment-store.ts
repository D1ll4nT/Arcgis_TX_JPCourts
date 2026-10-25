import type { SegmentRow } from "../types.js";

/** SQL string literal with single-quotes escaped, or NULL. */
function sqlText(v: string | null): string {
  return v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
}

/** Validate numeric field is finite and return SQL string representation. */
function num(v: number, field: string, key: string): string {
  if (!Number.isFinite(v)) throw new Error(`segmentValuesSql: non-finite ${field} for ${key}`);
  return String(v);
}

/**
 * INSERT statements for street_segments — appended to schema.sql to form the
 * exact dump `wrangler d1 import` loads. One INSERT per row keeps lines short
 * and import-friendly.
 */
export function segmentValuesSql(rows: SegmentRow[]): string {
  return rows
    .map(
      (r) =>
        `INSERT INTO street_segments (street_key, zip, from_addr, to_addr, parity, lon1, lat1, lon2, lat2) ` +
        `VALUES (${sqlText(r.street_key)}, ${sqlText(r.zip)}, ${num(r.from_addr, "from_addr", r.street_key)}, ${num(r.to_addr, "to_addr", r.street_key)}, ` +
        `${sqlText(r.parity)}, ${num(r.lon1, "lon1", r.street_key)}, ${num(r.lat1, "lat1", r.street_key)}, ${num(r.lon2, "lon2", r.street_key)}, ${num(r.lat2, "lat2", r.street_key)});`,
    )
    .join("\n");
}
