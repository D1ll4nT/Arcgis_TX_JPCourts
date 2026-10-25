export function validateLonLat(lon: number, lat: number): void {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new RangeError(`lon/lat must be finite numbers, got [${lon}, ${lat}]`);
  }
  if (lon < -180 || lon > 180) throw new RangeError(`lon out of range: ${lon}`);
  if (lat < -90 || lat > 90) throw new RangeError(`lat out of range: ${lat}`);
}
