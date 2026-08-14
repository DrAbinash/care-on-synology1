import { Router, type Response } from "express";
import { db, emergencyImportedTransactionsTable, emergencyNasConfigTable, emergencyReconciliationBatchesTable } from "@workspace/db";
import { desc, eq, or, sql } from "drizzle-orm";
import { parseEmergencyCsv, parseEmergencyJson, PatientResolutionError, type EmergencyTransaction } from "@workspace/emergency-billing";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import { importEmergencyTransactions, loadMatchCandidates, previewEmergencyTransactions } from "../lib/emergencyReconcile";
import { enrichCandidates, importedCareBillId, resolveEmergencyPatient } from "../lib/emergencyPatientResolve";
import {
  fetchPendingFromEmergencyNas,
  getEmergencyBillingStatus,
  getEmergencyNasConfig,
  listEmergencyMasterPushLog,
  markEmergencyNasReconciled,
  publicNasConfig,
  pushMasterToEmergencyNas,
} from "../lib/emergencyNasClient";
import { buildEmergencyMasterSnapshot } from "../lib/emergencyMasterSnapshot";

export const emergencyBillingRouter = Router();

function actor(req: StaffAuthRequest): { name: string; userId: number | null } {
  return {
    name: req.staffSession?.subjectName?.trim() || "staff",
    userId: req.staffSession?.subjectId ?? null,
  };
}

emergencyBillingRouter.get("/status", async (_req, res) => {
  const status = await getEmergencyBillingStatus();
  res.json(status);
});

emergencyBillingRouter.get("/push-log", async (_req, res) => {
  const rows = await listEmergencyMasterPushLog(50);
  res.json(rows);
});

emergencyBillingRouter.get("/config", async (_req, res) => {
  const cfg = await getEmergencyNasConfig();
  res.json(publicNasConfig(cfg));
});

emergencyBillingRouter.put("/config", async (req: StaffAuthRequest, res) => {
  const who = actor(req);
  const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim().replace(/\/+$/, "") : undefined;
  const fetchToken = typeof req.body?.fetchToken === "string" ? req.body.fetchToken.trim() : undefined;
  const existing = await getEmergencyNasConfig();
  const values = {
    id: 1,
    baseUrl: baseUrl !== undefined ? (baseUrl || null) : existing?.baseUrl ?? null,
    fetchToken: fetchToken ? fetchToken : existing?.fetchToken ?? null,
    fetchTokenSet: !!(fetchToken || existing?.fetchToken),
    updatedBy: who.name,
  };
  if (existing) {
    await db.update(emergencyNasConfigTable).set(values).where(eq(emergencyNasConfigTable.id, 1));
  } else {
    await db.insert(emergencyNasConfigTable).values(values);
  }
  await auditFromRequest(req, {
    userId: who.userId,
    userName: who.name,
    role: req.staffSession?.role ?? "admin",
    action: "emergency_nas_config",
    module: "emergency_billing",
    entityType: "emergency_nas_config",
    entityId: "1",
    newValue: JSON.stringify({ baseUrl: values.baseUrl, fetchTokenSet: values.fetchTokenSet }),
  });
  const cfg = await getEmergencyNasConfig();
  res.json(publicNasConfig(cfg));
});

emergencyBillingRouter.post("/master-snapshot", async (_req, res) => {
  const snapshot = await buildEmergencyMasterSnapshot();
  res.json({ syncedAt: snapshot.syncedAt, serviceCount: snapshot.services.length, doctorCount: snapshot.doctors.length, patientCount: snapshot.patients.length, staffCount: snapshot.staff.length });
});

emergencyBillingRouter.post("/push-master", async (req: StaffAuthRequest, res) => {
  const who = actor(req);
  try {
    const result = await pushMasterToEmergencyNas({
      initiatedBy: "MANUAL",
      userName: who.name,
      userId: who.userId,
    });
    await auditFromRequest(req, {
      userId: who.userId,
      userName: who.name,
      role: req.staffSession?.role ?? "admin",
      action: "emergency_master_push",
      module: "emergency_billing",
      entityType: "emergency_nas",
      newValue: JSON.stringify(result),
    });
    if (!result.ok) {
      res.status(502).json({ error: result.error, lastSuccessfulPushUnchanged: true });
      return;
    }
    if ("skipped" in result && result.skipped) {
      res.json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err), lastSuccessfulPushUnchanged: true });
  }
});

