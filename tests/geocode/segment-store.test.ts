import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { tigerEdgeToRows } from "../../src/geocode/tiger-edge.js";
import { segmentValuesSql } from "../../src/geocode/segment-store.js";
import type { SegmentRow, TigerEdge } from "../../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(HERE, "..", "..", "scripts", "tiger", "schema.sql"), "utf8");
const edges = JSON.parse(
  readFileSync(join(HERE, "..", "fixtures", "tiger-sample-edges.json"), "utf8"),
) as TigerEdge[];

describe("segmentValuesSql + schema (the real D1 import path)", () => {
  it("loads into SQLite and answers a street_key + zip lookup", () => {
    const rows = edges.flatMap(tigerEdgeToRows); // 3 rows: Church E/O + Field
    const db = new Database(":memory:");
    db.exec(schemaSql);
    db.exec(segmentValuesSql(rows));

    const got = db
      .prepare("SELECT * FROM street_segments WHERE street_key = ? AND zip = ? ORDER BY parity")
      .all("|CHURCH|RD|", "75231") as SegmentRow[];
    expect(got).toHaveLength(2);
    expect(got[0]!).toMatchObject({ parity: "E", from_addr: 9200, to_addr: 9298, lon1: -96.732 });

    const total = (db.prepare("SELECT COUNT(*) c FROM street_segments").get() as { c: number }).c;
    expect(total).toBe(3); // non-road "Trinity River" excluded; Field one-sided
  });

  it("emits SQL NULL for a null zip", () => {
    const rows: SegmentRow[] = [
      { street_key: "|A|ST|", zip: null, from_addr: 1, to_addr: 9, parity: "O",
        lon1: -96, lat1: 32, lon2: -96, lat2: 32 },
    ];
    expect(segmentValuesSql(rows)).toContain("NULL");
    const db = new Database(":memory:");
    db.exec(schemaSql);
    db.exec(segmentValuesSql(rows));
    const zip = (db.prepare("SELECT zip FROM street_segments").get() as { zip: string | null }).zip;
    expect(zip).toBeNull();
  });

  it("throws on a non-finite coordinate rather than emitting NaN SQL", () => {
    const bad = [{ street_key: "|A|ST|", zip: "75000", from_addr: 1, to_addr: 9, parity: "O",
      lon1: Number.NaN, lat1: 32, lon2: -96, lat2: 32 }] as unknown as SegmentRow[];
    expect(() => segmentValuesSql(bad)).toThrow(/non-finite/);
  });
});
