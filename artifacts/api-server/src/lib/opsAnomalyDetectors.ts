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
} as const;
