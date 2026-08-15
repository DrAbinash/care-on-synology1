/**
 * In-Process DICOM DIMSE Pull Agent
 *
 * Runs inside the API server (no external PC needed).  Polls the database for
 * pending dicom_pull_jobs, executes C-ECHO / C-FIND / C-MOVE against imaging
 * modalities using dcmjs-dimse, and writes results directly back to the DB.
 *
 * Feature toggle: ENABLE_DICOM_PULL_AGENT=1 (or ENABLE_SCHEDULERS=1 also enables it)
 *
 * Debug via:  server workflow logs (search "[dimse-agent]")
 */

import { hostname } from "node:os";
import { networkInterfaces } from "node:os";
import { db } from "@workspace/db";
import { NETWORK_LAN_HOST } from "../../lib/networkDefaults";
import {
  dicomPullJobsTable,
  dicomNodesTable,
  dicomPullAgentLogsTable,
  dicomPullAgentStatusTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getRadiologyConfig } from "../../lib/pacs/pacsConfig";
import { clinicPeakHoursLabel, isClinicPeakHours } from "../../lib/clinicPeakHours";
import type { DicomNode } from "@workspace/db/schema";

/* ── dcmjs-dimse lazy import (ESM/CJS compat) ───────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dimseModPromise: Promise<any> | null = null;

async function getDimse(): Promise<any> {
  if (!dimseModPromise) {
    dimseModPromise = import("dcmjs-dimse").catch((err) => {
      logger.error({ err }, "[dimse-agent] Failed to load dcmjs-dimse");
      throw err;
    });
  }
  return dimseModPromise;
}

/* ── Config ─────────────────────────────────────────────────────────────── */

const AGENT_NAME = process.env["AGENT_NAME"]?.trim() || hostname();
const AGENT_AE_TITLE = process.env["AGENT_AE_TITLE"]?.trim() || "DIAGNO_AGENT";
const POLL_INTERVAL_MS = Number(process.env["DIMSE_POLL_INTERVAL_MS"] || 30_000);
const MAX_CONCURRENT_JOBS = Number(process.env["DIMSE_MAX_CONCURRENT_JOBS"] || 3);
const DIMSE_TIMEOUT_MS = Number(process.env["DIMSE_TIMEOUT_MS"] || 60_000);

/* ── State ──────────────────────────────────────────────────────────────── */

let isRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeJobs = 0;
const agentHost = getPrimaryIp();

function getPrimaryIp(): string {
  const nics = networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const nic of nics[name] ?? []) {
      if (!nic.internal && nic.family === "IPv4") return nic.address;
    }
  }
  return "127.0.0.1";
}

/* ── Startup verification ───────────────────────────────────────────────── */

export async function logStartupVerification(): Promise<void> {
  const dimse = await getDimse();
  const ts = new Date().toISOString();
  logger.info(
    {
      agentName: AGENT_NAME,
      agentHost,
      agentAeTitle: AGENT_AE_TITLE,
      pollIntervalMs: POLL_INTERVAL_MS,
      maxConcurrent: MAX_CONCURRENT_JOBS,
      dimseTimeoutMs: DIMSE_TIMEOUT_MS,
      dimseVersion: (dimse as Record<string, unknown>)["VERSION"] ?? "unknown",
    },
    `[dimse-agent] STARTUP — In-process DIMSE pull agent ready`,
  );

  // Write a startup event to the DB log table so the UI can show it
  try {
    await db.insert(dicomPullAgentLogsTable).values({
      agentName: AGENT_NAME,
      agentHost,
      eventType: "STARTUP",
      status: "INFO",
      message: `In-process agent started on ${agentHost} (${ts})`,
      rawPayload: JSON.stringify({
        aeTitle: AGENT_AE_TITLE,
        pollIntervalMs: POLL_INTERVAL_MS,
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
        dimseTimeoutMs: DIMSE_TIMEOUT_MS,
      }),
    });
  } catch (err) {
    logger.error({ err }, "[dimse-agent] Failed to write startup log");
  }
}

