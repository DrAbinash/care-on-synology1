import { db, emergencyNasConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { EmergencyJsonPackage, EmergencySessionRecord, EmergencyTransaction, MasterDataSnapshot } from "@workspace/emergency-billing";
import { JSON_FORMAT, parseEmergencyJson } from "@workspace/emergency-billing";
import { buildEmergencyMasterSnapshot } from "./emergencyMasterSnapshot";

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

function nasHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Emergency-Fetch-Token": token,
    Accept: "application/json",
  };
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
  const baseUrl = (opts?.baseUrl || cfg?.baseUrl || process.env.EMERGENCY_NAS_URL || "").replace(/\/+$/, "");
  const token = opts?.token || cfg?.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN || "";
  if (!baseUrl) throw new Error("Emergency NAS URL is not configured");
  if (!token) throw new Error("Emergency NAS fetch token is not configured");

  const res = await fetch(`${baseUrl}/api/internal/pending`, {
    headers: nasHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Emergency NAS returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as EmergencyJsonPackage & { transactions?: EmergencyTransaction[] };
  if (body.format && body.format !== JSON_FORMAT) {
    throw new Error(`Unexpected emergency payload format ${String(body.format)}`);
  }
  const parsed = parseEmergencyJson(JSON.stringify({
    format: JSON_FORMAT,
    version: 1,
    exportedAt: body.exportedAt ?? new Date().toISOString(),
    masterDataLastSyncedAt: body.masterDataLastSyncedAt ?? null,
    sessions: body.sessions ?? [],
    transactions: body.transactions ?? [],
    checksumSha256: body.checksumSha256 ?? "",
  }));
  return {
    sessions: parsed.pkg?.sessions ?? [],
    transactions: parsed.pkg?.transactions ?? [],
    masterDataLastSyncedAt: parsed.pkg?.masterDataLastSyncedAt ?? null,
  };
}

export async function pushMasterToEmergencyNas(updatedBy: string): Promise<{ ok: true; syncedAt: string; serviceCount: number }> {
  const cfg = await getEmergencyNasConfig();
  const baseUrl = (cfg?.baseUrl || process.env.EMERGENCY_NAS_URL || "").replace(/\/+$/, "");
  const token = cfg?.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN || "";
  if (!baseUrl) throw new Error("Emergency NAS URL is not configured");
  if (!token) throw new Error("Emergency NAS fetch token is not configured");
  const snapshot: MasterDataSnapshot = await buildEmergencyMasterSnapshot();
  const res = await fetch(`${baseUrl}/api/internal/master-sync`, {
    method: "POST",
    headers: { ...nasHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Master sync failed HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  await db
    .update(emergencyNasConfigTable)
    .set({ lastMasterPushAt: new Date(), updatedBy })
    .where(eq(emergencyNasConfigTable.id, 1));
  return { ok: true, syncedAt: snapshot.syncedAt, serviceCount: snapshot.services.length };
}

export async function pushEmergencyMasterIfConfigured(updatedBy: string): Promise<void> {
  const cfg = await getEmergencyNasConfig();
  if (!cfg?.baseUrl || !(cfg.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN)) return;
  await pushMasterToEmergencyNas(updatedBy);
}

export async function markEmergencyNasReconciled(opts: {
  uuids: Array<{ emergencyTransactionUuid: string; careBillId: number }>;
}): Promise<void> {
  const cfg = await getEmergencyNasConfig();
  const baseUrl = (cfg?.baseUrl || process.env.EMERGENCY_NAS_URL || "").replace(/\/+$/, "");
  const token = cfg?.fetchToken || process.env.EMERGENCY_NAS_FETCH_TOKEN || "";
  if (!baseUrl || !token || opts.uuids.length === 0) return;
  await fetch(`${baseUrl}/api/internal/mark-reconciled`, {
    method: "POST",
    headers: { ...nasHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ items: opts.uuids }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => console.warn("[emergency-billing] mark-reconciled on NAS failed", err));
}
