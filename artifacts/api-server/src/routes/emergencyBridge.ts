/**
 * Token-authenticated bridge for Windows / DS225+ Emergency CARE to call Main CARE
 * without a staff browser session.
 *
 * Auth: X-Emergency-Fetch-Token (or Bearer) must match the configured emergency NAS
 * fetch token (same secret used the other direction).
 *
 * Mounted at /api/emergency-bridge — intentionally NOT behind requireStaffAuth.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import { parseEmergencyJson } from "@workspace/emergency-billing";
import { getEmergencyNasConfig } from "../lib/emergencyNasClient";
import { buildEmergencyMasterSnapshot } from "../lib/emergencyMasterSnapshot";
import { importEmergencyTransactions, previewEmergencyTransactions } from "../lib/emergencyReconcile";

export const emergencyBridgeRouter = Router();

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return ha.length === hb.length && ha.equals(hb) && a.length === b.length;
}

async function requireEmergencyFetchToken(req: Request, res: Response, next: NextFunction) {
  const cfg = await getEmergencyNasConfig();
  const expected = cfg?.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN || "";
  if (!expected) {
    res.status(503).json({ error: "Emergency fetch token is not configured on Main CARE" });
    return;
  }
  const got =
    String(req.headers["x-emergency-fetch-token"] || "").replace(/^Bearer\s+/i, "") ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got || !timingSafeEqualStr(got, expected)) {
    res.status(401).json({ error: "Invalid emergency fetch token" });
    return;
  }
  next();
}

/** Lightweight liveness for emergency grace-period probes (no secrets / PHI). */
emergencyBridgeRouter.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "care-emergency-bridge",
    role: "main-care",
    at: new Date().toISOString(),
  });
});

emergencyBridgeRouter.get("/master-snapshot", requireEmergencyFetchToken, async (_req, res) => {
  try {
    const snapshot = await buildEmergencyMasterSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBridgeRouter.post("/preview-json", requireEmergencyFetchToken, async (req, res) => {
  const raw = typeof req.body?.json === "string" ? req.body.json : JSON.stringify(req.body?.package ?? req.body ?? {});
  const parsed = parseEmergencyJson(raw);
  if (!parsed.pkg?.transactions.length) {
    res.status(400).json({ error: parsed.errors[0] || "No valid emergency transactions", errors: parsed.errors });
    return;
  }
  try {
    const preview = await previewEmergencyTransactions(parsed.pkg.transactions);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBridgeRouter.post("/import-json", requireEmergencyFetchToken, async (req, res) => {
  const raw = typeof req.body?.json === "string" ? req.body.json : JSON.stringify(req.body?.package ?? req.body ?? {});
  const parsed = parseEmergencyJson(raw);
  if (!parsed.pkg?.transactions.length) {
    res.status(400).json({ error: parsed.errors[0] || "No valid emergency transactions", errors: parsed.errors });
    return;
  }
  try {
    const { result, batchUuid, preview } = await importEmergencyTransactions({
      transactions: parsed.pkg.transactions,
      importMethod: "JSON",
      importedBy: "emergency-bridge",
      importedByUserId: null,
      sourceNas: typeof req.body?.sourceDeviceId === "string" ? req.body.sourceDeviceId : "windows-emergency",
      onlySafe: req.body?.onlySafe !== false,
    });
    res.json({
      batchUuid,
      result,
      preview,
      created: result.created,
      alreadyReconciled: result.alreadyReconciled,
      duplicates: result.duplicates,
      failures: result.failures,
      conflicts: result.conflicts,
      skippedReview: result.skippedReview,
      failureDetails: result.failureDetails,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
