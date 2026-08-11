/**
 * Modality Worklist (MWL) deployment diagnostics — used by Settings → Radiology → MWL.
 *
 * Important: `ready` / `verdict` must NOT be green merely because ORTHANC_WORKLIST_DIR
 * exists. Atomic publish failures (EXDEV), publish gaps (scheduled rows but 0 .wl files),
 * and missing tools must surface as FAILED / degraded.
 *
 * Pure helpers live in mwlDeploymentStatusPure.ts (unit-testable without DATABASE_URL).
 */

import { access, readdir, writeFile, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "@workspace/db";
import { radiologyScheduledProceduresTable } from "@workspace/db/schema";
import { desc, eq, inArray, and, sql } from "drizzle-orm";
import { isMwlEnabled, worklistDir, getMwlStagingDir } from "./mwlWorklistWriter";
import { probeAtomicPublish } from "./mwlAtomicPublishProbe";
import {
  check,
  resolveOrthancInternalUrl,
  assessPublishGap,
  deriveMwlVerdict,
  MWL_CRITICAL_CHECK_IDS,
  type MwlCheck,
  type MwlCheckStatus,
  type MwlVerdict,
  type OrthancInternalUrlInfo,
} from "./mwlDeploymentStatusPure";

export {
  check,
  resolveOrthancInternalUrl,
  assessPublishGap,
  deriveMwlVerdict,
  MWL_CRITICAL_CHECK_IDS,
  probeAtomicPublish,
};
export type { MwlCheck, MwlCheckStatus, MwlVerdict, OrthancInternalUrlInfo };

export type MwlRecentProcedure = {
  accessionNumber: string;
  patientName: string | null;
  modality: string | null;
  status: string | null;
  scheduledDate: string | null;
  hasWlFile: boolean;
};

export type MwlDeploymentStatus = {
  /** True only when critical publish path can work end-to-end. */
  ready: boolean;
  /** Coarser traffic-light for Overview. */
  verdict: MwlVerdict;
  checks: MwlCheck[];
  worklistDir: string | null;
  worklistHostHint: string | null;
  stagingDir: string | null;
  stagingHostHint: string | null;
  wlFileCount: number;
  quarantineCount: number;
  activeProcedureCount: number;
  procedureStats: Record<string, number>;
  recentActive: MwlRecentProcedure[];
  orthancInternal: OrthancInternalUrlInfo;
  lastSync: {
    written: number | null;
    removed: number | null;
    total: number | null;
    at: string | null;
    error: string | null;
  } | null;
  setupSteps: string[];
};

/** In-memory last sync result (set by sync route; process-local). */
let lastMwlSyncMemory: MwlDeploymentStatus["lastSync"] = null;

export function recordMwlSyncResult(result: {
  written: number;
  removed: number;
  total: number;
  error?: string | null;
}): void {
  lastMwlSyncMemory = {
    written: result.written,
    removed: result.removed,
    total: result.total,
    at: new Date().toISOString(),
    error: result.error ?? null,
  };
}

export function getLastMwlSyncResult(): MwlDeploymentStatus["lastSync"] {
  return lastMwlSyncMemory;
}

async function pathWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.mwl_probe_${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

function binaryAvailable(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", [name], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
    setTimeout(() => {
      try { proc.kill(); } catch { /* */ }
      resolve(false);
    }, 3000);
  });
}

async function countWlFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith(".wl")).length;
  } catch {
    return 0;
  }
}

async function countQuarantineFiles(liveDir: string | null): Promise<number> {
  if (!liveDir) return 0;
  const candidates = [
    path.join(path.dirname(liveDir), "worklists-bad"),
  ];
  for (const dir of candidates) {
    try {
      await access(dir);
      const entries = await readdir(dir);
      return entries.filter((f) => f.endsWith(".wl") || f.endsWith(".dcm") || f.endsWith(".bad")).length;
    } catch {
      /* not present */
    }
  }
  return 0;
}

async function wlFileExists(dir: string, accession: string): Promise<boolean> {
  const safe = accession.replace(/[^A-Za-z0-9._-]/g, "_") + ".wl";
  try {
    await access(path.join(dir, safe));
    return true;
  } catch {
    return false;
  }
}

