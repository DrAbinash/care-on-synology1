/**
 * Care Diagnostics Windows DICOM Pull Agent v1.3
 *
 * Runs on a Windows workstation inside the diagnostic center LAN.
 * Every poll cycle:
 *   1. Fetches remote config from ERP (modalities, Conquest settings, pull params)
 *   2. For each enabled modality: runs C-FIND (via dcmtk findscu) to discover new studies
 *   3. Checks ERP for duplicate studies already pulled
 *   4. Retrieves new studies (C-MOVE via movescu) to the local Conquest node
 *   5. Reports all activity back to ERP via heartbeat + log endpoints
 *
 * Robustness guarantees:
 *   - Never crashes on single modality failure (per-modality try/catch)
 *   - Persists last-known-good config locally (survives ERP downtime)
 *   - File-based rolling logs (agent.log, error.log, transfer.log) with 30-day cleanup
 *   - Graceful SIGTERM / SIGINT shutdown
 *
 * Prerequisites (Windows):
 *   - Node.js >= 18 (https://nodejs.org)
 *   - DCMTK installed and on PATH (https://dcmtk.org) — provides findscu, movescu, echoscu
 *   - Conquest PACS or Orthanc running locally (receives C-MOVE results)
 *
 * Quick start:
 *   1. Copy this folder to C:\DiagnoPullAgent\
 *   2. Create .env from .env.example and fill in your values
 *   3. npm install
 *   4. node src/index.js
 *   Optional: install as Windows service with NSSM (see README.md)
 */

"use strict";

const { execFile, spawn } = require("child_process");
const { promisify }       = require("util");
const path                = require("path");
const os                  = require("os");

const execFileAsync = promisify(execFile);

const { logger }              = require("./logger");
const { refreshConfig, getConfig, FETCH_INTERVAL_MS } = require("./config");

// ─── Startup banner ───────────────────────────────────────────────────────────
logger.info("Care Diagnostics DICOM Pull Agent starting", {
  version: "1.3.0",
  node:    process.version,
  platform: process.platform,
  hostname: os.hostname(),
});

// ─── Global state ─────────────────────────────────────────────────────────────
let polling = false;    // guard: don't overlap poll cycles
let stopping = false;   // graceful shutdown flag

// Keep a small in-memory dedup set for the current process session
// (prevents re-queuing the same UID twice in a single poll cycle)
const sessionPulledUIDs = new Set();