/* ── Heartbeat ──────────────────────────────────────────────────────────── */

async function heartbeat(
  opts: {
    status?: "INFO" | "SUCCESS" | "FAILED" | "WARNING";
    message?: string;
    stats?: { studiesFoundToday: number; studiesPulledToday: number; failedToday: number };
  } = {},
): Promise<void> {
  const now = new Date();
  const status = opts.status ?? "INFO";
  const isError = status === "FAILED";
  const isSuccess = status === "SUCCESS";

  const patch: Partial<typeof dicomPullAgentStatusTable.$inferInsert> = {
    lastHeartbeatAt: now,
    isOnline: true,
  };
  if (isSuccess) patch.lastSuccessfulPullAt = now;
  if (isError) {
    patch.lastErrorAt = now;
    patch.lastErrorMessage = opts.message ?? null;
  }
  if (opts.stats) {
    patch.studiesFoundToday = opts.stats.studiesFoundToday;
    patch.studiesPulledToday = opts.stats.studiesPulledToday;
    patch.failedToday = opts.stats.failedToday;
  }

  const [existing] = await db
    .select({ id: dicomPullAgentStatusTable.id })
    .from(dicomPullAgentStatusTable)
    .where(
      and(
        eq(dicomPullAgentStatusTable.agentName, AGENT_NAME),
        eq(dicomPullAgentStatusTable.agentHost, agentHost),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(dicomPullAgentStatusTable)
      .set(patch)
      .where(eq(dicomPullAgentStatusTable.id, existing.id));
  } else {
    await db.insert(dicomPullAgentStatusTable).values({
      agentName: AGENT_NAME,
      agentHost,
      lastHeartbeatAt: now,
      isOnline: true,
      lastSuccessfulPullAt: isSuccess ? now : null,
      lastErrorAt: isError ? now : null,
      lastErrorMessage: isError ? (opts.message ?? null) : null,
      studiesFoundToday: opts.stats?.studiesFoundToday ?? 0,
      studiesPulledToday: opts.stats?.studiesPulledToday ?? 0,
      failedToday: opts.stats?.failedToday ?? 0,
    });
  }

  if (opts.message) {
    logger.info({ agentName: AGENT_NAME, agentHost, status }, `[dimse-agent] ${opts.message}`);
  }
}

/* ── Internal log helper (writes to dicom_pull_agent_logs) ───────────────── */

async function logEvent(ev: {
  eventType: string;
  sourceAeTitle?: string | null;
  sourceIp?: string | null;
  modality?: string | null;
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  patientName?: string | null;
  patientId?: string | null;
  status: "SUCCESS" | "FAILED" | "WARNING" | "INFO";
  message: string;
  rawPayload?: unknown;
}): Promise<void> {
  try {
    await db.insert(dicomPullAgentLogsTable).values({
      agentName: AGENT_NAME,
      agentHost,
      eventType: ev.eventType,
      sourceAeTitle: ev.sourceAeTitle ?? null,
      sourceIp: ev.sourceIp ?? null,
      modality: ev.modality?.toUpperCase() ?? null,
      studyInstanceUID: ev.studyInstanceUID ?? null,
      accessionNumber: ev.accessionNumber ?? null,
      patientName: ev.patientName ?? null,
      patientId: ev.patientId ?? null,
      status: ev.status,
      message: ev.message,
      rawPayload: ev.rawPayload ? JSON.stringify(ev.rawPayload) : null,
    });
  } catch (err) {
    logger.error({ err, eventType: ev.eventType }, "[dimse-agent] logEvent insert failed");
  }
}

/* ── C-ECHO (connectivity probe) ────────────────────────────────────────── */

export async function testNodeConnection(
  node: Pick<DicomNode, "host" | "port" | "aeTitle" | "modality">,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const dimse = await getDimse();
  const { Client } = dimse;
  const { CEchoRequest } = dimse.requests;
  const { Status } = dimse.constants;

  const start = Date.now();

  return new Promise((resolve) => {
    const client = new Client();
    const request = new CEchoRequest();

    let resolved = false;
    const finish = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      client.close();
      const latencyMs = Date.now() - start;
      resolve({ ok, latencyMs, error });
    };

    request.on("response", (response: { getStatus(): number }) => {
      if (response.getStatus() === Status.Success) {
        finish(true);
      } else {
        finish(false, `C-ECHO rejected with status ${response.getStatus()}`);
      }
    });

    client.addRequest(request);
    client.on("networkError", (e: Error) => {
      finish(false, e.message);
    });

    client.send(node.host, node.port, AGENT_AE_TITLE, node.aeTitle);

    setTimeout(() => {
      finish(false, `C-ECHO timeout after ${DIMSE_TIMEOUT_MS}ms`);
    }, DIMSE_TIMEOUT_MS);
  });
}

