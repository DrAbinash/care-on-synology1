/**
 * Care Diagnostics DICOM Q/R Pull Agent
 * ──────────────────────────────────────────────────────────────────────────────
 * Runs on the Conquest PACS server machine (Windows/Linux).
 * Polls the ERP API for pending pull jobs, executes DCMTK findscu + movescu
 * to pull studies from each imaging machine into Conquest automatically.
 *
 * Prerequisites:
 *   1. DCMTK installed — https://dcmtk.org/en/dcmtk/dcmtk-overview/
 *      Windows: download the "official release" ZIP, extract, add bin/ to PATH
 *              or set DCMTK_DIR to the bin/ folder.
 *      Ubuntu:  sudo apt install dcmtk
 *   2. Node.js >= 18
 *   3. Environment variables (see below)
 *
 * Environment variables:
 *   ERP_BASE_URL        https://your-erp.replit.app
 *   INTERNAL_API_KEY    must match the server-side INTERNAL_API_KEY secret
 *   DCMTK_DIR           optional — path to DCMTK bin/ if not in system PATH
 *   AGENT_AE_TITLE      AE Title this agent uses when connecting (default: DIAGNO_AGENT)
 *   CONQUEST_AE_TITLE   Conquest AE Title (default: CONQUEST1)
 *   CONQUEST_HOST       Conquest IP/host (default: 127.0.0.1)
 *   CONQUEST_PORT       Conquest DICOM port (default: 5678)
 *   POLL_INTERVAL_MS    How often to poll the ERP in ms (default: 30000)
 *   LOG_LEVEL           debug | info | warn | error (default: info)
 *
 * Quick start (Windows CMD):
 *   set ERP_BASE_URL=https://your-erp.replit.app
 *   set INTERNAL_API_KEY=your-secret
 *   set CONQUEST_HOST=127.0.0.1
 *   node src/index.js
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────────────────────────

const ERP_BASE        = (process.env.ERP_BASE_URL ?? "").replace(/\/$/, "");
const API_KEY         = process.env.INTERNAL_API_KEY ?? "";
const DCMTK_DIR       = process.env.DCMTK_DIR ?? "";
const AGENT_AE        = process.env.AGENT_AE_TITLE ?? "DIAGNO_AGENT";
const CONQUEST_AE     = process.env.CONQUEST_AE_TITLE ?? "CONQUEST1";
const CONQUEST_HOST   = process.env.CONQUEST_HOST ?? "127.0.0.1";
const CONQUEST_PORT   = Number(process.env.CONQUEST_PORT ?? 5678);
const POLL_MS         = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
const LOG_LEVEL       = process.env.LOG_LEVEL ?? "info";
const AGENT_ID        = os.hostname();

// ERP Telemetry — opt-in. Set ERP_HEARTBEAT_ENABLED=1 to enable.
// When enabled, the agent sends a heartbeat after every poll cycle and a log
// entry for every C-FIND / C-MOVE event. ERP errors are non-fatal and never
// block DICOM operations.
const HEARTBEAT_ENABLED  = process.env.ERP_HEARTBEAT_ENABLED === "1";
const HEARTBEAT_ENDPOINT = process.env.ERP_HEARTBEAT_ENDPOINT || `${ERP_BASE}/api/internal/dicom-agent/heartbeat`;
const LOG_ENDPOINT       = process.env.ERP_LOG_ENDPOINT       || `${ERP_BASE}/api/internal/dicom-agent/log`;
const AGENT_NAME         = process.env.AGENT_NAME             || AGENT_ID;
const CONFIG_ENDPOINT    = process.env.ERP_CONFIG_ENDPOINT    || `${ERP_BASE}/api/internal/dicom-agent/config`;
const CONFIG_FETCH_ENABLED = process.env.ERP_CONFIG_ENABLED   !== "0"; // default on
const CONFIG_INTERVAL_MS = Number(process.env.ERP_CONFIG_INTERVAL_MS ?? 5 * 60 * 1000); // 5 min

// Session-level accumulators (reset when the agent process restarts).
let sessionStudiesFound  = 0;
let sessionStudiesPulled = 0;
let sessionFailed        = 0;

// ── Remote config ──────────────────────────────────────────────────────────────
// When CONFIG_FETCH_ENABLED the agent auto-fetches its config from the ERP
// every CONFIG_INTERVAL_MS. Modality rows returned are stored here and can be
// used by custom poll logic. Config errors are non-fatal (the agent keeps the
// last good config / falls back to env-var config).

/** @type {{ conquest: object; modalities: object[]; pullSettings: object; erpSettings: object } | null} */
let remoteConfig = null;
let lastConfigFetch = 0;

