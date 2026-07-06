/**
 * diagnostics.ts — admin-only request performance diagnostics.
 *
 * GET /api/diagnostics/summary
 *   Returns recent request log + per-endpoint aggregated stats from the
 *   in-memory ring buffer in lib/requestMetrics.ts.
 *
 * Access: admin / super_admin only (requireAdminRole — see
 * middleware/requireStaffAuth.ts). This is intentionally NOT gated by the
 * toggleable per-user permissions array; it's an operator tool, not a
 * business module.
 *
 * Never exposes: request/response bodies, headers, tokens, query strings,
 * or patient data — the underlying collector only ever stores method,
 * normalized path, status code, duration, and role (see requestMetrics.ts).
 */

import { Router } from "express";
import { getRecentRequests, getEndpointStats, getSlowThresholdMs } from "../lib/requestMetrics";

const router = Router();

router.get("/summary", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({
    ok: true,
    slowThresholdMs: getSlowThresholdMs(),
    recent: getRecentRequests(limit),
    endpoints: getEndpointStats(),
  });
});

export default router;