async function probeOrthancPlugins(base: string | null): Promise<{
  ok: boolean;
  hasWorklists: boolean;
  plugins: string[];
  detail: string;
}> {
  if (!base) {
    return {
      ok: false,
      hasWorklists: false,
      plugins: [],
      detail: "ORTHANC_INTERNAL_URL not set — skipped Orthanc probe (no invented Docker hostname)",
    };
  }
  const user = process.env.ORTHANC_USERNAME?.trim();
  const pass = process.env.ORTHANC_PASSWORD?.trim();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (user && pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${base}/plugins`, { headers, signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) {
      return { ok: false, hasWorklists: false, plugins: [], detail: `Orthanc /plugins HTTP ${resp.status}` };
    }
    const body = await resp.json() as unknown;
    const plugins = Array.isArray(body) ? body.map(String) : [];
    const hasWorklists = plugins.some((p) => /worklist/i.test(p));
    return {
      ok: true,
      hasWorklists,
      plugins,
      detail: hasWorklists
        ? `worklists plugin loaded (${plugins.join(", ")})`
        : `worklists plugin NOT found (${plugins.join(", ") || "no plugins listed"})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, hasWorklists: false, plugins: [], detail: msg };
  }
}

const SETUP_STEPS = [
  "On the NAS/host: ensure live + staging folders exist on the SAME volume (default: …/orthanc/worklists and …/orthanc/worklists-staging).",
  "In care.env: ORTHANC_WORKLIST_DIR=/orthanc-worklists and mount host worklists → /orthanc-worklists; mount staging → /worklists-staging.",
  "Set ORTHANC_INTERNAL_URL to a URL care-api can reach (LAN IP when ERP and PACS are separate Compose networks — not an invented Docker DNS name).",
  "Restart care-api so mounts are active.",
  "In Orthanc (care-pacs): enable worklists plugin; keep care-mwl-guard healthy.",
  "Bill a radiology test → Sync → confirm .wl count rises and modality C-FIND sees the patient.",
];

function andActiveToday(ymd: string) {
  return and(
    eq(radiologyScheduledProceduresTable.scheduledDate, ymd),
    inArray(radiologyScheduledProceduresTable.status, ["SCHEDULED", "SENT_TO_MWL", "IN_PROGRESS"]),
  );
}

