import { describe, expect, test } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";

/**
 * Regression: Express matches GET /:id before GET /my-preview when the
 * parametric route is registered first. Cashiers then hit requireOwnerOrAdmin
 * and get 403 on My Day Close. Non-numeric /:id must fall through via
 * next("route") so /my-* endpoints stay open to all staff.
 */
describe("day-close my-* routes are reachable for non-admin staff", () => {
  test("GET /my-preview is not swallowed by /:id admin gate", async () => {
    const app = express();
    const r = express.Router();

    const requireOwnerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
      const role = (req as { staffSession?: { role?: string } }).staffSession?.role;
      if (role !== "admin" && role !== "super_admin") {
        res.status(403).json({ error: "Owner/admin access required" });
        return;
      }
      next();
    };

    // Same pattern as production day-close.ts
    r.get("/:id", (req, res, next) => {
      if (!Number.isInteger(Number(req.params.id))) return next("route");
      return requireOwnerOrAdmin(req, res, next);
    }, (_req, res) => {
      res.json({ hit: "numeric-id" });
    });

    r.get("/my-preview", (_req, res) => {
      res.json({ hit: "my-preview", ok: true });
    });

    app.use((req, _res, next) => {
      (req as { staffSession?: { role: string } }).staffSession = { role: "billing" };
      next();
    });
    app.use("/day-close", r);

    const server = await new Promise<import("http").Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as { port: number }).port;

    try {
      const myPreview = await fetch(`http://127.0.0.1:${port}/day-close/my-preview`);
      expect(myPreview.status).toBe(200);
      expect(await myPreview.json()).toEqual({ hit: "my-preview", ok: true });

      const numeric = await fetch(`http://127.0.0.1:${port}/day-close/42`);
      expect(numeric.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
