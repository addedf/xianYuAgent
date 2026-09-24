import { describe, expect, it } from "vitest";
import { createTokenBucket } from "./rate-limit";

describe("JEV token bucket", () => {
  it("limits calls per minute and refills over time", () => {
    let now = 0;
    const take = createTokenBucket(() => now);
    expect(take(2)).toBe(true);
    expect(take(2)).toBe(true);
    expect(take(2)).toBe(false);
    now = 30_000;
    expect(take(2)).toBe(true);
    now = 60_000;
    expect(take(2)).toBe(true);
  });
});
