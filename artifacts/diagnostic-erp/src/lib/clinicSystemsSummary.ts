/**
 * Compact Clinic Systems rows for My Daily Summary.
 * Extends the existing owner pulse strip — not a second daily-summary system.
 */
import type { PulseTone } from "./infrastructurePulse";

export type OpsCheckStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN";

export interface ClinicOpsCheck {
  id: string;
  status: OpsCheckStatus;
  message: string;
}

export interface EmergencyStatusLike {
  nasStatus: "ONLINE" | "OFFLINE";
  configured: boolean;
  neverSynced: boolean;
  lastSuccessfulPushAt: string | null;
  snapshotAgeHours: number | null;
  ageBand: "never" | "fresh" | "warning" | "stale";
  contract?: {
    status: "COMPATIBLE" | "MISMATCH" | "UNAVAILABLE";
    careExpected: string;
    remoteSupported: string[];
    remotePrimary: string | null;
  };
  lastSuccessfulFetchAt?: string | null;
  lastSuccessfulReconciliationAt?: string | null;
  pendingEmergencyBills?: number | null;
  openEmergencySessions?: number | null;
  failedImportCount24h?: number;
}

export interface ClinicSystemsRow {
  key: string;
  label: string;
  value: string;
  tone: PulseTone;
}

export interface ClinicSystemsAlert {
  id: string;
  severity: "red" | "amber";
  message: string;
}

export interface ClinicSystemsSection {
  title: string;
  rows: ClinicSystemsRow[];
}

function checkById(checks: ClinicOpsCheck[], id: string): ClinicOpsCheck | undefined {
  return checks.find((c) => c.id === id);
}

function erpTone(status: OpsCheckStatus | undefined): PulseTone {
  if (!status || status === "SKIPPED") return "grey";
  if (status === "PASS") return "green";
  if (status === "FAIL") return "red";
  return "amber";
}

function erpValue(check: ClinicOpsCheck | undefined, okLabel: string, failLabel: string): string {
  if (!check || check.status === "SKIPPED") return "Not available";
  if (check.status === "PASS") return `✓ ${okLabel}`;
  if (check.status === "FAIL") return failLabel;
  return check.message || "Not available";
}

