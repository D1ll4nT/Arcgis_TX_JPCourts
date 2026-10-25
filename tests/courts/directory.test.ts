import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";
import { COUNTIES } from "../../src/types.js";
import type { CountyCourts } from "../../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function boundaryPrecincts(county: string): Set<string> {
  const fc = JSON.parse(
    readFileSync(join(ROOT, "data", "boundaries", `${county}.geojson`), "utf8"),
  ) as FeatureCollection;
  return new Set(fc.features.map((f) => (f.properties as { precinct: string }).precinct));
}
function courts(county: string): CountyCourts {
  return JSON.parse(readFileSync(join(ROOT, "data", "courts", `${county}.json`), "utf8")) as CountyCourts;
}

const REQUIRED_NONEMPTY = ["courtName", "filingAddress", "phone", "efilePortal", "source"] as const;

describe("court directory", () => {
  for (const county of COUNTIES) {
    describe(county, () => {
      const cc = courts(county);
      const precincts = boundaryPrecincts(county);

      it("file county matches the filename and is a Core-4 county", () => {
        expect(cc.county).toBe(county);
        expect(COUNTIES).toContain(cc.county);
      });

      it("court keys align 1:1 with boundary precincts", () => {
        expect(new Set(Object.keys(cc.courts))).toEqual(precincts);
      });

      it("every entry has the required non-empty fields + string[] places", () => {
        for (const [precinct, e] of Object.entries(cc.courts)) {
          for (const f of REQUIRED_NONEMPTY) {
            expect(typeof e[f], `${county}/${precinct}.${f}`).toBe("string");
            expect(e[f].length, `${county}/${precinct}.${f}`).toBeGreaterThan(0);
          }
          expect(Array.isArray(e.places), `${county}/${precinct}.places`).toBe(true);
        }
      });

      it("verification metadata is well-formed", () => {
        expect(typeof cc.verified).toBe("boolean");
        if (cc.verified) {
          expect(typeof cc.verifiedAt).toBe("string");
          expect((cc.verifiedAt ?? "").length).toBeGreaterThan(0);
          expect(typeof cc.verifiedBy).toBe("string");
          expect((cc.verifiedBy ?? "").length).toBeGreaterThan(0);
          for (const [precinct, e] of Object.entries(cc.courts)) {
            expect(typeof e.ocaLocationId, `${county}/${precinct}.ocaLocationId`).toBe("string");
            expect(e.ocaLocationId.length, `verified ${county}/${precinct} needs an ocaLocationId`).toBeGreaterThan(0);
          }
        } else {
          expect(cc.verifiedAt).toBeNull();
          expect(cc.verifiedBy).toBeNull();
        }
      });
    });
  }

  it("has exactly the Core-4 county files and no stray files", () => {
    const files = readdirSync(join(ROOT, "data", "courts")).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual([...COUNTIES].map((c) => `${c}.json`).sort());
  });
});
