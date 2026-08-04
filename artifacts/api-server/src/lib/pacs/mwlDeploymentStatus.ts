/**
 * Modality Worklist (MWL) deployment diagnostics — used by Settings → Radiology → DICOM & MWL.
 */

import { access, readdir, writeFile, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { db } from "@workspace/db";
import { radiologyScheduledProceduresTable } from "@workspace/db/schema";
import { desc, eq, inArray, and, sql } from "drizzle-orm";
import { isMwlEnabled, worklistDir } from "./mwlWorklistWriter";

export type MwlCheckStatus = "pass" | "warn" | "fail" | "skip";

export type MwlCheck = {
  id: string;
  title: string;
  status: MwlCheckStatus;
  detail: string;
  fix?: string;
};

export type MwlRecentProcedure = {
  accessionNumber: string;
  patientName: string | null;
  modality: string | null;
  status: string | null;
  scheduledDate: string | null;
  hasWlFile: boolean;
};

export type MwlDeploymentStatus = {
  /** True when bill → .wl → modality path can work end-to-end. */
  ready: boolean;
  checks: MwlCheck[];
  worklistDir: string | null;
  worklistHostHint: string | null;
  wlFileCount: number;
  procedureStats: Record<string, number>;
  recentActive: MwlRecentProcedure[];
  /** Plain-language setup steps (shown in UI). */
  setupSteps: string[];
};

function check(
  id: string,
  title: string,
  status: MwlCheckStatus,
  detail: string,
  fix?: string,
): MwlCheck {
  return { id, title, status, detail, fix };
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

function dump2dcmAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", ["dump2dcm"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
    setTimeout(() => { try { proc.kill(); } catch { /* */ } resolve(false); }, 3000);
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

async function wlFileExists(dir: string, accession: string): Promise<boolean> {
  const safe = accession.replace(/[^A-Za-z0-9._-]/g, "_") + ".wl";
  try {
    await access(path.join(dir, safe));
    return true;
  } catch {
    return false;
  }
}

async function probeOrthancPlugins(): Promise<{ ok: boolean; hasWorklists: boolean; plugins: string[]; detail: string }> {
  const base = (process.env.ORTHANC_INTERNAL_URL || "http://care-orthanc:8042").replace(/\/$/, "");
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
  "On the NAS/host: create the shared folder (default: /volume1/docker/care-pacs/orthanc/worklists).",
  "In care.env: set ORTHANC_WORKLIST_DIR=/orthanc-worklists and ORTHANC_WORKLIST_HOST_DIR to that host path.",
  "Restart care-api (docker compose up -d care-api) so the volume mount is active.",
  "In Orthanc (care-pacs): enable the worklists plugin and point Database to the same folder (inside Orthanc: /var/lib/orthanc/worklists).",
  "On the USG machine: set Modality Worklist SCP to Orthanc's MWL AE (often ORTHANC_MWL on port 4242) — or use the Windows MWL agent querying GET /api/internal/radiology/mwl.",
  "Bill a USG test — patient should appear on the USG worklist within seconds. Accession ACC-…-US-… must copy onto the study.",
  "After scan ends, Orthanc pushes study back to ERP — queue token completes and PACS Worklist refreshes automatically.",
];

export async function getMwlDeploymentStatus(): Promise<MwlDeploymentStatus> {
  const checks: MwlCheck[] = [];
  const dir = worklistDir();
  const hostHint = process.env.ORTHANC_WORKLIST_HOST_DIR?.trim() || null;

  // 1 — Env configured
  if (!isMwlEnabled()) {
    checks.push(check(
      "env_dir",
      "ORTHANC_WORKLIST_DIR set",
      "fail",
      "Not set — MWL file publishing is disabled. Bills still create DB rows, but no .wl files reach Orthanc.",
      "Add ORTHANC_WORKLIST_DIR=/orthanc-worklists to care.env and mount the host folder in docker-compose.yml (see docs/MWL_SETUP_SIMPLE.md).",
    ));
  } else {
    checks.push(check("env_dir", "ORTHANC_WORKLIST_DIR set", "pass", dir!));
  }

  // 2 — Folder writable
  let wlFileCount = 0;
  if (dir) {
    const writable = await pathWritable(dir);
    wlFileCount = await countWlFiles(dir);
    checks.push(check(
      "dir_writable",
      "Worklist folder writable",
      writable ? "pass" : "fail",
      writable ? `${dir} (${wlFileCount} .wl file(s))` : `Cannot write to ${dir} — check Docker volume mount`,
      writable ? undefined : `Ensure ORTHANC_WORKLIST_HOST_DIR exists on the host and is mounted into care-api at ${dir}. Run: mkdir -p ${hostHint ?? "<host-path>"}`,
    ));
  } else {
    checks.push(check("dir_writable", "Worklist folder writable", "skip", "Skipped — ORTHANC_WORKLIST_DIR not set"));
  }

  // 3 — DCMTK dump2dcm
  const hasDump = await dump2dcmAvailable();
  checks.push(check(
    "dump2dcm",
    "DCMTK dump2dcm installed",
    hasDump ? "pass" : "fail",
    hasDump ? "dump2dcm is on PATH" : "dump2dcm not found — .wl files cannot be generated",
    hasDump ? undefined : "Rebuild care-api image (Dockerfile installs dcmtk) or apt install dcmtk on the host.",
  ));

  // 4 — PACS provider
  const pacsProvider = (process.env.PACS_PROVIDER || "orthanc").toLowerCase();
  checks.push(check(
    "pacs_provider",
    "PACS provider = Orthanc",
    pacsProvider === "orthanc" ? "pass" : "warn",
    `PACS_PROVIDER=${pacsProvider}`,
    pacsProvider === "orthanc" ? undefined : "Set PACS_PROVIDER=orthanc for the standard Orthanc intake path.",
  ));

  // 5 — Study return (internal API key)
  const hasInternalKey = !!(process.env.INTERNAL_API_KEY?.trim());
  checks.push(check(
    "internal_api_key",
    "INTERNAL_API_KEY (Orthanc → ERP)",
    hasInternalKey ? "pass" : "warn",
    hasInternalKey ? "Set — Orthanc webhook/poller can push studies to ERP" : "Not set — automatic study intake from Orthanc may fail",
    hasInternalKey ? undefined : "Set INTERNAL_API_KEY in care.env (same value in Orthanc erp_notify.lua and care-erp-sync).",
  ));

  // 6 — Orthanc worklists plugin
  const orthancPlugins = await probeOrthancPlugins();
  if (!orthancPlugins.ok) {
    checks.push(check(
      "orthanc_worklists",
      "Orthanc worklists plugin",
      "warn",
      `Could not verify: ${orthancPlugins.detail}`,
      "Ensure care-orthanc is running and ORTHANC_INTERNAL_URL is correct. Alternatively use the Windows MWL agent (GET /api/internal/radiology/mwl).",
    ));
  } else if (orthancPlugins.hasWorklists) {
    checks.push(check("orthanc_worklists", "Orthanc worklists plugin", "pass", orthancPlugins.detail));
  } else {
    checks.push(check(
      "orthanc_worklists",
      "Orthanc worklists plugin",
      "warn",
      orthancPlugins.detail,
      'Add to orthanc.json: "Worklists": { "Enable": true, "Database": "/var/lib/orthanc/worklists" } and mount the shared host folder.',
    ));
  }

  // 7 — DB procedures today
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

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
      .where(
        andActiveToday(ymd),
      )
      .orderBy(desc(radiologyScheduledProceduresTable.updatedAt))
      .limit(8),
  ]);

  const procedureStats: Record<string, number> = {};
  for (const r of statsRows) procedureStats[r.status ?? "UNKNOWN"] = r.count;

  const activeToday = (procedureStats.SCHEDULED ?? 0) + (procedureStats.SENT_TO_MWL ?? 0);
  checks.push(check(
    "db_procedures",
    "Scheduled procedures in ERP",
    activeToday > 0 ? "pass" : "warn",
    activeToday > 0
      ? `${activeToday} active today (SCHEDULED/SENT_TO_MWL); ${wlFileCount} .wl on disk`
      : "No active MWL rows today — bill a USG/MRI/CT test to test the flow",
    activeToday > 0 ? undefined : "Create a bill with a radiology test; the ERP auto-publishes to radiology_scheduled_procedures.",
  ));

  const recentActive: MwlRecentProcedure[] = [];
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

  const criticalIds = new Set(["env_dir", "dir_writable", "dump2dcm"]);
  const ready = checks
    .filter((c) => criticalIds.has(c.id))
    .every((c) => c.status === "pass");

  return {
    ready,
    checks,
    worklistDir: dir,
    worklistHostHint: hostHint,
    wlFileCount,
    procedureStats,
    recentActive,
    setupSteps: SETUP_STEPS,
  };
}

function andActiveToday(ymd: string) {
  return and(
    eq(radiologyScheduledProceduresTable.scheduledDate, ymd),
    inArray(radiologyScheduledProceduresTable.status, ["SCHEDULED", "SENT_TO_MWL", "IN_PROGRESS"]),
  );
}
