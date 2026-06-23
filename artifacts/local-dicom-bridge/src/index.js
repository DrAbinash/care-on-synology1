/**
 * Care Diagnostics Local DICOM Bridge v1.0
 *
 * Runs on a PC inside the clinic LAN (Windows, Linux, or macOS).
 * Pulls DICOM studies from CT/MRI/USG modalities using dcmjs-dimse
 * (pure Node.js — no DCMTK installation needed) and moves them to
 * your local Conquest/Orthanc PACS.
 *
 * How it works:
 *   1. Polls ERP for pending pull jobs via REST API
 *   2. C-ECHO each modality to verify connectivity
 *   3. C-FIND to discover studies by date range
 *   4. C-MOVE (or C-GET) to transfer studies into Conquest
 *   5. Reports heartbeat + logs back to ERP
 *
 * Setup:
 *   1. Copy this folder to C:\DiagnoDicomBridge\ (or any path)
 *   2. npm install
 *   3. Copy .env.example to .env, fill in ERP_BASE_URL + INTERNAL_API_KEY
 *   4. node src/index.js
 *
 * Optional: install as Windows service with NSSM
 */

import { hostname, networkInterfaces } from "os";
import { refreshConfig, getConfig, erpFetch } from "./config.js";
import { logger } from "./logger.js";

// ── Lazy import dcmjs-dimse (ESM) ─────────────────────────────────────────
let dimsePromise = null;
async function getDimse() {
  if (!dimsePromise) {
    dimsePromise = import("dcmjs-dimse").catch((err) => {
      logger.error("Failed to load dcmjs-dimse", { error: err.message });
      throw err;
    });
  }
  return dimsePromise;
}

// ── Startup banner ───────────────────────────────────────────────────────────
const AGENT_ID   = process.env.AGENT_ID ?? `agent-${hostname()}`;
const AGENT_NAME = process.env.AGENT_NAME ?? hostname();

function getPrimaryIp() {
  const nics = networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const nic of nics[name] ?? []) {
      if (!nic.internal && nic.family === "IPv4") return nic.address;
    }
  }
  return "127.0.0.1";
}
const agentHost = getPrimaryIp();

logger.info("Care Diagnostics Local DICOM Bridge starting", {
  version: "1.0.0",
  node:    process.version,
  platform: process.platform,
  hostname: hostname(),
  agentId: AGENT_ID,
  agentHost,
});

// ── Global state ────────────────────────────────────────────────────────────
let polling = false;
let stopping = false;
const sessionPulledUIDs = new Set();

// ── ERP helpers ────────────────────────────────────────────────────────────
async function sendHeartbeat(status = "online") {
  const cfg = getConfig();
  return erpFetch(cfg.erpSettings.heartbeatEndpoint, {
    method: "POST",
    body: JSON.stringify({
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentHost,
      status,
      version: "1.0.0",
      hostname: hostname(),
      pollIntervalMs: cfg.pullSettings?.pollIntervalMs ?? 600_000,
    }),
  });
}

async function sendLog(level, message, meta = {}) {
  const cfg = getConfig();
  return erpFetch(cfg.erpSettings.logEndpoint, {
    method: "POST",
    body: JSON.stringify({
      agentName: AGENT_NAME,
      agentHost,
      level,
      message,
      ...meta,
    }),
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

// ── DIMSE helpers (dcmjs-dimse) ─────────────────────────────────────────────────────

async function runEcho(host, port, calledAE, callingAE = "DIAGNO_AGENT") {
  const dimse = await getDimse();
  const { Client } = dimse;
  const start = Date.now();
  const client = new Client();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.close();
      resolve({ ok: false, latencyMs: Date.now() - start, message: "C-ECHO timeout" });
    }, 10_000);

    client.on("networkError", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, latencyMs: Date.now() - start, message: `Network error: ${e.message ?? e}` });
    });

    client.addRequest(
      new dimse.requests.CEchoRequest(callingAE, calledAE),
      host,
      port,
    );

    client.on("response", () => {
      clearTimeout(timer);
      resolve({ ok: true, latencyMs: Date.now() - start, message: "C-ECHO OK" });
    });

    client.send();
  });
}

async function runCFind(host, port, calledAE, callingAE, dateFilter) {
  const dimse = await getDimse();
  const { Client, requests } = dimse;
  const today = dateFilter ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const client = new Client();
  const studies = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      resolve(studies);
    }, 60_000);

    client.on("networkError", (e) => {
      clearTimeout(timer);
      reject(new Error(`Network error: ${e.message ?? e}`));
    });

    const req = new requests.CFindRequest(callingAE, calledAE, "STUDY");
    req.addQuery("StudyDate", today);
    req.addQuery("StudyInstanceUID", "");
    req.addQuery("AccessionNumber", "");
    req.addQuery("ModalitiesInStudy", "");
    req.addQuery("PatientName", "");
    req.addQuery("PatientID", "");

    client.on("response", (response) => {
      const ds = response.getDataset();
      if (!ds) return;
      const uid = ds.getElement("StudyInstanceUID");
      if (!uid) return;
      studies.push({
        studyInstanceUID: String(uid ?? ""),
        accessionNumber:  String(ds.getElement("AccessionNumber") ?? ""),
        modality:         String(ds.getElement("ModalitiesInStudy") ?? "").split("\\")[0],
        patientName:      String(ds.getElement("PatientName") ?? ""),
        patientId:        String(ds.getElement("PatientID") ?? ""),
        studyDate:        String(ds.getElement("StudyDate") ?? ""),
      });
    });

    client.addRequest(req, host, port);
    client.send(() => {
      clearTimeout(timer);
      resolve(studies);
    });
  });
}

