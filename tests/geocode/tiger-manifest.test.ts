import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/geocode/tiger-manifest.js";

describe("buildManifest", () => {
  it("summarizes per-county counts + total + provenance", () => {
    const m = buildManifest("2024", { dallas: 10, denton: 5 }, "sha256:abc");
    expect(m).toEqual({
      tigerYear: "2024",
      generatedRows: 15,
      counties: [
        { county: "dallas", rowCount: 10 },
        { county: "denton", rowCount: 5 },
      ],
      contentHash: "sha256:abc",
    });
  });
});
