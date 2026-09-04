/**
 * apiTestApp.ts — real HTTP harness for request-level route tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The billing hot path was covered only by source-text assertions
 * (readFileSync + toContain). Those passed while POST /api/billing/save
 * returned HTTP 500 on every single call in production:
 *
 *   TypeError: Cannot set property query of #<IncomingMessage>
 *     which has only a getter        (billingDeskSave.ts, Express 5)
 *
 * A grep-style test cannot catch that, because the offending string was
 * present and spelled correctly. Only executing the route can.
 *
 * This harness mounts the SAME router the server mounts (routes/index.ts) on
 * a bare Express app, so tests exercise the real middleware chain
 * (requireStaffAuth → requireStaffPermission → handler) against a real
 * PostgreSQL database — without importing src/index.ts, which calls
 * app.listen() at module scope.
 */
import express, { type Express } from "express";

/** True when a database is reachable for integration-style tests. */
export function hasDatabaseUrl(): boolean {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}

/**
 * Build an Express app with the production API router mounted at /api.
 * Imported lazily so a missing DATABASE_URL cannot crash collection of
 * unrelated test files (@workspace/db throws at import time without it).
 */
export async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  // Routes expect pino-http's req.log (info/error/warn). Stub it so handlers
  // that log do not throw and fall through to Express's HTML error page.
  app.use((req, _res, next) => {
    const noop = () => undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = {
      info: noop,
      error: noop,
      warn: noop,
      debug: noop,
      fatal: noop,
      trace: noop,
      silent: noop,
      level: "silent",
      child: () => (req as any).log,
    };
    next();
  });
  const { default: router } = await import("../routes/index");
  app.use("/api", router);
  return app;
}
