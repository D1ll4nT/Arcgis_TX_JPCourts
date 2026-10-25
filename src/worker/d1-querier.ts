import type { SegmentQuerier } from "../geocode/geocode.js";
import type { SegmentRow } from "../types.js";

export interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): { all(): Promise<{ results: SegmentRow[] }> } };
}

export function d1SegmentQuerier(db: D1Like): SegmentQuerier {
  return {
    async query(streetKey, zip) {
      const sql =
        zip === null
          ? "SELECT * FROM street_segments WHERE street_key = ?"
          : "SELECT * FROM street_segments WHERE street_key = ? AND zip = ?";
      const stmt = zip === null ? db.prepare(sql).bind(streetKey) : db.prepare(sql).bind(streetKey, zip);
      const { results } = await stmt.all();
      return results ?? [];
    },
    // Coarse |NAME| substring fetch (parsed street names are [A-Z0-9 ], so no
    // LIKE metacharacters). May over-fetch; geocode filters by precise key parts.
    async queryByName(streetName, zip) {
      const pat = `%|${streetName}|%`;
      const sql =
        zip === null
          ? "SELECT * FROM street_segments WHERE street_key LIKE ?"
          : "SELECT * FROM street_segments WHERE street_key LIKE ? AND zip = ?";
      const stmt = zip === null ? db.prepare(sql).bind(pat) : db.prepare(sql).bind(pat, zip);
      const { results } = await stmt.all();
      return results ?? [];
    },
  };
}
