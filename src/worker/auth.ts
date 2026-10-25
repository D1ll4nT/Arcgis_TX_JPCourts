export interface KVLike {
  get(key: string): Promise<string | null>;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function presentedKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return request.headers.get("x-api-key");
}

/** Hashed-key KV check. Fail-closed: any error or missing/disabled key → false. */
export async function checkAuth(request: Request, kv: KVLike): Promise<boolean> {
  try {
    const key = presentedKey(request);
    if (!key) return false;
    const record = await kv.get(await sha256Hex(key));
    if (!record) return false;
    const parsed = JSON.parse(record) as { enabled?: boolean };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