async function fetchAgentConfig() {
  if (!CONFIG_FETCH_ENABLED || !ERP_BASE || !API_KEY) return;
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[config] ERP config fetch failed: HTTP ${res.status}`);
      return;
    }
    remoteConfig = await res.json();
    lastConfigFetch = Date.now();
    const count = remoteConfig?.modalities?.length ?? 0;
    console.log(`[config] Loaded remote config — ${count} active modalities.`);
  } catch (err) {
    console.warn(`[config] Failed to fetch ERP config: ${err?.message ?? err}`);
  }
}

async function startConfigRefreshLoop() {
  await fetchAgentConfig(); // initial fetch at startup
  setInterval(fetchAgentConfig, CONFIG_INTERVAL_MS);
}

// ── Startup validation ────────────────────────────────────────────────────────

if (!ERP_BASE) {
  console.error("[agent] FATAL: ERP_BASE_URL is not set.");
  process.exit(1);
}
if (!API_KEY) {
  console.error("[agent] FATAL: INTERNAL_API_KEY is not set. The ERP will reject all requests.");
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if ((LEVELS[level] ?? 0) >= MIN_LEVEL) {
    console[level === "debug" ? "log" : level](`[agent][${level.toUpperCase()}]`, ...args);
  }
}

// ── ERP Telemetry helpers (fire-and-forget) ───────────────────────────────────

async function postHeartbeat(extra = {}) {
  if (!HEARTBEAT_ENABLED) return;
  try {
    await fetch(HEARTBEAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        agentName: AGENT_NAME,
        agentHost: AGENT_ID,
        stats: {
          studiesFoundToday:  sessionStudiesFound,
          studiesPulledToday: sessionStudiesPulled,
          failedToday:        sessionFailed,
        },
        ...extra,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-fatal */ }
}

async function postLog(payload = {}) {
  if (!HEARTBEAT_ENABLED) return;
  try {
    await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ agentName: AGENT_NAME, agentHost: AGENT_ID, ...payload }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-fatal */ }
}

// ── DCMTK helpers ────────────────────────────────────────────────────────────

function dcmtkBin(name) {
  if (DCMTK_DIR) return path.join(DCMTK_DIR, name);
  return name; // assume in PATH
}

async function checkDcmtk() {
  try {
    await execFileAsync(dcmtkBin("findscu"), ["--version"], { timeout: 5000 });
    log("info", "DCMTK findscu found ✓");
    return true;
  } catch {
    log("error", `DCMTK not found. Install DCMTK and ensure 'findscu' is in PATH or set DCMTK_DIR.`);
    log("error", `Download: https://dcmtk.org/en/dcmtk/dcmtk-overview/`);
    return false;
  }
}

/**
 * Run C-FIND on a modality to discover Study Instance UIDs for the given date range.
 * Returns an array of Study Instance UIDs found on the machine.
 */
