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
  /** Safe counts/ages only — the ops runner scrubs secrets and PHI on the way out. */
  metadata?: Record<string, unknown>;
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
  /** Where to send the operator; defaults to the emergency-billing settings tab. */
  detailsHref?: string;
  linkLabel?: string;
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

/**
 * Unattended recovery after a Docker daemon restart. This row is the reason the
 * guard is worth having: every incident on record happened overnight, and the
 * crontab line that runs it is deleted without notice whenever DSM's Task
 * Scheduler rewrites /etc/crontab. Values stay short for the narrow grid; the
 * check's own sentence carries the fix.
 */
function guardRow(check: ClinicOpsCheck | undefined): ClinicSystemsRow {
  const key = "recovery-guard";
  const label = "Auto-Recovery";
  if (!check || check.status === "SKIPPED") return { key, label, value: "not on this host", tone: "grey" };
  const age = check.metadata?.ageMinutes;
  const ageText = typeof age === "number" ? ` · ${ageShort(age / 60)}` : "";
  if (check.status === "PASS") return { key, label, value: `✓ armed${ageText}`, tone: "green" };
  if (check.status === "FAIL") return { key, label, value: `NOT ARMED${ageText}`, tone: "red" };
  if (check.status === "UNKNOWN") return { key, label, value: "no tick record", tone: "amber" };
  return { key, label, value: "⚠ armed, did not act", tone: "amber" };
}

/**
 * The Docker daemon, as the host probe last sampled it. This row is about the
 * daemon rather than about the incident on purpose: "answering · LR on" is the
 * fact that has to be readable every morning, and the check's own sentence plus
 * the alert below carry the restart, how long it lasted and what it cost.
 *
 * "NO SAMPLE" is not the same as "not on this host": the first is a crontab
 * entry that stopped, which is how this light dies; the second is a developer
 * box or CI, where the light has nothing to say.
 */
function daemonRow(check: ClinicOpsCheck | undefined): ClinicSystemsRow {
  const key = "docker-daemon";
  const label = "Docker Daemon";
  if (!check || check.status === "SKIPPED") return { key, label, value: "not on this host", tone: "grey" };
  const meta = check.metadata || {};
  const age = meta.ageMinutes;
  const ageText = typeof age === "number" ? ` · ${ageShort(age / 60)}` : "";
  if (check.status === "PASS") {
    const lr = meta.liveRestore === "off" ? "LR off"
      : meta.liveRestore === "on" ? "LR on" : "LR unreadable";
    return { key, label, value: `✓ answering · ${lr}${ageText}`, tone: "green" };
  }
  if (check.status === "FAIL") {
    // The check's own ladder, in its own order: a stale record says NO SAMPLE
    // (nobody has looked), not NOT ANSWERING (it is refusing right now).
    if (meta.stale === true) return { key, label, value: `NO SAMPLE${ageText}`, tone: "red" };
    // While dockerd is refusing to answer, the live-restore setting is true but
    // not the thing he has to act on, and showing "LIVE-RESTORE OFF" here would
    // send him to plan a window instead of running the recovery.
    if (meta.ping === "down") {
      const dark = meta.darkSeconds;
      const darkText = typeof dark === "number" ? ` ${humanMins(dark / 60)}` : "";
      return { key, label, value: `NOT ANSWERING${darkText}${ageText}`, tone: "red" };
    }
    if (meta.liveRestore === "off") return { key, label, value: `LIVE-RESTORE OFF${ageText}`, tone: "red" };
    return { key, label, value: `NO SAMPLE${ageText}`, tone: "red" };
  }
  if (check.status === "UNKNOWN") return { key, label, value: "probe cannot tell", tone: "amber" };
  const evAge = meta.eventAgeMinutes;
  const kindWord = meta.eventKind === "boot" ? "NAS reboot"
    : meta.eventKind === "stall" ? "daemon stall" : "dockerd restart";
  return {
    key,
    label,
    value: typeof evAge === "number" ? `⚠ ${kindWord} ${ageShort(evAge / 60)}` : `⚠ daemon event${ageText}`,
    tone: "amber",
  };
}

