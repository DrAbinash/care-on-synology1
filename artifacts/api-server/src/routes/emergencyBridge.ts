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
import { parseEmergencyJson, PatientResolutionError, type EmergencyTransaction } from "@workspace/emergency-billing";
import { getEmergencyNasConfig } from "../lib/emergencyNasClient";
import { buildEmergencyMasterSnapshot } from "../lib/emergencyMasterSnapshot";
import { importEmergencyTransactions, previewEmergencyTransactions, loadMatchCandidates } from "../lib/emergencyReconcile";
import { enrichCandidates, importedCareBillId, resolveEmergencyPatient } from "../lib/emergencyPatientResolve";

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
  const assignPatient =
    req.body?.assignPatient && typeof req.body.assignPatient === "object" && !Array.isArray(req.body.assignPatient)
      ? (req.body.assignPatient as Record<string, number>)
      : undefined;
  try {
    const { result, batchUuid, preview } = await importEmergencyTransactions({
      transactions: parsed.pkg.transactions,
      importMethod: "JSON",
      importedBy: "emergency-bridge",
      importedByUserId: null,
      sourceNas: typeof req.body?.sourceDeviceId === "string" ? req.body.sourceDeviceId : "windows-emergency",
      onlySafe: req.body?.onlySafe !== false,
      overrides: assignPatient ? { assignPatient } : undefined,
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

/**
 * Same patient Resolve flow as CARE Settings → Emergency Billing, callable from
 * the Windows emergency PC with the shared fetch token (no staff browser session).
 */
emergencyBridgeRouter.post("/resolve-patient", requireEmergencyFetchToken, async (req, res) => {
  const t = req.body?.transaction as EmergencyTransaction | undefined;
  const action = req.body?.action === "create_new" ? "create_new" : req.body?.action === "select_existing" ? "select_existing" : null;
  if (!t?.emergencyTransactionUuid || !t.patient || !action) {
    res.status(400).json({ error: "transaction and action (select_existing | create_new) are required" });
    return;
  }
  try {
    const careBillId = await importedCareBillId(t.emergencyTransactionUuid);
    const candidates = await enrichCandidates(await loadMatchCandidates([t]));
    const { resolution, decision } = await resolveEmergencyPatient({
      transaction: t,
      action,
      carePatientId: req.body?.carePatientId != null ? Number(req.body.carePatientId) : null,
      alreadyImported: careBillId != null,
      careBillId,
      candidates,
      resolvedByStaffName: typeof req.body?.resolvedByStaffName === "string" ? req.body.resolvedByStaffName : "emergency-bridge",
      resolvedByStaffId: null,
    });
    const { rows, summary } = await previewEmergencyTransactions([t]);
    res.json({
      ok: true,
      resolution,
      matchClass: decision.matchClass,
      matchReason: decision.reason,
      row: rows[0],
      summary,
    });
  } catch (err) {
    if (err instanceof PatientResolutionError) {
      const status = err.code === "ALREADY_IMPORTED" ? 409 : 400;
      res.status(status).json({ error: err.message, code: err.code, readOnly: err.code === "ALREADY_IMPORTED" });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
