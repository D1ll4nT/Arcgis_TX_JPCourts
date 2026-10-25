import type { D1Like } from "./d1-querier.js";
import type { KVLike } from "./auth.js";
import type { AssetsFetcher } from "./boundaries.js";

export interface Env {
  DB: D1Like;
  KEYS: KVLike;
  ASSETS: AssetsFetcher;
  RL: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  AE: { writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
}