/* ── C-FIND (study query) ───────────────────────────────────────────────── */

type StudySummary = {
  studyInstanceUID: string;
  accessionNumber: string | null;
  patientName: string | null;
  patientId: string | null;
  studyDate: string | null;
  studyDescription: string | null;
  modality: string | null;
};

async function findStudies(
  node: DicomNode,
  dateFrom: string, // YYYY-MM-DD
  dateTo: string,   // YYYY-MM-DD
): Promise<{ studies: StudySummary[]; error?: string }> {
  const dimse = await getDimse();
  const { Client } = dimse;
  const { CFindRequest } = dimse.requests;
  const { Status } = dimse.constants;

  const toCompact = (d: string) => d.replace(/-/g, "");

  return new Promise((resolve) => {
    const client = new Client();
    const request = CFindRequest.createStudyFindRequest({
      StudyDate: `${toCompact(dateFrom)}-${toCompact(dateTo)}`,
    });

    const studies: StudySummary[] = [];
    let resolved = false;

    const finish = (error?: string) => {
      if (resolved) return;
      resolved = true;
      client.close();
      resolve({ studies, error });
    };

    request.on("response", (response: { getStatus(): number; hasDataset(): boolean; getDataset(): { getElement(tag: string): string | undefined } | null }) => {
      const status = response.getStatus();
      if (status === Status.Pending && response.hasDataset()) {
        const ds = response.getDataset();
        if (ds) {
          studies.push({
            studyInstanceUID: ds.getElement("0020000D") ?? "",
            accessionNumber: ds.getElement("00080050") ?? null,
            patientName: ds.getElement("00100010") ?? null,
            patientId: ds.getElement("00100020") ?? null,
            studyDate: ds.getElement("00080020") ?? null,
            studyDescription: ds.getElement("00081030") ?? null,
            modality: ds.getElement("00080061") ?? ds.getElement("00080060") ?? null,
          });
        }
      } else if (status === Status.Success) {
        finish();
      } else if (status !== Status.Pending) {
        finish(`C-FIND failed with status ${status}`);
      }
    });

    client.addRequest(request);
    client.on("networkError", (e: Error) => {
      finish(`Network error: ${e.message}`);
    });

    client.send(node.host, node.port, AGENT_AE_TITLE, node.aeTitle);

    setTimeout(() => {
      finish(`C-FIND timeout after ${DIMSE_TIMEOUT_MS}ms`);
    }, DIMSE_TIMEOUT_MS);
  });
}

/* ── C-MOVE (pull study to Conquest) ────────────────────────────────────── */

