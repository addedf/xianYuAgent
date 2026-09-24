export function createTokenBucket(clock = Date.now) {
  let tokens = 0;
  let capacity = 0;
  let last = clock();
  return (limit: number): boolean => {
    const now = clock();
    if (capacity !== limit) { capacity = limit; tokens = limit; last = now; }
    tokens = Math.min(limit, tokens + Math.max(0, now - last) * limit / 60_000);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
const globalLimiter = globalThis as typeof globalThis & { jevRateLimit?: ReturnType<typeof createTokenBucket> };
export const takeRateLimit = globalLimiter.jevRateLimit ??= createTokenBucket();