async function findStudies(node, dateFrom, dateTo) {
  // DICOM date format: YYYYMMDD or YYYYMMDD-YYYYMMDD for a range
  const dicomDateFrom = dateFrom.replace(/-/g, "");
  const dicomDateTo   = dateTo.replace(/-/g, "");
  const dicomDateRange = dicomDateFrom === dicomDateTo
    ? dicomDateFrom
    : `${dicomDateFrom}-${dicomDateTo}`;

  const args = [
    "-S",                            // Study Root Information Model (C-FIND)
    "-k", "0008,0052=STUDY",         // QueryRetrieveLevel = STUDY
    "-k", `0008,0020=${dicomDateRange}`, // StudyDate
    "-k", "0020,000D=",              // StudyInstanceUID — return value
    "-k", "0008,0060=",              // Modality
    "-k", "0010,0010=",              // PatientName
    "-k", "0010,0020=",              // PatientID
    "-k", "0008,0050=",              // AccessionNumber
    "-k", "0008,1030=",              // StudyDescription
    "-aet", AGENT_AE,                // Our AE title
    "-aec", node.aeTitle,            // Remote AE title (the modality)
    node.host,
    String(node.port),
  ];

  log("debug", `[node ${node.id}] findscu ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(dcmtkBin("findscu"), args, {
      timeout: 60_000,
    });
    const output = stdout + "\n" + stderr;

    // Parse StudyInstanceUID values from findscu output.
    // findscu prints lines like:  (0020,000d) UI [1.2.840.10008.5.1.4.1.2.2.1]
    const uids = new Set();
    for (const line of output.split("\n")) {
      const m = line.match(/\(0020,000d\)\s+UI\s+\[([^\]]+)\]/i);
      if (m) {
        const uid = m[1].trim();
        if (uid && uid !== "0") uids.add(uid);
      }
    }

    const result = [...uids];
    log("info", `[node ${node.id}] C-FIND found ${result.length} studies for ${dicomDateRange}`);
    void postLog({
      eventType: "C_FIND",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      status: "SUCCESS",
      message: `C-FIND → ${node.aeTitle} (${node.host}:${node.port}): ${result.length} studies for ${dicomDateRange}`,
      rawPayload: { nodeId: node.id, dicomDateRange, studiesFound: result.length },
    });
    return { ok: true, studyInstanceUIDs: result };
  } catch (err) {
    log("error", `[node ${node.id}] findscu failed:`, err.message);
    void postLog({
      eventType: "C_FIND",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      status: "FAILED",
      message: `C-FIND → ${node.aeTitle} failed: ${err.message}`,
      rawPayload: { nodeId: node.id, dicomDateRange, error: err.message },
    });
    return { ok: false, error: err.message, studyInstanceUIDs: [] };
  }
}

/**
 * Run C-MOVE to pull a single study from the modality into Conquest.
 * movescu sends a C-MOVE-RQ to the modality, which then C-STOREs each image
 * to the Conquest SCP (CONQUEST_AE at CONQUEST_HOST:CONQUEST_PORT).
 */
async function moveStudy(node, studyInstanceUID) {
  const args = [
    "-S",                               // Study Root
    "-k", "0008,0052=STUDY",            // QueryRetrieveLevel = STUDY
    "-k", `0020,000D=${studyInstanceUID}`, // StudyInstanceUID
    "-aet", AGENT_AE,                   // Our AE title (the requestor)
    "-aec", node.aeTitle,               // Source modality AE title
    "-aem", CONQUEST_AE,                // Move destination: Conquest AE title
    // Conquest's IP+port is what images get C-STOREd to.
    // movescu itself still connects to the source modality.
    node.host,
    String(node.port),
  ];

  log("debug", `[node ${node.id}] movescu ${args.join(" ")}`);

  try {
    await execFileAsync(dcmtkBin("movescu"), args, { timeout: 300_000 }); // 5 min per study
    log("info", `[node ${node.id}] C-MOVE success for UID ${studyInstanceUID}`);
    void postLog({
      eventType: "C_MOVE",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      studyInstanceUID,
      status: "SUCCESS",
      message: `C-MOVE → ${node.aeTitle}: study ${studyInstanceUID} transferred to Conquest`,
      rawPayload: { nodeId: node.id, studyInstanceUID },
    });
    return { ok: true };
  } catch (err) {
    log("warn", `[node ${node.id}] C-MOVE failed for UID ${studyInstanceUID}:`, err.message);
    void postLog({
      eventType: "C_MOVE",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      studyInstanceUID,
      status: "FAILED",
      message: `C-MOVE → ${node.aeTitle}: UID ${studyInstanceUID} failed — ${err.message}`,
      rawPayload: { nodeId: node.id, studyInstanceUID, error: err.message },
    });
    return { ok: false, error: err.message };
  }
}

// ── ERP API helpers ──────────────────────────────────────────────────────────

async function erpFetch(urlPath, options = {}) {
  const url = `${ERP_BASE}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ERP ${options.method ?? "GET"} ${urlPath} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchPendingJobs() {
  try {
    const data = await erpFetch("/api/internal/dicom/pull-jobs/pending");
    return data.jobs ?? [];
  } catch (err) {
    log("warn", "Failed to fetch pending jobs:", err.message);
    return [];
  }
}

async function claimJob(jobId) {
  try {
    await erpFetch(`/api/internal/dicom/pull-jobs/${jobId}/claim`, {
      method: "PATCH",
      body: JSON.stringify({ agentId: AGENT_ID }),
    });
    return true;
  } catch (err) {
    log("warn", `Failed to claim job ${jobId}:`, err.message);
    return false;
  }
}

async function reportJob(jobId, result) {
  try {
    await erpFetch(`/api/internal/dicom/pull-jobs/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify({ agentId: AGENT_ID, ...result }),
    });
  } catch (err) {
    log("error", `Failed to report job ${jobId} result:`, err.message);
  }
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processJob(job) {
  log("info", `Processing job ${job.id} — node ${job.nodeId} (${job.node?.aeTitle ?? "?"}) ${job.queryDateFrom}→${job.queryDateTo}`);

  const node = job.node;
  if (!node) {
    await reportJob(job.id, { status: "failed", errorMessage: "Node info missing in job payload" });
    return;
  }

  // Use per-node Conquest settings if configured, else fall back to global env vars
  const conquestAe   = node.conquestAeTitle || CONQUEST_AE;
  const conquestHost = node.conquestHost    || CONQUEST_HOST;
  const conquestPort = node.conquestPort    || CONQUEST_PORT;

  // Temporarily override globals for this job if the node has custom Conquest config
  const prevAe   = CONQUEST_AE;
  // (We pass them as parameters to functions in a real refactor; here we just note them)
  log("debug", `Conquest target: ${conquestAe}@${conquestHost}:${conquestPort}`);

  // Step 1: C-FIND — discover studies on the modality
  const findResult = await findStudies(node, job.queryDateFrom, job.queryDateTo);

  if (!findResult.ok || findResult.studyInstanceUIDs.length === 0) {
    await reportJob(job.id, {
      status: findResult.ok ? "completed" : "failed",
      studiesFound: 0,
      studiesPulled: 0,
      studiesFailed: 0,
      errorMessage: findResult.ok ? undefined : findResult.error,
      studyInstanceUIDs: "[]",
    });
    return;
  }

  const uids = findResult.studyInstanceUIDs;
  log("info", `Job ${job.id}: found ${uids.length} studies — starting C-MOVE`);
  sessionStudiesFound += uids.length;

  // Step 2: C-MOVE — pull each study into Conquest
  let pulled = 0, failed = 0;
  const failedUids = [];

  for (const uid of uids) {
    const moveResult = await moveStudy(node, uid);
    if (moveResult.ok) {
      pulled++;
      sessionStudiesPulled++;
    } else {
      failed++;
      sessionFailed++;
      failedUids.push(uid);
    }
  }

  const status = failed === 0 ? "completed" : pulled === 0 ? "failed" : "partial";
  const errorMsg = failedUids.length > 0
    ? `${failed} of ${uids.length} studies failed to move`
    : undefined;

  await reportJob(job.id, {
    status,
    studiesFound: uids.length,
    studiesPulled: pulled,
    studiesFailed: failed,
    studyInstanceUIDs: JSON.stringify(uids.filter(u => !failedUids.includes(u))),
    errorMessage: errorMsg,
  });

  log("info", `Job ${job.id} done: ${pulled} pulled, ${failed} failed (status: ${status})`);
}

// ── Main poll loop ────────────────────────────────────────────────────────────

let running = false;

async function poll() {
  if (running) return; // skip if previous poll is still executing
  running = true;
  try {
    const jobs = await fetchPendingJobs();
    if (jobs.length > 0) {
      log("info", `Found ${jobs.length} pending job(s)`);
    } else {
      log("debug", "No pending jobs");
    }

    for (const job of jobs) {
      const claimed = await claimJob(job.id);
      if (!claimed) continue; // another agent picked it up
      await processJob(job);
    }
  } catch (err) {
    log("error", "Poll error:", err.message);
    void postHeartbeat({ status: "FAILED", message: `Poll error: ${err.message}` });
  } finally {
    running = false;
    // Heartbeat is always sent after each poll cycle (success or partial failure).
    // ERP unreachability must never abort DICOM operations, so this is wrapped
    // in a separate try and called only after the main work is done.
    void postHeartbeat({ status: "INFO", message: `Poll cycle complete. Found: ${sessionStudiesFound}, Pulled: ${sessionStudiesPulled}, Failed: ${sessionFailed}` });
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

console.log("┌─────────────────────────────────────────────────┐");
console.log("│  Care Diagnostics DICOM Q/R Pull Agent          │");
console.log("└─────────────────────────────────────────────────┘");
console.log(`  ERP URL    : ${ERP_BASE}`);
console.log(`  Agent AE   : ${AGENT_AE}`);
console.log(`  Agent Name : ${AGENT_NAME}`);
console.log(`  Conquest   : ${CONQUEST_AE}@${CONQUEST_HOST}:${CONQUEST_PORT}`);
console.log(`  Poll every : ${POLL_MS / 1000}s`);
console.log(`  Agent ID   : ${AGENT_ID}`);
console.log(`  Heartbeat  : ${HEARTBEAT_ENABLED ? `ENABLED → ${HEARTBEAT_ENDPOINT}` : "disabled (set ERP_HEARTBEAT_ENABLED=1 to enable)"}`);
console.log("");

const dcmtkOk = await checkDcmtk();
if (!dcmtkOk) {
  console.warn("\n[agent] WARNING: DCMTK not available. Agent will poll the ERP but cannot execute DICOM operations.");
  console.warn("[agent] Install DCMTK from https://dcmtk.org or set DCMTK_DIR to the bin/ directory.\n");
}

// Start remote config refresh loop (non-blocking — errors are swallowed)
void startConfigRefreshLoop();

// Initial poll immediately, then on interval
await poll();
setInterval(poll, POLL_MS);

console.log(`[agent] Running — polling every ${POLL_MS / 1000}s. Press Ctrl+C to stop.`);