export async function getMwlDeploymentStatus(): Promise<MwlDeploymentStatus> {
  const checks: MwlCheck[] = [];
  const dir = worklistDir();
  const hostHint = process.env.ORTHANC_WORKLIST_HOST_DIR?.trim() || null;
  const staging = dir ? getMwlStagingDir() : null;
  const stagingHostHint = process.env.ORTHANC_WORKLIST_STAGING_HOST_DIR?.trim()
    || (hostHint ? hostHint.replace(/\/?worklists\/?$/, "/worklists-staging") : null);
  const orthancInternal = resolveOrthancInternalUrl();

  // 1 — Env configured
  if (!isMwlEnabled()) {
    checks.push(check(
      "env_dir",
      "ORTHANC_WORKLIST_DIR set",
      "fail",
      "Not set — MWL file publishing is disabled. Bills still create DB rows, but no .wl files reach Orthanc.",
      "Add ORTHANC_WORKLIST_DIR=/orthanc-worklists to care.env and mount the host folder in docker-compose.yml.",
    ));
  } else {
    checks.push(check("env_dir", "ORTHANC_WORKLIST_DIR set", "pass", dir!));
  }

  // 2 — Live folder writable
  let wlFileCount = 0;
  if (dir) {
    const writable = await pathWritable(dir);
    wlFileCount = await countWlFiles(dir);
    checks.push(check(
      "dir_writable",
      "Live worklist folder writable",
      writable ? "pass" : "fail",
      writable ? `${dir} (${wlFileCount} .wl file(s))` : `Cannot write to ${dir} — check Docker volume mount`,
      writable ? undefined : `Ensure host path exists and is mounted at ${dir}.`,
    ));
  } else {
    checks.push(check("dir_writable", "Live worklist folder writable", "skip", "Skipped — ORTHANC_WORKLIST_DIR not set"));
  }

  // 3 — Staging present + writable
  if (dir && staging) {
    const stagingWritable = await pathWritable(staging);
    checks.push(check(
      "staging_dir",
      "Staging folder writable",
      stagingWritable ? "pass" : "fail",
      stagingWritable
        ? `${staging}${stagingHostHint ? ` (host hint: ${stagingHostHint})` : ""}`
        : `Cannot write to staging ${staging} — mount host worklists-staging at /worklists-staging`,
      stagingWritable ? undefined : "Create /volume1/docker/care-pacs/orthanc/worklists-staging and mount it into care-api at /worklists-staging.",
    ));
  } else {
    checks.push(check("staging_dir", "Staging folder writable", "skip", "Skipped — live worklist dir not set"));
  }

  // 4 — Atomic publish (EXDEV)
  if (dir && staging) {
    const atomic = await probeAtomicPublish(dir, staging);
    checks.push(check(
      "atomic_publish",
      "Atomic staging → live rename",
      atomic.ok ? "pass" : "fail",
      atomic.detail,
      atomic.ok
        ? undefined
        : "Staging and live must be on the same filesystem. Do not point staging at a different volume or at OS tmp across devices.",
    ));
  } else {
    checks.push(check("atomic_publish", "Atomic staging → live rename", "skip", "Skipped — dirs not configured"));
  }

  // 5 — DCMTK tools
  const [hasDump, hasDcmdump] = await Promise.all([
    binaryAvailable("dump2dcm"),
    binaryAvailable("dcmdump"),
  ]);
  checks.push(check(
    "dump2dcm",
    "DCMTK dump2dcm installed",
    hasDump ? "pass" : "fail",
    hasDump ? "dump2dcm is on PATH" : "dump2dcm not found — .wl files cannot be generated",
    hasDump ? undefined : "Rebuild care-api image (Dockerfile installs dcmtk) or apt install dcmtk.",
  ));
  checks.push(check(
    "dcmdump",
    "DCMTK dcmdump installed",
    hasDcmdump ? "pass" : "warn",
    hasDcmdump ? "dcmdump is on PATH (post-write UID validation)" : "dcmdump not found — publish still validates dump text, but post-DICOM checks are weaker",
    hasDcmdump ? undefined : "Install dcmtk for stronger post-dump2dcm validation.",
  ));

  // 6 — PACS provider
  const pacsProvider = (process.env.PACS_PROVIDER || "orthanc").toLowerCase();
  checks.push(check(
    "pacs_provider",
    "PACS provider = Orthanc",
    pacsProvider === "orthanc" ? "pass" : "warn",
    `PACS_PROVIDER=${pacsProvider}`,
  ));

  // 7 — Internal API key (presence only — never echo value)
  const hasInternalKey = !!(process.env.INTERNAL_API_KEY?.trim());
  checks.push(check(
    "internal_api_key",
    "INTERNAL_API_KEY (Orthanc → ERP)",
    hasInternalKey ? "pass" : "warn",
    hasInternalKey ? "Set (value hidden)" : "Not set — automatic study intake from Orthanc may fail",
  ));

  // 8 — Orthanc internal URL + worklists plugin
  checks.push(check(
    "orthanc_internal_url",
    "ORTHANC_INTERNAL_URL",
    orthancInternal.source === "env" ? "pass" : "fail",
    `${orthancInternal.display}. ${orthancInternal.networkNote}`,
    orthancInternal.source === "env"
      ? undefined
      : "Set ORTHANC_INTERNAL_URL in care.env to a URL reachable from care-api (LAN IP when networks are separate).",
  ));

  const orthancPlugins = await probeOrthancPlugins(orthancInternal.probeUrl);
  if (!orthancPlugins.ok) {
    checks.push(check(
      "orthanc_worklists",
      "Orthanc worklists plugin",
      orthancInternal.probeUrl ? "fail" : "warn",
      `Could not verify: ${orthancPlugins.detail}`,
      "Ensure Orthanc is reachable via ORTHANC_INTERNAL_URL and the worklists plugin is enabled. ERP and Orthanc may be on separate Docker networks.",
    ));
  } else if (orthancPlugins.hasWorklists) {
    checks.push(check("orthanc_worklists", "Orthanc worklists plugin", "pass", orthancPlugins.detail));
  } else {
    checks.push(check(
      "orthanc_worklists",
      "Orthanc worklists plugin",
      "fail",
      orthancPlugins.detail,
      'Enable Worklists in orthanc.json and mount the shared worklists folder.',
    ));
  }

  // 9 — Quarantine (mwl-guard)
  const quarantineCount = await countQuarantineFiles(dir);
  checks.push(check(
    "quarantine",
    "Quarantined worklist files",
    quarantineCount === 0 ? "pass" : "warn",
    quarantineCount === 0
      ? "No quarantined .wl files detected in worklists-bad"
      : `${quarantineCount} file(s) in quarantine (worklists-bad) — inspect care-mwl-guard logs`,
  ));

  // 10 — DB procedures + publish gap
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  let procedureStats: Record<string, number> = {};
  let recentActive: MwlRecentProcedure[] = [];
  let activeProcedureCount = 0;
  try {
    const [statsRows, recentRows] = await Promise.all([
      db
        .select({ status: radiologyScheduledProceduresTable.status, count: sql<number>`count(*)::int` })
        .from(radiologyScheduledProceduresTable)
        .groupBy(radiologyScheduledProceduresTable.status),
      db
        .select({
          accessionNumber: radiologyScheduledProceduresTable.accessionNumber,
          patientName: radiologyScheduledProceduresTable.patientName,
          modality: radiologyScheduledProceduresTable.modality,
          status: radiologyScheduledProceduresTable.status,
          scheduledDate: radiologyScheduledProceduresTable.scheduledDate,
        })
        .from(radiologyScheduledProceduresTable)
        .where(andActiveToday(ymd))
        .orderBy(desc(radiologyScheduledProceduresTable.updatedAt))
        .limit(8),
    ]);

    for (const r of statsRows) procedureStats[r.status ?? "UNKNOWN"] = r.count;
    activeProcedureCount = (procedureStats.SCHEDULED ?? 0)
      + (procedureStats.SENT_TO_MWL ?? 0)
      + (procedureStats.IN_PROGRESS ?? 0);

    checks.push(check(
      "db_procedures",
      "Scheduled procedures in ERP",
      activeProcedureCount > 0 ? "pass" : "warn",
      activeProcedureCount > 0
        ? `${activeProcedureCount} active (SCHEDULED/SENT_TO_MWL/IN_PROGRESS); ${wlFileCount} .wl on disk`
        : "No active MWL rows — bill a radiology test to exercise the flow",
    ));

    checks.push(assessPublishGap(activeProcedureCount, wlFileCount));

    for (const row of recentRows) {
      recentActive.push({
        accessionNumber: row.accessionNumber,
        patientName: row.patientName,
        modality: row.modality,
        status: row.status,
        scheduledDate: row.scheduledDate,
        hasWlFile: dir ? await wlFileExists(dir, row.accessionNumber) : false,
      });
    }
  } catch (dbErr) {
    const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
    checks.push(check(
      "db_procedures",
      "Scheduled procedures in ERP",
      "fail",
      `Could not read radiology_scheduled_procedures: ${detail}`,
      "Run pending migrations so radiology_scheduled_procedures exists.",
    ));
    checks.push(assessPublishGap(0, wlFileCount));
    recentActive = [];
    procedureStats = {};
  }

  // 11 — Last sync memory (if any)
  const lastSync = getLastMwlSyncResult();
  if (lastSync?.error) {
    checks.push(check("last_sync", "Last MWL sync", "fail", lastSync.error));
  } else if (lastSync && lastSync.written === 0 && (lastSync.total ?? 0) > 0) {
    checks.push(check(
      "last_sync",
      "Last MWL sync",
      "fail",
      `Last sync wrote 0 of ${lastSync.total} procedure(s) at ${lastSync.at}`,
      "Inspect care-api logs for atomic rename / dump2dcm failures.",
    ));
  } else if (lastSync) {
    checks.push(check(
      "last_sync",
      "Last MWL sync",
      "pass",
      `Wrote ${lastSync.written}, removed ${lastSync.removed} of ${lastSync.total} at ${lastSync.at}`,
    ));
  }

  const { ready, verdict } = deriveMwlVerdict(checks);

  return {
    ready,
    verdict,
    checks,
    worklistDir: dir,
    worklistHostHint: hostHint,
    stagingDir: staging,
    stagingHostHint,
    wlFileCount,
    quarantineCount,
    activeProcedureCount,
    procedureStats,
    recentActive,
    orthancInternal,
    lastSync,
    setupSteps: SETUP_STEPS,
  };
}
