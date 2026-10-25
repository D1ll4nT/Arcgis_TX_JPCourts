/** A square parcel as an Esri geometry (clockwise outer ring = Esri outer convention). */
export function esriSquare(cx: number, cy: number, r: number): { rings: number[][][] } {
  return {
    rings: [[[cx - r, cy - r], [cx - r, cy + r], [cx + r, cy + r], [cx + r, cy - r], [cx - r, cy - r]]],
  };
}
