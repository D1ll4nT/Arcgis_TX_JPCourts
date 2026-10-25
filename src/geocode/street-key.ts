import type { StreetParts } from "../types.js";

/**
 * The canonical street-segment lookup key: "PRE|NAME|SUFFIX|POST" from C1's
 * standardized components. The single source of truth shared by the C2 build
 * (keys stored in D1) and the C3 lookup (keys queried), so they never diverge.
 */
export function streetKeyFromParts(parts: StreetParts): string {
  return `${parts.preDirectional ?? ""}|${parts.streetName}|${parts.streetSuffix ?? ""}|${parts.postDirectional ?? ""}`;
}