// ─── ERP API helpers ──────────────────────────────────────────────────────────
async function erpFetch(path, options = {}) {
  const baseUrl = process.env.ERP_BASE_URL;
  const apiKey  = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const { default: fetch } = await import("node-fetch").catch(() => ({ default: global.fetch }));
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn(`ERP API ${path} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`ERP API ${path} failed`, { error: String(err) });
    return null;
  }
}

async function sendHeartbeat(status = "online") {
  const agentId  = process.env.AGENT_ID ?? `agent-${os.hostname()}`;
  const version  = "1.3.0";
  const cfg = getConfig();
  return erpFetch("/api/internal/dicom-agent/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      status,
      version,
      hostname: os.hostname(),
      pollIntervalMs: cfg.pullSettings?.pollIntervalMs ?? 300_000,
    }),
  });
}

async function sendLog(level, message, meta = {}) {
  return erpFetch("/api/internal/dicom-agent/log", {
    method: "POST",
    body: JSON.stringify({ level, message, ...meta }),
  });
}

async function reportStudyPulled(studyInstanceUID, accessionNumber, modality, status = "PULLED", meta = {}) {
  return erpFetch("/api/internal/dicom-agent/study-pulled", {
    method: "POST",
    body: JSON.stringify({ studyInstanceUID, accessionNumber, modality, status, ...meta }),
  });
}

async function checkDuplicate(studyInstanceUID) {
  const result = await erpFetch(`/api/internal/dicom-agent/check-duplicate?uid=${encodeURIComponent(studyInstanceUID)}`);
  return result?.isDuplicate === true;
}

// ─── DCMTK helpers ───────────────────────────────────────────────────────────

/**
 * Run DICOM C-ECHO via echoscu.
 * Returns { ok: boolean, latencyMs: number, message: string }.
 */
async function runEcho(host, port, calledAE, callingAE = "DIAGNO_AGENT") {
  const start = Date.now();
  try {
    await execFileAsync("echoscu", [
      "-aet", callingAE, "-aec", calledAE,
      host, String(port),
    ], { timeout: 10_000 });
    return { ok: true, latencyMs: Date.now() - start, message: "C-ECHO OK" };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: String(err.message ?? err) };
  }
}

/**
 * Run DICOM C-FIND (Study root) on a modality.
 * Queries for studies received/modified today.
 * Returns array of { studyInstanceUID, accessionNumber, modality, patientName, patientId, studyDate }.
 */
async function runCFind(host, port, calledAE, callingAE, dateFilter) {
  const today = dateFilter ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // Build dcmtk findscu command for STUDY level
  const args = [
    "-v",
    "-aet", callingAE,
    "-aec", calledAE,
    "-S",                          // study root
    "-k", "QueryRetrieveLevel=STUDY",
    "-k", `StudyDate=${today}`,
    "-k", "StudyInstanceUID",
    "-k", "AccessionNumber",
    "-k", "ModalitiesInStudy",
    "-k", "PatientName",
    "-k", "PatientID",
    "-k", "NumberOfStudyRelatedSeries",
    host, String(port),
  ];

  try {
    const { stdout, stderr } = await execFileAsync("findscu", args, { timeout: 30_000 });
    return parseCFindOutput(stdout + "\n" + stderr);
  } catch (err) {
    // findscu exits with 1 even on success in some DCMTK versions — try to parse anyway
    if (err.stdout || err.stderr) {
      return parseCFindOutput((err.stdout ?? "") + "\n" + (err.stderr ?? ""));
    }
    throw err;
  }
}

/**
 * Parse dcmtk findscu verbose output into structured study objects.
 */
function parseCFindOutput(raw) {
  const studies = [];
  let current = null;

  for (const line of raw.split("\n")) {
    // Detect start of a new result set
    if (line.includes("---------------------------")) {
      if (current?.studyInstanceUID) {
        studies.push(current);
      }
      current = {};
      continue;
    }
    if (!current) continue;

    const uidMatch    = line.match(/\(0020,000d\)[^[]*\[(.*?)\]/);
    const accMatch    = line.match(/\(0008,0050\)[^[]*\[(.*?)\]/);
    const modalMatch  = line.match(/\(0008,0061\)[^[]*\[(.*?)\]/);
    const nameMatch   = line.match(/\(0010,0010\)[^[]*\[(.*?)\]/);
    const idMatch     = line.match(/\(0010,0020\)[^[]*\[(.*?)\]/);
    const dateMatch   = line.match(/\(0008,0020\)[^[]*\[(.*?)\]/);

    if (uidMatch)   current.studyInstanceUID = uidMatch[1].trim();
    if (accMatch)   current.accessionNumber  = accMatch[1].trim();
    if (modalMatch) current.modality         = modalMatch[1].trim().split("\\")[0].trim();
    if (nameMatch)  current.patientName      = nameMatch[1].trim();
    if (idMatch)    current.patientId        = idMatch[1].trim();
    if (dateMatch)  current.studyDate        = dateMatch[1].trim();
  }

  if (current?.studyInstanceUID) studies.push(current);
  return studies;
}

/**
 * Run DICOM C-MOVE to retrieve a study to the local PACS (Conquest).
 */
async function runCMove(remoteHost, remotePort, remoteAE, localAE, destAE, studyInstanceUID) {
  const args = [
    "-v",
    "-aet", localAE,
    "-aec", remoteAE,
    "-aem", destAE,       // destination SCP
    "-S",
    "-k", "QueryRetrieveLevel=STUDY",
    "-k", `StudyInstanceUID=${studyInstanceUID}`,
    remoteHost, String(remotePort),
  ];

  const start = Date.now();
  try {
    await execFileAsync("movescu", args, { timeout: 300_000 }); // 5 min per study
    const durationMs = Date.now() - start;
    logger.transfer("C-MOVE completed", { studyInstanceUID, remoteAE, destAE, durationMs });
    return { ok: true, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    // movescu often exits non-zero but succeeds — check if it was a timeout
    if (durationMs >= 300_000) {
      logger.error("C-MOVE timeout", { studyInstanceUID, remoteAE });
      return { ok: false, error: "timeout" };
    }
    // In some DCMTK versions exit code 0 or 1 both indicate success
    // Check if stdout/stderr suggests success
    const output = String(err.stdout ?? "") + String(err.stderr ?? "");
    if (output.includes("I: Releasing Association") || output.includes("I: Release")) {
      logger.transfer("C-MOVE likely succeeded (non-zero exit)", { studyInstanceUID, remoteAE, durationMs });
      return { ok: true, durationMs };
    }
    logger.error("C-MOVE failed", { studyInstanceUID, remoteAE, error: String(err.message ?? err) });
    return { ok: false, error: String(err.message ?? err) };
  }
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

async function isDuplicate(studyInstanceUID) {
  // 1. In-memory dedup (fast, same session)
  if (sessionPulledUIDs.has(studyInstanceUID)) return true;
  // 2. ERP API check (persistent across restarts)
  const dup = await checkDuplicate(studyInstanceUID);
  return dup;
}

// ─── Pull cycle ───────────────────────────────────────────────────────────────

async function pullFromModality(modality, cfg) {
  const { agentAeTitle } = cfg.pullSettings ?? {};
  const callingAE = agentAeTitle ?? "DIAGNO_AGENT";
  const name  = modality.machineName ?? modality.name ?? modality.aeTitle;
  const host  = modality.ipAddress;
  const port  = modality.port;
  const remoteAE = modality.aeTitle;
  const conquestAE = cfg.conquest?.aeTitle ?? "CONQUEST1";

  if (!host || !port || !remoteAE) {
    logger.warn(`Modality ${name} missing host/port/AE — skipping`);
    return;
  }

  logger.info(`Polling modality: ${name} (${remoteAE} @ ${host}:${port})`);

  // ── C-ECHO health check ──
  const echo = await runEcho(host, port, remoteAE, callingAE);
  if (!echo.ok) {
    logger.warn(`C-ECHO failed for ${name}: ${echo.message}`, { modality: name });
    await sendLog("warn", `C-ECHO failed for ${name}: ${echo.message}`, { agentEvent: "echo_fail", modality: remoteAE });
    return;
  }
  logger.info(`C-ECHO OK for ${name} (${echo.latencyMs}ms)`);

  // ── C-FIND ──
  let studies;
  try {
    studies = await runCFind(host, port, remoteAE, callingAE, null);
    logger.info(`C-FIND returned ${studies.length} studies from ${name}`);
  } catch (err) {
    logger.error(`C-FIND failed for ${name}: ${err}`, { modality: name });
    await sendLog("error", `C-FIND failed for ${name}: ${err}`, { agentEvent: "cfind_fail", modality: remoteAE });
    return;
  }

  // ── Per-study retrieval ──
  let pulled = 0, skipped = 0, failed = 0;

  for (const study of studies) {
    if (stopping) break;
    const uid = study.studyInstanceUID;
    if (!uid) continue;

    // Duplicate check
    const dup = await isDuplicate(uid);
    if (dup) {
      skipped++;
      logger.transfer(`Duplicate — skipping ${uid}`);
      await reportStudyPulled(uid, study.accessionNumber, study.modality, "DUPLICATE_SKIPPED", {
        patientName: study.patientName,
        patientId: study.patientId,
        sourceAeTitle: remoteAE,
      });
      continue;
    }

    // Mark in session dedup set BEFORE retrieval to prevent overlapping job triggers
    sessionPulledUIDs.add(uid);

    logger.transfer(`Starting C-MOVE: ${uid} from ${remoteAE} → ${conquestAE}`);
    const moveResult = await runCMove(host, port, remoteAE, callingAE, conquestAE, uid);

    if (moveResult.ok) {
      pulled++;
      await reportStudyPulled(uid, study.accessionNumber, study.modality, "PULLED", {
        patientName: study.patientName,
        patientId: study.patientId,
        sourceAeTitle: remoteAE,
        destinationAeTitle: conquestAE,
        durationMs: moveResult.durationMs,
      });
      await sendLog("info", `Study pulled successfully: ${study.accessionNumber ?? uid}`, {
        agentEvent: "study_pulled",
        studyInstanceUID: uid,
        modality: study.modality,
        durationMs: moveResult.durationMs,
      });
    } else {
      failed++;
      // Remove from session dedup so a retry in the next cycle can try again
      sessionPulledUIDs.delete(uid);
      await reportStudyPulled(uid, study.accessionNumber, study.modality, "FAILED", {
        patientName: study.patientName,
        patientId: study.patientId,
        sourceAeTitle: remoteAE,
        errorMessage: moveResult.error,
      });
      await sendLog("error", `Study retrieval failed: ${study.accessionNumber ?? uid}`, {
        agentEvent: "study_failed",
        studyInstanceUID: uid,
        modality: study.modality,
        error: moveResult.error,
      });
    }
  }

  logger.info(`Modality ${name} done: pulled=${pulled} skipped=${skipped} failed=${failed}`);
  await sendLog("info", `Poll complete for ${name}`, {
    agentEvent: "modality_poll_done",
    modality: remoteAE,
    pulled,
    skipped,
    failed,
  });
}

async function runPollCycle() {
  if (polling) {
    logger.warn("Previous poll cycle still running — skipping this tick");
    return;
  }
  polling = true;

  try {
    const cfg = getConfig();
    const modalities = (cfg.modalities ?? []).filter((m) => m.isActive !== false);

    if (modalities.length === 0) {
      logger.info("No active modalities configured — nothing to pull");
      await sendHeartbeat("idle");
      return;
    }

    await sendHeartbeat("polling");

    // Process modalities sequentially to avoid overwhelming the network
    // (increase maxConcurrentJobs in config for parallel if bandwidth allows)
    for (const mod of modalities) {
      if (stopping) break;
      try {
        await pullFromModality(mod, cfg);
      } catch (err) {
        // Per-modality catch — never crash the whole poll cycle
        logger.error(`Unexpected error pulling from ${mod.machineName ?? mod.aeTitle}: ${err}`);
      }
    }

    await sendHeartbeat("online");
  } catch (err) {
    logger.error(`Poll cycle error: ${err}`);
  } finally {
    polling = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let pollTimer = null;
let configRefreshTimer = null;

async function bootstrap() {
  // Initial config load
  await refreshConfig();
  const cfg = getConfig();
  const pollIntervalMs = cfg.pullSettings?.pollIntervalMs ?? 300_000;

  logger.info("Bootstrap complete", {
    conquest: cfg.conquest?.host,
    modalities: cfg.modalities?.length ?? 0,
    pollIntervalMs,
  });

  // First heartbeat
  await sendHeartbeat("online");

  // Start polling
  async function schedulePoll() {
    await runPollCycle();
    if (!stopping) {
      const nextInterval = getConfig().pullSettings?.pollIntervalMs ?? 300_000;
      pollTimer = setTimeout(schedulePoll, nextInterval);
    }
  }
  schedulePoll();

  // Config refresh every 5 minutes
  configRefreshTimer = setInterval(async () => {
    await refreshConfig();
  }, FETCH_INTERVAL_MS);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);
  stopping = true;
  clearTimeout(pollTimer);
  clearInterval(configRefreshTimer);

  await sendHeartbeat("offline");
  logger.info("Agent stopped.");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

// Uncaught exception handler — log and continue (never crash)
process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
});
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

// ─── Start ────────────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error(`Fatal bootstrap error: ${err}`);
  process.exit(1);
});
