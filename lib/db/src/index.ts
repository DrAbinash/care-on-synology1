import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
