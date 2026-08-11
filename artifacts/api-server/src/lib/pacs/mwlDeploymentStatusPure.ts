/**
 * Pure MWL status helpers — no DB / fs side effects (safe for unit tests).
 */

export type MwlCheckStatus = "pass" | "warn" | "fail" | "skip";
export type MwlVerdict = "healthy" | "degraded" | "failed";

export type MwlCheck = {
  id: string;
  title: string;
  status: MwlCheckStatus;
  detail: string;
  fix?: string;
};

export type OrthancInternalUrlInfo = {
  configured: string | null;
  probeUrl: string | null;
  display: string;
  source: "env" | "unset";
  networkNote: string;
};

export function check(
  id: string,
  title: string,
  status: MwlCheckStatus,
  detail: string,
  fix?: string,
): MwlCheck {
  return { id, title, status, detail, fix };
}

export function resolveOrthancInternalUrl(
  env: NodeJS.ProcessEnv = process.env,
): OrthancInternalUrlInfo {
  const configured = env.ORTHANC_INTERNAL_URL?.trim() || null;
  if (configured) {
    const host = configured.replace(/^https?:\/\//, "");
    const looksLikeDockerDns = /care-orthanc|orthanc:8042/i.test(configured)
      && !/^\d+\.\d+\.\d+\.\d+/.test(host);
    return {
      configured,
      probeUrl: configured.replace(/\/$/, ""),
      display: configured,
      source: "env",
      networkNote: looksLikeDockerDns
        ? "Uses a Docker service hostname. This only works if care-api and Orthanc share a Docker network. Production often uses a LAN IP instead (ERP and PACS are separate Compose projects)."
        : "Resolved from ORTHANC_INTERNAL_URL. ERP and Orthanc may be on separate Docker networks — LAN IP is expected in that layout.",
    };
  }
  return {
    configured: null,
    probeUrl: null,
    display: "Not set — configure via deployment environment (ORTHANC_INTERNAL_URL)",
    source: "unset",
    networkNote:
      "Do not assume http://care-orthanc:8042. When ERP and PACS are separate Compose projects, set ORTHANC_INTERNAL_URL to a LAN-reachable Orthanc HTTP URL (e.g. http://172.16.1.139:8042).",
  };
}

export function assessPublishGap(activeCount: number, wlFileCount: number): MwlCheck {
  if (activeCount <= 0) {
    return check(
      "publish_gap",
      "Scheduled vs live .wl files",
      "skip",
      "No active scheduled procedures today",
    );
  }
  if (wlFileCount === 0) {
    return check(
      "publish_gap",
      "Scheduled vs live .wl files",
      "fail",
      `${activeCount} active scheduled procedure(s) but 0 live .wl files on disk — modalities will see an empty worklist`,
      "Click Sync Worklist. If sync writes 0 files, check staging/live mounts are on the same filesystem (EXDEV) and dump2dcm is installed.",
    );
  }
  if (wlFileCount < Math.min(activeCount, 5) && activeCount >= 5) {
    return check(
      "publish_gap",
      "Scheduled vs live .wl files",
      "warn",
      `${activeCount} active procedure(s) vs ${wlFileCount} live .wl file(s) — possible partial publish failure`,
      "Run Sync and inspect care-api logs for mwl: atomic rename failed / dump2dcm errors.",
    );
  }
  return check(
    "publish_gap",
    "Scheduled vs live .wl files",
    "pass",
    `${activeCount} active procedure(s); ${wlFileCount} live .wl file(s)`,
  );
}

export const MWL_CRITICAL_CHECK_IDS = new Set([
  "env_dir",
  "dir_writable",
  "dump2dcm",
  "atomic_publish",
  "publish_gap",
]);

export function deriveMwlVerdict(checks: MwlCheck[]): { ready: boolean; verdict: MwlVerdict } {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const criticalFail = [...MWL_CRITICAL_CHECK_IDS].some((id) => byId.get(id)?.status === "fail");
  const anyFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  const ready = [...MWL_CRITICAL_CHECK_IDS].every((id) => {
    const c = byId.get(id);
    if (!c) return id === "publish_gap" || id === "atomic_publish";
    if (c.status === "skip" && (id === "publish_gap" || id === "atomic_publish")) return true;
    return c.status === "pass";
  });
  if (criticalFail || !ready) return { ready: false, verdict: "failed" };
  if (anyFail) return { ready: false, verdict: "failed" };
  if (anyWarn) return { ready: true, verdict: "degraded" };
  return { ready: true, verdict: "healthy" };
}