async function moveStudy(
  node: DicomNode,
  studyInstanceUID: string,
  destAeTitle: string,
): Promise<{ ok: boolean; remaining: number; completed: number; failed: number; error?: string }> {
  const dimse = await getDimse();
  const { Client } = dimse;
  const { CMoveRequest } = dimse.requests;
  const { Status } = dimse.constants;

  return new Promise((resolve) => {
    const client = new Client();
    const request = CMoveRequest.createStudyMoveRequest(destAeTitle, studyInstanceUID);

    let remaining = 0;
    let completed = 0;
    let failed = 0;
    let resolved = false;

    const finish = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      client.close();
      resolve({ ok, remaining, completed, failed, error });
    };

    request.on("response", (response: { getStatus(): number; getRemaining(): number; getCompleted(): number; getFailures(): number }) => {
      const status = response.getStatus();
      if (status === Status.Pending) {
        remaining = response.getRemaining();
        completed = response.getCompleted();
        failed = response.getFailures();
      } else if (status === Status.Success) {
        finish(true);
      } else {
        finish(false, `C-MOVE failed with status ${status}`);
      }
    });

    client.addRequest(request);
    client.on("networkError", (e: Error) => {
      finish(false, `Network error: ${e.message}`);
    });

    client.send(node.host, node.port, AGENT_AE_TITLE, node.aeTitle);

    setTimeout(() => {
      finish(false, `C-MOVE timeout after ${DIMSE_TIMEOUT_MS}ms`);
    }, DIMSE_TIMEOUT_MS);
  });
}

/* ── Job processor ────────────────────────────────────────────────────────── */

