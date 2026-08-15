/**
 * redisClient.ts — shared Redis client for server-side caching.
 *
 * Connects to REDIS_URL (default redis://redis:6379). If Redis is unavailable
 * (not started, wrong URL, network issue), all operations silently return
 * null/false — callers must treat Redis as a best-effort cache, never a
 * hard dependency. The app works correctly without Redis; it just runs
 * slightly slower (DB queries instead of cache hits).
 *
 * Uses ioredis (already a dependency) which has built-in reconnection,
 * connection pooling, and cluster support.
 *
 * Usage:
 *   import { redisGet, redisSet, redisDel } from "./redisClient";
 *
 *   const cached = await redisGet("feature-flags");
 *   if (cached) return JSON.parse(cached);
 *   // ... fetch from DB ...
 *   await redisSet("feature-flags", JSON.stringify(rows), 60); // 60s TTL
 */

import Redis from "ioredis";

let client: Redis | null = null;
let connectionFailed = false;
let connectionFailedAt = 0;

/**
 * Get the Redis client, connecting lazily on first call.
 * Returns null if Redis is not configured or connection failed.
 * Connection failures are cached for 5 minutes so we don't retry on every request.
 */
function getClient(): Redis | null {
  // If Redis is not configured, skip entirely
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    return null;
  }

  // If connection previously failed, don't retry on every request
  // (reset after 5 minutes to allow Redis to come back after a restart)
  if (connectionFailed) {
    if (Date.now() - connectionFailedAt > 300_000) {
      connectionFailed = false;
    } else {
      return null;
    }
  }

  if (client) return client;

  const url = process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "redis"}:6379`;

  try {
    const c = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying after 3 attempts
        return Math.min(times * 200, 1000);
      },
    });

    c.on("error", (err: Error) => {
      // Don't crash — just log
      if (!connectionFailed) {
        console.warn("[redis] Client error:", err.message);
      }
    });

    c.on("connect", () => {
      console.log("[redis] Connected to", url.replace(/redis:\/\/[^@]*@/, "redis://"));
    });

    // Trigger initial connection
    void c.connect().catch((err: Error) => {
      console.warn("[redis] Connection failed (caching for 5 min):", err.message);
      connectionFailed = true;
      connectionFailedAt = Date.now();
    });

    client = c;
    return c;
  } catch (err) {
    console.warn("[redis] Failed to create client:", err instanceof Error ? err.message : String(err));
    connectionFailed = true;
    connectionFailedAt = Date.now();
    return null;
  }
}

/**
 * Get a cached value by key. Returns null on miss, error, or no Redis.
 */
export async function redisGet(key: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return await c.get(key);
  } catch {
    return null;
  }
}

/**
 * Set a cached value with TTL in seconds. Silently fails on error.
 */
export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, value, "EX", ttlSeconds);
  } catch {
    // silent
  }
}

/**
 * Delete a cached value (use after mutations to invalidate stale cache).
 */
export async function redisDel(key: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.del(key);
  } catch {
    // silent
  }
}

/**
 * Delete all keys matching a pattern (e.g. "feature-flags:*").
 * Uses SCAN to avoid blocking Redis on large keyspaces.
 */
export async function redisDelPattern(pattern: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await c.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await c.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // silent
  }
}

/** Check if Redis is connected (for health checks). */
export async function redisIsHealthy(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const pong = await c.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
