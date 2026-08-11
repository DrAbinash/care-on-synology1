/**
 * Radiology admin overview — aggregates safe runtime status for Settings → Overview.
 * Never returns secrets (passwords, INTERNAL_API_KEY values).
 */

import { getMwlDeploymentStatus, type MwlVerdict } from "./mwlDeploymentStatus";
import { resolveOrthancInternalUrl } from "./mwlDeploymentStatus";

export type TrafficLight = "green" | "yellow" | "red" | "unknown";

export type OverviewComponent = {
  id: string;
  label: string;
  status: TrafficLight;
  detail: string;
};

export type SyncWorkerInfo = {
  id: string;
  label: string;
  enabled: boolean;
  source: "env";
  detail: string;
};

export type RadiologyAdminOverview = {
  generatedAt: string;
  overall: TrafficLight;
  components: OverviewComponent[];
  mwl: {
    verdict: MwlVerdict;
    ready: boolean;
    wlFileCount: number;
    activeProcedureCount: number;
    quarantineCount: number;
  };
  orthancInternal: ReturnType<typeof resolveOrthancInternalUrl>;
  syncWorkers: SyncWorkerInfo[];
  duplicateSyncWarning: string | null;
  deployment: {
    orthancWorklistDir: string | null;
    orthancWorklistHostHint: string | null;
    stagingDir: string | null;
    pacsProvider: string;
    orthancCredentialsConfigured: boolean;
    internalApiKeyConfigured: boolean;
    /** Never expose values — only whether set. */
    secrets: {
      orthancPasswordSet: boolean;
      internalApiKeySet: boolean;
    };
  };
};

function envFlagTrue(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function mwlToLight(v: MwlVerdict): TrafficLight {
  if (v === "healthy") return "green";
  if (v === "degraded") return "yellow";
  return "red";
}

function worst(...lights: TrafficLight[]): TrafficLight {
  if (lights.includes("red")) return "red";
  if (lights.includes("yellow")) return "yellow";
  if (lights.includes("unknown")) return "yellow";
  return "green";
}

export async function getRadiologyAdminOverview(): Promise<RadiologyAdminOverview> {
  const mwl = await getMwlDeploymentStatus();
  const orthancInternal = mwl.orthancInternal;

  const pollerExplicitOff = (process.env.ORTHANC_CHANGES_POLLER ?? "").trim() === "0";
  const pollerOn = !pollerExplicitOff && (
    process.env.ORTHANC_CHANGES_POLLER === undefined
    || process.env.ORTHANC_CHANGES_POLLER === ""
    || envFlagTrue("ORTHANC_CHANGES_POLLER")
  );

  const pullAgent = envFlagTrue("ENABLE_DICOM_PULL_AGENT");
  const schedulers = envFlagTrue("ENABLE_SCHEDULERS");
  // care-erp-sync is an external compose service — we can only hint via INTERNAL_API_KEY + docs
  const erpSyncLikely = !!(process.env.INTERNAL_API_KEY?.trim());

  const syncWorkers: SyncWorkerInfo[] = [
    {
      id: "orthanc-changes-poller",
      label: "ERP in-process Orthanc changes poller",
      enabled: pollerOn,
      source: "env",
      detail: pollerOn
        ? "ORTHANC_CHANGES_POLLER enabled (or default-on) inside care-api"
        : "ORTHANC_CHANGES_POLLER=0 — in-process poller off",
    },
    {
      id: "dicom-pull-agent",
      label: "ERP DICOM pull agent",
      enabled: pullAgent,
      source: "env",
      detail: pullAgent ? "ENABLE_DICOM_PULL_AGENT=1" : "ENABLE_DICOM_PULL_AGENT not enabled",
    },
    {
      id: "schedulers",
      label: "API schedulers / cron worker",
      enabled: schedulers,
      source: "env",
      detail: schedulers
        ? "ENABLE_SCHEDULERS=1 — keep enabled on only one API/worker process"
        : "ENABLE_SCHEDULERS off on this process",
    },
    {
      id: "care-erp-sync",
      label: "care-erp-sync (care-pacs sidecar)",
      enabled: erpSyncLikely,
      source: "env",
      detail: erpSyncLikely
        ? "INTERNAL_API_KEY is set — external care-erp-sync may be active on the PACS compose stack (not visible from this process)"
        : "INTERNAL_API_KEY unset — care-erp-sync cannot authenticate to ERP",
    },
  ];

  const activeIntake = [pollerOn, pullAgent, erpSyncLikely].filter(Boolean).length;
  const duplicateSyncWarning = activeIntake >= 2
    ? `Multiple intake paths appear enabled (${activeIntake}). Prefer one primary Orthanc→ERP path to avoid duplicate study notifications. Review care-erp-sync vs ORTHANC_CHANGES_POLLER.`
    : null;

  const components: OverviewComponent[] = [
    {
      id: "orthanc",
      label: "Orthanc",
      status: mwl.checks.find((c) => c.id === "orthanc_worklists")?.status === "pass"
        ? "green"
        : mwl.checks.find((c) => c.id === "orthanc_worklists")?.status === "warn"
          ? "yellow"
          : mwl.checks.find((c) => c.id === "orthanc_internal_url")?.status === "fail"
            ? "red"
            : "red",
      detail: orthancInternal.display,
    },
    {
      id: "mwl",
      label: "Modality Worklist",
      status: mwlToLight(mwl.verdict),
      detail: mwl.ready
        ? `${mwl.wlFileCount} live .wl · ${mwl.activeProcedureCount} active procedures`
        : mwl.checks.filter((c) => c.status === "fail").map((c) => c.title).slice(0, 3).join("; ") || "Not ready",
    },
    {
      id: "sync",
      label: "Sync / Automation",
      status: duplicateSyncWarning ? "yellow" : (pollerOn || erpSyncLikely ? "green" : "yellow"),
      detail: duplicateSyncWarning
        ?? (syncWorkers.filter((w) => w.enabled).map((w) => w.label).join(" · ") || "No intake path clearly enabled"),
    },
    {
      id: "ohif",
      label: "OHIF / Viewer",
      status: "unknown",
      detail: "See Viewer tab and Diagnostics → Flight Deck for browser-reachable probe results",
    },
  ];

  const overall = worst(...components.map((c) => c.status), mwlToLight(mwl.verdict));

  return {
    generatedAt: new Date().toISOString(),
    overall,
    components,
    mwl: {
      verdict: mwl.verdict,
      ready: mwl.ready,
      wlFileCount: mwl.wlFileCount,
      activeProcedureCount: mwl.activeProcedureCount,
      quarantineCount: mwl.quarantineCount,
    },
    orthancInternal,
    syncWorkers,
    duplicateSyncWarning,
    deployment: {
      orthancWorklistDir: mwl.worklistDir,
      orthancWorklistHostHint: mwl.worklistHostHint,
      stagingDir: mwl.stagingDir,
      pacsProvider: (process.env.PACS_PROVIDER || "orthanc").toLowerCase(),
      orthancCredentialsConfigured: !!(process.env.ORTHANC_USERNAME?.trim() && process.env.ORTHANC_PASSWORD?.trim()),
      internalApiKeyConfigured: !!(process.env.INTERNAL_API_KEY?.trim()),
      secrets: {
        orthancPasswordSet: !!process.env.ORTHANC_PASSWORD?.trim(),
        internalApiKeySet: !!process.env.INTERNAL_API_KEY?.trim(),
      },
    },
  };
}
