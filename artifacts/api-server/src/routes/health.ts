import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Capture the process start time once — this becomes the "version token".
// Every deployment restarts the process, so the token changes and connected
// clients can detect that a new version is available.
const SERVER_STARTED_AT = Date.now();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Lightweight version endpoint — clients poll this to detect new deployments.
// Returns the server's startup timestamp (no auth required; no sensitive data).
router.get("/version", (_req, res) => {
  res.json({ startedAt: SERVER_STARTED_AT });
});

export default router;
