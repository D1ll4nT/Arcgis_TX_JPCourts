export interface TigerManifestEntry {
  county: string;
  rowCount: number;
}

export interface TigerManifest {
  tigerYear: string;
  generatedRows: number;
  counties: TigerManifestEntry[];
  contentHash: string;
}

/** Provenance summary for a generated tiger.sql dump. */
export function buildManifest(
  tigerYear: string,
  counts: Record<string, number>,
  contentHash: string,
): TigerManifest {
  const counties = Object.entries(counts).map(([county, rowCount]) => ({ county, rowCount }));
  const generatedRows = counties.reduce((sum, c) => sum + c.rowCount, 0);
  return { tigerYear, generatedRows, counties, contentHash };
}