/** Minutes, the way a daemon outage gets read at the desk: "34m", "2h 11m". */
function humanMins(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * Orthanc → ERP delivery. This is the one PACS line that can tell a closed
 * clinic from a dead bridge: freshness alone cannot, which is why the pair is
 * shown together and only this one drives the ribbon light.
 */
function syncDeliveryRow(check: ClinicOpsCheck | undefined): ClinicSystemsRow {
  const label = "Orthanc → ERP";
  if (!check || check.status === "SKIPPED") {
    return { key: "sync-delivery", label, value: "nothing to compare", tone: "grey" };
  }
  if (check.status === "PASS") {
    const due = Number(check.metadata?.due ?? 0);
    return { key: "sync-delivery", label, value: due > 0 ? `✓ ${due} delivered` : "✓ delivered", tone: "green" };
  }
  if (check.status === "FAIL") {
    const missing = Number(check.metadata?.missing ?? 0);
    return { key: "sync-delivery", label, value: missing > 0 ? `${missing} NOT DELIVERED` : "not delivering", tone: "red" };
  }
  return { key: "sync-delivery", label, value: "cannot compare", tone: "amber" };
}

function syncFreshRow(check: ClinicOpsCheck | undefined): ClinicSystemsRow {
  const label = "Last Orthanc sync";
  if (!check || check.status === "SKIPPED") {
    return { key: "sync-fresh", label, value: "never", tone: "grey" };
  }
  const mins = check.metadata?.ageMinutes;
  const value = typeof mins === "number" ? ageShort(mins / 60) : "unknown";
  return { key: "sync-fresh", label, value, tone: check.status === "PASS" ? "green" : "amber" };
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
    daemonRow(checkById(opts.checks, "ops.docker_daemon")),
    guardRow(checkById(opts.checks, "ops.recovery_guard")),
  ];

  const orthanc = checkById(opts.checks, "orthanc.reachable");
  const divergence = checkById(opts.checks, "orthanc.sync_divergence");
  const syncFresh = checkById(opts.checks, "orthanc.sync_fresh");
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
    syncDeliveryRow(divergence),
    syncFreshRow(syncFresh),
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

  if (divergence?.status === "FAIL") {
    const missing = Number(divergence.metadata?.missing ?? 0);
    alerts.push({
      id: "pacs-not-delivering",
      severity: "red",
      message: missing > 0
        ? `${missing} stud${missing === 1 ? "y" : "ies"} in Orthanc ha${missing === 1 ? "s" : "ve"} not reached the ERP`
        : "Orthanc → ERP delivery is failing",
      detailsHref: "/radiology/operational-health",
      linkLabel: "Operational health",
    });
  }

  // A guard that stopped ticking is invisible everywhere else: the ERP is fine
  // right now, which is precisely why nobody notices until an overnight daemon
  // restart takes the clinic down at 03:00 and the desk finds it at 08:30.
  const guard = checkById(opts.checks, "ops.recovery_guard");
  if (guard?.status === "FAIL") {
    alerts.push({
      id: "recovery-guard-dead",
      severity: "red",
      message: guard.message || "The unattended daemon-restart recovery is not armed",
      detailsHref: "/radiology/operational-health",
      linkLabel: "Operational health",
    });
  }

  // Docker daemon: one red per cause, because "red over dockerd" means a
  // different action in each case — run the recovery, restore the crontab
  // entry, plan an approved window for live-restore, or read the ledger and
  // change nothing. Collapsing them into one alert would send the desk to the
  // wrong instruction.
  const daemon = checkById(opts.checks, "ops.docker_daemon");
  const dm = daemon?.metadata || {};
  if (daemon && daemon.status === "FAIL") {
    // Staleness is read from the check's own flag rather than re-derived from
    // ageMinutes, because the threshold lives in the API layer and a second copy
    // here would silently disagree with it. It also has to come first: a
    // two-hour-old "down" record is a stopped crontab line, not a live outage,
    // and alerting on the latter would have him restarting a daemon that already
    // came back while he was asleep.
    if (dm.stale === true) {
      const age = typeof dm.ageMinutes === "number" ? humanMins(dm.ageMinutes) : "hours";
      alerts.push({
        id: "docker-daemon-probe-silent",
        severity: "red",
        message: `the Docker daemon probe has not written a sample in ${age}, so nothing on this page describes dockerd any more — its crontab entry is gone`,
        detailsHref: "/radiology/operational-health",
        linkLabel: "Operational health",
      });
    } else if (dm.ping === "down") {
      const dark = typeof dm.darkSeconds === "number" ? humanMins(dm.darkSeconds / 60) : null;
      // The action while the daemon is dark is the recovery, so this alert owns
      // it alone; live-restore is named here rather than competing for the same
      // red row with a second instruction.
      const lr = dm.liveRestore === "off"
        ? " Live-restore is also OFF in this daemon, so the containers did not survive it."
        : "";
      alerts.push({
        id: "docker-daemon-down",
        severity: "red",
        message: `Docker daemon is not answering${dark ? ` (no reply for ${dark})` : ""} — /api/* can fail while every container still reports Up (healthy), because the DNS that resolves "api" is served by dockerd${lr}`,
        detailsHref: "/radiology/operational-health",
        linkLabel: "Operational health",
      });
    } else if (dm.liveRestore === "off") {
      alerts.push({
        id: "docker-live-restore-off",
        severity: "red",
        message: "live-restore is OFF in the running daemon — the next dockerd restart stops every container and none of them come back on their own, which is the 2026-11-10 incident (20 containers still down hours later). Turning it on costs one final all-container stop, so it needs an approved window.",
        detailsHref: "/radiology/operational-health",
        linkLabel: "Operational health",
      });
    } else {
      alerts.push({
        id: "docker-daemon-fault",
        severity: "red",
        message: daemon.message || "The Docker daemon probe reports a failure",
        detailsHref: "/radiology/operational-health",
        linkLabel: "Operational health",
      });
    }
  } else if (daemon && daemon.status === "WARNING") {
    const evAge = typeof dm.eventAgeMinutes === "number" ? humanMins(dm.eventAgeMinutes) : null;
    const kindWord = dm.eventKind === "boot" ? "the NAS rebooted"
      : dm.eventKind === "stall" ? "dockerd stalled and recovered" : "dockerd restarted";
    const dark = typeof dm.eventDarkSeconds === "number"
      ? humanMins(dm.eventDarkSeconds / 60)
      : "length not observed";
    const stamps = dm.eventStamps && typeof dm.eventStamps === "object"
      ? `, ${(dm.eventStamps as { changed?: number; compared?: number }).changed}/${(dm.eventStamps as { changed?: number; compared?: number }).compared} ERP containers restarted across it`
      : "";
    alerts.push({
      id: "docker-daemon-incident",
      severity: "amber",
      message: `${kindWord} ${evAge ? `${evAge} ago` : "recently"} (${dark}${stamps}) — the clinic was unavailable overnight without anyone seeing it happen`,
      detailsHref: "/radiology/operational-health",
      linkLabel: "Operational health",
    });
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
