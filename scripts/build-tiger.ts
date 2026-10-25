import { createHash } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { open } from "shapefile";
import type { Feature, LineString } from "geojson";
import { featureToTigerEdge, tigerEdgeToRows } from "../src/geocode/tiger-edge.js";
import { segmentValuesSql } from "../src/geocode/segment-store.js";
import { buildManifest } from "../src/geocode/tiger-manifest.js";
import type { SegmentRow } from "../src/types.js";

const TIGER_YEAR = "2024";
const COUNTIES: { county: string; fips: string }[] = [
  { county: "dallas", fips: "48113" },
  { county: "tarrant", fips: "48439" },
  { county: "collin", fips: "48085" },
  { county: "denton", fips: "48121" },
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data", "geocoder");
const TMP_DIR = join(OUT_DIR, ".tmp");
const SCHEMA = join(ROOT, "scripts", "tiger", "schema.sql");

async function countyRows(fips: string): Promise<SegmentRow[]> {
  const url = `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}/EDGES/tl_${TIGER_YEAR}_${fips}_edges.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TIGER ${fips}: HTTP ${res.status} from ${url}`);
  const dir = join(TMP_DIR, fips);
  await mkdir(dir, { recursive: true });
  new AdmZip(Buffer.from(await res.arrayBuffer())).extractAllTo(dir, true);

  const shp = join(dir, `tl_${TIGER_YEAR}_${fips}_edges.shp`);
  const dbf = join(dir, `tl_${TIGER_YEAR}_${fips}_edges.dbf`);
  const rows: SegmentRow[] = [];
  let skipped = 0;
  const source = await open(shp, dbf);
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value as Feature<LineString>;
    if (!f.geometry || f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
      skipped++;
      continue;
    }
    rows.push(...tigerEdgeToRows(featureToTigerEdge(f)));
  }
  if (skipped) console.log(`  (${fips}: skipped ${skipped} non-street/degenerate features)`);
  return rows;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const parts: string[] = [readFileSync(SCHEMA, "utf8")];
  const counts: Record<string, number> = {};

  for (const c of COUNTIES) {
    const rows = await countyRows(c.fips);
    counts[c.county] = rows.length;
    parts.push(segmentValuesSql(rows));
    console.log(`${c.county}: ${rows.length} segment rows`);
  }

  const INDEX_DDL = "CREATE INDEX idx_street ON street_segments (street_key, zip);";
  const sql = parts.join("\n") + "\n" + INDEX_DDL + "\n";
  await writeFile(join(OUT_DIR, "tiger.sql"), sql);
  const hash = "sha256:" + createHash("sha256").update(sql).digest("hex");
  const manifest = buildManifest(TIGER_YEAR, counts, hash);
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await rm(TMP_DIR, { recursive: true, force: true });
  console.log(`wrote data/geocoder/tiger.sql (${manifest.generatedRows} rows) + manifest.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
