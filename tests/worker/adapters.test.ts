import { describe, it, expect } from "vitest";
import { d1SegmentQuerier } from "../../src/worker/d1-querier.js";
import { checkAuth, sha256Hex } from "../../src/worker/auth.js";
import type { SegmentRow } from "../../src/types.js";

const row: SegmentRow = { street_key: "|A|ST|", zip: "75201", from_addr: 1, to_addr: 9, parity: "O", lon1: -96, lat1: 32, lon2: -96, lat2: 32 };

function fakeDb(byArgs: (key: string, zip: string | null) => SegmentRow[]) {
  return {
    prepare(_sql: string) {
      return { bind(...args: unknown[]) { return { async all() { return { results: byArgs(args[0] as string, (args[1] as string) ?? null) }; } }; } };
    },
  };
}

describe("d1SegmentQuerier", () => {
  it("queries by street_key (+zip) and returns rows", async () => {
    const q = d1SegmentQuerier(fakeDb((k) => (k === "|A|ST|" ? [row] : [])));
    expect(await q.query("|A|ST|", "75201")).toHaveLength(1);
    expect(await q.query("|B|ST|", null)).toHaveLength(0);
  });

  it("queryByName fetches all directional/suffix variants of a name, zip-scoped, via real SQL", async () => {
    // Real sqlite behind the D1Like shape so the actual SQL text is exercised.
    const Database = (await import("better-sqlite3")).default;
    const { readFileSync } = await import("node:fs");
    const sqlite = new Database(":memory:");
    sqlite.exec(readFileSync(new URL("../../scripts/tiger/schema.sql", import.meta.url), "utf8"));
    const ins = sqlite.prepare(
      "INSERT INTO street_segments (street_key, zip, from_addr, to_addr, parity, lon1, lat1, lon2, lat2) VALUES (?, ?, 1, 9, 'B', 0, 0, 0, 0)",
    );
    ins.run("E|DALLAS|ST|", "76063");
    ins.run("|DALLAS|AVE|", "76063");
    ins.run("|DALLAS|ST|", "75050"); // other zip — excluded when zip-scoped
    ins.run("|MAIN|ST|", "76063");
    const db = {
      prepare(sql: string) {
        const stmt = sqlite.prepare(sql);
        return { bind(...args: unknown[]) { return { async all() { return { results: stmt.all(...args) as SegmentRow[] }; } }; } };
      },
    };
    const q = d1SegmentQuerier(db);
    const inZip = await q.queryByName("DALLAS", "76063");
    expect(inZip.map((r) => r.street_key).sort()).toEqual(["E|DALLAS|ST|", "|DALLAS|AVE|"].sort());
    const anyZip = await q.queryByName("DALLAS", null);
    expect(anyZip).toHaveLength(3);
  });
});

describe("checkAuth", () => {
  it("accepts a key whose SHA-256 is enabled in KV; fail-closed otherwise", async () => {
    const good = "secret-key";
    const hash = await sha256Hex(good);
    const kv = { async get(k: string) { return k === hash ? JSON.stringify({ enabled: true }) : null; } };
    const ok = new Request("https://x/v1/precinct", { headers: { authorization: `Bearer ${good}` } });
    expect(await checkAuth(ok, kv)).toBe(true);
    const bad = new Request("https://x/v1/precinct", { headers: { authorization: "Bearer nope" } });
    expect(await checkAuth(bad, kv)).toBe(false);
    const none = new Request("https://x/v1/precinct");
    expect(await checkAuth(none, kv)).toBe(false);
    const throwing = { async get() { throw new Error("kv down"); } };
    expect(await checkAuth(ok, throwing)).toBe(false); // fail-closed
  });

  it("disabled key is rejected", async () => {
    const hash = await sha256Hex("k");
    const kv = { async get(x: string) { return x === hash ? JSON.stringify({ enabled: false }) : null; } };
    const req = new Request("https://x", { headers: { "x-api-key": "k" } });
    expect(await checkAuth(req, kv)).toBe(false);
  });
});