async function processNextJob(): Promise<void> {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return;

  // Auto-pull *creation* already skips peak hours; also stop *executing*
  // leftover pending C-MOVE jobs so Orthanc I/O stays free for USG C-STORE
  // and billing. Manual/force jobs created after peak resume normally.
  if (isClinicPeakHours()) {
    return;
  }

  // Pick the oldest pending job
  const [job] = await db
    .select()
    .from(dicomPullJobsTable)
    .where(eq(dicomPullJobsTable.status, "pending"))
    .orderBy(dicomPullJobsTable.createdAt)
    .limit(1);

  if (!job) return;

  activeJobs++;

  try {
    // Claim the job immediately
    const [claimed] = await db
      .update(dicomPullJobsTable)
      .set({ status: "running", agentId: `${AGENT_NAME}@${agentHost}`, startedAt: new Date() })
      .where(eq(dicomPullJobsTable.id, job.id))
      .returning();

    if (!claimed) {
      // Another process claimed it between select and update
      activeJobs--;
      return;
    }

    // Fetch the node details
    const [node] = await db
      .select()
      .from(dicomNodesTable)
      .where(eq(dicomNodesTable.id, job.nodeId));

    if (!node) {
      await failJob(job.id, `Node ${job.nodeId} not found in dicom_nodes`);
      return;
    }

    if (!node.isActive) {
      await failJob(job.id, `Node ${node.aeTitle} is inactive`);
      return;
    }

    // ── C-ECHO connectivity probe ────────────────────────────────────────
    const echo = await testNodeConnection(node);
    if (!echo.ok) {
      await failJob(job.id, `C-ECHO failed: ${echo.error}`);
      await logEvent({
        eventType: "C_ECHO",
        sourceAeTitle: node.aeTitle,
        sourceIp: node.host,
        modality: node.modality,
        status: "FAILED",
        message: `C-ECHO failed to ${node.aeTitle} (${node.host}:${node.port}): ${echo.error}`,
      });
      return;
    }

    await logEvent({
      eventType: "C_ECHO",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      modality: node.modality,
      status: "SUCCESS",
      message: `C-ECHO OK to ${node.aeTitle} (${node.host}:${node.port}) in ${echo.latencyMs}ms`,
    });

    // ── C-FIND (query studies) ───────────────────────────────────────────
    const findResult = await findStudies(node, job.queryDateFrom, job.queryDateTo);
    const studiesFound = findResult.studies.length;

    if (findResult.error) {
      await failJob(job.id, `C-FIND failed: ${findResult.error}`);
      await logEvent({
        eventType: "C_FIND",
        sourceAeTitle: node.aeTitle,
        sourceIp: node.host,
        modality: node.modality,
        status: "FAILED",
        message: `C-FIND failed: ${findResult.error}`,
      });
      return;
    }

    await logEvent({
      eventType: "C_FIND",
      sourceAeTitle: node.aeTitle,
      sourceIp: node.host,
      modality: node.modality,
      status: "SUCCESS",
      message: `C-FIND found ${studiesFound} study(ies) on ${node.aeTitle}`,
      rawPayload: { studiesFound, dateFrom: job.queryDateFrom, dateTo: job.queryDateTo },
    });

    if (studiesFound === 0) {
      // Nothing to pull — mark completed with zero results
      await completeJob(job.id, 0, 0, 0, []);
      return;
    }

    // ── Determine destination (Conquest PACS) ──────────────────────────
    const cfg = await getRadiologyConfig();
    const destAeTitle = node.conquestAeTitle || cfg.conquest.aeTitle || "CONQUESTPACS";
    const destHost = node.conquestHost || cfg.conquest.ip || NETWORK_LAN_HOST;
    const destPort = node.conquestPort || cfg.conquest.dicomPort || 5678;

    // ── C-MOVE each study ────────────────────────────────────────────────
    let studiesPulled = 0;
    let studiesFailed = 0;
    const pulledUIDs: string[] = [];

    for (const study of findResult.studies) {
      if (!study.studyInstanceUID) continue;

      const moveResult = await moveStudy(node, study.studyInstanceUID, destAeTitle);

      if (moveResult.ok) {
        studiesPulled++;
        pulledUIDs.push(study.studyInstanceUID);
        await logEvent({
          eventType: "C_MOVE",
          sourceAeTitle: node.aeTitle,
          sourceIp: node.host,
          modality: node.modality,
          studyInstanceUID: study.studyInstanceUID,
          accessionNumber: study.accessionNumber,
          patientName: study.patientName,
          patientId: study.patientId,
          status: "SUCCESS",
          message: `C-MOVE OK: ${study.studyInstanceUID} to ${destAeTitle} (${moveResult.completed} instances)`,
          rawPayload: { remaining: moveResult.remaining, completed: moveResult.completed },
        });
      } else {
        studiesFailed++;
        await logEvent({
          eventType: "C_MOVE",
          sourceAeTitle: node.aeTitle,
          sourceIp: node.host,
          modality: node.modality,
          studyInstanceUID: study.studyInstanceUID,
          accessionNumber: study.accessionNumber,
          patientName: study.patientName,
          patientId: study.patientId,
          status: "FAILED",
          message: `C-MOVE failed: ${moveResult.error}`,
          rawPayload: { remaining: moveResult.remaining, completed: moveResult.completed },
        });
      }
    }

    // ── Finalise job ───────────────────────────────────────────────────
    const finalStatus = studiesFailed > 0 && studiesPulled === 0 ? "failed"
      : studiesFailed > 0 ? "partial"
      : "completed";

    if (finalStatus === "completed") {
      await completeJob(job.id, studiesFound, studiesPulled, studiesFailed, pulledUIDs);
    } else if (finalStatus === "partial") {
      await partialJob(job.id, studiesFound, studiesPulled, studiesFailed, pulledUIDs);
    } else {
      await failJob(job.id, `All ${studiesFound} studies failed to move`);
    }

    // Update node telemetry
    await db
      .update(dicomNodesTable)
      .set({
        lastPullAt: new Date(),
        lastPullStatus: finalStatus,
        lastPullMessage: `Found ${studiesFound}, pulled ${studiesPulled}, failed ${studiesFailed}`,
      })
      .where(eq(dicomNodesTable.id, node.id));

    await heartbeat({
      status: finalStatus === "completed" ? "SUCCESS" : finalStatus === "partial" ? "WARNING" : "FAILED",
      message: `Job #${job.id} ${finalStatus}: ${studiesFound} found, ${studiesPulled} pulled, ${studiesFailed} failed`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId: job.id }, `[dimse-agent] Unhandled error processing job`);
    try {
      await failJob(job.id, `Unhandled error: ${msg}`);
    } catch { /* ignore */ }
  } finally {
    activeJobs--;
  }
}

