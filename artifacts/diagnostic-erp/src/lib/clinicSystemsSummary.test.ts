import { describe, expect, it } from "vitest";
import {
  buildClinicSystemsSummary,
  buildDs225PulsePill,
  type ClinicOpsCheck,
  type EmergencyStatusLike,
} from "./clinicSystemsSummary";

const healthyChecks = [
  { id: "app.responding", status: "PASS" as const, message: "API up" },
  { id: "db.connect", status: "PASS" as const, message: "DB ok" },
  { id: "backup.age", status: "PASS" as const, message: "latest backup 2h ago" },
  { id: "orthanc.reachable", status: "PASS" as const, message: "Orthanc up" },
  { id: "ai.ollama", status: "PASS" as const, message: "Ollama up" },
  { id: "integ.ocr_worker", status: "PASS" as const, message: "OCR up" },
  { id: "backup.restore_verified", status: "PASS" as const, message: "verified" },
  { id: "integ.icici_orange", status: "PASS" as const, message: "ICICI configured" },
  {
    id: "ops.recovery_guard",
    status: "PASS" as const,
    message: "armed — last tick 2 min ago, ERP healthy",
    metadata: { ageMinutes: 2, rc: "0", lockStreak: 0 },
  },
  {
    id: "ops.docker_daemon",
    status: "PASS" as const,
    message:
      "dockerd has been up 30 h, engine 24.0.2, live-restore on, 4/4 ERP containers running, no daemon incident recorded yet",
    metadata: {
      ageMinutes: 2,
      stale: false,
      ping: "ok",
      liveRestore: "on",
      serverVersion: "24.0.2",
      darkSeconds: null,
      eventKind: "none",
      eventAgeMinutes: null,
      eventOpen: false,
      eventDarkSeconds: null,
      eventStamps: null,
      containersRunning: 4,
      containersSeen: 4,
    },
  },
];

function healthyEmergency(over: Partial<EmergencyStatusLike> = {}): EmergencyStatusLike {
  return {
    nasStatus: "ONLINE",
    configured: true,
    neverSynced: false,
    lastSuccessfulPushAt: "2026-08-14T10:00:00.000Z",
    snapshotAgeHours: 2,
    ageBand: "fresh",
    contract: {
      status: "COMPATIBLE",
      careExpected: "CARE_EMERGENCY_MASTER_V1",
      remoteSupported: ["CARE_EMERGENCY_MASTER_V1"],
      remotePrimary: "CARE_EMERGENCY_MASTER_V1",
    },
    pendingEmergencyBills: 0,
    openEmergencySessions: 0,
    failedImportCount24h: 0,
    ...over,
  };
}

