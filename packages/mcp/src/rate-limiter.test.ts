import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlidingWindowRateLimiter } from "./rate-limiter.js";

describe("createSlidingWindowRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls while under the configured limit", () => {
    const limiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1_000 });

    const first = limiter.limit("alpha");
    const second = limiter.limit("alpha");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.remaining).toBe(0);
    expect(first.limit).toBe(2);
    expect(second.limit).toBe(2);
  });

  it("blocks calls once the limit is exhausted", () => {
    const limiter = createSlidingWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    const first = limiter.limit("alpha");
    const second = limiter.limit("alpha");

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.remaining).toBe(0);
    expect(second.reset).toBeGreaterThan(Date.now());
  });

  it("recovers when the window elapses", () => {
    const limiter = createSlidingWindowRateLimiter({ limit: 1, windowMs: 500 });
    limiter.limit("alpha");

    vi.advanceTimersByTime(600);
    const third = limiter.limit("alpha");

    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("supports explicit identifier resets", () => {
    const limiter = createSlidingWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.limit("alpha").success).toBe(true);
    expect(limiter.limit("beta").success).toBe(true);
    expect(limiter.limit("alpha").success).toBe(false);

    limiter.reset("alpha");

    const afterReset = limiter.limit("alpha");
    expect(afterReset.success).toBe(true);
  });
});