function ageShort(hours: number | null | undefined): string {
  if (hours == null) return "never";
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m ago`;
  }
  if (hours < 48) {
    const h = Math.round(hours * 10) / 10;
    return `${h}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function backupRow(check: ClinicOpsCheck | undefined, key: string, label: string): ClinicSystemsRow {
  if (!check || check.status === "SKIPPED" || check.status === "UNKNOWN") {
    return { key, label, value: "status unavailable", tone: "grey" };
  }
  if (check.status === "PASS") {
    return { key, label, value: "✓ latest", tone: "green" };
  }
  if (check.status === "FAIL") {
    return { key, label, value: check.message || "unhealthy", tone: "red" };
  }
  return { key, label, value: check.message || "warning", tone: "amber" };
}

export function buildClinicSystemsSummary(opts: {
  checks: ClinicOpsCheck[];
  emergency: EmergencyStatusLike | null;
}): { sections: ClinicSystemsSection[]; alerts: ClinicSystemsAlert[]; degraded: boolean } {
  const erp = checkById(opts.checks, "app.responding");
  const db = checkById(opts.checks, "db.connect");
  const backup = checkById(opts.checks, "backup.age");
  const em = opts.emergency;

  const careRows: ClinicSystemsRow[] = [
    {
      key: "care-erp",
      label: "CARE ERP",
      value: erpValue(erp, "ONLINE", "UNHEALTHY"),
      tone: erpTone(erp?.status),
    },
    {
      key: "care-db",
      label: "CARE DB",
      value: erpValue(db, "HEALTHY", "UNHEALTHY"),
      tone: erpTone(db?.status),
    },
  ];

  const emergencyRows: ClinicSystemsRow[] = [];
  if (!em || !em.configured) {
    emergencyRows.push(
      { key: "ds225", label: "DS225 Emergency", value: "not configured", tone: "grey" },
      { key: "contract", label: "Contract", value: "—", tone: "grey" },
      { key: "master", label: "Master Sync", value: "never", tone: "grey" },
      { key: "pending", label: "Pending EMG Bills", value: "—", tone: "grey" },
      { key: "open", label: "Open EMG Sessions", value: "—", tone: "grey" },
    );
  } else {
    const online = em.nasStatus === "ONLINE";
    emergencyRows.push({
      key: "ds225",
      label: "DS225 Emergency",
      value: online ? "✓ ONLINE" : "OFFLINE",
      tone: online ? "green" : "red",
    });
    const cs = em.contract?.status ?? "UNAVAILABLE";
    emergencyRows.push({
      key: "contract",
      label: "Contract",
      value: cs === "COMPATIBLE" ? "✓ COMPATIBLE" : cs === "MISMATCH" ? "⚠ MISMATCH" : "unknown",
      tone: cs === "COMPATIBLE" ? "green" : cs === "MISMATCH" ? "red" : "grey",
    });
    emergencyRows.push({
      key: "master",
      label: "Master Sync",
      value: em.neverSynced ? "never" : ageShort(em.snapshotAgeHours),
      tone: em.neverSynced ? "red" : em.ageBand === "stale" ? "amber" : "green",
    });
    const pending = em.pendingEmergencyBills;
    emergencyRows.push({
      key: "pending",
      label: "Pending EMG Bills",
      value: pending == null ? "Not available" : String(pending),
      tone: pending == null ? "grey" : pending > 0 ? "amber" : "green",
    });
    const open = em.openEmergencySessions;
    emergencyRows.push({
      key: "open",
      label: "Open EMG Sessions",
      value: open == null ? "Not available" : String(open),
      tone: open == null ? "grey" : open > 0 ? "amber" : "green",
    });
  }

  const drRows: ClinicSystemsRow[] = [
    backupRow(backup, "pg-care", "Postgres CARE"),
    { key: "pg-hope", label: "Postgres HOPE", value: "status unavailable", tone: "grey" },
    { key: "hyper", label: "Hyper Backup", value: "status unavailable", tone: "grey" },
    {
      key: "ds225-dr",
      label: "DS225+ DR",
      value: !em || !em.configured ? "not configured" : em.nasStatus === "ONLINE" ? "✓ ONLINE" : "OFFLINE",
      tone: !em || !em.configured ? "grey" : em.nasStatus === "ONLINE" ? "green" : "red",
    },
  ];

  const orthanc = checkById(opts.checks, "orthanc.reachable");
  const ollama = checkById(opts.checks, "ai.ollama");
  const ocr = checkById(opts.checks, "integ.ocr_worker");
  const backupVerify = checkById(opts.checks, "backup.restore_verified");
  const icici = checkById(opts.checks, "integ.icici_orange");

  const supportingRows: ClinicSystemsRow[] = [
    {
      key: "orthanc",
      label: "Orthanc/PACS",
      value: erpValue(orthanc, "ONLINE", "UNHEALTHY"),
      tone: erpTone(orthanc?.status),
    },
    {
      key: "ollama",
      label: "Local AI",
      value: erpValue(ollama, "ONLINE", "UNHEALTHY"),
      tone: erpTone(ollama?.status),
    },
    {
      key: "ocr",
      label: "OCR",
      value: erpValue(ocr, "ONLINE", "UNHEALTHY"),
      tone: erpTone(ocr?.status),
    },
    {
      key: "backup-verify",
      label: "Backup Verify",
      value: erpValue(backupVerify, "VERIFIED", "FAILED"),
      tone: erpTone(backupVerify?.status),
    },
    {
      key: "icici",
      label: "ICICI Pay",
      // Healthy Orange Pay product must show semantic GREEN — not orange branding.
      value: erpValue(icici, "ONLINE", "UNHEALTHY"),
      tone: erpTone(icici?.status),
    },
  ];

  const alerts: ClinicSystemsAlert[] = [];
  if (em?.configured) {
    if (em.nasStatus === "OFFLINE") {
      alerts.push({ id: "emg-offline", severity: "red", message: "225app unreachable" });
    }
    if (em.contract?.status === "MISMATCH") {
      alerts.push({
        id: "emg-mismatch",
        severity: "red",
        message: `Contract mismatch — CARE expects ${em.contract.careExpected}; 225app supports ${em.contract.remoteSupported.join(", ") || "(none)"}`,
      });
    }
    if (em.neverSynced) {
      alerts.push({ id: "emg-never", severity: "red", message: "No successful initial master-data push" });
    } else if (em.ageBand === "stale") {
      alerts.push({ id: "emg-stale", severity: "amber", message: "Master snapshot is older than 24 hours" });
    }
    if ((em.pendingEmergencyBills ?? 0) > 0) {
      alerts.push({
        id: "emg-pending",
        severity: "amber",
        message: `${em.pendingEmergencyBills} unreconciled emergency bill${em.pendingEmergencyBills === 1 ? "" : "s"}`,
      });
    }
    if ((em.openEmergencySessions ?? 0) > 0) {
      alerts.push({
        id: "emg-open",
        severity: "amber",
        message: "Emergency session left open",
      });
    }
    if ((em.failedImportCount24h ?? 0) > 0) {
      alerts.push({
        id: "emg-failed",
        severity: "amber",
        message: `${em.failedImportCount24h} failed reconciliation/import row${em.failedImportCount24h === 1 ? "" : "s"} in the last 24h`,
      });
    }
  }

  return {
    sections: [
      { title: "CARE / Core", rows: careRows },
      { title: "Emergency DS225+", rows: emergencyRows },
      { title: "DR / Backup", rows: drRows },
      { title: "Supporting Systems", rows: supportingRows },
    ],
    alerts,
    degraded: alerts.length > 0,
  };
}

/** Ribbon pill for DS225+ from existing emergency-billing status (no extra fetch). */
export function buildDs225PulsePill(emergency: EmergencyStatusLike | null | undefined): {
  key: string;
  label: string;
  tone: PulseTone;
  message: string;
  detailsHref: string;
  shouldBlink: boolean;
} {
  if (!emergency || !emergency.configured) {
    return {
      key: "ds225",
      label: "DS225+",
      tone: "grey",
      message: "Emergency billing not configured",
      detailsHref: "/settings?tab=emergency-billing",
      shouldBlink: false,
    };
  }
  if (emergency.nasStatus === "OFFLINE") {
    return {
      key: "ds225",
      label: "DS225+",
      tone: "red",
      message: "225app unreachable",
      detailsHref: "/settings?tab=emergency-billing",
      shouldBlink: true,
    };
  }
  if (emergency.contract?.status === "MISMATCH" || emergency.neverSynced) {
    return {
      key: "ds225",
      label: "DS225+",
      tone: "amber",
      message: emergency.neverSynced
        ? "No successful initial master-data push"
        : `Contract mismatch — CARE expects ${emergency.contract?.careExpected}`,
      detailsHref: "/settings?tab=emergency-billing",
      shouldBlink: true,
    };
  }
  return {
    key: "ds225",
    label: "DS225+",
    tone: "green",
    message: "DS225+ Emergency online",
    detailsHref: "/settings?tab=emergency-billing",
    shouldBlink: false,
  };
}