describe("clinicSystemsSummary", () => {
  it("daily summary healthy idle state has no alerts", () => {
    const s = buildClinicSystemsSummary({ checks: healthyChecks, emergency: healthyEmergency() });
    expect(s.degraded).toBe(false);
    expect(s.alerts).toEqual([]);
    expect(s.sections.map((x) => x.title)).toEqual([
      "CARE / Core",
      "Emergency DS225+",
      "DR / Backup",
      "Supporting Systems",
    ]);
    const ds225 = s.sections.find((x) => x.title === "Emergency DS225+")?.rows;
    expect(ds225?.find((r) => r.key === "ds225")?.value).toBe("✓ ONLINE");
    expect(ds225?.find((r) => r.key === "contract")?.value).toBe("✓ COMPATIBLE");
    expect(ds225?.find((r) => r.key === "pending")?.value).toBe("0");
    expect(ds225?.find((r) => r.key === "open")?.value).toBe("0");
    const dr = s.sections.find((x) => x.title === "DR / Backup")?.rows;
    expect(dr?.find((r) => r.key === "pg-care")?.value).toBe("✓ latest");
    expect(dr?.find((r) => r.key === "hyper")?.value).toBe("status unavailable");
    expect(dr?.find((r) => r.key === "pg-hope")?.value).toBe("status unavailable");
    // The host-side daemon light, green and worded as the fact rather than the
    // incident, and left of Auto-Recovery: a dark daemon is the cause and the
    // guard is the consequence, so they are read in that order.
    expect(dr?.find((r) => r.key === "docker-daemon")).toEqual({
      key: "docker-daemon", label: "Docker Daemon", value: "✓ answering · LR on · 2m ago", tone: "green",
    });
    const drKeys = dr?.map((r) => r.key) ?? [];
    expect(drKeys.indexOf("docker-daemon")).toBeLessThan(drKeys.indexOf("recovery-guard"));
    const supporting = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    // Healthy ICICI / Orange Pay uses semantic GREEN — not orange branding.
    expect(supporting?.find((r) => r.key === "icici")?.tone).toBe("green");
    expect(supporting?.find((r) => r.key === "icici")?.value).toBe("✓ ONLINE");
  });

  it("225app offline is a prominent degraded alert", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ nasStatus: "OFFLINE", contract: { status: "UNAVAILABLE", careExpected: "CARE_EMERGENCY_MASTER_V1", remoteSupported: [], remotePrimary: null } }),
    });
    expect(s.degraded).toBe(true);
    expect(s.alerts.some((a) => a.id === "emg-offline")).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "ds225")?.value).toBe("OFFLINE");
  });

  it("no initial snapshot is flagged", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ neverSynced: true, lastSuccessfulPushAt: null, snapshotAgeHours: null, ageBand: "never" }),
    });
    expect(s.alerts.some((a) => a.id === "emg-never")).toBe(true);
  });

  it("stale >24h snapshot is flagged without treating idle zeros as noise", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ snapshotAgeHours: 30, ageBand: "stale" }),
    });
    expect(s.alerts.map((a) => a.id)).toEqual(["emg-stale"]);
  });

  it("pending emergency bills are surfaced", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ pendingEmergencyBills: 3 }),
    });
    expect(s.alerts.some((a) => a.message.includes("3 unreconciled"))).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "pending")?.value).toBe("3");
  });

  it("open emergency session is surfaced", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ openEmergencySessions: 1 }),
    });
    expect(s.alerts.some((a) => a.id === "emg-open")).toBe(true);
    expect(s.sections.flatMap((x) => x.rows).find((r) => r.key === "open")?.value).toBe("1");
  });

  it("contract mismatch degrades the daily summary", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({
        contract: {
          status: "MISMATCH",
          careExpected: "CARE_EMERGENCY_MASTER_V1",
          remoteSupported: ["CARE_EMERGENCY_MASTER_V2"],
          remotePrimary: "CARE_EMERGENCY_MASTER_V2",
        },
      }),
    });
    expect(s.degraded).toBe(true);
    expect(s.alerts.some((a) => a.id === "emg-mismatch")).toBe(true);
  });

  it("unconfigured emergency system stays quiet", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ configured: false }),
    });
    expect(s.alerts).toEqual([]);
    expect(s.degraded).toBe(false);
  });

  it("DS225 ribbon pill uses existing emergency status without inventing APIs", () => {
    expect(buildDs225PulsePill(null).tone).toBe("grey");
    expect(buildDs225PulsePill(healthyEmergency()).tone).toBe("green");
    expect(buildDs225PulsePill(healthyEmergency({ nasStatus: "OFFLINE" })).tone).toBe("red");
  });

  it("Orthanc → ERP shows the delivered count and the last sync age when healthy", () => {
    const s = buildClinicSystemsSummary({
      checks: [
        ...healthyChecks,
        { id: "orthanc.sync_divergence", status: "PASS" as const, message: "all 7 studies due are in the ERP worklist", metadata: { due: 7, missing: 0 } },
        { id: "orthanc.sync_fresh", status: "PASS" as const, message: "last Orthanc delivery 12 min ago", metadata: { ageMinutes: 12 } },
      ],
      emergency: healthyEmergency(),
    });
    const supporting = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(supporting?.find((r) => r.key === "sync-delivery")).toMatchObject({ label: "Orthanc → ERP", tone: "green", value: "✓ 7 delivered" });
    expect(supporting?.find((r) => r.key === "sync-fresh")).toMatchObject({ label: "Last Orthanc sync", tone: "green", value: "12m ago" });
    expect(s.alerts).toEqual([]);
  });

  it("undelivered studies raise a red row and an alert that does NOT point at emergency billing", () => {
    const s = buildClinicSystemsSummary({
      checks: [
        ...healthyChecks,
        { id: "orthanc.sync_divergence", status: "FAIL" as const, message: "3 of 9 Orthanc studies due never reached the ERP worklist", metadata: { due: 9, missing: 3 } },
        { id: "orthanc.sync_fresh", status: "WARNING" as const, message: "no Orthanc delivery for 40h", metadata: { ageMinutes: 2400 } },
      ],
      emergency: healthyEmergency(),
    });
    const rows = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(rows?.find((r) => r.key === "sync-delivery")).toMatchObject({ tone: "red", value: "3 NOT DELIVERED" });
    expect(rows?.find((r) => r.key === "sync-fresh")?.value).toBe("40h ago");
    const alert = s.alerts.find((a) => a.id === "pacs-not-delivering");
    expect(alert?.severity).toBe("red");
    expect(alert?.message).toBe("3 studies in Orthanc have not reached the ERP");
    expect(alert?.detailsHref).toBe("/radiology/operational-health");
    expect(s.degraded).toBe(true);
  });

  it("emergency alerts keep their emergency-billing link", () => {
    const s = buildClinicSystemsSummary({
      checks: healthyChecks,
      emergency: healthyEmergency({ nasStatus: "OFFLINE" }),
    });
    expect(s.alerts.find((a) => a.id === "emg-offline")?.detailsHref).toBeUndefined();
  });

  it("no Orthanc checks at all → grey rows, never a green all-clear", () => {
    const s = buildClinicSystemsSummary({ checks: healthyChecks, emergency: healthyEmergency() });
    const rows = s.sections.find((x) => x.title === "Supporting Systems")?.rows;
    expect(rows?.find((r) => r.key === "sync-delivery")?.tone).toBe("grey");
    expect(rows?.find((r) => r.key === "sync-fresh")?.tone).toBe("grey");
  });

  // The guard is the control that decides whether an overnight dockerd restart
  // costs three minutes or the whole morning. Its crontab line can be deleted
  // without notice by a DSM Task Scheduler save, so "quiet" has to be loud here.
  describe("Auto-Recovery row and alert", () => {
    const summaryWith = (guard: ClinicOpsCheck) =>
      buildClinicSystemsSummary({
        checks: [...healthyChecks.filter((c) => c.id !== "ops.recovery_guard"), guard],
        emergency: healthyEmergency(),
      });
    const dr = (guard: ClinicOpsCheck) =>
      summaryWith(guard).sections.find((x) => x.title === "DR / Backup")?.rows?.find((r) => r.key === "recovery-guard");

    it("healthy baseline shows it armed and stays out of the alerts", () => {
      const s = buildClinicSystemsSummary({ checks: healthyChecks, emergency: healthyEmergency() });
      expect(s.sections.find((x) => x.title === "DR / Backup")?.rows.find((r) => r.key === "recovery-guard")).toEqual({
        key: "recovery-guard", label: "Auto-Recovery", value: "✓ armed · 2m ago", tone: "green",
      });
      expect(s.alerts).toEqual([]);
    });

    it("no tick since the crontab line went away → red row plus the loud alert", () => {
      const s = summaryWith({
        id: "ops.recovery_guard",
        status: "FAIL",
        message: "recovery guard has not ticked in 4h 12 min — its crontab entry is gone",
        metadata: { ageMinutes: 252, rc: "0", lockStreak: 0 },
      });
      expect(dr({ id: "ops.recovery_guard", status: "FAIL", message: "m", metadata: { ageMinutes: 252 } })).toEqual({
        key: "recovery-guard", label: "Auto-Recovery", value: "NOT ARMED · 4.2h ago", tone: "red",
      });
      expect(s.degraded).toBe(true);
      const alert = s.alerts.find((a) => a.id === "recovery-guard-dead");
      expect(alert?.severity).toBe("red");
      // The alert carries the check's own sentence, so it names the fix rather
      // than repeating a generic "recovery is off".
      expect(alert?.message).toContain("crontab entry is gone");
      expect(alert?.detailsHref).toBe("/radiology/operational-health");
    });

    it("a recovery that ran and FAILED is reported as that, not as silence", () => {
      const s = summaryWith({
        id: "ops.recovery_guard",
        status: "FAIL",
        message: "the last recovery attempt FAILED (rc=6) 3h ago, so the guard is disarmed",
        metadata: { ageMinutes: 180, rc: "6", lockStreak: 0 },
      });
      expect(s.alerts.find((a) => a.id === "recovery-guard-dead")?.message).toContain("rc=6");
    });

    it("armed but standing down over a different outage → amber, no red alert", () => {
      const guard: ClinicOpsCheck = {
        id: "ops.recovery_guard", status: "WARNING",
        message: "the guard found the ERP down for a DIFFERENT reason than a daemon restart",
        metadata: { ageMinutes: 2, rc: "4", lockStreak: 0 },
      };
      expect(dr(guard)).toMatchObject({ value: "⚠ armed, did not act", tone: "amber" });
      expect(summaryWith(guard).alerts.find((a) => a.id === "recovery-guard-dead")).toBeUndefined();
    });

    it("a host with no guard at all is grey and quiet, never a false alarm", () => {
      const guard: ClinicOpsCheck = { id: "ops.recovery_guard", status: "SKIPPED", message: "no guard directory here" };
      expect(dr(guard)).toMatchObject({ value: "not on this host", tone: "grey" });
      expect(summaryWith(guard).alerts.find((a) => a.id === "recovery-guard-dead")).toBeUndefined();
    });

    it("a mounted dir with no tick record is amber 'no tick record', not green", () => {
      const guard: ClinicOpsCheck = { id: "ops.recovery_guard", status: "UNKNOWN", message: "never written" };
      expect(dr(guard)).toMatchObject({ value: "no tick record", tone: "amber" });
    });
  });

  // "Did the Docker daemon do something bad last night?" was asked on 2026-11-13
  // and answerable only by SSHing in and reading /var/run/docker.pid mtimes.
  // These tests pin the other half of that: the page has to answer it, and each
  // of the four failure shapes has to name its OWN action, because "red over
  // dockerd" means run the recovery / restore the crontab line / plan a window /
  // read the ledger, and a single generic alert would send him to the wrong one.
  describe("Docker Daemon row and alerts", () => {
    const dmCheck = (
      status: ClinicOpsCheck["status"],
      metadata: Record<string, unknown> = {},
      message = "the check's own sentence",
    ): ClinicOpsCheck => ({ id: "ops.docker_daemon", status, message, metadata });
    const summaryWith = (daemon: ClinicOpsCheck) =>
      buildClinicSystemsSummary({
        checks: [...healthyChecks.filter((c) => c.id !== "ops.docker_daemon"), daemon],
        emergency: healthyEmergency(),
      });
    const dr = (daemon: ClinicOpsCheck) =>
      summaryWith(daemon).sections.find((x) => x.title === "DR / Backup")?.rows?.find((r) => r.key === "docker-daemon");

    it("dockerd refusing now → red row with the measured window and the DNS consequence", () => {
      const s = summaryWith(dmCheck("FAIL", {
        ageMinutes: 2, stale: false, ping: "down", liveRestore: "on", darkSeconds: 360,
      }));
      expect(dr(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "down", darkSeconds: 360 }))).toEqual({
        key: "docker-daemon", label: "Docker Daemon", value: "NOT ANSWERING 6m · 2m ago", tone: "red",
      });
      expect(s.degraded).toBe(true);
      const ids = s.alerts.map((a) => a.id);
      expect(ids).toContain("docker-daemon-down");
      expect(ids).not.toContain("docker-daemon-probe-silent");
      const alert = s.alerts.find((a) => a.id === "docker-daemon-down");
      expect(alert?.severity).toBe("red");
      expect(alert?.message).toContain("no reply for 6m");
      expect(alert?.message).toMatch(/DNS that resolves "api" is served by dockerd/);
      expect(alert?.detailsHref).toBe("/radiology/operational-health");
    });

    // The fabrication this guards against: a probe whose crontab line died
    // two hours ago still holds ping=down from its last tick. Reading that as a
    // live outage would have him restarting a daemon that recovered while nobody
    // was looking.
    it("a stale record says NO SAMPLE and never claims a live outage", () => {
      const s = summaryWith(dmCheck("FAIL", {
        ageMinutes: 252, stale: true, ping: "down", liveRestore: "on", darkSeconds: 60,
      }));
      expect(dr(dmCheck("FAIL", { ageMinutes: 252, stale: true, ping: "down" }))).toEqual({
        key: "docker-daemon", label: "Docker Daemon", value: "NO SAMPLE · 4.2h ago", tone: "red",
      });
      const ids = s.alerts.map((a) => a.id);
      expect(ids).toContain("docker-daemon-probe-silent");
      expect(ids).not.toContain("docker-daemon-down");
      expect(s.alerts.find((a) => a.id === "docker-daemon-probe-silent")?.message).toMatch(
        /not written a sample in 4h 12m.*crontab entry is gone/s,
      );
    });

    it("live-restore off while the daemon answers is its own red, with the window it needs", () => {
      const s = summaryWith(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "ok", liveRestore: "off" }));
      expect(dr(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "ok", liveRestore: "off" }))).toEqual({
        key: "docker-daemon", label: "Docker Daemon", value: "LIVE-RESTORE OFF · 2m ago", tone: "red",
      });
      const ids = s.alerts.map((a) => a.id);
      expect(ids).toContain("docker-live-restore-off");
      expect(ids).not.toContain("docker-daemon-down");
      expect(s.alerts.find((a) => a.id === "docker-live-restore-off")?.message).toMatch(/approved window/);
    });

    // Dark AND unconfigured for survival: the outage is the action, but the
    // reason the containers did not come back must not be lost.
    it("a dark daemon with live-restore off leads with the outage and still names the setting", () => {
      const s = summaryWith(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "down", liveRestore: "off", darkSeconds: 120 }));
      const ids = s.alerts.map((a) => a.id);
      expect(ids).toContain("docker-daemon-down");
      expect(ids).not.toContain("docker-live-restore-off");
      const alert = s.alerts.find((a) => a.id === "docker-daemon-down");
      expect(alert?.message).toMatch(/is not answering \(no reply for 2m\)/);
      expect(alert?.message).toMatch(/Live-restore is also OFF/);
      expect(dr(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "down", liveRestore: "off" }))?.value).toContain("NOT ANSWERING");
    });

    it("an overnight restart is amber on the page and makes it say so, not a silent green", () => {
      const s = summaryWith(dmCheck("WARNING", {
        ageMinutes: 2, stale: false, ping: "ok", liveRestore: "on",
        eventKind: "stall", eventAgeMinutes: 420, eventDarkSeconds: 360, eventStamps: { changed: 1, compared: 4 },
      }));
      expect(dr(dmCheck("WARNING", { eventKind: "stall", eventAgeMinutes: 420 }))).toEqual({
        key: "docker-daemon", label: "Docker Daemon", value: "⚠ daemon stall 7h ago", tone: "amber",
      });
      expect(s.degraded).toBe(true);
      const alert = s.alerts.find((a) => a.id === "docker-daemon-incident");
      expect(alert?.severity).toBe("amber");
      expect(alert?.message).toMatch(/^dockerd stalled and recovered 7h ago \(6m, 1\/4 ERP containers restarted across it\)/);
      expect(alert?.message).toMatch(/unavailable overnight without anyone seeing it happen/);
      expect(s.alerts.map((a) => a.id)).not.toContain("docker-daemon-down");
    });

    it("a reboot is told from a dockerd restart, and an unobserved window is admitted as unobserved", () => {
      const boot = summaryWith(dmCheck("WARNING", { eventKind: "boot", eventAgeMinutes: 90 }));
      expect(boot.alerts.find((a) => a.id === "docker-daemon-incident")?.message).toMatch(/^the NAS rebooted 1h 30m ago \(length not observed/);
      expect(dr(dmCheck("WARNING", { eventKind: "boot", eventAgeMinutes: 90 }))?.value).toBe("⚠ NAS reboot 1.5h ago");
    });

    it("a probe that cannot tell is amber on the row and silent in the alerts", () => {
      const unknown: ClinicOpsCheck = dmCheck("UNKNOWN", { ageMinutes: 2, ping: "unknown" }, "curl rc=127");
      expect(dr(unknown)).toMatchObject({ value: "probe cannot tell", tone: "amber" });
      const s = summaryWith(unknown);
      expect(s.alerts.filter((a) => a.id.startsWith("docker-"))).toEqual([]);
      expect(s.degraded).toBe(false);
    });

    it("a host with no probe dir is grey and quiet — a developer box is not a dead daemon", () => {
      const skipped: ClinicOpsCheck = dmCheck("SKIPPED", {}, "no docker-daemon probe record on this host");
      expect(dr(skipped)).toMatchObject({ value: "not on this host", tone: "grey" });
      expect(summaryWith(skipped).alerts.filter((a) => a.id.startsWith("docker-"))).toEqual([]);
    });

    it("a FAIL the summary has no cause-specific wording for still gets the check's own sentence", () => {
      const s = summaryWith(dmCheck("FAIL", { ageMinutes: 2, stale: false, ping: "ok", liveRestore: "on" }, "a cause this build does not name"));
      expect(s.alerts.find((a) => a.id === "docker-daemon-fault")?.message).toBe("a cause this build does not name");
    });
  });

  // A provisional receipt is paper in the patient's hand and cash in the drawer.
  // Every financial report in the clinic correctly says nothing about it, so this
  // row is the only detector — which makes the difference between "all delivered"
  // and "no witness table" the whole point of the feature.
  describe("Desk Bills row and alert", () => {
    const deskCheck = (
      status: ClinicOpsCheck["status"],
      metadata: Record<string, unknown> = {},
      message = "the check's own sentence",
    ): ClinicOpsCheck => ({ id: "billing.unreplayed_desk_bills", status, message, metadata });
    const summaryWith = (check: ClinicOpsCheck | undefined) =>
      buildClinicSystemsSummary({
        checks: check ? [...healthyChecks, check] : healthyChecks,
        emergency: healthyEmergency(),
      });
    const core = (check: ClinicOpsCheck | undefined) =>
      summaryWith(check).sections.find((x) => x.title === "CARE / Core")?.rows?.find((r) => r.key === "desk-bills");

    it("it is a CARE / Core row, immediately after CARE DB", () => {
      const rows = summaryWith(undefined).sections.find((x) => x.title === "CARE / Core")?.rows ?? [];
      expect(rows.map((r) => r.key)).toEqual(["care-erp", "care-db", "desk-bills"]);
    });

    it("no check at all, and a check that cannot run, are both grey and silent", () => {
      expect(core(undefined)).toEqual({ key: "desk-bills", label: "Desk Bills", value: "not checked", tone: "grey" });
      expect(core(deskCheck("SKIPPED"))).toMatchObject({ value: "not checked", tone: "grey" });
      expect(summaryWith(deskCheck("SKIPPED")).alerts.filter((a) => a.id === "desk-bills-unreplayed")).toEqual([]);
    });

    it("an absent witness table is amber 'no witness table', never a green all-clear", () => {
      expect(core(deskCheck("UNKNOWN"))).toEqual({
        key: "desk-bills", label: "Desk Bills", value: "no witness table", tone: "amber",
      });
    });

    it("everything announced has reached the ledger → green and no alert", () => {
      const s = summaryWith(deskCheck("PASS", { announcedTotal: 7, outstandingCount: 0 }));
      expect(core(deskCheck("PASS"))).toEqual({
        key: "desk-bills", label: "Desk Bills", value: "✓ all delivered", tone: "green",
      });
      expect(s.alerts.filter((a) => a.id === "desk-bills-unreplayed")).toEqual([]);
      expect(s.degraded).toBe(false);
    });

    it("stuck bills name the count, the money, the age and the machine", () => {
      const check = deskCheck("WARNING", {
        outstandingCount: 2, outstandingAmount: 1250, oldestMinutes: 75, workstations: ["billing-pc-1"],
      });
      expect(core(check)).toEqual({
        key: "desk-bills", label: "Desk Bills", value: "2 printed, NOT DELIVERED (₹1,250) · 1h 15m ago", tone: "amber",
      });
      const alert = summaryWith(check).alerts.find((a) => a.id === "desk-bills-unreplayed");
      expect(alert?.severity).toBe("amber");
      expect(alert?.message).toBe(
        "2 bills printed at the desk on billing-pc-1 for ₹1,250 have never reached the ledger — replay has not caught up yet",
      );
      expect(alert?.detailsHref).toBe("/radiology/operational-health");
    });

    // The loud one: replay has plainly lost the bill, so the number is in a
    // drawer and in no account.
    it("past the fail limit it is red and says the reports cannot see the cash", () => {
      const check = deskCheck("FAIL", {
        outstandingCount: 1, outstandingAmount: 400, oldestMinutes: 300, workstations: ["billing-pc-2", "billing-pc-3"],
      });
      expect(core(check)).toMatchObject({ value: "1 printed, NOT DELIVERED (₹400) · 5h ago", tone: "red" });
      const alert = summaryWith(check).alerts.find((a) => a.id === "desk-bills-unreplayed");
      expect(alert?.severity).toBe("red");
      expect(alert?.message).toBe(
        "1 bill printed at the desk on billing-pc-2, billing-pc-3 for ₹400 has never reached the ledger — the drawer holds this cash and no report knows",
      );
      expect(summaryWith(check).degraded).toBe(true);
    });

    it("a bill announced without a workstation name still alarms, without a bare 'on'", () => {
      const alert = summaryWith(
        deskCheck("WARNING", { outstandingCount: 1, outstandingAmount: 400, oldestMinutes: 30, workstations: [] }),
      ).alerts.find((a) => a.id === "desk-bills-unreplayed");
      expect(alert?.message).toBe(
        "1 bill printed at the desk for ₹400 has never reached the ledger — replay has not caught up yet",
      );
    });

    it("an unknown age is left off the row rather than shown as 0m", () => {
      expect(
        core(deskCheck("WARNING", { outstandingCount: 3, outstandingAmount: 0, oldestMinutes: null })),
      ).toMatchObject({ value: "3 printed, NOT DELIVERED (₹0)" });
    });
  });
});
