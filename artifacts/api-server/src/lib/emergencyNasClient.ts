import { db, emergencyNasConfigTable, emergencyMasterPushLogTable, pool } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  emergencyMasterSyncIntervalHours,
  type EmergencySessionRecord,
  type EmergencyTransaction,
  type PushInitiator,
} from "@workspace/emergency-billing";
import { buildEmergencyMasterSnapshot } from "./emergencyMasterSnapshot";
import {
  EMERGENCY_MASTER_PUSH_LOCK_KEY,
  emergencyStatusFromState,
  fetchPendingHttp,
  probeEmergencyNas,
  runEmergencyMasterPush,
  type MasterPushLogRow,
  type MasterPushResult,
} from "./emergencyMasterPush";

export async function getEmergencyNasConfig() {
  const [row] = await db.select().from(emergencyNasConfigTable).where(eq(emergencyNasConfigTable.id, 1)).limit(1);
  return row ?? null;
}

export function publicNasConfig(row: typeof emergencyNasConfigTable.$inferSelect | null) {
  if (!row) {
    return { baseUrl: "", fetchTokenSet: false, lastFetchAt: null, lastMasterPushAt: null };
  }
  return {
    baseUrl: row.baseUrl ?? "",
    fetchTokenSet: !!(row.fetchToken || row.fetchTokenSet),
    lastFetchAt: row.lastFetchAt,
    lastMasterPushAt: row.lastMasterPushAt,
  };
}

function resolveNasTarget(cfg: Awaited<ReturnType<typeof getEmergencyNasConfig>>, opts?: { baseUrl?: string; token?: string }) {
  const baseUrl = (opts?.baseUrl || cfg?.baseUrl || process.env.EMERGENCY_NAS_URL || "").replace(/\/+$/, "");
  const token = opts?.token || cfg?.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN || "";
  return { baseUrl, token };
}

async function recordPushLog(row: MasterPushLogRow) {
  await db.insert(emergencyMasterPushLogTable).values({
    pushedAt: row.pushedAt ?? new Date(),
    initiatedBy: row.initiatedBy,
    userName: row.userName,
    userId: row.userId,
    targetUrl: row.targetUrl,
    snapshotFormat: row.snapshotFormat,
    snapshotVersion: row.snapshotVersion,
    serviceCount: row.serviceCount,
    doctorCount: row.doctorCount,
    patientCount: row.patientCount,
    staffCount: row.staffCount,
    success: row.success,
    errorMessage: row.errorMessage,
  });
}

function livePushDeps() {
  return {
    getConfig: async () => {
      const cfg = await getEmergencyNasConfig();
      const { baseUrl, token } = resolveNasTarget(cfg);
      if (!baseUrl) throw new Error("Emergency NAS URL is not configured");
      if (!token) throw new Error("Emergency NAS fetch token is not configured");
      return { baseUrl, token };
    },
    lastSuccessAt: async () => {
      const cfg = await getEmergencyNasConfig();
      return cfg?.lastMasterPushAt ?? null;
    },
    buildSnapshot: () => buildEmergencyMasterSnapshot(),
    fetchImpl: fetch,
    recordLog: recordPushLog,
    markLastSuccess: async (at: Date, updatedBy: string) => {
      const existing = await getEmergencyNasConfig();
      if (existing) {
        await db.update(emergencyNasConfigTable).set({ lastMasterPushAt: at, updatedBy }).where(eq(emergencyNasConfigTable.id, 1));
      } else {
        await db.insert(emergencyNasConfigTable).values({ id: 1, lastMasterPushAt: at, updatedBy });
      }
    },
    tryLock: async () => true,
    intervalHours: emergencyMasterSyncIntervalHours(),
  };
}

/**
 * Session-level advisory lock around a scheduled push so two CARE API/worker
 * processes cannot both push. Manual pushes do not take this lock (the push
 * itself is idempotent).
 */
async function withSchedulerLock<T>(fn: (locked: boolean) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [EMERGENCY_MASTER_PUSH_LOCK_KEY],
    );
    const locked = !!r.rows[0]?.locked;
    try {
      return await fn(locked);
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [EMERGENCY_MASTER_PUSH_LOCK_KEY]);
      }
    }
  } finally {
    client.release();
  }
}

