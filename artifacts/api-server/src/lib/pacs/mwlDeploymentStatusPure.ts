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

/**
 * Directories the API should inspect for mwl-guard quarantine.
 * Live `.env` uses ORTHANC_WORKLIST_DIR=/orthanc-worklists; dirname of that is `/`,
 * so sibling lookup alone is not enough — compose must also mount `/worklists-bad`.
 */
export function resolveWorklistBadDirs(
  liveDir: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  const push = (p: string | null | undefined) => {
    const t = p?.trim();
    if (!t) return;
    const n = t.replace(/\/+$/, "") || "/";
    if (!out.includes(n)) out.push(n);
  };
  push(env.ORTHANC_WORKLIST_BAD_DIR);
  push("/worklists-bad");
  if (liveDir?.trim()) {
    const live = liveDir.trim().replace(/\/+$/, "") || "/";
    const parent = live === "/" ? "/" : live.replace(/\/[^/]+$/, "") || "/";
    push(parent === "/" ? "/worklists-bad" : `${parent}/worklists-bad`);
    // Host-style sibling: …/orthanc/worklists → …/orthanc/worklists-bad
    if (/\/worklists$/i.test(live)) {
      push(live.replace(/\/worklists$/i, "/worklists-bad"));
    }
  }
  return out;
}

/** First useful line of an mwl-guard .reason.txt, stripped of likely PHI. */
export function sanitizeQuarantineReason(text: string): string | null {
  const parsed = parseMwlGuardReason(text);
  if (parsed) return parsed;
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => {
    if (!l) return false;
    if (/^(quarantined_at_utc|source|severity|reasons)\s*[=:]?/i.test(l)) return false;
    return true;
  });
  if (!line) return null;
  const technical = /UID|empty|invalid|missing|housekeeper|SOP|Series|Study/i.test(line);
  if (/\^/.test(line) || /\bPatient(Name|ID)?\b/i.test(line)) {
    return technical
      ? line.replace(/\[[^\]]{8,}\]/g, "[…]").slice(0, 200)
      : "quarantined (see .reason.txt on NAS — do not copy files back)";
  }
  return line.slice(0, 240);
}

/**
 * care-mwl-guard writes:
 *   severity=crash-class
 *   reasons:
 *     - missing/invalid StudyInstanceUID ('') — Orthanc housekeeper would terminate Orthanc
 */
export function parseMwlGuardReason(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const severityLine = lines.find((l) => /^severity=/i.test(l));
  const reasonBullets = lines.filter((l) => /^- /.test(l));
  if (!severityLine && reasonBullets.length === 0) return null;

  const severity = severityLine?.slice(severityLine.indexOf("=") + 1).trim() || "quarantined";
  const uids: string[] = [];
  for (const bullet of reasonBullets) {
    for (const name of ["StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID"]) {
      if (bullet.includes(name) && !uids.includes(name)) uids.push(name);
    }
  }
  if (uids.length > 0) {
    return `${severity}: missing/invalid ${uids.join(", ")} — Orthanc housekeeper would crash; do not copy back`;
  }
  if (severityLine) {
    return `${severity} quarantine — do not copy worklists-bad back`;
  }
  return null;
}

export const MWL_QUARANTINE_FIX =
  "Do not copy worklists-bad back into the live worklists folder — Orthanc's housekeeper can crash on empty Study/Series/SOP UIDs. Redeploy care-api so live + staging worklists are mounted, then click Sync worklist to write valid .wl files. Leave quarantine as an audit trail. Historical studies already in PACS still need Auto-link on Match Center.";

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
