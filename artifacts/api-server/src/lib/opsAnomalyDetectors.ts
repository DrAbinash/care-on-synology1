// Pure, DB-free threshold detectors for the operational-health cockpit.
// The cron/route layer gathers live metric values (DB reads) and feeds them
// here; this module decides whether each metric warrants an anomaly_alerts row
// and at what severity. Unit-tested. No I/O.

export type Severity = "low" | "medium" | "high" | "critical";

export interface AlertCandidate {
  alertType: string;
  severity: Severity;
  message: string;
  scope: string;
}

export interface MetricThreshold {
  alertType: string;   // e.g. BACKLOG_SPIKE (reuses the documented anomaly_alerts types)
  scope: string;       // e.g. "reports"
  label: string;       // human label for the message
  value: number;       // observed value
  warnAt: number;      // value >= warnAt → high
  critAt: number;      // value >= critAt → critical
  unit?: string;
}

/** Map an observed value to a severity, or null when it's within normal range. */
export function severityForValue(value: number, warnAt: number, critAt: number): Severity | null {
  if (!Number.isFinite(value)) return null;
  if (value >= critAt) return "critical";
  if (value >= warnAt) return "high";
  return null;
}

/** Turn one metric+threshold into an alert candidate (or null when healthy). */
export function evaluateMetric(m: MetricThreshold): AlertCandidate | null {
  const sev = severityForValue(m.value, m.warnAt, m.critAt);
  if (!sev) return null;
  const u = m.unit ? ` ${m.unit}` : "";
  return {
    alertType: m.alertType,
    severity: sev,
    scope: m.scope,
    message: `${m.label}: ${m.value}${u} (alert threshold ${m.warnAt}${u}, critical ${m.critAt}${u})`,
  };
}

/** Evaluate a batch of metrics, dropping the healthy ones. */
export function evaluateMetrics(metrics: MetricThreshold[]): AlertCandidate[] {
  return metrics.map(evaluateMetric).filter((c): c is AlertCandidate => c !== null);
}

/** Default thresholds for the metrics the cockpit scans. Tunable in one place. */
export const DEFAULT_OPS_THRESHOLDS = {
  pendingReports: { alertType: "BACKLOG_SPIKE", scope: "reports", label: "Pending reports", warnAt: 50, critAt: 120, unit: "reports" },
  deliveryFailures: { alertType: "DELIVERY_FAILURE_SPIKE", scope: "report_delivery", label: "WhatsApp delivery failures today", warnAt: 10, critAt: 30, unit: "failures" },
  overdueRecalls: { alertType: "RECALL_BACKLOG", scope: "recall", label: "Overdue recalls pending", warnAt: 40, critAt: 100, unit: "recalls" },
  // Production reliability (I12-G). A dead letter and a stale backup are invisible to
  // the three clinical metrics above, and both mean "something stopped working quietly".
  deadLetters: { alertType: "INTEGRATION_DEAD_LETTER", scope: "integration", label: "Dead-lettered integration events", warnAt: 1, critAt: 10, unit: "events" },
  outboxStalled: { alertType: "INTEGRATION_OUTBOX_STALLED", scope: "integration", label: "Oldest unsent integration event", warnAt: 6, critAt: 24, unit: "h past its due time" },
  backupAge: { alertType: "BACKUP_STALE", scope: "backup", label: "Age of the last recorded successful backup", warnAt: 26, critAt: 48, unit: "h" },
} as const;

/**
 * Hours elapsed since `since`, clamped at 0, or `null` when there is no timestamp
 * at all. `null` is kept distinct from `0` on purpose: "this has never happened" and
 * "this happened now" are different claims, and a dashboard that can confuse them
 * will eventually report a backup that does not exist as hours-old-and-fine.
 */
export function hoursSince(since: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (since === null || since === undefined || since === "") return null;
  const t = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

/**
 * A reading that could not be taken. The threshold path above deliberately treats a
 * non-finite value as "no data, do not page anyone" — that is an existing, tested
 * contract — so a scan that measured nothing must say so through here instead of
 * passing NaN and hoping it disappears quietly.
 */
export function evaluateUnmeasured(m: { alertType: string; scope: string; label: string; reason: string }): AlertCandidate {
  return {
    alertType: m.alertType,
    severity: "critical",
    scope: m.scope,
    message: `${m.label}: could not be measured (${m.reason}) — not assumed healthy`,
  };
}

/** The reliability readings, as gathered from the database (null = not measured). */
export interface ReliabilityReadings {
  deadLetters: number | null;
  outboxStalledHours: number | null;
  backupAgeHours: number | null;
}

/**
 * Turn reliability readings into alert candidates. Split from the gathering so the
 * part that decides "unmeasured is not healthy" is testable without a database.
 */
export function reliabilityCandidates(r: ReliabilityReadings): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const rows: Array<[keyof ReliabilityReadings, { alertType: string; scope: string; label: string; warnAt: number; critAt: number; unit?: string }, string]> = [
    ["deadLetters", DEFAULT_OPS_THRESHOLDS.deadLetters, "the dead-letter count could not be read"],
    ["outboxStalledHours", DEFAULT_OPS_THRESHOLDS.outboxStalled, "no due integration event has ever been observed — if events are queued and never sent, nothing here proves they are moving"],
    ["backupAgeHours", DEFAULT_OPS_THRESHOLDS.backupAge, "no successful backup is recorded in backup_logs"],
  ];
  for (const [field, threshold, reason] of rows) {
    const value = r[field];
    if (value === null) {
      // An empty outbox legitimately has nothing waiting, so "stalled" is 0 and
      // healthy — only the two readings that must always exist alert when absent.
      if (field === "outboxStalledHours") continue;
      out.push(evaluateUnmeasured({ alertType: threshold.alertType, scope: threshold.scope, label: threshold.label, reason }));
      continue;
    }
    const c = evaluateMetric({ ...threshold, value });
    if (c) out.push(c);
  }
  return out;
}