async function runCMove(remoteHost, remotePort, remoteAE, callingAE, destAE, studyInstanceUID) {
  const dimse = await getDimse();
  const { Client, requests } = dimse;
  const start = Date.now();
  const client = new Client();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.close();
      resolve({ ok: false, durationMs: Date.now() - start, error: "C-MOVE timeout" });
    }, 300_000);

    client.on("networkError", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, durationMs: Date.now() - start, error: `Network error: ${e.message ?? e}` });
    });

    const req = new requests.CMoveRequest(callingAE, remoteAE, destAE, "STUDY");
    req.addQuery("StudyInstanceUID", studyInstanceUID);

    client.on("response", (response) => {
      clearTimeout(timer);
      const status = response.getStatus();
      const ok = status === 0 || status === 0x0000;
      resolve({ ok, durationMs: Date.now() - start, error: ok ? null : `Status 0x${status.toString(16)}` });
    });

    client.addRequest(req, remoteHost, remotePort);
    client.send();
  });
}

// ── Duplicate check ────────────────────────────────────────────────────────────
async function isDuplicate(studyInstanceUID) {
  if (sessionPulledUIDs.has(studyInstanceUID)) return true;
  const dup = await checkDuplicate(studyInstanceUID);
  return dup;
}

// ── Pull cycle ────────────────────────────────────────────────────────────
async function pullFromModality(mod, cfg) {
  const callingAE = cfg.pullSettings?.agentAeTitle ?? "DIAGNO_AGENT";
  const name  = mod.machineName ?? mod.aeTitle;
  const host  = mod.ipAddress ?? mod.host;
  const port  = mod.port;
  const remoteAE = mod.aeTitle;
  const conquestAE = mod.conquestAeTitle ?? cfg.conquest?.aeTitle ?? "CONQUEST1";

  if (!host || !port || !remoteAE) {
    logger.warn(`Modality ${name} missing host/port/AE — skipping`);
    return;
  }

  logger.info(`Polling modality: ${name} (${remoteAE} @ ${host}:${port})`);

  // ── C-ECHO ──
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
    const lookbackHours = mod.queryLookbackHours ?? 24;
    const today = new Date();
    const dates = [];
    const daysBack = Math.ceil(lookbackHours / 24);
    for (let d = 0; d < daysBack; d++) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      dates.push(dt.toISOString().slice(0, 10).replace(/-/g, ""));
    }
    const dateFilter = dates.join("-");
    studies = await runCFind(host, port, remoteAE, callingAE, dateFilter);
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
      await sendLog("info", `Study pulled: ${study.accessionNumber ?? uid}`, {
        agentEvent: "study_pulled",
        studyInstanceUID: uid,
        modality: study.modality,
        durationMs: moveResult.durationMs,
      });
    } else {
      failed++;
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
    logger.warn("Previous poll cycle still running — skipping");
    return;
  }
  polling = true;

  try {
    const cfg = getConfig();
    const modalities = (cfg.modalities ?? []).filter((m) => m.isActive !== false && m.autoPull !== false);

    if (modalities.length === 0) {
      logger.info("No active modalities configured — nothing to pull");
      await sendHeartbeat("idle");
      return;
    }

    await sendHeartbeat("polling");

    for (const mod of modalities) {
      if (stopping) break;
      try {
        await pullFromModality(mod, cfg);
      } catch (err) {
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

// ── Scheduler ────────────────────────────────────────────────────────────
let pollTimer = null;
let configRefreshTimer = null;
const FETCH_INTERVAL_MS = Number(process.env.CONFIG_REFRESH_MS ?? 300_000);

async function bootstrap() {
  await refreshConfig();
  const cfg = getConfig();
  const pollIntervalMs = cfg.pullSettings?.pollIntervalMs ?? 600_000;

  logger.info("Bootstrap complete", {
    conquest: cfg.conquest?.host,
    modalities: cfg.modalities?.length ?? 0,
    pollIntervalMs,
  });

  await sendHeartbeat("online");

  async function schedulePoll() {
    await runPollCycle();
    if (!stopping) {
      const nextInterval = getConfig().pullSettings?.pollIntervalMs ?? 600_000;
      pollTimer = setTimeout(schedulePoll, nextInterval);
    }
  }
  schedulePoll();

  configRefreshTimer = setInterval(async () => {
    await refreshConfig();
  }, FETCH_INTERVAL_MS);
}

// ── Graceful shutdown ────────────────────────────────────────────────────────────
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

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
});
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

// ── Start ────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error(`Fatal bootstrap error: ${err}`);
  process.exit(1);
});
