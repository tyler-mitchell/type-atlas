/**
 * Shared rate limiting primitives for MCP tools.
 *
 * Modeled after practical token/window limiter APIs used by
 * popular libraries (for example `success`/`remaining`/`msBeforeNext` in
 * upstash-style responses).
 */

const RATE_LIMIT_MIN_WINDOW_MS = 1;
const RATE_LIMIT_MIN_LIMIT = 1;

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  msBeforeNext: number;
  retryAfterSeconds: number;
};

export type SlidingWindowRateLimiter = {
  consume: (key: string) => RateLimitResult;
  reset: (key?: string) => void;
};

const normalizePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalizedValue, 10);
  if (!Number.isFinite(parsed) || parsed < RATE_LIMIT_MIN_LIMIT) {
    return fallback;
  }

  return parsed;
};

export const parsePositiveIntEnv = (env: string, fallback: number): number =>
  normalizePositiveInteger(process.env[env]?.trim(), fallback);

const normalizePositiveWindowMs = (windowMs: number): number =>
  Math.max(windowMs, RATE_LIMIT_MIN_WINDOW_MS);

const normalizePositiveLimit = (limit: number): number =>
  Math.max(limit, RATE_LIMIT_MIN_LIMIT);

export const createSlidingWindowRateLimiter = ({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}): SlidingWindowRateLimiter => {
  const normalizedLimit = normalizePositiveLimit(limit);
  const normalizedWindowMs = normalizePositiveWindowMs(windowMs);
  const buckets = new Map<string, number[]>();

  const cleanupBucket = (bucketKey: string, now: number): number[] => {
    const cutoffAt = now - normalizedWindowMs;
    return (buckets.get(bucketKey) ?? []).filter((ts) => ts > cutoffAt);
  };

  const toRetryAfter = (nextAllowedAfter: number, now: number) => {
    const msBeforeNext = Math.max(0, nextAllowedAfter - now);
    return {
      msBeforeNext,
      retryAfterSeconds: Math.max(1, Math.ceil(msBeforeNext / 1000)),
    };
  };

  return {
    consume: (key) => {
      const now = Date.now();
      const windowTimestamps = cleanupBucket(key, now);

      if (windowTimestamps.length >= normalizedLimit) {
        const nextAllowedAfter = (windowTimestamps.at(0) ?? now) + normalizedWindowMs;
        buckets.set(key, windowTimestamps);
        const timeout = toRetryAfter(nextAllowedAfter, now);
        return {
          success: false,
          limit: normalizedLimit,
          remaining: 0,
          resetAt: nextAllowedAfter,
          msBeforeNext: timeout.msBeforeNext,
          retryAfterSeconds: timeout.retryAfterSeconds,
        };
      }

      const updatedBucket = [...windowTimestamps, now];
      buckets.set(key, updatedBucket);

      const nextAllowedAfter = updatedBucket[0] + normalizedWindowMs;
      return {
        success: true,
        limit: normalizedLimit,
        remaining: Math.max(0, normalizedLimit - updatedBucket.length),
        resetAt: nextAllowedAfter,
        msBeforeNext: nextAllowedAfter - now,
        retryAfterSeconds: 0,
      };
    },
    reset: (key) => {
      if (key === undefined) {
        buckets.clear();
        return;
      }
      buckets.delete(key);
    },
  };
};

export type { RateLimitResult as RateLimitOutcome };
