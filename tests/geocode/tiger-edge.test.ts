import { describe, it, expect } from "vitest";
import { tigerEdgeToRows } from "../../src/geocode/tiger-edge.js";
import type { TigerEdge } from "../../src/types.js";

const base: TigerEdge = {
  fullName: "Church Rd",
  roadFlag: true,
  lFromAdd: "9200", lToAdd: "9298",   // even side
  rFromAdd: "9201", rToAdd: "9299",   // odd side
  zipL: "75231", zipR: "75231",
  start: [-96.732, 32.885],
  end: [-96.730, 32.887],
};

describe("tigerEdgeToRows", () => {
  it("explodes an edge into one row per addressed side with a C1 street_key", () => {
    const rows = tigerEdgeToRows(base);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.street_key === "|CHURCH|RD|")).toBe(true);
    const even = rows.find((r) => r.parity === "E")!;
    expect(even).toMatchObject({
      zip: "75231", from_addr: 9200, to_addr: 9298,
      lon1: -96.732, lat1: 32.885, lon2: -96.730, lat2: 32.887,
    });
    expect(rows.find((r) => r.parity === "O")).toMatchObject({ from_addr: 9201, to_addr: 9299 });
  });

  it("keeps only the side that has a numeric range", () => {
    const rows = tigerEdgeToRows({ ...base, rFromAdd: "", rToAdd: "" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.parity).toBe("E");
  });

  it("marks a mixed-parity range 'B'", () => {
    const rows = tigerEdgeToRows({ ...base, lFromAdd: "100", lToAdd: "199", rFromAdd: "", rToAdd: "" });
    expect(rows[0]!.parity).toBe("B");
  });

  it("preserves address direction (from_addr may exceed to_addr)", () => {
    const rows = tigerEdgeToRows({ ...base, lFromAdd: "9298", lToAdd: "9200", rFromAdd: "", rToAdd: "" });
    expect(rows[0]!).toMatchObject({ from_addr: 9298, to_addr: 9200 });
  });

  it("returns [] for a non-road edge", () => {
    expect(tigerEdgeToRows({ ...base, roadFlag: false })).toEqual([]);
  });

  it("returns [] when the street name is empty", () => {
    expect(tigerEdgeToRows({ ...base, fullName: "" })).toEqual([]);
  });

  it("returns [] when no side has a numeric range", () => {
    expect(tigerEdgeToRows({ ...base, lFromAdd: "", lToAdd: "", rFromAdd: "x", rToAdd: "y" })).toEqual([]);
  });
});