emergencyBillingRouter.post("/fetch", async (req: StaffAuthRequest, res) => {
  try {
    const payload = await fetchPendingFromEmergencyNas();
    await db.update(emergencyNasConfigTable).set({ lastFetchAt: new Date() }).where(eq(emergencyNasConfigTable.id, 1));
    const { rows, summary } = await previewEmergencyTransactions(payload.transactions);
    summary.sessionUuid = payload.sessions[0]?.emergencySessionUuid ?? summary.sessionUuid;
    summary.sessionStartedAt = payload.sessions[0]?.startedAt ?? null;
    summary.sessionEndedAt = payload.sessions[0]?.endedAt ?? null;
    await auditFromRequest(req, {
      userId: actor(req).userId,
      userName: actor(req).name,
      role: req.staffSession?.role ?? "admin",
      action: "emergency_fetch",
      module: "emergency_billing",
      entityType: "emergency_nas",
      newValue: JSON.stringify({ sessions: payload.sessions.length, pending: payload.transactions.length }),
    });
    res.json({
      sessions: payload.sessions,
      masterDataLastSyncedAt: payload.masterDataLastSyncedAt,
      summary,
      rows,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBillingRouter.post("/preview-csv", async (req: StaffAuthRequest, res) => {
  const raw = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!raw.trim()) {
    res.status(400).json({ error: "csv is required" });
    return;
  }
  const parsed = parseEmergencyCsv(raw);
  const { rows, summary } = await previewEmergencyTransactions(parsed.transactions);
  res.json({ errors: parsed.errors, summary, rows });
});

emergencyBillingRouter.post("/preview-json", async (req: StaffAuthRequest, res) => {
  const raw = typeof req.body?.json === "string" ? req.body.json : JSON.stringify(req.body?.package ?? req.body ?? {});
  const parsed = parseEmergencyJson(raw);
  if (!parsed.pkg) {
    res.status(400).json({ error: parsed.errors[0] || "Invalid JSON", errors: parsed.errors });
    return;
  }
  const { rows, summary } = await previewEmergencyTransactions(parsed.pkg.transactions);
  summary.sessionUuid = parsed.pkg.sessions[0]?.emergencySessionUuid ?? summary.sessionUuid;
  summary.sessionStartedAt = parsed.pkg.sessions[0]?.startedAt ?? null;
  summary.sessionEndedAt = parsed.pkg.sessions[0]?.endedAt ?? null;
  res.json({ errors: parsed.errors, sessions: parsed.pkg.sessions, summary, rows });
});

async function runImport(req: StaffAuthRequest, res: Response, opts: {
  transactions: Parameters<typeof importEmergencyTransactions>[0]["transactions"];
  importMethod: "NAS_API" | "CSV" | "JSON";
  onlySafe?: boolean;
  assignPatient?: Record<string, number>;
}) {
  const who = actor(req);
  const { result, batchUuid, preview } = await importEmergencyTransactions({
    transactions: opts.transactions,
    importMethod: opts.importMethod,
    importedBy: who.name,
    importedByUserId: who.userId,
    sourceNas: (await getEmergencyNasConfig())?.baseUrl ?? null,
    onlySafe: opts.onlySafe !== false,
    overrides: { assignPatient: opts.assignPatient },
  });
  const createdUuids = preview
    .filter((p) => !p.alreadyImported && p.careBillId)
    .map((p) => ({ emergencyTransactionUuid: p.emergencyTransactionUuid, careBillId: p.careBillId! }));
  const importedRows = await db
    .select({
      uuid: emergencyImportedTransactionsTable.emergencyTransactionUuid,
      careBillId: emergencyImportedTransactionsTable.careBillId,
    })
    .from(emergencyImportedTransactionsTable)
    .where(eq(emergencyImportedTransactionsTable.batchId, (
      await db.select({ id: emergencyReconciliationBatchesTable.id }).from(emergencyReconciliationBatchesTable).where(eq(emergencyReconciliationBatchesTable.batchUuid, batchUuid)).limit(1)
    )[0]?.id ?? 0));
  await markEmergencyNasReconciled({
    uuids: importedRows.filter((r) => r.careBillId).map((r) => ({
      emergencyTransactionUuid: r.uuid,
      careBillId: r.careBillId!,
    })),
  });
  await auditFromRequest(req, {
    userId: who.userId,
    userName: who.name,
    role: req.staffSession?.role ?? "admin",
    action: "emergency_import",
    module: "emergency_billing",
    entityType: "emergency_reconciliation_batch",
    entityId: batchUuid,
    newValue: JSON.stringify(result),
  });
  res.json({ batchUuid, result, preview, createdUuids });
}

emergencyBillingRouter.post("/import-fetched", async (req: StaffAuthRequest, res) => {
  try {
    const payload = await fetchPendingFromEmergencyNas();
    await runImport(req, res, {
      transactions: payload.transactions,
      importMethod: "NAS_API",
      onlySafe: req.body?.onlySafe !== false,
      assignPatient: req.body?.assignPatient,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBillingRouter.post("/import-csv", async (req: StaffAuthRequest, res) => {
  const raw = typeof req.body?.csv === "string" ? req.body.csv : "";
  const parsed = parseEmergencyCsv(raw);
  if (!parsed.transactions.length) {
    res.status(400).json({ error: parsed.errors[0] || "No valid emergency rows", errors: parsed.errors });
    return;
  }
  try {
    await runImport(req, res, {
      transactions: parsed.transactions,
      importMethod: "CSV",
      onlySafe: req.body?.onlySafe !== false,
      assignPatient: req.body?.assignPatient,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBillingRouter.post("/import-json", async (req: StaffAuthRequest, res) => {
  const raw = typeof req.body?.json === "string" ? req.body.json : JSON.stringify(req.body?.package ?? {});
  const parsed = parseEmergencyJson(raw);
  if (!parsed.pkg?.transactions.length) {
    res.status(400).json({ error: parsed.errors[0] || "No valid emergency transactions", errors: parsed.errors });
    return;
  }
  try {
    await runImport(req, res, {
      transactions: parsed.pkg.transactions,
      importMethod: "JSON",
      onlySafe: req.body?.onlySafe !== false,
      assignPatient: req.body?.assignPatient,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

emergencyBillingRouter.post("/resolve-patient", async (req: StaffAuthRequest, res) => {
  const t = req.body?.transaction as EmergencyTransaction | undefined;
  const action = req.body?.action === "create_new" ? "create_new" : req.body?.action === "select_existing" ? "select_existing" : null;
  if (!t?.emergencyTransactionUuid || !t.patient || !action) {
    res.status(400).json({ error: "transaction and action (select_existing | create_new) are required" });
    return;
  }
  const who = actor(req);
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
      resolvedByStaffName: who.name,
      resolvedByStaffId: who.userId,
    });
    await auditFromRequest(req, {
      userId: who.userId,
      userName: who.name,
      role: req.staffSession?.role ?? "admin",
      action: "emergency_patient_resolve",
      module: "emergency_billing",
      entityType: "emergency_transaction",
      entityId: t.emergencyTransactionUuid,
      newValue: JSON.stringify({
        emg: t.emergencyBillNumber,
        resolutionAction: resolution.action,
        carePatientId: resolution.carePatientId,
        carePatientLabel: resolution.carePatientLabel,
        matchClass: decision.matchClass,
      }),
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

emergencyBillingRouter.get("/history", async (_req, res) => {
  const batches = await db
    .select()
    .from(emergencyReconciliationBatchesTable)
    .orderBy(desc(emergencyReconciliationBatchesTable.importedAt))
    .limit(100);
  res.json(batches);
});

emergencyBillingRouter.get("/history/:batchId", async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }
  const [batch] = await db.select().from(emergencyReconciliationBatchesTable).where(eq(emergencyReconciliationBatchesTable.id, id)).limit(1);
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  const txns = await db
    .select()
    .from(emergencyImportedTransactionsTable)
    .where(eq(emergencyImportedTransactionsTable.batchId, id))
    .orderBy(emergencyImportedTransactionsTable.id);
  res.json({ batch, transactions: txns });
});

emergencyBillingRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 3) {
    res.json([]);
    return;
  }
  const pattern = `%${q.toLowerCase()}%`;
  const rows = await db
    .select()
    .from(emergencyImportedTransactionsTable)
    .where(or(
      sql`LOWER(${emergencyImportedTransactionsTable.originalEmgBillNumber}) LIKE ${pattern}`,
      sql`LOWER(${emergencyImportedTransactionsTable.emergencyTransactionUuid}) LIKE ${pattern}`,
    ))
    .orderBy(desc(emergencyImportedTransactionsTable.importedAt))
    .limit(25);
  res.json(rows);
});