export async function fetchPendingFromEmergencyNas(opts?: {
  baseUrl?: string;
  token?: string;
}): Promise<{
  sessions: EmergencySessionRecord[];
  transactions: EmergencyTransaction[];
  masterDataLastSyncedAt: string | null;
}> {
  const cfg = await getEmergencyNasConfig();
  const { baseUrl, token } = resolveNasTarget(cfg, opts);
  if (!baseUrl) throw new Error("Emergency NAS URL is not configured");
  if (!token) throw new Error("Emergency NAS fetch token is not configured");
  return fetchPendingHttp({ baseUrl, token });
}

export async function pushMasterToEmergencyNas(opts: {
  initiatedBy: PushInitiator;
  userName: string;
  userId?: number | null;
  respectInterval?: boolean;
  requireLock?: boolean;
}): Promise<MasterPushResult> {
  const deps = livePushDeps();
  if (opts.requireLock) {
    return withSchedulerLock(async (locked) => {
      if (!locked) return { ok: true as const, skipped: true as const, reason: "lock" as const };
      return runEmergencyMasterPush(
        {
          initiatedBy: opts.initiatedBy,
          userName: opts.userName,
          userId: opts.userId ?? null,
          respectInterval: opts.respectInterval,
          requireLock: false,
        },
        deps,
      );
    });
  }
  return runEmergencyMasterPush(
    {
      initiatedBy: opts.initiatedBy,
      userName: opts.userName,
      userId: opts.userId ?? null,
      respectInterval: opts.respectInterval,
      requireLock: false,
    },
    deps,
  );
}

export async function pushEmergencyMasterIfConfigured(updatedBy: string): Promise<MasterPushResult> {
  return pushMasterToEmergencyNas({
    initiatedBy: "SCHEDULER",
    userName: updatedBy,
    respectInterval: true,
    requireLock: true,
  });
}

export async function getEmergencyBillingStatus() {
  const cfg = await getEmergencyNasConfig();
  const { baseUrl, token } = resolveNasTarget(cfg);
  const configured = !!(baseUrl && token);
  const nasStatus = configured ? await probeEmergencyNas(baseUrl) : "OFFLINE";
  const [lastOk] = await db
    .select()
    .from(emergencyMasterPushLogTable)
    .where(eq(emergencyMasterPushLogTable.success, true))
    .orderBy(desc(emergencyMasterPushLogTable.pushedAt))
    .limit(1);
  const [lastFail] = await db
    .select()
    .from(emergencyMasterPushLogTable)
    .where(eq(emergencyMasterPushLogTable.success, false))
    .orderBy(desc(emergencyMasterPushLogTable.pushedAt))
    .limit(1);
  const lastSuccessfulPushAt = lastOk?.pushedAt ?? cfg?.lastMasterPushAt ?? null;
  return emergencyStatusFromState({
    configured,
    nasStatus,
    lastSuccessfulPushAt,
    counts: lastOk
      ? {
          serviceCount: lastOk.serviceCount ?? 0,
          doctorCount: lastOk.doctorCount ?? 0,
          patientCount: lastOk.patientCount ?? 0,
          staffCount: lastOk.staffCount ?? 0,
        }
      : null,
    lastFailure: lastFail
      ? {
          at: lastFail.pushedAt.toISOString(),
          error: lastFail.errorMessage || "Push failed",
          initiatedBy: lastFail.initiatedBy,
        }
      : null,
  });
}

export async function listEmergencyMasterPushLog(limit = 50) {
  return db
    .select()
    .from(emergencyMasterPushLogTable)
    .orderBy(desc(emergencyMasterPushLogTable.pushedAt))
    .limit(limit);
}

export async function markEmergencyNasReconciled(opts: {
  uuids: Array<{ emergencyTransactionUuid: string; careBillId: number }>;
}): Promise<void> {
  const cfg = await getEmergencyNasConfig();
  const { baseUrl, token } = resolveNasTarget(cfg);
  if (!baseUrl || !token || opts.uuids.length === 0) return;
  await fetch(`${baseUrl}/api/internal/mark-reconciled`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Emergency-Fetch-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: opts.uuids }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => console.warn("[emergency-billing] mark-reconciled on NAS failed", err));
}
