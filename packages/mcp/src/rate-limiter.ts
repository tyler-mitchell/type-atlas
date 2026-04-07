/**
 * Shared rate limiting primitives for MCP tools.
 *
 * Upstash-style shape for the subset we use:
 * - `limit(identifier)` entrypoint
 * - `{ success, limit, remaining, reset }` result shape
 */

const RATE_LIMIT_MIN_WINDOW_MS = 1;
const RATE_LIMIT_MIN_LIMIT = 1;

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

export type SlidingWindowRateLimiter = {
  limit: (key: string) => RateLimitResult;
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

  return {
    limit: (key) => {
      const now = Date.now();
      const windowTimestamps = cleanupBucket(key, now);

      if (windowTimestamps.length >= normalizedLimit) {
        const nextAllowedAfter = (windowTimestamps.at(0) ?? now) + normalizedWindowMs;
        buckets.set(key, windowTimestamps);
        return {
          success: false,
          limit: normalizedLimit,
          remaining: 0,
          reset: nextAllowedAfter,
        };
      }

      const updatedBucket = [...windowTimestamps, now];
      buckets.set(key, updatedBucket);

      const nextAllowedAfter = updatedBucket[0] + normalizedWindowMs;
      return {
        success: true,
        limit: normalizedLimit,
        remaining: Math.max(0, normalizedLimit - updatedBucket.length),
        reset: nextAllowedAfter,
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
