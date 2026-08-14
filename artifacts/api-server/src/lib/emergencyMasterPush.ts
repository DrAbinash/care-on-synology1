import {
  MASTER_FORMAT,
  countsFromSnapshot,
  emergencyMasterSyncIntervalHours,
  parseEmergencyJson,
  shouldSkipScheduledPush,
  snapshotAgeBand,
  snapshotAgeHours,
  type MasterDataSnapshot,
  type MasterPushCounts,
  type PushInitiator,
  type SnapshotAgeBand,
  JSON_FORMAT,
  type EmergencyJsonPackage,
  type EmergencySessionRecord,
  type EmergencyTransaction,
} from "@workspace/emergency-billing";

export const EMERGENCY_MASTER_PUSH_LOCK_KEY = "care_erp_emergency_master_push";

export function nasHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Emergency-Fetch-Token": token,
    Accept: "application/json",
  };
}

export async function probeEmergencyNas(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"ONLINE" | "OFFLINE"> {
  const url = baseUrl.replace(/\/+$/, "");
  if (!url) return "OFFLINE";
  try {
    const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(4_000) });
    return res.ok ? "ONLINE" : "OFFLINE";
  } catch {
    return "OFFLINE";
  }
}

export async function postMasterSnapshotHttp(opts: {
  baseUrl: string;
  token: string;
  snapshot: MasterDataSnapshot;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string; httpStatus?: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/internal/master-sync`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { ...nasHeaders(opts.token), "Content-Type": "application/json" },
      body: JSON.stringify(opts.snapshot),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, httpStatus: res.status, error: `Master sync failed HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPendingHttp(opts: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  sessions: EmergencySessionRecord[];
  transactions: EmergencyTransaction[];
  masterDataLastSyncedAt: string | null;
}> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.baseUrl.replace(/\/+$/, "")}/api/internal/pending`, {
    headers: nasHeaders(opts.token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Emergency NAS returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as EmergencyJsonPackage & { transactions?: EmergencyTransaction[] };
  if (body.format && body.format !== JSON_FORMAT) {
    throw new Error(`Unsupported emergency payload format ${String(body.format)}. Expected ${JSON_FORMAT}.`);
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
  if (!parsed.pkg && parsed.errors.length) {
    throw new Error(parsed.errors[0]);
  }
  return {
    sessions: parsed.pkg?.sessions ?? [],
    transactions: parsed.pkg?.transactions ?? [],
    masterDataLastSyncedAt: parsed.pkg?.masterDataLastSyncedAt ?? null,
  };
}

export type MasterPushLogRow = {
  initiatedBy: PushInitiator;
  userName: string | null;
  userId: number | null;
  targetUrl: string | null;
  snapshotFormat: string | null;
  snapshotVersion: number | null;
  serviceCount: number | null;
  doctorCount: number | null;
  patientCount: number | null;
  staffCount: number | null;
  success: boolean;
  errorMessage: string | null;
  pushedAt?: Date;
};

export type MasterPushDeps = {
  getConfig: () => Promise<{ baseUrl: string; token: string }>;
  lastSuccessAt: () => Promise<Date | null>;
  buildSnapshot: () => Promise<MasterDataSnapshot>;
  fetchImpl: typeof fetch;
  recordLog: (row: MasterPushLogRow) => Promise<void>;
  markLastSuccess: (at: Date, updatedBy: string) => Promise<void>;
  tryLock: () => Promise<boolean>;
  now?: Date;
  intervalHours?: number;
};

export type MasterPushResult =
  | ({ ok: true; skipped?: false; syncedAt: string; targetUrl: string } & MasterPushCounts)
  | { ok: true; skipped: true; reason: "lock" | "interval" | "not_configured" }
  | { ok: false; error: string; targetUrl?: string };

export async function runEmergencyMasterPush(
  opts: {
    initiatedBy: PushInitiator;
    userName: string;
    userId: number | null;
    respectInterval?: boolean;
    requireLock?: boolean;
  },
  deps: MasterPushDeps,
): Promise<MasterPushResult> {
  const now = deps.now ?? new Date();
  if (opts.requireLock) {
    const locked = await deps.tryLock();
    if (!locked) return { ok: true, skipped: true, reason: "lock" };
  }

  let cfg: { baseUrl: string; token: string };
  try {
    cfg = await deps.getConfig();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!cfg.baseUrl || !cfg.token) {
    return { ok: true, skipped: true, reason: "not_configured" };
  }

  if (opts.respectInterval) {
    const last = await deps.lastSuccessAt();
    const hours = deps.intervalHours ?? emergencyMasterSyncIntervalHours();
    if (shouldSkipScheduledPush(last, hours, now)) {
      return { ok: true, skipped: true, reason: "interval" };
    }
  }

  const snapshot = await deps.buildSnapshot();
  const counts = countsFromSnapshot(snapshot);
  const posted = await postMasterSnapshotHttp({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    snapshot,
    fetchImpl: deps.fetchImpl,
  });

  const log: MasterPushLogRow = {
    initiatedBy: opts.initiatedBy,
    userName: opts.userName,
    userId: opts.userId,
    targetUrl: cfg.baseUrl,
    snapshotFormat: snapshot.format ?? MASTER_FORMAT,
    snapshotVersion: snapshot.version ?? 1,
    ...counts,
    success: posted.ok,
    errorMessage: posted.ok ? null : posted.error,
    pushedAt: now,
  };
  await deps.recordLog(log);

  if (!posted.ok) {
    return { ok: false, error: posted.error, targetUrl: cfg.baseUrl };
  }

  await deps.markLastSuccess(now, opts.userName);
  return { ok: true, syncedAt: snapshot.syncedAt, targetUrl: cfg.baseUrl, ...counts };
}

export function emergencyStatusFromState(opts: {
  configured: boolean;
  nasStatus: "ONLINE" | "OFFLINE";
  lastSuccessfulPushAt: Date | string | null;
  counts: MasterPushCounts | null;
  lastFailure: { at: string; error: string; initiatedBy: string } | null;
  now?: Date;
  syncIntervalHours?: number;
}): {
  nasStatus: "ONLINE" | "OFFLINE";
  configured: boolean;
  neverSynced: boolean;
  lastSuccessfulPushAt: string | null;
  snapshotAgeHours: number | null;
  ageBand: SnapshotAgeBand;
  counts: MasterPushCounts | null;
  lastFailure: { at: string; error: string; initiatedBy: string } | null;
  syncIntervalHours: number;
} {
  const last = opts.lastSuccessfulPushAt
    ? (typeof opts.lastSuccessfulPushAt === "string" ? opts.lastSuccessfulPushAt : opts.lastSuccessfulPushAt.toISOString())
    : null;
  return {
    nasStatus: opts.nasStatus,
    configured: opts.configured,
    neverSynced: !last,
    lastSuccessfulPushAt: last,
    snapshotAgeHours: snapshotAgeHours(last, opts.now),
    ageBand: snapshotAgeBand(last, opts.now),
    counts: opts.counts,
    lastFailure: opts.lastFailure,
    syncIntervalHours: opts.syncIntervalHours ?? emergencyMasterSyncIntervalHours(),
  };
}
