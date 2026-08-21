import type { EmergencyTransaction } from "./types";
import { summarizeTransactions } from "./money";

export const EMERGENCY_SYNC_SUMMARY_FORMAT = "CARE_EMERGENCY_SYNC_SUMMARY_V1" as const;

/** Selectable window for the emergency-side reconciliation summary (not CARE's import preview). */
export const EMERGENCY_SYNC_SUMMARY_SCOPES = ["today", "session", "all"] as const;
export type EmergencySyncSummaryScope = (typeof EMERGENCY_SYNC_SUMMARY_SCOPES)[number];

export type EmergencyHandoffChannel = "LAN_PUSH" | "USB" | "CSV" | "JSON";

export interface EmergencyHandoffInfo {
  channel: EmergencyHandoffChannel;
  at: string;
  created?: number;
  alreadyReconciled?: number;
  conflicts?: number;
  failures?: number;
  batchUuid?: string | null;
}

export type EmergencySyncSummaryRow = EmergencyTransaction & {
  /** Local emergency sync pipeline status (pending|synced|conflict|failed|void). */
  syncStatus?: string | null;
};

export interface EmergencySyncSummary {
  format: typeof EMERGENCY_SYNC_SUMMARY_FORMAT;
  /** today (default) | open session | all local bills */
  scope: EmergencySyncSummaryScope;
  scopeLabel: string;
  /** Asia/Kolkata YYYY-MM-DD when scope=today */
  dayKeyIst: string | null;
  sessionUuid: string | null;
  generatedAt: string;
  /** true when embedded in USB/export package as a frozen receipt */
  frozen: boolean;
  bills: number;
  voided: number;
  pending: number;
  synced: number;
  conflict: number;
  failed: number;
  gross: number;
  discount: number;
  net: number;
  collected: number;
  due: number;
  cash: number;
  upi: number;
  card: number;
  lastHandoff: EmergencyHandoffInfo | null;
  openSession: boolean;
}

export function parseEmergencySyncSummaryScope(raw: unknown): EmergencySyncSummaryScope {
  const s = String(raw ?? "today").toLowerCase();
  if (s === "session" || s === "all") return s;
  return "today";
}

/** Asia/Kolkata calendar-day bounds as UTC instants. */
export function clinicDayBoundsIst(anchor: Date | string = new Date()): {
  dayKey: string;
  startUtc: Date;
  endUtc: Date;
} {
  const at = typeof anchor === "string" ? new Date(anchor) : anchor;
  const safe = Number.isFinite(at.getTime()) ? at : new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = fmt.format(safe);
  const startUtc = new Date(`${dayKey}T00:00:00+05:30`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { dayKey, startUtc, endUtc };
}

function syncBucket(row: EmergencySyncSummaryRow): "void" | "synced" | "conflict" | "failed" | "pending" {
  if (row.status === "VOID") return "void";
  const s = String(row.syncStatus || "").toLowerCase();
  if (row.status === "RECONCILED" || s === "synced") return "synced";
  if (s === "conflict") return "conflict";
  if (s === "failed") return "failed";
  return "pending";
}

function scopeLabel(scope: EmergencySyncSummaryScope, dayKey: string | null): string {
  if (scope === "session") return "Open emergency session";
  if (scope === "all") return "All emergency bills on this device";
  return dayKey ? `Today (${dayKey} IST)` : "Today (IST)";
}

/**
 * Build the emergency-device reconciliation summary (Windows / DS225 / USB).
 * Separate from CARE Settings → Emergency Billing import preview summary.
 */
export function buildEmergencySyncSummary(opts: {
  rows: EmergencySyncSummaryRow[];
  scope?: EmergencySyncSummaryScope;
  /** Required for scope=session (open session uuid). */
  sessionUuid?: string | null;
  openSession?: boolean;
  lastHandoff?: EmergencyHandoffInfo | null;
  frozen?: boolean;
  generatedAt?: string;
  /** Anchor clock for "today" (tests). Default now. */
  now?: Date | string;
}): EmergencySyncSummary {
  const scope = opts.scope ?? "today";
  const now = opts.now ?? new Date();
  const { dayKey, startUtc, endUtc } = clinicDayBoundsIst(now);
  const sessionUuid = opts.sessionUuid ?? null;

  let filtered = opts.rows;
  if (scope === "today") {
    filtered = opts.rows.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= startUtc.getTime() && t < endUtc.getTime();
    });
  } else if (scope === "session") {
    filtered = sessionUuid
      ? opts.rows.filter((r) => r.emergencySessionUuid === sessionUuid)
      : [];
  }

  const money = summarizeTransactions(filtered);
  let voided = 0;
  let pending = 0;
  let synced = 0;
  let conflict = 0;
  let failed = 0;
  for (const r of filtered) {
    const b = syncBucket(r);
    if (b === "void") voided += 1;
    else if (b === "synced") synced += 1;
    else if (b === "conflict") conflict += 1;
    else if (b === "failed") failed += 1;
    else pending += 1;
  }

  return {
    format: EMERGENCY_SYNC_SUMMARY_FORMAT,
    scope,
    scopeLabel: scopeLabel(scope, scope === "today" ? dayKey : null),
    dayKeyIst: scope === "today" ? dayKey : null,
    sessionUuid: scope === "session" ? sessionUuid : null,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    frozen: !!opts.frozen,
    bills: money.bills,
    voided,
    pending,
    synced,
    conflict,
    failed,
    gross: money.gross,
    discount: money.discount,
    net: money.net,
    collected: money.collected,
    due: money.due,
    cash: money.cash,
    upi: money.upi,
    card: money.card,
    lastHandoff: opts.lastHandoff ?? null,
    openSession: !!opts.openSession,
  };
}