async function completeJob(
  jobId: number,
  found: number,
  pulled: number,
  failed: number,
  uids: string[],
): Promise<void> {
  await db
    .update(dicomPullJobsTable)
    .set({
      status: "completed",
      studiesFound: found,
      studiesPulled: pulled,
      studiesFailed: failed,
      studyInstanceUIDs: JSON.stringify(uids),
      completedAt: new Date(),
    })
    .where(eq(dicomPullJobsTable.id, jobId));
}

async function partialJob(
  jobId: number,
  found: number,
  pulled: number,
  failed: number,
  uids: string[],
): Promise<void> {
  await db
    .update(dicomPullJobsTable)
    .set({
      status: "partial",
      studiesFound: found,
      studiesPulled: pulled,
      studiesFailed: failed,
      studyInstanceUIDs: JSON.stringify(uids),
      completedAt: new Date(),
    })
    .where(eq(dicomPullJobsTable.id, jobId));
}

async function failJob(jobId: number, errorMessage: string): Promise<void> {
  await db
    .update(dicomPullJobsTable)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(dicomPullJobsTable.id, jobId));
}

/* ── Poll loop ──────────────────────────────────────────────────────────── */

async function pollTick(): Promise<void> {
  if (!isRunning) return;

  try {
    if (isClinicPeakHours()) {
      // Heartbeat only — do not claim/run C-MOVE while the desk is busy.
      await heartbeat({
        status: "INFO",
        message: `Poll tick skipped — clinic peak hours (${clinicPeakHoursLabel()}); pending C-MOVE deferred`,
      });
      return;
    }

    // Process up to max-concurrent jobs per tick
    let processed = 0;
    while (activeJobs < MAX_CONCURRENT_JOBS && processed < 3) {
      const hadPending = await hasPendingJobs();
      if (!hadPending) break;
      await processNextJob();
      processed++;
    }

    // Emit heartbeat even when idle
    await heartbeat({ status: "INFO", message: `Poll tick — activeJobs=${activeJobs}` });
  } catch (err) {
    logger.error({ err }, "[dimse-agent] Poll tick error");
    await heartbeat({ status: "FAILED", message: `Poll tick error: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function hasPendingJobs(): Promise<boolean> {
  const rows = await db
    .select({ id: dicomPullJobsTable.id })
    .from(dicomPullJobsTable)
    .where(eq(dicomPullJobsTable.status, "pending"))
    .limit(1);
  return rows.length > 0;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export function startDimsePullAgent(): void {
  if (isRunning) {
    logger.warn("[dimse-agent] Already running, ignoring duplicate start");
    return;
  }
  isRunning = true;

  // Log startup asynchronously (don't block)
  logStartupVerification().catch((err) => {
    logger.error({ err }, "[dimse-agent] Startup verification failed");
  });

  // First poll after a short delay so startup logging completes first
  setTimeout(() => {
    if (!isRunning) return;
    pollTick().catch((err) => logger.error({ err }, "[dimse-agent] First poll failed"));
  }, 2_000);

  pollTimer = setInterval(() => {
    pollTick().catch((err) => logger.error({ err }, "[dimse-agent] Poll interval failed"));
  }, POLL_INTERVAL_MS);

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, maxConcurrent: MAX_CONCURRENT_JOBS },
    `[dimse-agent] Poll loop started`,
  );
}

export function stopDimsePullAgent(): void {
  isRunning = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logger.info("[dimse-agent] Stopped");
}

export function isDimsePullAgentRunning(): boolean {
  return isRunning;
}
