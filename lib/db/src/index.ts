import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Increase pool size from default 10 to 25 — the billing save path holds
  // a connection through the advisory-lock transaction, and concurrent saves
  // (reception + billing counter + day-close queries) can exhaust the default
  // 10-connection pool on a busy day, causing save latency to spike as
  // requests queue waiting for a free connection.
  max: Number(process.env.DB_POOL_MAX ?? 25),
  // Fail fast instead of hanging indefinitely when the DB is unreachable.
  // Default is 0 (no timeout) which means a frozen DB hangs the entire API.
  connectionTimeoutMillis: 10_000,
  // Reclaim idle connections faster so the pool stays fresh.
  idleTimeoutMillis: 30_000,
  // Allow a brief grace period for queries to finish when the pool is
  // draining on shutdown, then force-close.
  allowExitOnIdle: false,
});

// Catch idle-client errors and connection failures emitted on the pool event
// emitter. Without this handler Node.js would print the raw error object to
// stderr — which includes the full connection string (credentials) in the
// message. We log only the sanitised message so secrets never reach logs.
pool.on("error", (err: Error) => {
  // Mask any connection string that may be embedded in the message.
  const safe = err.message.replace(/postgres(?:ql)?:\/\/[^@]+@[^\s/]*/gi, "postgres://***:***@***");
  console.error("[pg-pool] Idle client error:", safe);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
