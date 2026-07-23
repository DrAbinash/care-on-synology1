import { Router } from "express";
import { db, syncQueueTable, syncCheckpointTable, patientsTable, ordersTable, billsTable, paymentsTable } from "@workspace/db";
import { eq, and, gte, desc, sql, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

// NOTE on offline billing specifically: bills created while the NAS is
// unreachable do NOT flow through this router's /push + applyChangeToCloud.
// They queue client-side (diagnostic-erp/src/lib/offlineBillingQueue.ts) and
// replay directly against the real POST /api/orders and POST /api/bills
// routes, reusing the clientRef-based idempotency those already implement
// for exactly this "retry after a network drop" case. Routing bills through
// the generic apply-by-tableName path below would mean re-deriving VIP
// surcharge, discount, Form-F, and token-allocation logic a second time in a
// place that isn't the single source of truth for it — so applyChangeToCloud
// stays a stub for "orders"/"bills" on purpose, not by oversight.

export const syncRouter = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────
const PushBody = z.object({
  clinicId: z.string().min(1),
  changes: z.array(z.object({
    action: z.enum(["create", "update", "delete"]),
    tableName: z.string(),
    localId: z.number().optional(),
    cloudId: z.number().optional(),
    payload: z.record(z.any()).optional(),
    conflictStrategy: z.enum(["server_wins", "local_wins", "merge"]).default("server_wins"),
    createdAt: z.string().optional(),
  })),
});

const PullBody = z.object({
  clinicId: z.string().min(1),
  checkpoints: z.record(z.string().optional()), // tableName → lastPulledAt ISO
});

// ─── PUSH: receive offline changes from a clinic → apply to cloud DB ─────────
syncRouter.post("/push", async (req, res) => {
  const parsed = PushBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const { clinicId, changes } = parsed.data;
  const results: Array<{ localId?: number; cloudId?: number; status: "ok" | "conflict" | "error"; message?: string }> = [];

  for (const change of changes) {
    try {
      // For MVP: only handle patients, orders, bills, payments
      // Real implementation would use a generic upsert helper per table
      const result = await applyChangeToCloud(change, clinicId);
      results.push(result);
    } catch (err) {
      results.push({ localId: change.localId, status: "error", message: String((err as Error).message) });
    }
  }

  res.json({ ok: true, applied: results.filter((r) => r.status === "ok").length, conflicts: results.filter((r) => r.status === "conflict").length, results });
});

// ─── PULL: send cloud changes since client's last checkpoint ──────────────────
syncRouter.post("/pull", async (req, res) => {
  const parsed = PullBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const { clinicId, checkpoints } = parsed.data;
  const pulled: Record<string, unknown[]> = {};

  // For MVP: only pull patients modified since last checkpoint
  const patientCheckpoint = checkpoints["patients"];
  if (patientCheckpoint) {
    const checkpointDate = new Date(patientCheckpoint);
    const rows = await db
      .select()
      .from(patientsTable)
      .where(and(
        gte(patientsTable.createdAt, checkpointDate),
        sql`${patientsTable.updatedAt} IS NOT NULL AND ${patientsTable.updatedAt} >= ${checkpointDate}`
      ))
      .orderBy(desc(patientsTable.updatedAt))
      .limit(100);
    pulled["patients"] = rows;
  }

  // Return updated checkpoint timestamps
  const nowIso = new Date().toISOString();
  const newCheckpoints: Record<string, string> = {};
  for (const table of Object.keys(checkpoints)) {
    newCheckpoints[table] = nowIso;
  }

  res.json({ ok: true, pulled, checkpoints: newCheckpoints });
});

// ─── STATUS: lightweight read ────────────────────────────────────────────
syncRouter.get("/status", async (_req, res) => {
  try {
    const pending = await db.select({ count: sql<number>`count(*)` }).from(syncQueueTable).where(eq(syncQueueTable.isSynced, false));
    const checkpoint = await db.select().from(syncCheckpointTable).limit(1);
    res.json({
      pending: Number(pending[0]?.count ?? 0),
      lastSyncedAt: checkpoint[0]?.lastPulledAt ?? null,
      error: null,
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─── TRIGGER: manual sync request from client ────────────────────────────
syncRouter.post("/trigger", async (_req, res) => {
  res.json({ ok: true, message: "Sync acknowledged. In desktop/offline mode the local engine will process queued changes." });
});

// ─── SEED: download full table snapshots for initial offline setup ───────────────────────────────────────────────────────
const SEED_TABLES = [
  "users", "patients", "doctors", "diagnostic_tests", "test_packages",
  "discount_reasons", "clinic_settings", "printers", "departments", "floors", "rooms",
] as const;

syncRouter.get("/seed", async (req, res) => {
  const table = req.query["table"];
  if (!table || typeof table !== "string" || !SEED_TABLES.includes(table as typeof SEED_TABLES[number])) {
    res.status(400).json({ error: "Invalid table", allowed: SEED_TABLES });
    return;
  }
  try {
    // MVP stub — returns empty rows for all tables.
    // Real implementation: import each Drizzle table and run db.select().from(table)
    const rows: unknown[] = [];
    res.json({ ok: true, table, rows });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─── HELPER: apply one change to the cloud DB ──────────────────────────────
async function applyChangeToCloud(
  change: z.infer<typeof PushBody>["changes"][number],
  _clinicId: string,
): Promise<{ localId?: number; cloudId?: number; status: "ok" | "conflict" | "error"; message?: string }> {
  // No table has real per-table upsert logic wired in here yet (see the
  // NOTE above the router for why "orders"/"bills" are deliberately staying
  // out of this generic path rather than getting one). Reporting "ok" for a
  // change nothing actually persisted would be silent data loss for whatever
  // eventually does call POST /push — fail loudly instead until a table is
  // genuinely implemented.
  return { localId: change.localId, status: "error", message: `Not implemented for table "${change.tableName}"` };
}
