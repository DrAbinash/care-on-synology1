/**
 * pacsEnterprise.ts
 * Enterprise PACS/RIS routes — Parts 1–7 of the enterprise upgrade.
 *
 * Mounted at /api/radiology by routes/index.ts, behind
 * requireStaffAuth + requireStaffPermission("/orders").
 */
import { Router } from "express";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import { tcpProbe } from "../lib/pacs/providers.js";
import { testNodeConnection } from "../services/dicom-pull-agent/dimse-agent";
import { getRadiologyConfig, validateRadiologyConfig, isDockerBridgeIp } from "../lib/pacs/pacsConfig.js";
import { writeWorklistFile, removeWorklistFile, syncWorklistForStatus, isMwlEnabled, MWL_TERMINAL_STATUSES } from "../lib/pacs/mwlWorklistWriter.js";
import { getMwlDeploymentStatus, recordMwlSyncResult } from "../lib/pacs/mwlDeploymentStatus.js";
import { getRadiologyAdminOverview } from "../lib/pacs/radiologyAdminOverview.js";
import { NETWORK_LAN_HOST, DEFAULT_OHIF_BASE_URL, DEFAULT_WADO_URL, OHIF_HTTP_PORT } from "../lib/networkDefaults";
import { fetchPrintImageBytes, PRINT_MAX_IMAGE_BYTES } from "../lib/reportImages";
import { buildPrintClinic } from "../lib/buildPrintClinic";
import {
  dicomRoutingRulesTable,
  dicomPulledStudiesTable,
  dicomFailedRetrievalQueueTable,
  radiologyScheduledProceduresTable,
  pacsSettingsTable,
  dicomModalitiesTable,
  dicomNodesTable,
  pacsLogsTable,
  radiologyWorklistTable,
  radiologyStudiesTable,
  patientsTable,
  radiologyConfigChangesTable,
  clinicSettingsTable,
  dicomStudiesTable,
  dicomStudySeriesTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";

const execAsync = promisify(exec);
const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getViewerSettings(): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(pacsSettingsTable)
    .where(eq(pacsSettingsTable.category, "viewer"));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value ?? "";
  return map;
}

async function getSetting(key: string, category: string): Promise<string | null> {
  const [row] = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, category)))
    .limit(1);
  return row?.value ?? null;
}

async function logPacsEvent(
  source: string,
  eventType: string,
  message: string,
  extra: { studyInstanceUID?: string; accessionNumber?: string | null; severity?: string } = {},
) {
  await db
    .insert(pacsLogsTable)
    .values({
      source,
      eventType,
      severity: extra.severity ?? "info",
      message,
      studyInstanceUid: extra.studyInstanceUID ?? null,
      accessionNumber: extra.accessionNumber ?? null,
    })
    .catch(() => {});
}

// ─── C-ECHO (Upgraded) ────────────────────────────────────────────────────────
//
// POST /api/radiology/modalities/:id/echo-test
// Tries real DICOM C-ECHO via echoscu (DCMTK) if available on the server.
// Falls back to TCP reachability probe when DCMTK is not installed.

router.post("/modalities/:id/echo-test", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [modality] = await db
    .select()
    .from(dicomModalitiesTable)
    .where(eq(dicomModalitiesTable.id, id));
  if (!modality) {
    res.status(404).json({ error: "Modality not found" });
    return;
  }

  const host = modality.ipAddress;
  const port = modality.port;
  if (!host || !port) {
    res.status(400).json({ error: "No IP/port configured for this modality" });
    return;
  }

  const aeTitle = modality.aeTitle ?? "DIAGNOCENTER";
  const start = Date.now();

  // Detect whether echoscu (DCMTK) is installed on this server
  let hasDcmtk = false;
  try {
    await execAsync("which echoscu", { timeout: 3000 });
    hasDcmtk = true;
  } catch {
    hasDcmtk = false;
  }

  let ok = false;
  let testType: "DICOM_C_ECHO" | "TCP_FALLBACK" = "TCP_FALLBACK";
  let message = "";
  let latencyMs = 0;
  let associationStatus: "ACCEPTED" | "REJECTED" | "UNREACHABLE" = "UNREACHABLE";

  if (hasDcmtk) {
    testType = "DICOM_C_ECHO";
    try {
      // -aec: called AE title (the target modality)
      // -aet: calling AE title (us)
      // Timeout flag: --timeout 5
      const { stdout, stderr } = await execAsync(
        `echoscu -aec "${aeTitle}" -aet "DIAGNOCENTER" --timeout 5 "${host}" ${port}`,
        { timeout: 8000 },
      );
      latencyMs = Date.now() - start;
      const output = (stdout + stderr).toLowerCase();
      if (output.includes("association accepted") || output.includes("successful")) {
        ok = true;
        associationStatus = "ACCEPTED";
        message = "DICOM C-ECHO successful — association accepted";
      } else if (output.includes("association rejected") || output.includes("refused")) {
        ok = false;
        associationStatus = "REJECTED";
        message = `DICOM C-ECHO rejected: ${stdout.trim() || stderr.trim()}`;
      } else {
        // echoscu exits 0 on success even with no output
        ok = true;
        associationStatus = "ACCEPTED";
        message = "DICOM C-ECHO completed (echoscu exit 0)";
      }
    } catch (err: unknown) {
      latencyMs = Date.now() - start;
      const e = err as { code?: number; stderr?: string; message?: string };
      ok = false;
      associationStatus = "UNREACHABLE";
      message = `DICOM C-ECHO failed: ${e.stderr ?? e.message ?? "unknown error"}`;
    }
  } else {
    // TCP fallback
    const tcpResult = await tcpProbe(host, port, 5000, true);
    latencyMs = tcpResult.latencyMs ?? (Date.now() - start);
    ok = tcpResult.ok;
    message = tcpResult.ok
      ? "TCP reachable — DICOM association not verified (install DCMTK on server for full C-ECHO)"
      : tcpResult.message;
    associationStatus = tcpResult.ok ? "ACCEPTED" : "UNREACHABLE";
  }

  await db
    .update(dicomModalitiesTable)
    .set({
      lastConnectionStatus: ok ? "ok" : "error",
      lastSeenAt: ok ? new Date() : undefined,
      lastError: ok ? null : message,
      updatedAt: new Date(),
    })
    .where(eq(dicomModalitiesTable.id, id));

  await logPacsEvent(
    "DICOM_PULL_AGENT",
    ok ? "C_ECHO_SUCCESS" : "C_ECHO_FAILED",
    message,
    { severity: ok ? "info" : "warn" },
  );

  res.json({
    ok,
    testType,
    latencyMs,
    message,
    aeTitle,
    associationStatus,
    host,
    port,
  });
});

// POST /api/radiology/test-modality
// Non-persisted server-side modality connectivity tester.
// Tries real DICOM C-ECHO via echoscu (DCMTK) if available on the server.
// Falls back to TCP reachability probe when DCMTK is not installed.
router.post("/test-modality", async (req, res) => {
  const body = z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    aeTitle: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Host and port are required" });
    return;
  }

  const { host, port, aeTitle: aeTitleOpt } = body.data;
  const aeTitle = aeTitleOpt ?? "DIAGNOCENTER";
  const start = Date.now();

  // Detect whether echoscu (DCMTK) is installed on this server
  let hasDcmtk = false;
  try {
    await execAsync("which echoscu", { timeout: 3000 });
    hasDcmtk = true;
  } catch {
    hasDcmtk = false;
  }

  let ok = false;
  let testType: "DICOM_C_ECHO" | "TCP_FALLBACK" = "TCP_FALLBACK";
  let message = "";
  let latencyMs = 0;
  let associationStatus: "ACCEPTED" | "REJECTED" | "UNREACHABLE" = "UNREACHABLE";

  if (hasDcmtk) {
    testType = "DICOM_C_ECHO";
    try {
      const { stdout, stderr } = await execAsync(
        `echoscu -aec "${aeTitle}" -aet "DIAGNOCENTER" --timeout 5 "${host}" ${port}`,
        { timeout: 8000 },
      );
      latencyMs = Date.now() - start;
      const output = (stdout + stderr).toLowerCase();
      if (output.includes("association accepted") || output.includes("successful")) {
        ok = true;
        associationStatus = "ACCEPTED";
        message = "DICOM C-ECHO successful — association accepted";
      } else if (output.includes("association rejected") || output.includes("refused")) {
        ok = false;
        associationStatus = "REJECTED";
        message = `DICOM C-ECHO rejected: ${stdout.trim() || stderr.trim()}`;
      } else {
        ok = true;
        associationStatus = "ACCEPTED";
        message = "DICOM C-ECHO completed (echoscu exit 0)";
      }
    } catch (err: any) {
      latencyMs = Date.now() - start;
      ok = false;
      associationStatus = "UNREACHABLE";
      message = `DICOM C-ECHO failed: ${err.stderr ?? err.message ?? "unknown error"}`;
    }
  } else {
    // TCP fallback
    const tcpResult = await tcpProbe(host, port, 5000, true);
    latencyMs = tcpResult.latencyMs ?? (Date.now() - start);
    ok = tcpResult.ok;
    message = tcpResult.ok
      ? "TCP reachable — DICOM association not verified (install DCMTK on server for full C-ECHO)"
      : tcpResult.message;
    associationStatus = tcpResult.ok ? "ACCEPTED" : "UNREACHABLE";
  }

  res.json({
    ok,
    testType,
    latencyMs,
    message,
    aeTitle,
    associationStatus,
    host,
    port,
  });
});

// ─── ROUTING RULES ────────────────────────────────────────────────────────────

const DEFAULT_VIEWER_SETTINGS: Record<string, string> = {
  // OHIF viewer — same-origin nginx proxy (port 3010 proxies /dicom-web → care-orthanc:8042)
  ohif_base_url: DEFAULT_OHIF_BASE_URL,
  dicom_web_base_url: `${DEFAULT_OHIF_BASE_URL}/dicom-web`,
  ohif_study_url_template: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
  // Weasis — uses Orthanc's own WADO-URI endpoint directly (not via OHIF proxy)
  wado_uri_base_url: DEFAULT_WADO_URL,
  weasis_manifest_url_template: `weasis://$dicom:get -w "${DEFAULT_WADO_URL}?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"`,
  pacs_ip: NETWORK_LAN_HOST,
  pacs_port: "4242",
  pacs_ae_title: "ORTHANC2",
  viewer_mode: "BOTH",
  default_viewer: "WEASIS",
  ohif_enabled: "true",
  weasis_enabled: "true",
};

router.post("/pacs-settings/load-defaults", async (_req, res) => {
  const results: { key: string; action: "inserted" | "updated" }[] = [];
  for (const [key, value] of Object.entries(DEFAULT_VIEWER_SETTINGS)) {
    const [existing] = await db
      .select({ id: pacsSettingsTable.id })
      .from(pacsSettingsTable)
      .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, "viewer")))
      .limit(1);
    if (existing) {
      await db
        .update(pacsSettingsTable)
        .set({ value, updatedAt: new Date() })
        .where(eq(pacsSettingsTable.id, existing.id));
      results.push({ key, action: "updated" });
    } else {
      await db.insert(pacsSettingsTable).values({
        key,
        value,
        category: "viewer",
        isSecret: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      results.push({ key, action: "inserted" });
    }
  }
  res.json({ ok: true, count: results.length, results });
});

router.get("/routing-rules", async (_req, res) => {
  const rows = await db
    .select()
    .from(dicomRoutingRulesTable)
    .orderBy(asc(dicomRoutingRulesTable.priority), asc(dicomRoutingRulesTable.id));
  res.json(rows);
});

router.post("/routing-rules", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body.name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const payload = {
    name: String(body.name),
    modalityType: body.modalityType ? String(body.modalityType) : null,
    sourceAeTitle: body.sourceAeTitle ? String(body.sourceAeTitle) : null,
    destinationPacs: body.destinationPacs ? String(body.destinationPacs) : "CONQUEST",
    destinationAeTitle: body.destinationAeTitle ? String(body.destinationAeTitle) : null,
    destinationIp: body.destinationIp ? String(body.destinationIp) : null,
    destinationPort: body.destinationPort ? Number(body.destinationPort) : null,
    storagePath: body.storagePath ? String(body.storagePath) : null,
    autoPush: body.autoPush !== false,
    priority: body.priority ? Number(body.priority) : 10,
    isEnabled: body.isEnabled !== false,
    notes: body.notes ? String(body.notes) : null,
    updatedAt: new Date(),
  };

  if (body.id) {
    const [row] = await db
      .update(dicomRoutingRulesTable)
      .set(payload)
      .where(eq(dicomRoutingRulesTable.id, Number(body.id)))
      .returning();
    res.json(row);
  } else {
    const [row] = await db.insert(dicomRoutingRulesTable).values(payload).returning();
    res.json(row);
  }
});

router.patch("/routing-rules/:id/toggle", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [current] = await db
    .select({ isEnabled: dicomRoutingRulesTable.isEnabled })
    .from(dicomRoutingRulesTable)
    .where(eq(dicomRoutingRulesTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .update(dicomRoutingRulesTable)
    .set({ isEnabled: !current.isEnabled, updatedAt: new Date() })
    .where(eq(dicomRoutingRulesTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/routing-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(dicomRoutingRulesTable).where(eq(dicomRoutingRulesTable.id, id));
  res.json({ ok: true });
});

// ─── PULLED STUDIES ───────────────────────────────────────────────────────────

router.get("/pulled-studies", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const status = req.query.status as string | undefined;
  const modality = req.query.modality as string | undefined;

  const conds = [];
  if (status) conds.push(eq(dicomPulledStudiesTable.status, status));
  if (modality) conds.push(eq(dicomPulledStudiesTable.modality, modality));

  const rows = await db
    .select()
    .from(dicomPulledStudiesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(dicomPulledStudiesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

// GET /api/radiology/pulled-studies/stats — must come BEFORE /:uid routes
router.get("/pulled-studies/stats", async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayRows, allRows] = await Promise.all([
    db
      .select({ status: dicomPulledStudiesTable.status, count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .where(gte(dicomPulledStudiesTable.createdAt, todayStart))
      .groupBy(dicomPulledStudiesTable.status),
    db
      .select({ status: dicomPulledStudiesTable.status, count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .groupBy(dicomPulledStudiesTable.status),
  ]);

  const today: Record<string, number> = {};
  for (const r of todayRows) today[r.status] = r.count;
  const totals: Record<string, number> = {};
  for (const r of allRows) totals[r.status] = r.count;

  res.json({ today, totals });
});

// ─── FAILED RETRIEVAL QUEUE ───────────────────────────────────────────────────

router.get("/failed-queue", async (req, res) => {
  const status = (req.query.status as string) || "PENDING";
  const rows = await db
    .select()
    .from(dicomFailedRetrievalQueueTable)
    .where(eq(dicomFailedRetrievalQueueTable.status, status))
    .orderBy(desc(dicomFailedRetrievalQueueTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.post("/failed-queue/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [item] = await db
    .select()
    .from(dicomFailedRetrievalQueueTable)
    .where(eq(dicomFailedRetrievalQueueTable.id, id));
  if (!item) {
    res.status(404).json({ error: "Queue item not found" });
    return;
  }

  const [updated] = await db
    .update(dicomFailedRetrievalQueueTable)
    .set({
      status: "PENDING",
      nextRetryAt: new Date(),
      retryCount: item.retryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(dicomFailedRetrievalQueueTable.id, id))
    .returning();

  res.json({ ok: true, item: updated });
});

router.delete("/failed-queue/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .update(dicomFailedRetrievalQueueTable)
    .set({ status: "ABANDONED", updatedAt: new Date() })
    .where(eq(dicomFailedRetrievalQueueTable.id, id));
  res.json({ ok: true });
});

// ─── WEASIS VIEWER LAUNCH ─────────────────────────────────────────────────────

router.get("/studies/:studyInstanceUID/weasis-launch", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const cfg = await getRadiologyConfig();

  const wadoUrl = cfg.weasis.wadoUrl;
  const manifestTemplate = cfg.weasis.launchTemplate;
  const pacsType = cfg.orthanc.ip ? "ORTHANC" : "UNKNOWN";

  if (!wadoUrl && !manifestTemplate) {
    res.json({
      studyInstanceUID,
      viewerType: "WEASIS",
      error: "Viewer settings are not configured. Go to PACS / DICOM Settings → Viewer Settings and click Load Clinic Viewer Defaults.",
      weasisUrl: null,
      fallbackDicomWebUrl: null,
      pacsType: "UNKNOWN",
    });
    return;
  }

  // Format the template dynamically
  const weasisUrl = manifestTemplate
    ? manifestTemplate
        .replace(/\{WADO_URL\}/g, wadoUrl)
        .replace(/\{wado_url\}/g, wadoUrl)
        .replace(/\{studyInstanceUID\}/g, studyInstanceUID)
    : `weasis://$dicom:get -w "${wadoUrl}" -r "studyUID=${studyInstanceUID}"`;

  const [[worklist], [pulled]] = await Promise.all([
    db
      .select({ patientName: radiologyWorklistTable.patientName, accessionNumber: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID))
      .limit(1),
    db
      .select({ patientName: dicomPulledStudiesTable.patientName, accessionNumber: dicomPulledStudiesTable.accessionNumber })
      .from(dicomPulledStudiesTable)
      .where(eq(dicomPulledStudiesTable.studyInstanceUID, studyInstanceUID))
      .limit(1),
  ]);

  const patientName = worklist?.patientName ?? pulled?.patientName ?? null;
  const accessionNumber = worklist?.accessionNumber ?? pulled?.accessionNumber ?? null;

  void logPacsEvent("WEASIS_VIEWER_LAUNCH", "VIEWER_LAUNCHED", `Weasis viewer launched for study ${studyInstanceUID}`, {
    studyInstanceUID,
    accessionNumber,
  });

  res.json({
    studyInstanceUID,
    patientName,
    accessionNumber,
    viewerType: "WEASIS",
    weasisUrl,
    fallbackDicomWebUrl: cfg.orthanc.dicomWebUrl || null,
    wadoBaseUrl: wadoUrl,
    pacsType,
  });
});

// GET /api/radiology/studies/:studyInstanceUID/weasis-launch-redirect
// Redirects to the weasis:// protocol handler. This route (like the rest of
// this router) requires requireStaffAuth — a plain browser navigation
// (window.open/<a href>) can never carry the Authorization header that
// needs, so it 401s for any real user before this handler ever runs. Kept
// for any authenticated non-browser caller; the frontend uses the sibling
// JSON /weasis-launch endpoint via an authenticated fetch instead (see
// openWeasisLaunchRedirect in diagnostic-erp/src/lib/viewerService.ts).
router.get("/studies/:studyInstanceUID/weasis-launch-redirect", async (req, res) => {
  const { studyInstanceUID } = req.params;
  const cfg = await getRadiologyConfig();

  const wadoUrl = cfg.weasis.wadoUrl;
  const manifestTemplate = cfg.weasis.launchTemplate;

  if (!wadoUrl && !manifestTemplate) {
    res.status(400).send("Viewer settings are not configured. Go to PACS Settings and load defaults.");
    return;
  }

  const weasisUrl = manifestTemplate
    ? manifestTemplate
        .replace(/\{WADO_URL\}/g, wadoUrl)
        .replace(/\{wado_url\}/g, wadoUrl)
        .replace(/\{studyInstanceUID\}/g, studyInstanceUID)
    : `weasis://$dicom:get -w "${wadoUrl}" -r "studyUID=${studyInstanceUID}"`;

  void logPacsEvent("WEASIS_REDIRECT_LAUNCH", "VIEWER_LAUNCHED", `Weasis redirect executed for study ${studyInstanceUID}`, {
    studyInstanceUID,
  });

  res.redirect(weasisUrl);
});

// ─── OHIF VIEWER LAUNCH ───────────────────────────────────────────────────────

// R1.3 — the launch URL is built SERVER-SIDE from the admin-configured
// template, optionally narrowed to a series / SOP instance for report-image
// deep links. Every UID is validated; malformed identifiers are rejected.
// Precision degrades explicitly (SOP → series → study) when the configured
// viewer URL cannot express the requested level, and the response reports
// both the requested and the achieved level. Never patient-name matching,
// never a public PACS URL.
const LAUNCH_UID = /^[0-9.]{1,128}$/;

/** Pure R1.3 helper (exported for tests): builds the most specific OHIF URL
 *  the configured template can express. */
export function buildOhifLaunchUrl(opts: {
  ohifBase: string;
  studyTemplate: string | null | undefined;
  studyInstanceUID: string;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
}): { ohifUrl: string; launchLevel: "study" | "series" | "sop" } {
  const { ohifBase, studyTemplate, studyInstanceUID } = opts;
  const series = opts.seriesInstanceUID || null;
  const sop = opts.sopInstanceUID || null;
  let url = studyTemplate
    ? studyTemplate
        .replace(/\{OHIF_BASE_URL\}/g, ohifBase.replace(/\/$/, ""))
        .replace(/\{studyInstanceUID\}/g, encodeURIComponent(studyInstanceUID))
    : `${ohifBase.replace(/\/$/, "")}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;
  let launchLevel: "study" | "series" | "sop" = "study";
  // A custom template may carry explicit placeholders for deeper levels.
  const hasSeriesSlot = !!studyTemplate && studyTemplate.includes("{seriesInstanceUID}");
  const hasSopSlot = !!studyTemplate && studyTemplate.includes("{sopInstanceUID}");
  if (hasSeriesSlot) url = url.replace(/\{seriesInstanceUID\}/g, series ? encodeURIComponent(series) : "");
  if (hasSopSlot) url = url.replace(/\{sopInstanceUID\}/g, sop ? encodeURIComponent(sop) : "");
  if (series && hasSeriesSlot) launchLevel = "series";
  if (sop && hasSopSlot) launchLevel = "sop";
  // Standard OHIF viewer URLs (the default and the shipped template) accept
  // SeriesInstanceUIDs as a query filter; SOP-level addressing is not a
  // stable OHIF URL parameter, so a SOP request degrades to its series.
  if (series && launchLevel === "study" && /[?&]StudyInstanceUIDs=/.test(url)) {
    url += `&SeriesInstanceUIDs=${encodeURIComponent(series)}`;
    launchLevel = "series";
  }
  return { ohifUrl: url, launchLevel };
}

router.get("/studies/:studyInstanceUID/ohif-launch", async (req, res) => {
  const { studyInstanceUID } = req.params;
  if (!LAUNCH_UID.test(studyInstanceUID)) {
    res.status(400).json({ error: "invalid StudyInstanceUID" });
    return;
  }
  const seriesInstanceUID = typeof req.query.seriesInstanceUID === "string" ? req.query.seriesInstanceUID : "";
  const sopInstanceUID = typeof req.query.sopInstanceUID === "string" ? req.query.sopInstanceUID : "";
  if (seriesInstanceUID && !LAUNCH_UID.test(seriesInstanceUID)) {
    res.status(400).json({ error: "invalid SeriesInstanceUID" });
    return;
  }
  if (sopInstanceUID && !LAUNCH_UID.test(sopInstanceUID)) {
    res.status(400).json({ error: "invalid SOPInstanceUID" });
    return;
  }
  if (sopInstanceUID && !seriesInstanceUID) {
    res.status(400).json({ error: "seriesInstanceUID is required with sopInstanceUID" });
    return;
  }
  const requestedLevel: "study" | "series" | "sop" = sopInstanceUID ? "sop" : seriesInstanceUID ? "series" : "study";
  const worklistIdRaw = typeof req.query.worklistId === "string" ? Number(req.query.worklistId) : NaN;
  if (Number.isFinite(worklistIdRaw) && worklistIdRaw > 0) {
    const [wl] = await db
      .select({ id: radiologyWorklistTable.id, studyInstanceUID: radiologyWorklistTable.studyInstanceUID })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, Math.trunc(worklistIdRaw)))
      .limit(1);
    if (!wl || (wl.studyInstanceUID && wl.studyInstanceUID !== studyInstanceUID)) {
      res.status(409).json({ error: "StudyInstanceUID does not match the requested worklist study", code: "OHIF_STUDY_MISMATCH" });
      return;
    }
  }
  const cfg = await getRadiologyConfig();

  const ohifBase = cfg.ohif.baseUrl;
  const studyTemplate = cfg.ohif.studyLaunchTemplate;
  const dicomWebUrl = cfg.orthanc.dicomWebUrl;
  const pacsType = cfg.orthanc.ip ? "ORTHANC" : "CONQUEST";

  if (!ohifBase && !studyTemplate) {
    res.json({
      studyInstanceUID,
      viewerType: "OHIF",
      error: "Viewer settings are not configured. Go to PACS / DICOM Settings → Viewer Settings and click Load Clinic Viewer Defaults.",
      ohifUrl: null,
      dicomWebBaseUrl: "/api/radiology/dicom-web",
      pacsType,
      requestedLevel,
      launchLevel: null,
    });
    return;
  }

  const { ohifUrl, launchLevel } = buildOhifLaunchUrl({
    ohifBase, studyTemplate, studyInstanceUID,
    seriesInstanceUID: seriesInstanceUID || null,
    sopInstanceUID: sopInstanceUID || null,
  });

  const [[worklist], [pulled]] = await Promise.all([
    db
      .select({ patientName: radiologyWorklistTable.patientName, accessionNumber: radiologyWorklistTable.accessionNumber })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID))
      .limit(1),
    db
      .select({ patientName: dicomPulledStudiesTable.patientName, accessionNumber: dicomPulledStudiesTable.accessionNumber })
      .from(dicomPulledStudiesTable)
      .where(eq(dicomPulledStudiesTable.studyInstanceUID, studyInstanceUID))
      .limit(1),
  ]);

  const patientName = worklist?.patientName ?? pulled?.patientName ?? null;
  const accessionNumber = worklist?.accessionNumber ?? pulled?.accessionNumber ?? null;

  void logPacsEvent("OHIF_VIEWER_LAUNCH", "VIEWER_LAUNCHED", `OHIF viewer launched for study ${studyInstanceUID} (${launchLevel} level)`, {
    studyInstanceUID,
    accessionNumber,
  });

  // Browser QIDO/WADO must always use the ERP same-origin proxy — never a LAN
  // OHIF/Orthanc URL (CORS + mixed-content block remote/Tailscale clients).
  // The server reaches Orthanc internally; the SPA only needs session cookies.
  const browserDicomWeb = "/api/radiology/dicom-web";

  res.json({
    studyInstanceUID,
    patientName,
    accessionNumber,
    viewerType: "OHIF",
    ohifUrl,
    dicomWebBaseUrl: browserDicomWeb || dicomWebUrl,
    /** Server-side Orthanc DICOMweb (not for browser fetch). */
    orthancDicomWebUrl: dicomWebUrl,
    pacsType,
    requestedLevel,
    launchLevel,
  });
});

// ─── Browser DICOMweb proxy (Report Images / Print Images) ───────────────────
// OHIF loads images inside its own origin via nginx → Orthanc. The SPA cannot
// QIDO Orthanc :8042 (CORS / auth). These routes re-expose the subset of
// DICOMweb the image pickers need, authenticated as staff, using server-side
// Orthanc credentials.

async function orthancDicomWebFetch(pathAndQuery: string, accept: string): Promise<Response | null> {
  const cfg = await getRadiologyConfig();
  const base =
    process.env.ORTHANC_INTERNAL_URL?.replace(/\/+$/, "")
    || cfg.orthanc.dicomWebUrl?.replace(/\/dicom-web\/?$/, "")
    || "";
  if (!base) return null;
  const headers: Record<string, string> = { Accept: accept };
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  if (user && pass) headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(`${base}/dicom-web${pathAndQuery}`, { headers, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/dicom-web/studies/:studyInstanceUID/series", async (req, res) => {
  const { studyInstanceUID } = req.params;
  if (!LAUNCH_UID.test(studyInstanceUID)) {
    res.status(400).json({ error: "invalid StudyInstanceUID" });
    return;
  }
  const upstream = await orthancDicomWebFetch(
    `/studies/${encodeURIComponent(studyInstanceUID)}/series`,
    "application/dicom+json",
  );
  if (!upstream) {
    res.status(502).json({ error: "Orthanc DICOMweb unreachable" });
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status).type(upstream.headers.get("content-type") || "application/dicom+json").send(body);
});

router.get("/dicom-web/studies/:studyInstanceUID/series/:seriesInstanceUID/instances", async (req, res) => {
  const { studyInstanceUID, seriesInstanceUID } = req.params;
  if (!LAUNCH_UID.test(studyInstanceUID) || !LAUNCH_UID.test(seriesInstanceUID)) {
    res.status(400).json({ error: "invalid UID" });
    return;
  }
  const upstream = await orthancDicomWebFetch(
    `/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesInstanceUID)}/instances`,
    "application/dicom+json",
  );
  if (!upstream) {
    res.status(502).json({ error: "Orthanc DICOMweb unreachable" });
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status).type(upstream.headers.get("content-type") || "application/dicom+json").send(body);
});

router.get(
  "/dicom-web/studies/:studyInstanceUID/series/:seriesInstanceUID/instances/:sopInstanceUID/rendered",
  async (req, res) => {
    const { studyInstanceUID, seriesInstanceUID, sopInstanceUID } = req.params;
    if (!LAUNCH_UID.test(studyInstanceUID) || !LAUNCH_UID.test(seriesInstanceUID) || !LAUNCH_UID.test(sopInstanceUID)) {
      res.status(400).json({ error: "invalid UID" });
      return;
    }
    const qs = new URLSearchParams();
    if (typeof req.query.quality === "string") qs.set("quality", req.query.quality);
    if (typeof req.query.viewport === "string") qs.set("viewport", req.query.viewport);
    const suffix = qs.toString() ? `?${qs}` : "";
    const upstream = await orthancDicomWebFetch(
      `/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesInstanceUID)}/instances/${encodeURIComponent(sopInstanceUID)}/rendered${suffix}`,
      "image/jpeg",
    );
    if (!upstream) {
      res.status(502).json({ error: "Orthanc DICOMweb unreachable" });
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).type(upstream.headers.get("content-type") || "image/jpeg").send(body);
  },
);

router.get(
  "/dicom-web/studies/:studyInstanceUID/series/:seriesInstanceUID/instances/:sopInstanceUID/frames/:frame/rendered",
  async (req, res) => {
    const { studyInstanceUID, seriesInstanceUID, sopInstanceUID, frame } = req.params;
    if (!LAUNCH_UID.test(studyInstanceUID) || !LAUNCH_UID.test(seriesInstanceUID) || !LAUNCH_UID.test(sopInstanceUID)) {
      res.status(400).json({ error: "invalid UID" });
      return;
    }
    if (!/^\d{1,6}$/.test(frame)) {
      res.status(400).json({ error: "invalid frame" });
      return;
    }
    const qs = new URLSearchParams();
    if (typeof req.query.quality === "string") qs.set("quality", req.query.quality);
    if (typeof req.query.viewport === "string") qs.set("viewport", req.query.viewport);
    const suffix = qs.toString() ? `?${qs}` : "";
    const upstream = await orthancDicomWebFetch(
      `/studies/${encodeURIComponent(studyInstanceUID)}/series/${encodeURIComponent(seriesInstanceUID)}/instances/${encodeURIComponent(sopInstanceUID)}/frames/${frame}/rendered${suffix}`,
      "image/jpeg",
    );
    if (!upstream) {
      res.status(502).json({ error: "Orthanc DICOMweb unreachable" });
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).type(upstream.headers.get("content-type") || "image/jpeg").send(body);
  },
);

// ─── M1.2 — READ-ONLY LAUNCH DIAGNOSTICS ─────────────────────────────────────
// The browser cannot ask the PACS whether a StudyInstanceUID exists (QIDO is
// cross-origin), so the workspace's permission-gated diagnostics drawer asks
// this endpoint instead. Read-only; staff-auth + "/radiology" permission are
// enforced at the router mount. Endpoint hosts are MASKED — diagnostics must
// not enumerate internal topology — and there is no credential exposure and
// no patient-name search (exact StudyInstanceUID only).

/** Mask a URL's host: keep scheme, first 3 chars of host, port and path. */
export function maskEndpointForDiagnostics(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.length <= 3 ? "***" : `${u.hostname.slice(0, 3)}***`;
    return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${u.pathname !== "/" ? u.pathname : ""}`;
  } catch {
    return "***";
  }
}

router.get("/studies/:studyInstanceUID/launch-diagnostics", async (req, res) => {
  const { studyInstanceUID } = req.params;
  if (!/^[0-9.]{1,128}$/.test(studyInstanceUID)) {
    res.status(400).json({ error: "invalid StudyInstanceUID" });
    return;
  }

  // Which network modes have viewer endpoints configured (masked).
  const settings = await db.select().from(pacsSettingsTable);
  const val = (key: string) => settings.find((s) => s.key === key)?.value?.trim() ?? "";
  const modeKeys: Record<string, string> = {
    LAN: "ohif_base_url",
    TAILSCALE: "ohif_base_url_tailscale",
    CLOUDFLARE: "ohif_base_url_cloudflare",
    PUBLIC: "ohif_base_url_public",
  };
  const endpoints: Record<string, string> = {};
  const configuredModes: string[] = [];
  for (const [mode, key] of Object.entries(modeKeys)) {
    const url = val(key);
    if (url) {
      configuredModes.push(mode);
      endpoints[mode] = maskEndpointForDiagnostics(url);
    }
  }

  // Server-side PACS existence check by EXACT StudyInstanceUID (never by
  // patient name). Uses the server's own Orthanc reachability, bounded.
  let pacsLookup: "FOUND" | "NOT_FOUND" | "UNAVAILABLE" = "UNAVAILABLE";
  let pacsDetail: string | undefined;
  try {
    const cfg = await getRadiologyConfig();
    const orthancBase =
      process.env.ORTHANC_INTERNAL_URL?.replace(/\/$/, "") ||
      cfg.orthanc.dicomWebUrl?.replace(/\/dicom-web\/?$/, "") ||
      "";
    if (!orthancBase) {
      pacsDetail = "no Orthanc endpoint configured on the server";
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const user = process.env.ORTHANC_USERNAME || "";
        const pass = process.env.ORTHANC_PASSWORD || "";
        if (user && pass) headers["Authorization"] = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
        const r = await fetch(`${orthancBase}/tools/find`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: studyInstanceUID } }),
        });
        if (r.ok) {
          const found = (await r.json()) as unknown[];
          pacsLookup = Array.isArray(found) && found.length > 0 ? "FOUND" : "NOT_FOUND";
        } else {
          pacsDetail = `PACS answered HTTP ${r.status}`;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (err) {
    pacsDetail = err instanceof Error && err.name === "AbortError" ? "PACS lookup timed out (3s)" : "PACS lookup failed";
  }

  res.json({ studyInstanceUID, pacsLookup, ...(pacsDetail ? { pacsDetail } : {}), configuredModes, endpoints });
});

// ─── MWL PROCEDURES (STAFF DASHBOARD) ────────────────────────────────────────

router.get("/mwl-procedures", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const status = req.query.status as string | undefined;
  const modality = req.query.modality as string | undefined;
  const date = req.query.date as string | undefined;
  const search = req.query.search as string | undefined;

  const conds = [];
  if (status) conds.push(eq(radiologyScheduledProceduresTable.status, status));
  if (modality) conds.push(eq(radiologyScheduledProceduresTable.modality, modality));
  if (date) {
    const compact = date.replace(/-/g, "");
    conds.push(eq(radiologyScheduledProceduresTable.scheduledDate, compact));
  }
  if (search) {
    conds.push(
      sql`(${radiologyScheduledProceduresTable.patientName} ILIKE ${`%${search}%`} OR ${radiologyScheduledProceduresTable.accessionNumber} ILIKE ${`%${search}%`})`,
    );
  }

  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(radiologyScheduledProceduresTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(radiologyScheduledProceduresTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ status: radiologyScheduledProceduresTable.status, count: sql<number>`count(*)::int` })
      .from(radiologyScheduledProceduresTable)
      .groupBy(radiologyScheduledProceduresTable.status),
  ]);

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c.count;

  res.json({ procedures: rows, byStatus });
});

router.patch("/mwl-procedures/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const allowed = ["status", "stationAeTitle", "scheduledDate", "scheduledTime", "studyDescription"];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if ((req.body as Record<string, unknown>)[key] !== undefined)
      updates[key] = (req.body as Record<string, unknown>)[key];
  }

  const [row] = await db
    .update(radiologyScheduledProceduresTable)
    .set(updates)
    .where(eq(radiologyScheduledProceduresTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (updates["status"] === "SENT_TO_MWL") {
    void logPacsEvent("MWL_SCHEDULED_PROCEDURE", "MWL_SENT", `Procedure ${row.accessionNumber} sent to MWL`, {
      accessionNumber: row.accessionNumber,
    });
  }

  // Keep the modality worklist file in sync with the procedure's status:
  // (re)write it while active, remove it once terminal. Inert unless configured.
  void syncWorklistForStatus(row, row.status);

  res.json(row);
});

router.post("/mwl-procedures", async (req, res) => {
  const body = req.body as Record<string, string | undefined>;
  if (!body.accessionNumber) {
    res.status(400).json({ error: "accessionNumber required" });
    return;
  }

  const [row] = await db
    .insert(radiologyScheduledProceduresTable)
    .values({
      accessionNumber: body.accessionNumber,
      patientId: body.patientId ?? null,
      patientName: body.patientName ?? null,
      patientSex: body.patientSex ?? null,
      patientAge: body.patientAge ?? null,
      patientDob: body.patientDob ?? null,
      modality: body.modality ?? null,
      procedureName: body.procedureName ?? null,
      procedureCode: body.procedureCode ?? null,
      studyDescription: body.studyDescription ?? null,
      referringDoctor: body.referringDoctor ?? null,
      referringDoctorId: body.referringDoctorId ?? null,
      scheduledDate: body.scheduledDate ? body.scheduledDate.replace(/-/g, "") : null,
      scheduledTime: body.scheduledTime ?? null,
      stationAeTitle: body.stationAeTitle ?? null,
      bodyPartExamined: body.bodyPartExamined ?? null,
      sourceBillId: body.sourceBillId ?? null,
      sourceOrderId: body.sourceOrderId ?? null,
      sourceAppointmentId: body.sourceAppointmentId ?? null,
      status: "SCHEDULED",
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    res.status(409).json({ error: "Duplicate accession number" });
    return;
  }

  void logPacsEvent("MWL_SCHEDULED_PROCEDURE", "MWL_CREATED", `New procedure scheduled: ${row.accessionNumber}`, {
    accessionNumber: row.accessionNumber,
  });

  // Publish to the modality worklist (inert unless ORTHANC_WORKLIST_DIR is set).
  void writeWorklistFile(row);

  res.json(row);
});

// Regenerate the whole worklist folder from the DB — initial population after
// enabling the feature, and reconciliation if files drift. Removes terminal
// procedures' files, (re)writes active ones.
router.post("/mwl-worklist/sync", async (_req, res) => {
  try {
    if (!isMwlEnabled()) {
      res.status(503).json({ error: "Modality worklist is not configured. Set ORTHANC_WORKLIST_DIR and mount a folder shared with Orthanc (worklists plugin)." });
      return;
    }
    const rows = await db.select().from(radiologyScheduledProceduresTable).limit(5000);
    let written = 0;
    let removed = 0;
    for (const row of rows) {
      if (MWL_TERMINAL_STATUSES.has((row.status || "").toUpperCase())) {
        await removeWorklistFile(row.accessionNumber);
        removed++;
      } else if (await writeWorklistFile(row)) {
        written++;
      }
    }
    recordMwlSyncResult({ written, removed, total: rows.length });
    res.json({ total: rows.length, written, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordMwlSyncResult({ written: 0, removed: 0, total: 0, error: message });
    res.status(500).json({ error: message, message });
  }
});

// GET /api/radiology/mwl-status — deployment health for Settings → DICOM & MWL tab
router.get("/mwl-status", async (_req, res) => {
  try {
    const status = await getMwlDeploymentStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Aggregated Radiology Settings Overview (safe — no secret values). */
router.get("/admin-overview", async (_req, res) => {
  try {
    const overview = await getRadiologyAdminOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── DICOM Q/R QUERY ─────────────────────────────────────────────────────────
//
// GET /api/radiology/qr-query
// Query params:
//   date       — exact study date YYYY-MM-DD
//   dateFrom   — range start YYYY-MM-DD
//   dateTo     — range end YYYY-MM-DD
//   modality   — comma-separated list e.g. "MR,CT"
//   patientName      — ILIKE substring
//   accessionNumber  — ILIKE substring
//   referringDoctor  — ILIKE substring
//   limit / offset   — pagination
//
// Queries both radiologyStudiesTable (RIS) and radiologyWorklistTable (PACS),
// deduplicates by accession number (RIS wins), then paginates.

router.get("/qr-query", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const dateParam = req.query.date as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const modalityParam = req.query.modality as string | undefined;
  const patientNameParam = req.query.patientName as string | undefined;
  const accessionParam = req.query.accessionNumber as string | undefined;
  const referringDoctorParam = req.query.referringDoctor as string | undefined;

  const modalityList = modalityParam
    ? modalityParam.split(",").map((m) => m.trim()).filter(Boolean)
    : [];

  // ── Query RIS (radiologyStudiesTable joined with patientsTable) ──────────
  const risConds: ReturnType<typeof eq>[] = [];
  if (dateParam) risConds.push(eq(radiologyStudiesTable.studyDate, dateParam));
  if (dateFrom && !dateParam) risConds.push(gte(radiologyStudiesTable.studyDate, dateFrom));
  if (dateTo && !dateParam) risConds.push(lte(radiologyStudiesTable.studyDate, dateTo));
  if (modalityList.length === 1) risConds.push(eq(radiologyStudiesTable.modality, modalityList[0]!));
  if (modalityList.length > 1) risConds.push(inArray(radiologyStudiesTable.modality, modalityList));
  if (accessionParam) risConds.push(ilike(radiologyStudiesTable.accessionNumber, `%${accessionParam}%`));
  if (referringDoctorParam) risConds.push(ilike(radiologyStudiesTable.referringDoctor, `%${referringDoctorParam}%`));

  const risQuery = db
    .select({
      id: radiologyStudiesTable.id,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      studyInstanceUID: radiologyStudiesTable.studyInstanceUid,
      modality: radiologyStudiesTable.modality,
      patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || ${patientsTable.lastName}, '')`,
      patientId: radiologyStudiesTable.patientId,
      studyDate: radiologyStudiesTable.studyDate,
      referringDoctor: radiologyStudiesTable.referringDoctor,
      status: radiologyStudiesTable.status,
    })
    .from(radiologyStudiesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .where(risConds.length ? and(...risConds) : undefined)
    .orderBy(desc(radiologyStudiesTable.studyDate), desc(radiologyStudiesTable.id))
    .limit(500);

  // patient name filter applied in JS after join (COALESCE expression)
  const [risRaw, pacsRaw] = await Promise.all([
    risQuery,
    (async () => {
      // radiologyWorklistTable.studyDate is stored as raw DICOM compact date YYYYMMDD.
      // Frontend sends YYYY-MM-DD so we strip dashes before comparing.
      const toCompact = (iso: string) => iso.replace(/-/g, "");
      const pacsConds: ReturnType<typeof eq>[] = [];
      if (dateParam) pacsConds.push(eq(radiologyWorklistTable.studyDate, toCompact(dateParam)));
      if (dateFrom && !dateParam) pacsConds.push(sql`${radiologyWorklistTable.studyDate} >= ${toCompact(dateFrom)}`);
      if (dateTo && !dateParam) pacsConds.push(sql`${radiologyWorklistTable.studyDate} <= ${toCompact(dateTo)}`);
      if (modalityList.length === 1) pacsConds.push(eq(radiologyWorklistTable.modality, modalityList[0]!));
      if (modalityList.length > 1) pacsConds.push(inArray(radiologyWorklistTable.modality, modalityList));
      if (accessionParam) pacsConds.push(ilike(radiologyWorklistTable.accessionNumber, `%${accessionParam}%`));
      if (referringDoctorParam) pacsConds.push(ilike(radiologyWorklistTable.referringDoctor, `%${referringDoctorParam}%`));
      if (patientNameParam) pacsConds.push(ilike(radiologyWorklistTable.patientName, `%${patientNameParam}%`));

      return db
        .select({
          id: radiologyWorklistTable.id,
          accessionNumber: radiologyWorklistTable.accessionNumber,
          studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
          modality: radiologyWorklistTable.modality,
          patientName: radiologyWorklistTable.patientName,
          patientId: radiologyWorklistTable.patientId,
          studyDate: radiologyWorklistTable.studyDate,
          referringDoctor: radiologyWorklistTable.referringDoctor,
          status: radiologyWorklistTable.status,
        })
        .from(radiologyWorklistTable)
        .where(pacsConds.length ? and(...pacsConds) : undefined)
        .orderBy(desc(radiologyWorklistTable.studyDate), desc(radiologyWorklistTable.id))
        .limit(500);
    })(),
  ]);

  // Apply patient name filter on RIS side (it's a computed expression)
  const risFiltered = patientNameParam
    ? risRaw.filter((r) => r.patientName.toLowerCase().includes(patientNameParam.toLowerCase()))
    : risRaw;

  // Merge: RIS rows indexed by accession number. PACS rows fill in gaps.
  type QrRow = {
    id: number;
    accessionNumber: string | null;
    studyInstanceUID: string | null;
    modality: string;
    patientName: string | null;
    patientId: number | null;
    studyDate: string | null;
    referringDoctor: string | null;
    status: string;
    source: string;
  };

  // Key type admits null: PACS rows can lack an accession number, and the
  // dedup below relies on the same runtime behaviour Map has always had.
  const byAccession = new Map<string | null, QrRow>();
  for (const r of risFiltered) {
    byAccession.set(r.accessionNumber, { ...r, source: "RIS" });
  }
  for (const p of pacsRaw) {
    if (!byAccession.has(p.accessionNumber)) {
      byAccession.set(p.accessionNumber, { ...p, source: "PACS" });
    }
  }

  // Normalize studyDate to canonical YYYY-MM-DD for both sources.
  // RIS rows are already YYYY-MM-DD (date column).
  // PACS rows arrive as compact DICOM YYYYMMDD — convert so frontend
  // can display and sort consistently.
  const normalizeDate = (d: string | null): string | null => {
    if (!d) return null;
    // Already ISO-like (YYYY-MM-DD or longer)?
    if (d.includes("-")) return d.slice(0, 10);
    // Compact YYYYMMDD (exactly 8 digits)
    if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    return d;
  };

  for (const row of byAccession.values()) {
    row.studyDate = normalizeDate(row.studyDate);
  }

  // Sort merged set by studyDate desc, then by id desc
  const merged = Array.from(byAccession.values()).sort((a, b) => {
    const da = a.studyDate ?? "";
    const db2 = b.studyDate ?? "";
    if (da !== db2) return da > db2 ? -1 : 1;
    return (b.id ?? 0) - (a.id ?? 0);
  });

  // NOTE: Each source is pre-capped at 500 rows before merge/dedupe.
  // This keeps memory bounded and covers typical daily/weekly queries.
  // Very large date ranges may not return all studies; narrow the query
  // with date, modality, or patient filters if results appear incomplete.

  const total = merged.length;
  const studies = merged.slice(offset, offset + limit);

  res.json({ total, studies });
});

// ─── EXTENDED PACS DASHBOARD DATA ────────────────────────────────────────────
//
// GET /api/radiology/pacs-dashboard-ext
// Supplements the existing /pacs-dashboard with enterprise data:
// pulled-studies stats, failed-queue counts, routing-rules count,
// modality health summary, recent pulled studies.

router.get("/pacs-dashboard-ext", async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    pulledToday,
    failedQueue,
    routingRulesCount,
    modalityHealth,
    recentPulled,
    mwlCounts,
  ] = await Promise.all([
    db
      .select({ status: dicomPulledStudiesTable.status, count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .where(gte(dicomPulledStudiesTable.createdAt, todayStart))
      .groupBy(dicomPulledStudiesTable.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dicomFailedRetrievalQueueTable)
      .where(eq(dicomFailedRetrievalQueueTable.status, "PENDING")),
    db.select({ count: sql<number>`count(*)::int` }).from(dicomRoutingRulesTable).where(eq(dicomRoutingRulesTable.isEnabled, true)),
    db
      .select({
        id: dicomModalitiesTable.id,
        name: dicomModalitiesTable.machineName,
        aeTitle: dicomModalitiesTable.aeTitle,
        modalityType: dicomModalitiesTable.modality,
        lastConnectionStatus: dicomModalitiesTable.lastConnectionStatus,
        lastSeenAt: dicomModalitiesTable.lastSeenAt,
        ipAddress: dicomModalitiesTable.ipAddress,
        port: dicomModalitiesTable.port,
        isActive: dicomModalitiesTable.isActive,
      })
      .from(dicomModalitiesTable)
      .where(eq(dicomModalitiesTable.isActive, true))
      .orderBy(asc(dicomModalitiesTable.machineName)),
    db
      .select()
      .from(dicomPulledStudiesTable)
      .orderBy(desc(dicomPulledStudiesTable.createdAt))
      .limit(10),
    db
      .select({ status: radiologyScheduledProceduresTable.status, count: sql<number>`count(*)::int` })
      .from(radiologyScheduledProceduresTable)
      .groupBy(radiologyScheduledProceduresTable.status),
  ]);

  const pulledStats: Record<string, number> = {};
  for (const r of pulledToday) pulledStats[r.status] = r.count;

  const mwlStats: Record<string, number> = {};
  for (const r of mwlCounts) mwlStats[r.status] = r.count;

  const healthy = modalityHealth.filter((m) => m.lastConnectionStatus === "ok").length;

  res.json({
    pulledToday: pulledStats,
    pendingRetries: failedQueue[0]?.count ?? 0,
    activeRoutingRules: routingRulesCount[0]?.count ?? 0,
    modalityHealth,
    healthyModalities: healthy,
    totalActiveModalities: modalityHealth.length,
    recentPulled,
    mwlStats,
  });
});

// ─── DICOM QUERY / RETRIEVE ───────────────────────────────────────────────────

// GET /api/radiology/dicom-query
// Search radiology_studies joined with patients, enriched with pull status from
// dicom_pulled_studies (matched on accession number).
router.get("/dicom-query", async (req, res) => {
  const q          = req.query as Record<string, string | undefined>;
  const date       = q.date;
  const dateFrom   = q.dateFrom;
  const dateTo     = q.dateTo;
  const modalityQ  = q.modality;
  const patientQ   = q.patientName?.trim();
  const accessionQ = q.accessionNumber?.trim();
  const referringQ = q.referringDoctor?.trim();
  const descQ      = q.studyDescription?.trim();
  const aeTitleQ   = q.aeTitle?.trim()?.toLowerCase();
  const limit      = Math.min(Number(q.limit) || 50, 200);
  const offset     = Number(q.offset) || 0;

  const conds = [];

  // Date range
  if (date) {
    conds.push(eq(radiologyStudiesTable.studyDate, date));
  } else {
    if (dateFrom) conds.push(gte(radiologyStudiesTable.studyDate, dateFrom));
    if (dateTo)   conds.push(lte(radiologyStudiesTable.studyDate, dateTo));
  }

  // Modality (comma-separated for multi-select)
  if (modalityQ) {
    const mods = modalityQ.split(",").map((m) => m.trim()).filter(Boolean);
    if (mods.length === 1) {
      conds.push(eq(radiologyStudiesTable.modality, mods[0]));
    } else if (mods.length > 1) {
      conds.push(inArray(radiologyStudiesTable.modality, mods));
    }
  }

  // Patient name (ilike on first or last name)
  if (patientQ) {
    const pat = `%${patientQ}%`;
    conds.push(or(ilike(patientsTable.firstName, pat), ilike(patientsTable.lastName, pat))!);
  }

  if (accessionQ) conds.push(ilike(radiologyStudiesTable.accessionNumber, `%${accessionQ}%`));
  if (referringQ) conds.push(ilike(radiologyStudiesTable.referringDoctor,  `%${referringQ}%`));
  if (descQ)      conds.push(ilike(radiologyStudiesTable.studyDescription,  `%${descQ}%`));

  const rows = await db
    .select({
      id:                     radiologyStudiesTable.id,
      accessionNumber:        radiologyStudiesTable.accessionNumber,
      studyInstanceUID:       radiologyStudiesTable.studyInstanceUid,
      modality:               radiologyStudiesTable.modality,
      studyDate:              radiologyStudiesTable.studyDate,
      studyDescription:       radiologyStudiesTable.studyDescription,
      referringDoctor:        radiologyStudiesTable.referringDoctor,
      status:                 radiologyStudiesTable.status,
      scheduledStationAETitle: radiologyStudiesTable.scheduledStationAETitle,
      patientId:              radiologyStudiesTable.patientId,
      patientName:            sql<string>`COALESCE(${patientsTable.firstName} || ' ' || ${patientsTable.lastName}, '')`,
      pullStatus:             dicomPulledStudiesTable.status,
      pulledAt:               dicomPulledStudiesTable.pulledAt,
    })
    .from(radiologyStudiesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .leftJoin(
      dicomPulledStudiesTable,
      eq(dicomPulledStudiesTable.accessionNumber, radiologyStudiesTable.accessionNumber),
    )
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(radiologyStudiesTable.studyDate), desc(radiologyStudiesTable.createdAt))
    .limit(aeTitleQ ? 200 : limit)   // over-fetch when filtering by AE client-side
    .offset(aeTitleQ ? 0 : offset);

  // AE-title post-filter (column is on the ERP study, not on pulled_studies)
  const filtered = aeTitleQ
    ? rows.filter((r) => (r.scheduledStationAETitle ?? "").toLowerCase().includes(aeTitleQ))
    : rows;

  // Pagination total (without AE filter overhead)
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radiologyStudiesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .where(conds.length ? and(...conds) : undefined);

  const paged = aeTitleQ ? filtered.slice(offset, offset + limit) : filtered;

  res.json({
    studies: paged,
    total:   aeTitleQ ? filtered.length : (countRow?.count ?? 0),
    limit,
    offset,
  });
});

// ─── DICOM C-FIND (Live PACS Search) ─────────────────────────────────────────
//
// GET /api/radiology/qr-cfind
// Sends a real C-FIND request against the configured PACS. Two strategies:
//   1. Orthanc REST API  — POST /tools/find  (preferred; no DCMTK needed)
//   2. DCMTK findscu    — spawned as a child process against any DICOM SCP
//
// Returns results in the same JSON shape as /dicom-query so the frontend
// can render them with the same table component.
// Additional fields on the response envelope:
//   source     — "ORTHANC_REST" | "DCMTK_FINDSCU" | "NONE"
//   dcmtkHint  — non-null when neither Orthanc nor findscu is available

router.get("/qr-cfind", async (req, res) => {
  const q              = req.query as Record<string, string | undefined>;
  const dateExact      = q.date?.trim();
  const dateFrom       = q.dateFrom?.trim();
  const dateTo         = q.dateTo?.trim();
  const modalityQ      = q.modality?.trim();
  const patientQ       = q.patientName?.trim();
  const accessionQ     = q.accessionNumber?.trim();
  const descQ          = q.studyDescription?.trim();
  const referringQ     = q.referringDoctor?.trim();
  const limit          = Math.min(Number(q.limit) || 50, 200);
  const offset         = Number(q.offset) || 0;

  // DICOM date range in YYYYMMDD compact format
  const toCompact = (iso: string) => iso.replace(/-/g, "");
  let studyDateQuery = "";
  if (dateExact)               studyDateQuery = toCompact(dateExact);
  else if (dateFrom && dateTo) studyDateQuery = `${toCompact(dateFrom)}-${toCompact(dateTo)}`;
  else if (dateFrom)           studyDateQuery = `${toCompact(dateFrom)}-`;
  else if (dateTo)             studyDateQuery = `-${toCompact(dateTo)}`;

  const normalizeDate = (d: string | null): string => {
    if (!d) return "";
    if (d.includes("-")) return d.slice(0, 10);
    if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    return d;
  };

  const modalityList = modalityQ
    ? modalityQ.split(",").map((m) => m.trim()).filter(Boolean)
    : [];

  // Shared type for normalized study rows returned by either strategy
  type CfindRow = {
    id: number;
    accessionNumber: string;
    studyInstanceUID: string | null;
    modality: string;
    studyDate: string;
    studyDescription: string | null;
    referringDoctor: string | null;
    status: string;
    scheduledStationAETitle: string | null;
    patientId: number;
    patientName: string;
    pullStatus: string | null;
    pulledAt: string | null;
    source: string;
  };

  // ── Strategy 1: Orthanc REST API ──────────────────────────────────────────
  // If ORTHANC_URL is set but the request fails (e.g. Orthanc is down),
  // we log the error and fall through to Strategy 2 (findscu) rather than
  // returning 502 — this makes the feature resilient for mixed deployments.

  const orthancBase = (process.env.ORTHANC_URL || "").replace(/\/$/, "");
  const orthancUser = process.env.ORTHANC_USERNAME || "";
  const orthancPass = process.env.ORTHANC_PASSWORD || "";

  if (orthancBase) {
    try {
      const authHeaders: Record<string, string> =
        orthancUser && orthancPass
          ? { Authorization: "Basic " + Buffer.from(`${orthancUser}:${orthancPass}`).toString("base64") }
          : {};

      // Build Orthanc /tools/find query (DICOM-tag-keyed)
      const findQuery: Record<string, string> = { QueryRetrieveLevel: "STUDY" };
      if (studyDateQuery) findQuery["StudyDate"]               = studyDateQuery;
      if (patientQ)       findQuery["PatientName"]             = `*${patientQ}*`;
      if (accessionQ)     findQuery["AccessionNumber"]         = `*${accessionQ}*`;
      if (descQ)          findQuery["StudyDescription"]        = `*${descQ}*`;
      if (referringQ)     findQuery["ReferringPhysicianName"]  = `*${referringQ}*`;
      // Single-modality C-FIND tag; multi-modality post-filtered in JS below
      if (modalityList.length === 1) findQuery["ModalitiesInStudy"] = modalityList[0]!;

      const findResp = await fetch(`${orthancBase}/tools/find`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body:    JSON.stringify({
          Level:  "Study",
          Query:  findQuery,
          Expand: true,
          Limit:  limit + offset + 50,   // over-fetch so JS post-filter still paginates cleanly
        }),
      });
      if (!findResp.ok) throw new Error(`Orthanc /tools/find returned ${findResp.status}`);

      const rawStudies = (await findResp.json()) as Record<string, unknown>[];

      let idx = 1;
      const rows: CfindRow[] = rawStudies
        .map((s) => {
          const mt  = (s["MainDicomTags"]        as Record<string, string>) ?? {};
          const pt  = (s["PatientMainDicomTags"] as Record<string, string>) ?? {};
          const mod = mt["ModalitiesInStudy"] || mt["Modality"] || "";
          return {
            id:                      idx++,
            accessionNumber:         mt["AccessionNumber"]        ?? "",
            studyInstanceUID:        mt["StudyInstanceUID"]       ?? null,
            modality:                mod,
            studyDate:               normalizeDate(mt["StudyDate"] ?? null),
            studyDescription:        mt["StudyDescription"]       ?? null,
            referringDoctor:         mt["ReferringPhysicianName"] ?? null,
            status:                  "COMPLETED",
            scheduledStationAETitle: null,
            patientId:               0,
            patientName:             pt["PatientName"] ?? mt["PatientName"] ?? "",
            pullStatus:              "PUSHED_TO_PACS",
            pulledAt:                null as null,
            source:                  "LIVE_PACS",
          };
        })
        // Multi-modality post-filter (when >1 modality selected, /tools/find only supports 1)
        .filter((r) =>
          modalityList.length === 0 ||
          modalityList.some((m) => r.modality.toUpperCase().includes(m.toUpperCase())),
        );

      void logPacsEvent(
        "CFIND", "CFIND_QUERY",
        `Live C-FIND via Orthanc REST: ${rows.length} results`,
        {},
      );

      res.json({
        studies:   rows.slice(offset, offset + limit),
        total:     rows.length,
        limit,
        offset,
        source:    "ORTHANC_REST",
        dcmtkHint: null,
      });
      return;
    } catch (err) {
      // Orthanc is configured but unavailable — fall through to findscu
      req.log?.warn(
        { err },
        "qr-cfind: Orthanc REST failed, attempting findscu fallback",
      );
    }
  }

  // ── Strategy 2: DCMTK findscu ─────────────────────────────────────────────

  let hasDcmtk = false;
  try {
    await execAsync("which findscu", { timeout: 3000 });
    hasDcmtk = true;
  } catch {
    hasDcmtk = false;
  }

  // Read PACS connection from DB settings or env
  const [pacsHost, pacsPortStr, pacsAeTitle] = await Promise.all([
    getSetting("pacs_host", "conquest").then((v) => v ?? process.env.CONQUEST_HOST ?? ""),
    getSetting("pacs_port", "conquest").then((v) => v ?? process.env.CONQUEST_PORT ?? "5678"),
    getSetting("pacs_ae_title", "conquest").then((v) => v ?? process.env.PACS_AE_TITLE ?? "CONQUESTPACS"),
  ]);
  const pacsPort = Number(pacsPortStr) || 5678;

  // Determine hint prefix based on whether Orthanc was configured but failed
  const orthancFailedPrefix = orthancBase
    ? "Orthanc REST API is configured but unreachable. "
    : "";

  if (!hasDcmtk) {
    res.json({
      studies:   [],
      total:     0,
      limit,
      offset,
      source:    "NONE",
      dcmtkHint:
        orthancFailedPrefix +
        "findscu (DCMTK) is not installed on this server. " +
        "Install DCMTK on the server (e.g. apt install dcmtk) and configure the PACS host/AE title " +
        "in PACS Settings, or ensure Orthanc is reachable at the configured ORTHANC_URL.",
    });
    return;
  }

  if (!pacsHost) {
    res.json({
      studies:   [],
      total:     0,
      limit,
      offset,
      source:    "NONE",
      dcmtkHint:
        orthancFailedPrefix +
        "PACS host is not configured. Set the CONQUEST_HOST environment variable or enter " +
        "the PACS host in PACS Settings → Conquest to enable Live PACS C-FIND.",
    });
    return;
  }

  // Build findscu arguments (study-level)
  const safeArg = (s: string) => s.replace(/[";|&$`\\]/g, "");
  const args: string[] = [
    "-v",
    "-aet", "DIAGNOCENTER",
    "-aec", pacsAeTitle,
    "-S",
    "-k", "QueryRetrieveLevel=STUDY",
    "-k", `StudyDate=${safeArg(studyDateQuery)}`,
    "-k", "StudyInstanceUID",
    "-k", "AccessionNumber",
    "-k", "ModalitiesInStudy",
    "-k", "StudyDescription",
    "-k", "PatientName",
    "-k", "PatientID",
    "-k", "ReferringPhysicianName",
    "-k", "StudyDate",
  ];
  if (patientQ)    args.push("-k", `PatientName=*${safeArg(patientQ)}*`);
  if (accessionQ)  args.push("-k", `AccessionNumber=*${safeArg(accessionQ)}*`);
  if (descQ)       args.push("-k", `StudyDescription=*${safeArg(descQ)}*`);
  if (referringQ)  args.push("-k", `ReferringPhysicianName=*${safeArg(referringQ)}*`);
  if (modalityList.length === 1) args.push("-k", `ModalitiesInStudy=${safeArg(modalityList[0]!)}`);

  args.push(pacsHost, String(pacsPort));

  try {
    const quoted = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    const { stdout, stderr } = await execAsync(`findscu ${quoted}`, { timeout: 15000 });
    const output = stdout + stderr;

    // Parse DCMTK verbose output.
    // Each result starts with a line "(0008,0052) CS [STUDY...]".
    // Tag values appear as: (GGGG,EEEE) VR [value] # len, 1 TagName
    const extractTag = (block: string, tag: string): string => {
      const re = new RegExp(`\\(${tag}\\)\\s+\\S+\\s+\\[([^\\]]*)\\]`);
      return (block.match(re)?.[1] ?? "").trim();
    };

    const blocks = output.split(/(?=\(0008,0052\)\s+CS\s+\[STUDY)/g)
      .filter((b) => b.includes("[STUDY"));

    let idx2 = 1;
    const rows = blocks.map((block) => ({
      id:                      idx2++,
      accessionNumber:         extractTag(block, "0008,0050"),
      studyInstanceUID:        extractTag(block, "0020,000d") || null,
      modality:                extractTag(block, "0008,0061") || extractTag(block, "0008,0060"),
      studyDate:               normalizeDate(extractTag(block, "0008,0020") || null),
      studyDescription:        extractTag(block, "0008,1030") || null,
      referringDoctor:         extractTag(block, "0008,0090") || null,
      status:                  "COMPLETED",
      scheduledStationAETitle: null as null,
      patientId:               0,
      patientName:             extractTag(block, "0010,0010"),
      pullStatus:              null as null,
      pulledAt:                null as null,
      source:                  "LIVE_PACS",
    }));

    void logPacsEvent("CFIND", "CFIND_QUERY", `Live C-FIND via findscu: ${rows.length} results`, {});

    res.json({
      studies:   rows.slice(offset, offset + limit),
      total:     rows.length,
      limit,
      offset,
      source:    "DCMTK_FINDSCU",
      dcmtkHint: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "findscu failed";
    res.status(502).json({ error: msg, source: "DCMTK_FINDSCU" });
  }
});

// POST /api/radiology/dicom-retrieve
// Queue a single study for retrieval by the pull agent.
router.post("/dicom-retrieve", async (req, res) => {
  const body = req.body as {
    studyInstanceUID?: string;
    accessionNumber?: string;
    modality?: string;
    patientName?: string;
    patientId?: string;
    studyDate?: string;
    sourceAeTitle?: string;
  };

  if (!body.studyInstanceUID && !body.accessionNumber) {
    res.status(400).json({ error: "studyInstanceUID or accessionNumber required" });
    return;
  }

  const uid = body.studyInstanceUID
    ?? `REQ-${Date.now()}-${(body.accessionNumber ?? "").replace(/[^A-Za-z0-9]/g, "")}`;

  const [row] = await db
    .insert(dicomPulledStudiesTable)
    .values({
      studyInstanceUID: uid,
      accessionNumber:  body.accessionNumber ?? null,
      modality:         body.modality ?? null,
      patientName:      body.patientName ?? null,
      patientId:        body.patientId ?? null,
      studyDate:        body.studyDate ?? null,
      sourceAeTitle:    body.sourceAeTitle ?? null,
      status:           "RETRIEVE_REQUESTED",
    })
    .onConflictDoUpdate({
      target: dicomPulledStudiesTable.studyInstanceUID,
      set: { status: "RETRIEVE_REQUESTED", lastError: null, updatedAt: new Date() },
    })
    .returning();

  res.json({ success: true, study: row });
});

// POST /api/radiology/dicom-retrieve/bulk
// Queue up to 50 studies for retrieval by the pull agent.
router.post("/dicom-retrieve/bulk", async (req, res) => {
  const body = req.body as {
    studies?: Array<{
      studyInstanceUID?: string;
      accessionNumber?: string;
      modality?: string;
      patientName?: string;
      patientId?: string;
      studyDate?: string;
      sourceAeTitle?: string;
    }>;
  };

  if (!Array.isArray(body.studies) || body.studies.length === 0) {
    res.status(400).json({ error: "studies array required" });
    return;
  }

  let count = 0;
  for (const s of body.studies.slice(0, 50)) {
    const uid = s.studyInstanceUID
      ?? `REQ-${Date.now()}-${count}-${(s.accessionNumber ?? Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9]/g, "")}`;
    await db
      .insert(dicomPulledStudiesTable)
      .values({
        studyInstanceUID: uid,
        accessionNumber:  s.accessionNumber ?? null,
        modality:         s.modality ?? null,
        patientName:      s.patientName ?? null,
        patientId:        s.patientId ?? null,
        studyDate:        s.studyDate ?? null,
        sourceAeTitle:    s.sourceAeTitle ?? null,
        status:           "RETRIEVE_REQUESTED",
      })
      .onConflictDoUpdate({
        target: dicomPulledStudiesTable.studyInstanceUID,
        set: { status: "RETRIEVE_REQUESTED", lastError: null, updatedAt: new Date() },
      });
    count++;
  }

  res.json({ success: true, count });
});

// ─── Enterprise Monitoring & Analytics APIs ───────────────────────────────────────────

import {
  radiologistPerformanceStatsTable,
  criticalFindingsAlertsTable,
  aiServerHealthLogTable,
  pacsArchiveLifecycleTable,
  watchdogStatusTable,
  risSyncStatusTable,
} from "@workspace/db/schema";

// GET /api/radiology/performance-stats
// Aggregated radiologist productivity analytics
router.get("/performance-stats", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const stats = await db
    .select()
    .from(radiologistPerformanceStatsTable)
    .where(and(
      eq(radiologistPerformanceStatsTable.periodType, "daily"),
      eq(radiologistPerformanceStatsTable.periodDate, today),
    ))
    .orderBy(desc(radiologistPerformanceStatsTable.totalStudies));

  const totals = {
    totalStudies: stats.reduce((s, r) => s + (r.totalStudies || 0), 0),
    reportedStudies: stats.reduce((s, r) => s + (r.reportedStudies || 0), 0),
    statStudies: stats.reduce((s, r) => s + (r.statStudies || 0), 0),
    avgTat: stats.length > 0
      ? Math.round(stats.reduce((s, r) => s + (r.avgTatMinutes || 0), 0) / stats.length)
      : 0,
  };

  res.json({ today, stats, totals });
});

// GET /api/radiology/critical-findings
// Active critical findings alerts with optional status filter
router.get("/critical-findings", async (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit || 50), 100);

  const conditions = [eq(criticalFindingsAlertsTable.status, status || "active")];
  if (!status) {
    conditions.length = 0;
    conditions.push(
      or(
        eq(criticalFindingsAlertsTable.status, "active"),
        eq(criticalFindingsAlertsTable.status, "acknowledged"),
      ) as any,
    );
  }

  const alerts = await db
    .select()
    .from(criticalFindingsAlertsTable)
    .where(and(...conditions))
    .orderBy(desc(criticalFindingsAlertsTable.createdAt))
    .limit(limit);

  res.json({ alerts, count: alerts.length });
});

// POST /api/radiology/critical-findings/:id/acknowledge
router.post("/critical-findings/:id/acknowledge", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name: ackBy } = (req as any).user || {};
  const [updated] = await db
    .update(criticalFindingsAlertsTable)
    .set({
      acknowledged: true,
      acknowledgedBy: ackBy || "staff",
      acknowledgedAt: new Date(),
      status: "acknowledged",
    })
    .where(eq(criticalFindingsAlertsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
  res.json({ success: true, alert: updated });
});

// POST /api/radiology/critical-findings/:id/resolve
router.post("/critical-findings/:id/resolve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db
    .update(criticalFindingsAlertsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(criticalFindingsAlertsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
  res.json({ success: true, alert: updated });
});

// POST /api/radiology/critical-findings
// Create a critical finding alert (from AI or radiologist)
router.post("/critical-findings", async (req, res) => {
  const body = req.body as {
    worklistId?: number;
    studyId?: number;
    accessionNumber: string;
    patientId?: number;
    patientName: string;
    modality?: string;
    studyDescription?: string;
    severity?: string;
    findingType: string;
    description: string;
    flaggedBy?: string;
    flaggedById?: number;
    aiConfidence?: number;
    notificationChannels?: string[];
  };

  if (!body.accessionNumber || !body.findingType || !body.description || !body.patientName) {
    res.status(400).json({ error: "accessionNumber, findingType, description, patientName required" });
    return;
  }

  const [alert] = await db
    .insert(criticalFindingsAlertsTable)
    .values({
      worklistId: body.worklistId ?? null,
      studyId: body.studyId ?? null,
      accessionNumber: body.accessionNumber,
      patientId: body.patientId ?? null,
      patientName: body.patientName,
      modality: body.modality ?? "OT",
      studyDescription: body.studyDescription ?? null,
      severity: body.severity ?? "high",
      findingType: body.findingType,
      description: body.description,
      flaggedBy: body.flaggedBy ?? "system",
      flaggedById: body.flaggedById ?? null,
      aiConfidence: body.aiConfidence != null ? String(body.aiConfidence) : null,
      notificationChannels: JSON.stringify(body.notificationChannels ?? ["push"]),
    })
    .returning();

  res.status(201).json({ success: true, alert });
});

// GET /api/radiology/ai-health
// AI provider health status + recent latency/success metrics
router.get("/ai-health", async (_req, res) => {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await db
    .select()
    .from(aiServerHealthLogTable)
    .where(gte(aiServerHealthLogTable.createdAt, last24h))
    .orderBy(desc(aiServerHealthLogTable.createdAt))
    .limit(200);

  const byProvider: Record<string, { total: number; success: number; avgLatency: number; lastStatus: string }> = {};
  for (const log of logs) {
    const p = log.provider;
    if (!byProvider[p]) byProvider[p] = { total: 0, success: 0, avgLatency: 0, lastStatus: log.status };
    byProvider[p].total++;
    if (log.success) byProvider[p].success++;
    if (log.latencyMs) byProvider[p].avgLatency += log.latencyMs;
    byProvider[p].lastStatus = log.status;
  }
  for (const p of Object.keys(byProvider)) {
    if (byProvider[p].total > 0) {
      byProvider[p].avgLatency = Math.round(byProvider[p].avgLatency / byProvider[p].total);
    }
  }

  res.json({ providers: byProvider, recentLogs: logs.slice(0, 20) });
});

// GET /api/radiology/archive-lifecycle
// Study archive/compression status overview
router.get("/archive-lifecycle", async (req, res) => {
  const tier = req.query.tier as string | undefined;
  const limit = Math.min(Number(req.query.limit || 50), 100);

  const conditions = tier ? [eq(pacsArchiveLifecycleTable.tier, tier)] : [];
  const rows = conditions.length > 0
    ? await db.select().from(pacsArchiveLifecycleTable).where(and(...conditions)).orderBy(desc(pacsArchiveLifecycleTable.createdAt)).limit(limit)
    : await db.select().from(pacsArchiveLifecycleTable).orderBy(desc(pacsArchiveLifecycleTable.createdAt)).limit(limit);

  const tierCounts = await db
    .select({ tier: pacsArchiveLifecycleTable.tier, count: sql<number>`COUNT(*)` })
    .from(pacsArchiveLifecycleTable)
    .groupBy(pacsArchiveLifecycleTable.tier);

  res.json({ studies: rows, tierCounts });
});

// GET /api/radiology/watchdog
// Background service health + auto-restart status
router.get("/watchdog", async (_req, res) => {
  const services = await db
    .select()
    .from(watchdogStatusTable)
    .orderBy(watchdogStatusTable.displayName);

  const down = services.filter((s) => s.status === "down" || s.consecutiveFailures > 3);
  res.json({ services, downCount: down.length, healthyCount: services.length - down.length });
});

// POST /api/radiology/watchdog/:service/heartbeat
// External services can POST heartbeats here
router.post("/watchdog/:service/heartbeat", async (req, res) => {
  const serviceName = req.params.service;
  const { metadata } = req.body as { metadata?: Record<string, unknown> };

  const [existing] = await db
    .select()
    .from(watchdogStatusTable)
    .where(eq(watchdogStatusTable.serviceName, serviceName))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(watchdogStatusTable)
      .set({
        status: "healthy",
        lastHeartbeat: new Date(),
        consecutiveFailures: 0,
        metadata: JSON.stringify(metadata ?? {}),
        updatedAt: new Date(),
      })
      .where(eq(watchdogStatusTable.id, existing.id))
      .returning();
    res.json({ success: true, service: updated });
  } else {
    const [created] = await db
      .insert(watchdogStatusTable)
      .values({
        serviceName,
        displayName: serviceName,
        status: "healthy",
        lastHeartbeat: new Date(),
        metadata: JSON.stringify(metadata ?? {}),
      })
      .returning();
    res.json({ success: true, service: created });
  }
});

// GET /api/radiology/ris-sync-status
// Real-time RIS sync health across all channels
router.get("/ris-sync-status", async (_req, res) => {
  const syncs = await db
    .select()
    .from(risSyncStatusTable)
    .orderBy(risSyncStatusTable.syncType);

  const pendingTotal = syncs.reduce((s, r) => s + (r.itemsPending || 0), 0);
  const failedTotal = syncs.reduce((s, r) => s + (r.itemsFailed || 0), 0);
  const healthy = syncs.filter((s) => s.status === "synced" || s.status === "idle").length;

  res.json({ syncs, pendingTotal, failedTotal, healthyChannels: healthy, totalChannels: syncs.length });
});

// GET /api/radiology/queue-monitor
// Real-time queue depth and bottleneck analysis
router.get("/queue-monitor", async (_req, res) => {
  const [worklistPending, worklistAiDraft, studiesScheduled, studiesInProgress, criticalActive] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.status, "STUDY_RECEIVED")),
    db.select({ count: sql<number>`COUNT(*)` }).from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.status, "AI_DRAFT_READY")),
    db.select({ count: sql<number>`COUNT(*)` }).from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.status, "scheduled")),
    db.select({ count: sql<number>`COUNT(*)` }).from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.status, "in_progress")),
    db.select({ count: sql<number>`COUNT(*)` }).from(criticalFindingsAlertsTable)
      .where(eq(criticalFindingsAlertsTable.status, "active")),
  ]);

  // Studies by priority (STAT, emergency, routine) from radiology_studies
  const byPriority = await db
    .select({
      priority: sql<string>`COALESCE(NULLIF(${radiologyStudiesTable.priority},''),'routine')`,
      count: sql<number>`COUNT(*)`,
    })
    .from(radiologyStudiesTable)
    .where(or(
      eq(radiologyStudiesTable.status, "scheduled"),
      eq(radiologyStudiesTable.status, "in_progress"),
    ))
    .groupBy(sql`COALESCE(NULLIF(${radiologyStudiesTable.priority},''),'routine')`);

  // By modality
  const byModality = await db
    .select({
      modality: radiologyStudiesTable.modality,
      count: sql<number>`COUNT(*)`,
    })
    .from(radiologyStudiesTable)
    .where(or(
      eq(radiologyStudiesTable.status, "scheduled"),
      eq(radiologyStudiesTable.status, "in_progress"),
    ))
    .groupBy(radiologyStudiesTable.modality);

  res.json({
    worklistPending: worklistPending[0]?.count ?? 0,
    worklistAiDraft: worklistAiDraft[0]?.count ?? 0,
    studiesScheduled: studiesScheduled[0]?.count ?? 0,
    studiesInProgress: studiesInProgress[0]?.count ?? 0,
    criticalActive: criticalActive[0]?.count ?? 0,
    byPriority,
    byModality,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/radiology/archive-lifecycle/:id/compress
// Queues a compression job for a specific study
router.post("/archive-lifecycle/:id/compress", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(pacsArchiveLifecycleTable)
    .where(eq(pacsArchiveLifecycleTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Study not found" }); return; }

  await db
    .update(pacsArchiveLifecycleTable)
    .set({
      notes: `Compression queued at ${new Date().toISOString()}`,
      updatedAt: new Date(),
    })
    .where(eq(pacsArchiveLifecycleTable.id, id));

  await logPacsEvent("archive", "compression_queued", `Study ${existing.studyInstanceUID} queued for compression`, {
    studyInstanceUID: existing.studyInstanceUID,
    accessionNumber: existing.accessionNumber,
    severity: "info",
  });

  res.json({ success: true, message: "Compression queued" });
});

// POST /api/radiology/archive-lifecycle/:id/move-tier
// Manually move a study to a different storage tier
router.post("/archive-lifecycle/:id/move-tier", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { tier } = req.body as { tier?: string };
  if (!tier || !["hot", "warm", "cold", "archived"].includes(tier)) {
    res.status(400).json({ error: "tier must be hot | warm | cold | archived" });
    return;
  }

  const [existing] = await db
    .select()
    .from(pacsArchiveLifecycleTable)
    .where(eq(pacsArchiveLifecycleTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Study not found" }); return; }

  const now = new Date();
  const updates: any = {
    tier,
    movedToTierAt: now,
    updatedAt: now,
    notes: `Manually moved to ${tier} at ${now.toISOString()}`,
  };
  if (tier === "hot") {
    updates.restoredAt = now;
    updates.restoreCount = (existing.restoreCount || 0) + 1;
  }

  await db.update(pacsArchiveLifecycleTable).set(updates).where(eq(pacsArchiveLifecycleTable.id, id));

  await logPacsEvent("archive", "tier_change", `Study moved from ${existing.tier} to ${tier}`, {
    studyInstanceUID: existing.studyInstanceUID,
    accessionNumber: existing.accessionNumber,
    severity: tier === "archived" ? "info" : "info",
  });

  res.json({ success: true, newTier: tier });
});

// PATCH /api/radiology/watchdog/:id/toggle-restart
router.patch("/watchdog/:id/toggle-restart", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { autoRestartEnabled } = req.body as { autoRestartEnabled?: boolean };
  if (typeof autoRestartEnabled !== "boolean") {
    res.status(400).json({ error: "autoRestartEnabled boolean required" });
    return;
  }

  const [updated] = await db
    .update(watchdogStatusTable)
    .set({ autoRestartEnabled, updatedAt: new Date() })
    .where(eq(watchdogStatusTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
  res.json({ success: true, service: updated });
});

// POST /api/radiology/watchdog/:id/restart
// Triggers a manual restart signal (logged, actual restart is external)
router.post("/watchdog/:id/restart", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(watchdogStatusTable)
    .where(eq(watchdogStatusTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Service not found" }); return; }

  await db
    .update(watchdogStatusTable)
    .set({
      status: "restarting",
      restartCount: (existing.restartCount || 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(watchdogStatusTable.id, id));

  await logPacsEvent("watchdog", "restart_triggered", `Manual restart triggered for ${existing.displayName}`, {
    severity: "warning",
  });

  res.json({ success: true, message: "Restart signal sent. External watchdog monitor should pick this up." });
});

// GET /api/radiology/ai-inference-config
// Reads GPU inference configuration from pacs_settings (category="ai_inference")
router.get("/ai-inference-config", async (_req, res) => {
  const rows = await db
    .select()
    .from(pacsSettingsTable)
    .where(eq(pacsSettingsTable.category, "ai_inference"));

  const defaults: Record<string, string> = {
    gpuEndpointUrl: "",
    modelName: "",
    batchSize: "1",
    timeoutSeconds: "30",
    concurrency: "4",
    enabled: "true",
    fallbackToCloud: "true",
    useLocalGpu: "true",
    cloudProvider: "gemini",
    warmUpOnStartup: "true",
    cacheResults: "true",
    maxRetries: "2",
    requestPriority: "normal",
  };

  const map: Record<string, string> = { ...defaults };
  for (const r of rows) if (r.value != null) map[r.key] = r.value;

  res.json({
    gpuEndpointUrl: map.gpuEndpointUrl,
    modelName: map.modelName,
    batchSize: Number(map.batchSize) || 1,
    timeoutSeconds: Number(map.timeoutSeconds) || 30,
    concurrency: Number(map.concurrency) || 4,
    enabled: map.enabled === "true",
    fallbackToCloud: map.fallbackToCloud === "true",
    useLocalGpu: map.useLocalGpu === "true",
    cloudProvider: map.cloudProvider,
    warmUpOnStartup: map.warmUpOnStartup === "true",
    cacheResults: map.cacheResults === "true",
    maxRetries: Number(map.maxRetries) || 2,
    requestPriority: map.requestPriority,
  });
});

// POST /api/radiology/ai-inference-config
// Saves GPU inference configuration to pacs_settings
router.post("/ai-inference-config", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const keys = [
    "gpuEndpointUrl", "modelName", "batchSize", "timeoutSeconds", "concurrency",
    "enabled", "fallbackToCloud", "useLocalGpu", "cloudProvider",
    "warmUpOnStartup", "cacheResults", "maxRetries", "requestPriority",
  ];

  for (const key of keys) {
    const value = body[key];
    if (value === undefined) continue;
    const strValue = typeof value === "boolean" ? String(value) : String(value ?? "");

    const [existing] = await db
      .select()
      .from(pacsSettingsTable)
      .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, "ai_inference")))
      .limit(1);

    if (existing) {
      await db
        .update(pacsSettingsTable)
        .set({ value: strValue, updatedAt: new Date() })
        .where(eq(pacsSettingsTable.id, existing.id));
    } else {
      await db.insert(pacsSettingsTable).values({
        key,
        value: strValue,
        category: "ai_inference",
      });
    }
  }

  res.json({ success: true });
});

// POST /api/radiology/ai-inference-test
// Quick connectivity test to the configured GPU endpoint
router.post("/ai-inference-test", async (req, res) => {
  const { endpoint, model } = req.body as { endpoint?: string; model?: string };
  if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latency = Date.now() - start;
    res.json({ ok: response.ok, status: response.status, latency });
  } catch (err: any) {
    const latency = Date.now() - start;
    res.status(200).json({ ok: false, error: err.name === "AbortError" ? "Timeout" : err.message, latency });
  }
});

// ─── DICOM Node C-ECHO test (in-process DIMSE) ───────────────────────────────
//
// POST /api/radiology/nodes/:id/echo-test
// Tests connectivity to a dicom_nodes row using the in-process dcmjs-dimse
// agent — no external DCMTK tools needed.  Returns real C-ECHO latency.

router.post("/nodes/:id/echo-test", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [node] = await db
    .select()
    .from(dicomNodesTable)
    .where(eq(dicomNodesTable.id, id));

  if (!node) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }

  if (!node.isActive) {
    res.status(400).json({ error: "Node is inactive" });
    return;
  }

  if (!node.host || !node.port) {
    res.status(400).json({ error: "Node has no host/port configured" });
    return;
  }

  try {
    const result = await testNodeConnection({
      host: node.host,
      port: node.port,
      aeTitle: node.aeTitle,
      modality: node.modality,
    });

    // Persist telemetry back into the node row
    await db
      .update(dicomNodesTable)
      .set({
        lastTestAt: new Date(),
        lastTestStatus: result.ok ? "success" : "failed",
        lastTestMessage: result.error ?? "C-ECHO OK",
        lastTestLatencyMs: result.latencyMs,
      })
      .where(eq(dicomNodesTable.id, id));

    res.json({
      ok: result.ok,
      latencyMs: result.latencyMs,
      source: "DIMSE_NATIVE",
      node: {
        id: node.id,
        aeTitle: node.aeTitle,
        host: node.host,
        port: node.port,
        modality: node.modality,
      },
      error: result.error ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      ok: false,
      latencyMs: null,
      source: "DIMSE_NATIVE",
      error: msg,
      hint: "Make sure dcmjs-dimse is installed and the agent module loaded successfully.",
    });
  }
});

// ─── NETWORK CONTROL CENTER ENDPOINTS ─────────────────────────────────────────

router.get("/network/settings", async (req, res) => {
  try {
    const config = await getRadiologyConfig();
    res.json({
      ok: true,
      config,
      env: {
        ORTHANC_URL: !!process.env.ORTHANC_URL,
        OHIF_URL: !!process.env.OHIF_URL,
        WADO_URL: !!process.env.WADO_URL,
        INTERNAL_API_KEY: !!process.env.INTERNAL_API_KEY,
        PUBLIC_BASE_URL: !!process.env.PUBLIC_BASE_URL,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.patch("/network/settings", async (req: any, res) => {
  try {
    const { reason, ...settings } = req.body as { reason?: string; [key: string]: string | undefined };
    const changedBy = req.staffSession?.subjectId ?? null;
    const changedByName = req.staffSession?.subjectName ?? "SYSTEM";
    const changeReason = reason || "Updated via settings dashboard";

    for (const [key, val] of Object.entries(settings)) {
      if (val === undefined) continue;

      // Determine category based on prefix
      let category = "general";
      if (key.startsWith("orthanc_")) category = "orthanc";
      else if (key.startsWith("conquest_")) category = "conquest";
      else if (key.startsWith("erp_")) category = "erp";
      else if (key.startsWith("ohif_") || key.startsWith("weasis_") || key === "pacs_ip" || key === "pacs_port" || key === "pacs_ae_title" || key === "default_viewer" || key === "viewer_mode") {
        category = "viewer";
      }

      // Check if row exists
      const [existing] = await db
        .select()
        .from(pacsSettingsTable)
        .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, category)))
        .limit(1);

      const oldValue = existing ? existing.value : null;

      if (oldValue !== val) {
        if (existing) {
          await db
            .update(pacsSettingsTable)
            .set({ value: val, updatedAt: new Date() })
            .where(eq(pacsSettingsTable.id, existing.id));
        } else {
          await db.insert(pacsSettingsTable).values({
            key,
            value: val,
            category,
            isSecret: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        // Log the change
        await db.insert(radiologyConfigChangesTable).values({
          key,
          category,
          oldValue,
          newValue: val,
          reason: changeReason,
          changedBy,
          changedByName,
          changedAt: new Date(),
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /network/config/export — export settings JSON dump
router.get("/network/config/export", async (req, res) => {
  try {
    const settings = await db.select().from(pacsSettingsTable);
    const modalities = await db.select().from(dicomModalitiesTable);
    const nodes = await db.select().from(dicomNodesTable);

    res.json({
      settings: settings.map(s => ({ key: s.key, value: s.value, category: s.category })),
      modalities: modalities.map(m => ({
        machineName: m.machineName,
        modality: m.modality,
        aeTitle: m.aeTitle,
        ipAddress: m.ipAddress,
        port: m.port,
        destinationPacs: m.destinationPacs,
      })),
      nodes: nodes.map(n => ({
        aeTitle: n.aeTitle,
        host: n.host,
        port: n.port,
        modality: n.modality,
        name: n.name,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /network/config/import — import settings JSON dump
router.post("/network/config/import", async (req: any, res) => {
  try {
    const { settings, modalities, nodes, reason } = req.body as {
      settings?: Array<{ key: string; value: string; category: string }>;
      modalities?: Array<any>;
      nodes?: Array<any>;
      reason?: string;
    };
    const changedBy = req.staffSession?.subjectId ?? null;
    const changedByName = req.staffSession?.subjectName ?? "SYSTEM";
    const changeReason = reason || "Imported via settings file";

    // 1. Restore Settings
    if (settings && Array.isArray(settings)) {
      for (const s of settings) {
        const [existing] = await db
          .select()
          .from(pacsSettingsTable)
          .where(and(eq(pacsSettingsTable.key, s.key), eq(pacsSettingsTable.category, s.category)))
          .limit(1);

        const oldValue = existing ? existing.value : null;
        if (oldValue !== s.value) {
          if (existing) {
            await db
              .update(pacsSettingsTable)
              .set({ value: s.value, updatedAt: new Date() })
              .where(eq(pacsSettingsTable.id, existing.id));
          } else {
            await db.insert(pacsSettingsTable).values({
              key: s.key,
              value: s.value,
              category: s.category,
              isSecret: false,
            });
          }

          await db.insert(radiologyConfigChangesTable).values({
            key: s.key,
            category: s.category,
            oldValue,
            newValue: s.value,
            reason: changeReason,
            changedBy,
            changedByName,
          });
        }
      }
    }

    // 2. Restore Modalities
    if (modalities && Array.isArray(modalities)) {
      for (const m of modalities) {
        const [existing] = await db
          .select()
          .from(dicomModalitiesTable)
          .where(eq(dicomModalitiesTable.machineName, m.machineName))
          .limit(1);

        if (existing) {
          await db
            .update(dicomModalitiesTable)
            .set({
              modality: m.modality,
              aeTitle: m.aeTitle,
              ipAddress: m.ipAddress,
              port: m.port,
              destinationPacs: m.destinationPacs,
              updatedAt: new Date(),
            })
            .where(eq(dicomModalitiesTable.id, existing.id));
        } else {
          await db.insert(dicomModalitiesTable).values({
            machineName: m.machineName,
            modality: m.modality,
            aeTitle: m.aeTitle,
            ipAddress: m.ipAddress,
            port: m.port,
            destinationPacs: m.destinationPacs,
          });
        }
      }
    }

    // 3. Restore Nodes
    if (nodes && Array.isArray(nodes)) {
      for (const n of nodes) {
        const [existing] = await db
          .select()
          .from(dicomNodesTable)
          .where(eq(dicomNodesTable.aeTitle, n.aeTitle))
          .limit(1);

        if (existing) {
          await db
            .update(dicomNodesTable)
            .set({
              host: n.host,
              port: n.port,
              modality: n.modality,
              name: n.name,
              updatedAt: new Date(),
            })
            .where(eq(dicomNodesTable.id, existing.id));
        } else {
          await db.insert(dicomNodesTable).values({
            aeTitle: n.aeTitle,
            host: n.host,
            port: n.port,
            modality: n.modality,
            name: n.name,
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /network/config/changes — get configuration history audit log
router.get("/network/config/changes", async (req, res) => {
  try {
    const changes = await db
      .select()
      .from(radiologyConfigChangesTable)
      .orderBy(desc(radiologyConfigChangesTable.changedAt))
      .limit(100);

    res.json({ ok: true, changes });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /network/config/validate — live configuration tester (PASS/WARNING/FAIL)
router.post("/network/config/validate", async (req, res) => {
  try {
    const cfg = await getRadiologyConfig();
    const results: Array<{ name: string; status: "PASS" | "WARNING" | "FAIL"; message: string }> = [];

    const testHttp = async (name: string, url: string) => {
      if (!url) {
        results.push({ name, status: "FAIL", message: "URL not configured" });
        return;
      }
      try {
        const resp = await fetch(url, { method: "HEAD" }).catch(() => fetch(url, { method: "GET" }));
        if (resp.ok) {
          results.push({ name, status: "PASS", message: `Connected successfully (HTTP ${resp.status})` });
        } else {
          results.push({ name, status: "WARNING", message: `Connected but returned HTTP status ${resp.status}` });
        }
      } catch (err) {
        results.push({ name, status: "FAIL", message: err instanceof Error ? err.message : "Connection failed" });
      }
    };

    // 1. Orthanc HTTP
    await testHttp("Orthanc REST API", cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, "/system"));

    // 2. Orthanc DICOM port
    const orthancDicom = await tcpProbe(cfg.orthanc.ip, cfg.orthanc.dicomPort);
    results.push({
      name: "Orthanc DICOM Port",
      status: orthancDicom.ok ? "PASS" : "FAIL",
      message: orthancDicom.ok ? `TCP connection passed (${cfg.orthanc.ip}:${cfg.orthanc.dicomPort})` : orthancDicom.message || "Connection timeout",
    });

    // 3. Conquest DICOM port
    if (cfg.conquest.ip) {
      const conquestDicom = await tcpProbe(cfg.conquest.ip, cfg.conquest.dicomPort);
      results.push({
        name: "Conquest DICOM Port",
        status: conquestDicom.ok ? "PASS" : "FAIL",
        message: conquestDicom.ok ? `TCP connection passed (${cfg.conquest.ip}:${cfg.conquest.dicomPort})` : conquestDicom.message || "Connection timeout",
      });
    } else {
      results.push({ name: "Conquest DICOM Port", status: "WARNING", message: "Conquest IP not configured" });
    }

    // 4. OHIF
    await testHttp("OHIF Viewer", cfg.ohif.baseUrl);

    // 5. Weasis
    await testHttp("Weasis WADO Server", cfg.weasis.wadoUrl);

    // 6. ERP API check
    await testHttp("ERP Internal API", cfg.erp.internalApiUrl.replace(/\/api\/internal$/, "/api/health"));

    // 7. Modalities connection
    const modalities = await db.select().from(dicomModalitiesTable);
    for (const m of modalities) {
      if (m.ipAddress && m.port) {
        const probe = await tcpProbe(m.ipAddress, m.port, 3000, true);
        results.push({
          name: `Modality: ${m.machineName}`,
          status: probe.ok ? "PASS" : "FAIL",
          message: probe.ok ? `TCP connection passed (${m.ipAddress}:${m.port})` : probe.message || "TCP connection timeout",
        });
      } else {
        results.push({
          name: `Modality: ${m.machineName}`,
          status: "WARNING",
          message: "IP address or Port is missing",
        });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/network/health", async (req, res) => {
  try {
    const cfg = await getRadiologyConfig();
    
    const fetchWithTimeout = async (url: string, timeout = 2000): Promise<{ ok: boolean; status?: number; error?: string }> => {
      if (!url) return { ok: false, error: "Empty URL" };
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const resp = await fetch(url, { signal: controller.signal, method: "HEAD" }).catch(() => 
          fetch(url, { signal: controller.signal, method: "GET" }) // fallback to GET if HEAD blocked
        );
        clearTimeout(id);
        return { ok: resp.ok, status: resp.status };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    // ── Orthanc probe strategy:
    // For server-side health checks inside Docker, use the internal service name
    // (http://care-orthanc:8042) rather than the external LAN IP.
    // This avoids SSRF guards and bridge IP routing issues.
    const internalOrthancBase = (process.env.ORTHANC_INTERNAL_URL || "http://care-orthanc:8042").replace(/\/$/, "");
    const externalOrthancBase = cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, "");

    // ── Bridge IP detection: shared, corrected helper (see pacsConfig.ts) —
    // deliberately excludes the clinic's real LAN subnet 172.16.1.x so a
    // working OHIF/Weasis URL on that subnet is never mistaken for "unconfigured".
    const ohifConfigured = !!cfg.ohif.baseUrl && !isDockerBridgeIp(cfg.ohif.baseUrl);
    const weasisConfigured = !!cfg.weasis.wadoUrl && !isDockerBridgeIp(cfg.weasis.wadoUrl);

    // OHIF probe target: same Docker-bridge-isolation problem Orthanc had —
    // the container often cannot reach the NAS's own external LAN IP. If an
    // internal reachable address is provided via env, use it for the PROBE
    // only; the URL actually opened in the doctor's browser is unaffected
    // (that still comes from cfg.ohif.baseUrl / admin PACS Settings).
    const ohifProbeUrl = process.env.OHIF_INTERNAL_URL || cfg.ohif.baseUrl;

    // Ollama: read from env, no hardcoded IPs
    const ollamaUrl = process.env.OLLAMA_URL || "";

    // run probes concurrently
    const [orthancHttp, orthancDicom, ohifHttp, weasisWado, conquestDicom, ollamaAi] = await Promise.all([
      // Orthanc HTTP — probe via internal Docker name (always reachable within compose stack)
      fetchWithTimeout(internalOrthancBase + "/system"),
      // Orthanc DICOM Port — allowPrivate=true required; add ALLOW_PRIVATE_IPS=true to ERP .env
      tcpProbe(cfg.orthanc.ip, cfg.orthanc.dicomPort, 3000, true),
      // OHIF — only probe if URL is configured and not a Docker bridge IP
      ohifConfigured
        ? fetchWithTimeout(ohifProbeUrl)
        : Promise.resolve({ ok: false, error: "Not configured" }),
      // Weasis WADO — if external URL has bridge IP, fall back to internal Orthanc WADO
      weasisConfigured
        ? fetchWithTimeout(cfg.weasis.wadoUrl)
        : fetchWithTimeout(internalOrthancBase + "/wado"),
      // Conquest — not installed is yellow, not red
      cfg.conquest.ip
        ? tcpProbe(cfg.conquest.ip, cfg.conquest.dicomPort, 3000, true)
        : Promise.resolve({ ok: false, latencyMs: 0, message: "Not installed" }),
      // Ollama AI — optional; offline = yellow not red
      ollamaUrl
        ? fetchWithTimeout(ollamaUrl)
        : Promise.resolve({ ok: false, error: "Not configured" }),
    ]);

    // Derive nuanced status: distinguish "not configured" from "failing"
    const ohifStatus  = !ohifConfigured ? "yellow" : ohifHttp.ok  ? "green" : "red";
    const ohifDetails = !ohifConfigured
      ? `Not configured — enter OHIF URL in PACS Settings (use ${NETWORK_LAN_HOST}:${OHIF_HTTP_PORT})`
      : ohifHttp.ok ? "Reachable" : "Unreachable from server — check OHIF is running, or set OHIF_INTERNAL_URL if the container can't reach its own external LAN IP";

    const weasisStatus  = weasisWado.ok ? "green" : "yellow";
    const weasisDetails = weasisWado.ok
      ? "WADO endpoint reachable"
      : weasisConfigured
        ? "WADO endpoint unreachable — Weasis uses local app fallback"
        : "Using Orthanc WADO — configure Weasis URL in PACS Settings";

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      services: {
        orthancHttp: {
          name: "Orthanc REST API",
          endpoint: externalOrthancBase,
          status: orthancHttp.ok ? "green" : "red",
          details: orthancHttp.ok
            ? "Reachable (internal Docker network)"
            : "Unreachable — check care-orthanc container status",
        },
        orthancDicom: {
          name: "Orthanc DICOM Port",
          endpoint: `${cfg.orthanc.ip}:${cfg.orthanc.dicomPort}`,
          status: orthancDicom.ok ? "green" : "yellow",
          details: orthancDicom.ok
            ? orthancDicom.message
            : "TCP probe blocked — add ALLOW_PRIVATE_IPS=true to ERP .env (not a service failure)",
        },
        ohifHttp: {
          name: "OHIF Viewer",
          endpoint: cfg.ohif.baseUrl || "Not configured",
          status: ohifStatus,
          details: ohifDetails,
        },
        weasisWado: {
          name: "Weasis WADO Server",
          endpoint: weasisConfigured ? cfg.weasis.wadoUrl : internalOrthancBase + "/wado",
          status: weasisStatus,
          details: weasisDetails,
        },
        conquestDicom: {
          name: "Conquest DICOM SCP",
          endpoint: cfg.conquest.ip ? `${cfg.conquest.ip}:${cfg.conquest.dicomPort}` : "Not installed",
          status: !cfg.conquest.ip ? "yellow" : conquestDicom.ok ? "green" : "yellow",
          details: !cfg.conquest.ip
            ? "Conquest not installed — system uses Orthanc only (expected)"
            : conquestDicom.message,
        },
        ollamaAi: {
          name: "Ollama AI (Radiology Copilot)",
          endpoint: ollamaUrl || "Not configured",
          status: ollamaAi.ok ? "green" : "yellow",
          details: ollamaAi.ok ? "Reachable" : "Offline — AI draft will be unavailable (not critical)",
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/network/warnings", async (req, res) => {
  try {
    const cfg = await getRadiologyConfig();
    const warnings: string[] = [];

    // Check for Docker Bridge IP leaks (shared, corrected helper — see
    // pacsConfig.ts; deliberately excludes the real clinic LAN 172.16.1.x)
    if (isDockerBridgeIp(cfg.orthanc.ip)) {
      warnings.push("Orthanc IP uses a Docker bridge network address, unreachable by LAN workstations. Set ORTHANC_IP or ORTHANC_URL to the clinic's real LAN IP (e.g. 172.16.1.139) in .env.");
    }
    if (isDockerBridgeIp(cfg.conquest.ip)) {
      warnings.push("Conquest IP uses a Docker bridge network address, unreachable by LAN workstations. Set CONQUEST_HOST to the clinic's real LAN IP in .env.");
    }
    if (isDockerBridgeIp(cfg.ohif.baseUrl)) {
      warnings.push("OHIF Base URL uses a Docker bridge IP — browser clients will fail to launch OHIF. Set OHIF_URL in .env (or the OHIF Base URL field in PACS Settings) to a LAN IP, Tailscale IP, or public domain.");
    }
    if (isDockerBridgeIp(cfg.weasis.wadoUrl)) {
      warnings.push("Weasis WADO endpoint uses a Docker bridge IP — local Weasis installations cannot read scans. Set WEASIS_WADO_PUBLIC_URL in .env (or the Weasis WADO field in PACS Settings) to a LAN IP, Tailscale IP, or public domain.");
    }

    // Check missing settings
    if (!cfg.orthanc.aeTitle) warnings.push("Orthanc AE Title is missing.");
    if (!cfg.conquest.aeTitle) warnings.push("Conquest AE Title is missing.");
    if (!cfg.orthanc.dicomPort) warnings.push("Orthanc DICOM port is missing.");
    if (!cfg.conquest.dicomPort) warnings.push("Conquest DICOM port is missing.");
    
    // Check Conquest / Orthanc AE Title conflicts
    if (cfg.conquest.aeTitle === cfg.orthanc.aeTitle) {
      warnings.push(`Duplicate AE Title found: Both Orthanc and Conquest are named '${cfg.orthanc.aeTitle}'.`);
    }

    // Check placeholders
    if (cfg.erp.lanUrl.includes("YOUR_DOMAIN.replit.app") || cfg.erp.internalApiUrl.includes("YOUR_DOMAIN.replit.app")) {
      warnings.push("Placeholder Replit URL detected in ERP settings. Update to your LAN IP or caredeoghar.com domain.");
    }
    if (!cfg.erp.hasApiKey) {
      warnings.push("INTERNAL_API_KEY is not set. Hook sync from Orthanc/Conquest will fail authorization.");
    }

    res.json({ ok: true, warnings });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/network/health-monitor", async (req, res) => {
  try {
    const cfg = await getRadiologyConfig();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Live Operational Timestamps
    const [lastPulled] = await db
      .select({ createdAt: dicomPulledStudiesTable.createdAt })
      .from(dicomPulledStudiesTable)
      .orderBy(desc(dicomPulledStudiesTable.createdAt))
      .limit(1);

    const [lastWorklist] = await db
      .select({ createdAt: radiologyWorklistTable.createdAt })
      .from(radiologyWorklistTable)
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(1);

    const [lastScheduled] = await db
      .select({ createdAt: radiologyScheduledProceduresTable.createdAt })
      .from(radiologyScheduledProceduresTable)
      .orderBy(desc(radiologyScheduledProceduresTable.createdAt))
      .limit(1);

    const [lastSyncRow] = await db
      .select({ updatedAt: risSyncStatusTable.updatedAt })
      .from(risSyncStatusTable)
      .orderBy(desc(risSyncStatusTable.updatedAt))
      .limit(1);

    const [lastOhifLaunch] = await db
      .select({ createdAt: pacsLogsTable.createdAt })
      .from(pacsLogsTable)
      .where(and(eq(pacsLogsTable.source, "OHIF_VIEWER_LAUNCH"), eq(pacsLogsTable.eventType, "VIEWER_LAUNCHED")))
      .orderBy(desc(pacsLogsTable.createdAt))
      .limit(1);

    const [lastWeasisLaunch] = await db
      .select({ createdAt: pacsLogsTable.createdAt })
      .from(pacsLogsTable)
      .where(and(
        or(eq(pacsLogsTable.source, "WEASIS_VIEWER_LAUNCH"), eq(pacsLogsTable.source, "WEASIS_REDIRECT_LAUNCH")),
        eq(pacsLogsTable.eventType, "VIEWER_LAUNCHED")
      ))
      .orderBy(desc(pacsLogsTable.createdAt))
      .limit(1);

    // 2. Daily Counters
    const [receivedToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .where(gte(dicomPulledStudiesTable.createdAt, today));

    const [syncedToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .where(and(
        eq(dicomPulledStudiesTable.status, "completed"),
        gte(dicomPulledStudiesTable.updatedAt, today)
      ));

    const [failedToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dicomPulledStudiesTable)
      .where(and(
        eq(dicomPulledStudiesTable.status, "failed"),
        gte(dicomPulledStudiesTable.updatedAt, today)
      ));

    const [launchFailures] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pacsLogsTable)
      .where(and(
        eq(pacsLogsTable.severity, "error"),
        or(
          ilike(pacsLogsTable.source, "%viewer%"),
          ilike(pacsLogsTable.message, "%viewer%"),
          ilike(pacsLogsTable.message, "%launch%")
        ),
        gte(pacsLogsTable.createdAt, today)
      ));

    const [syncFailuresToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pacsLogsTable)
      .where(and(
        eq(pacsLogsTable.severity, "error"),
        or(
          ilike(pacsLogsTable.source, "%sync%"),
          ilike(pacsLogsTable.message, "%sync%")
        ),
        gte(pacsLogsTable.createdAt, today)
      ));

    const [pullerErrorsToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pacsLogsTable)
      .where(and(
        eq(pacsLogsTable.severity, "error"),
        or(
          eq(pacsLogsTable.source, "DICOM_PULL_AGENT"),
          ilike(pacsLogsTable.message, "%pull%"),
          ilike(pacsLogsTable.source, "%pull%")
        ),
        gte(pacsLogsTable.createdAt, today)
      ));

    // 3. Health Status
    const fetchWithTimeout = async (url: string, timeout = 2000): Promise<boolean> => {
      if (!url) return false;
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const resp = await fetch(url, { signal: controller.signal, method: "HEAD" }).catch(() => 
          fetch(url, { signal: controller.signal, method: "GET" })
        );
        clearTimeout(id);
        return resp.ok;
      } catch {
        return false;
      }
    };

    // ── Health-monitor probes: same dual-URL strategy as /network/health.
    // Uses the shared, corrected isDockerBridgeIp (see pacsConfig.ts) so a
    // working OHIF/Weasis URL on the real clinic LAN (172.16.1.x) is never
    // mistaken for an unreachable Docker bridge address.
    const internalOrthancBase2 = (process.env.ORTHANC_INTERNAL_URL || "http://care-orthanc:8042").replace(/\/$/, "");
    const ohifUrlOk  = !!cfg.ohif.baseUrl   && !isDockerBridgeIp(cfg.ohif.baseUrl);
    const wadoUrlOk  = !!cfg.weasis.wadoUrl && !isDockerBridgeIp(cfg.weasis.wadoUrl);

    const [orthancOk, orthancPortOk, ohifOk, weasisOk, conquestOk] = await Promise.all([
      // Orthanc HTTP via internal Docker name
      fetchWithTimeout(internalOrthancBase2 + "/system"),
      // Orthanc DICOM port — allowPrivate required
      tcpProbe(cfg.orthanc.ip, cfg.orthanc.dicomPort, 3000, true).then(r => r.ok),
      // OHIF — skip if bridge IP (would always false-RED)
      ohifUrlOk ? fetchWithTimeout(cfg.ohif.baseUrl) : Promise.resolve(false),
      // Weasis — fall back to internal Orthanc WADO if URL is bridge IP
      wadoUrlOk
        ? fetchWithTimeout(cfg.weasis.wadoUrl)
        : fetchWithTimeout(internalOrthancBase2 + "/wado"),
      // Conquest — not installed = treated as yellow (not counted against health score)
      cfg.conquest.ip
        ? tcpProbe(cfg.conquest.ip, cfg.conquest.dicomPort, 3000, true).then(r => r.ok)
        : Promise.resolve(null)  // null = not installed
    ]);

    let orthancStatus = "red";
    if (orthancOk && orthancPortOk) orthancStatus = "green";
    else if (orthancOk) orthancStatus = "yellow"; // HTTP works, DICOM probe blocked = acceptable

    // Conquest null = not installed → yellow (does not penalise health score)
    const conquestStatus = conquestOk === null ? "yellow" : conquestOk ? "green" : "yellow";
    // OHIF: if not configured → yellow (informational, not a failure)
    const ohifStatus = !ohifUrlOk ? "yellow" : ohifOk ? "green" : "red";
    // Weasis: optional viewer → yellow when unreachable, not red
    const weasisStatus = weasisOk ? "green" : "yellow";

    const syncs = await db.select().from(risSyncStatusTable);
    const hasSyncErrors = syncs.some(s => s.status === "failed" || (s.itemsFailed ?? 0) > 0);
    const erpSyncStatus = hasSyncErrors ? "red" : (syncs.length > 0 ? "green" : "yellow");

    const watchdogServices = await db.select().from(watchdogStatusTable);
    const pullerService = watchdogServices.find(s => 
      s.serviceName.toLowerCase().includes("pull") || s.displayName.toLowerCase().includes("pull")
    );
    let pullerStatus = "yellow";
    if (pullerService) {
      pullerStatus = pullerService.status === "healthy" ? "green" : "red";
    } else {
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      const [recentPull] = await db
        .select({ id: pacsLogsTable.id })
        .from(pacsLogsTable)
        .where(and(
          eq(pacsLogsTable.source, "DICOM_PULL_AGENT"),
          gte(pacsLogsTable.createdAt, twentyMinsAgo)
        ))
        .limit(1);
      pullerStatus = recentPull ? "green" : "yellow";
    }

    // Worklist Creation Health Logic
    let worklistCreationStatus = "red";
    if (lastScheduled?.createdAt) {
      const msSinceLastScheduled = Date.now() - new Date(lastScheduled.createdAt).getTime();
      const hoursSinceLastScheduled = msSinceLastScheduled / (1000 * 60 * 60);
      if (hoursSinceLastScheduled <= 24) {
        worklistCreationStatus = "green";
      } else if (hoursSinceLastScheduled <= 24 * 7) {
        worklistCreationStatus = "yellow";
      } else {
        worklistCreationStatus = "red";
      }
    }
    const [recentWorklistError] = await db
      .select({ id: pacsLogsTable.id })
      .from(pacsLogsTable)
      .where(and(
        eq(pacsLogsTable.severity, "error"),
        or(
          ilike(pacsLogsTable.source, "%worklist%"),
          ilike(pacsLogsTable.message, "%worklist%"),
          ilike(pacsLogsTable.message, "%scheduled%")
        ),
        gte(pacsLogsTable.createdAt, today)
      ))
      .limit(1);

    if (recentWorklistError) {
      worklistCreationStatus = "red";
    }

    // 4. Recent Errors & Warnings Map
    const rawErrors = await db
      .select()
      .from(pacsLogsTable)
      .where(or(
        eq(pacsLogsTable.severity, "error"),
        eq(pacsLogsTable.severity, "warning")
      ))
      .orderBy(desc(pacsLogsTable.createdAt))
      .limit(20);

    const recentErrors = rawErrors.map((log) => {
      const msg = log.message.toLowerCase();
      const src = (log.source ?? "").toLowerCase();
      let suggestedAction = "Check system configurations and logs.";
      if (msg.includes("timeout") || msg.includes("refused") || msg.includes("connect")) {
        suggestedAction = "Check if target server is running, the host IP is reachable, and ports are open.";
      } else if (msg.includes("auth") || msg.includes("api key") || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("key")) {
        suggestedAction = "Verify API credentials and internal API key configuration in settings.";
      } else if (msg.includes("wado") || msg.includes("weasis") || msg.includes("ohif") || msg.includes("launch") || msg.includes("viewer")) {
        suggestedAction = "Verify viewer base URL configuration and network accessibility.";
      } else if (msg.includes("disk") || msg.includes("storage") || msg.includes("full") || msg.includes("write error")) {
        suggestedAction = "Check server disk space allocation and directory permissions.";
      } else if (msg.includes("syntax") || msg.includes("format") || msg.includes("invalid dicom") || msg.includes("corrupt")) {
        suggestedAction = "Ensure modality is sending valid DICOM files with compatible transfer syntax.";
      } else if (src.includes("pull") || msg.includes("pull")) {
        suggestedAction = "Verify DICOM Puller service is active in watchdog and verify pull destination AE Title.";
      } else if (src.includes("worklist") || msg.includes("worklist") || msg.includes("scheduled")) {
        suggestedAction = "Verify Scheduled Procedure cron agent settings and RIS sync endpoint path.";
      }
      
      return {
        ...log,
        suggestedAction,
      };
    });

    res.json({
      ok: true,
      timestamps: {
        lastStudyReceived: lastPulled?.createdAt || lastWorklist?.createdAt || null,
        lastOrthancImport: lastWorklist?.createdAt || null,
        lastErpSync: lastSyncRow?.updatedAt || null,
        lastWorklistCreation: lastScheduled?.createdAt || null,
        lastOhifLaunch: lastOhifLaunch?.createdAt || null,
        lastWeasisLaunch: lastWeasisLaunch?.createdAt || null,
      },
      counters: {
        receivedToday: receivedToday?.count ?? 0,
        syncedToday: syncedToday?.count ?? 0,
        failedToday: failedToday?.count ?? 0,
        launchFailures: launchFailures?.count ?? 0,
        syncFailures: (syncFailuresToday?.count ?? 0) + syncs.reduce((sum, s) => sum + (s.itemsFailed ?? 0), 0),
        pullerErrors: pullerErrorsToday?.count ?? 0,
      },
      health: {
        orthanc: orthancStatus,
        conquest: conquestStatus,
        ohif: ohifStatus,
        weasis: weasisStatus,
        erpSync: erpSyncStatus,
        dicomPuller: pullerStatus,
        worklistCreation: worklistCreationStatus,
      },
      recentErrors,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/network/diagnostics", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. Modalities
    const modalities = await db.select().from(dicomNodesTable);
    const modalityDiagnostics = modalities.map((m) => ({
      id: m.id,
      aeTitle: m.aeTitle,
      ip: m.host,
      port: m.port,
      lastCEcho: m.lastTestAt ? m.lastTestAt.toISOString() : null,
      lastCFind: m.lastPullAt ? m.lastPullAt.toISOString() : null,
      lastCMove: m.lastPullAt ? m.lastPullAt.toISOString() : null,
      lastReceivedStudy: m.lastPullAt ? m.lastPullAt.toISOString() : null,
      lastErpSync: m.lastPullAt ? m.lastPullAt.toISOString() : null,
      lastError: m.lastPullMessage || m.lastTestMessage || null,
      status: m.lastPullStatus || "unknown"
    }));

    // 2. Orthanc
    const [studiesTodayRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(radiologyWorklistTable)
      .where(gte(radiologyWorklistTable.createdAt, todayStart));
    
    const [lastWorklistRow] = await db
      .select({ createdAt: radiologyWorklistTable.createdAt })
      .from(radiologyWorklistTable)
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(1);

    const orthancDiagnostics = {
      studiesToday: studiesTodayRes?.count ?? 0,
      lastModalityConnection: lastWorklistRow?.createdAt ? lastWorklistRow.createdAt.toISOString() : null,
      lastRetrieval: lastWorklistRow?.createdAt ? lastWorklistRow.createdAt.toISOString() : null,
      lastErpNotification: lastWorklistRow?.createdAt ? lastWorklistRow.createdAt.toISOString() : null,
    };

    // 3. ERP
    const [lastReceived] = await db
      .select({ createdAt: radiologyWorklistTable.createdAt })
      .from(radiologyWorklistTable)
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(1);

    const [lastStudy] = await db
      .select({ createdAt: radiologyStudiesTable.createdAt })
      .from(radiologyStudiesTable)
      .orderBy(desc(radiologyStudiesTable.createdAt))
      .limit(1);

    const [lastSyncErrLog] = await db
      .select({ createdAt: pacsLogsTable.createdAt })
      .from(pacsLogsTable)
      .where(and(
        eq(pacsLogsTable.severity, "error"),
        or(
          ilike(pacsLogsTable.source, "%sync%"),
          ilike(pacsLogsTable.message, "%sync%")
        )
      ))
      .orderBy(desc(pacsLogsTable.createdAt))
      .limit(1);

    const erpDiagnostics = {
      lastStudyReceived: lastReceived?.createdAt ? lastReceived.createdAt.toISOString() : null,
      lastWorklistInsertion: lastStudy?.createdAt ? lastStudy.createdAt.toISOString() : null,
      lastSyncFailure: lastSyncErrLog?.createdAt ? lastSyncErrLog.createdAt.toISOString() : null,
    };

    res.json({
      ok: true,
      modalities: modalityDiagnostics,
      orthanc: orthancDiagnostics,
      erp: erpDiagnostics
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/network/lua-hook/conquest", async (req, res) => {
  const cfg = await getRadiologyConfig();
  const erpUrl = `${cfg.erp.internalApiUrl}/radiology/studies`;
  const erpKey = process.env.INTERNAL_API_KEY || "REPLACE_WITH_YOUR_INTERNAL_API_KEY";

  const hookContent = `-- =============================================================================
-- erp_notify.lua  —  CONQUEST PACS → DiagnoCenter ERP study-intake hook
-- Generated Dynamically by ERP Network Control Center
-- =============================================================================
local ERP_URL     = "${erpUrl}"
local ERP_API_KEY = "${erpKey}"
local DEBUG       = true

local function json_escape(s)
  if s == nil then return "" end
  s = tostring(s):gsub('\\\\', '\\\\\\\\')
                 :gsub('"',  '\\\\"')
                 :gsub('\\n', '\\\\n')
                 :gsub('\\r', '\\\\r')
                 :gsub('\\t', '\\\\t')
                 :gsub('\\0', '')
  return s
end

local function http_post(url, key, body)
  local ok_http, http = pcall(require, "socket.http")
  if ok_http and http then
    local ok_ltn12, ltn12 = pcall(require, "ltn12")
    if ok_ltn12 then
      local sink_t = {}
      local _, code = http.request({
        url     = url,
        method  = "POST",
        headers = {
          ["Content-Type"]   = "application/json",
          ["Authorization"]  = "Bearer " .. key,
          ["Content-Length"] = tostring(#body),
        },
        source = ltn12.source.string(body),
        sink   = ltn12.sink.table(sink_t),
      })
      return code
    end
  end

  local tmpfile = os.tmpname() .. "_erp.json"
  local f = io.open(tmpfile, "w")
  if not f then return 0 end
  f:write(body)
  f:close()

  local cmd = string.format(
    'curl -s -o NUL -w "%%{http_code}" -X POST "%s"'
    .. ' -H "Content-Type: application/json"'
    .. ' -H "Authorization: Bearer %s"'
    .. ' --data-binary "@%s"'
    .. ' --max-time 10 --connect-timeout 5',
    url, key, tmpfile
  )
  if package.config:sub(1,1) == "/" then
    cmd = cmd:gsub("NUL", "/dev/null")
  end

  local handle = io.popen(cmd)
  local code_str = handle and handle:read("*a") or "000"
  if handle then handle:close() end
  os.remove(tmpfile)

  return tonumber(code_str) or 0
end

function converter(callingae, calledae, ip, port)
  local accession = AccessionNumber or ""
  if accession == "" then return end

  local raw_name   = PatientsName or PatientName or ""
  local patient_name = raw_name:gsub("%%^", " "):match("^%%s*(.-)%%s*$")
  if patient_name == "" then patient_name = "UNKNOWN" end

  local patient_id   = PatientID            or ""
  local study_uid    = StudyInstanceUID     or ""
  local modality     = Modality             or "OT"
  local description  = StudyDescription     or ""
  local study_date   = StudyDate            or ""
  local referring_dr = ReferringPhysiciansName or ""

  local body = string.format(
    '{"patientId":"%%s","patientName":"%%s","accessionNumber":"%%s",'
    .. '"studyInstanceUID":"%%s","modality":"%%s","studyDescription":"%%s",'
    .. '"studyDate":"%%s","referringDoctor":"%%s","aeTitle":"%%s","ipAddress":"%%s"}',
    json_escape(patient_id), json_escape(patient_name), json_escape(accession),
    json_escape(study_uid), json_escape(modality), json_escape(description),
    json_escape(study_date), json_escape(referring_dr), json_escape(calledae or ""),
    json_escape(ip or "")
  )

  local code = http_post(ERP_URL, ERP_API_KEY, body)
  if code < 200 or code >= 300 then
    print("[ERP] Hook Sync Failure: HTTP " .. tostring(code))
  end
end
`;

  res.setHeader("Content-Disposition", "attachment; filename=erp_notify.lua");
  res.setHeader("Content-Type", "text/plain");
  res.send(hookContent);
});

router.get("/network/lua-hook/orthanc", async (req, res) => {
  const cfg = await getRadiologyConfig();
  const erpUrl = `${cfg.erp.internalApiUrl}/radiology/studies`;
  const erpKey = process.env.INTERNAL_API_KEY || "REPLACE_WITH_YOUR_INTERNAL_API_KEY";

  const hookContent = `-- =============================================================================
-- orthanc_erp_notify.lua  —  ORTHANC PACS → DiagnoCenter ERP study-intake hook
-- Generated Dynamically by ERP Network Control Center
-- =============================================================================
function OnStoredInstance(instanceId, tags, metadata, origin)
  if origin and origin["RequestOrigin"] == "RestApi" then
    return
  end

  local accession = tags["AccessionNumber"] or ""
  if accession == "" then
    return
  end

  local ERP_URL     = "${erpUrl}"
  local ERP_API_KEY = "${erpKey}"

  local patient_name = (tags["PatientName"] or "UNKNOWN"):gsub("%%^", " ")
  local patient_id   = tags["PatientID"] or ""
  local study_uid    = tags["StudyInstanceUID"] or ""
  local modality     = tags["Modality"] or "OT"
  local description  = tags["StudyDescription"] or ""
  local study_date   = tags["StudyDate"] or ""
  local referring_dr = tags["ReferringPhysicianName"] or ""
  local called_ae    = origin and origin["CalledAet"] or ""
  local ip_addr      = origin and origin["IpAddress"] or ""

  local function escape(s)
    if not s then return "" end
    return tostring(s):gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('\\n', '\\\\n'):gsub('\\r', '\\\\r')
  end

  local json = string.format(
    '{"patientId":"%%s","patientName":"%%s","accessionNumber":"%%s","studyInstanceUID":"%%s","modality":"%%s","studyDescription":"%%s","studyDate":"%%s","referringDoctor":"%%s","aeTitle":"%%s","ipAddress":"%%s"}',
    escape(patient_id), escape(patient_name), escape(accession),
    escape(study_uid), escape(modality), escape(description),
    escape(study_date), escape(referring_dr), escape(called_ae), escape(ip_addr)
  )

  local headers = {
    ["Content-Type"] = "application/json",
    ["Authorization"] = "Bearer " .. ERP_API_KEY
  }

  local response = HttpPost(ERP_URL, json, headers)
end
`;

  res.setHeader("Content-Disposition", "attachment; filename=orthanc_erp_notify.lua");
  res.setHeader("Content-Type", "text/plain");
  res.send(hookContent);
});

// ─── Print bridge (drabinash/dicomtowindows) ─────────────────────────────────
//
// POST /api/radiology/print-images
// Print a caller-chosen set of images directly to the clinic's glossy-photo
// printer via the NAS-side DICOM print bridge's HTTP API. This is a SEPARATE
// selection from a report's own key images (radiology_image_references) —
// the workspace's print picker keeps its own local, unpersisted selection;
// nothing here is written to the database.

const MAX_PRINT_IMAGES_PER_REQUEST = 100; // mirrors reportImages.ts's MAX_IMAGES_PER_REPORT
const PRINT_FETCH_CONCURRENCY = 4;
// Stays comfortably under the print bridge's default 60MB HTTP_MAX_BODY_BYTES
// after base64 inflation (~4/3x): 40MB raw -> ~53MB base64 + negligible JSON
// overhead. Without this, a large batch of print-quality images could build
// a request the bridge flatly rejects with a 413 and nothing printed at all.
const PRINT_TOTAL_RAW_BYTES_BUDGET = 40_000_000;

interface PrintBridgeResponse {
  status?: string;
  jobKey?: string;
  pages?: number;
  images?: number;
  error?: string;
}

type PrintClinic = ReturnType<typeof buildPrintClinic>;

/** Patient identification printed on the sheet by the print bridge. */
export interface PrintPatient {
  name?: string;
  id?: string;
  studyDate?: string;
  modality?: string;
}

/** Pure helper (exported for tests): the one Study Instance UID shared by
 *  every requested image, or null.
 *
 *  Printing one patient's name over another patient's images is worse than
 *  printing no name at all, so this is deliberately strict: a request that
 *  spans two studies gets no identification line, and so does one where any
 *  image lacks a study UID — an unattributed image could belong to anyone. */
export function singleStudyUidFor(refs: Array<{ studyInstanceUid?: string }>): string | null {
  if (refs.length === 0) return null;
  const uids = refs.map((r) => (r.studyInstanceUid || "").trim());
  if (uids.some((uid) => !uid)) return null;
  return uids.every((uid) => uid === uids[0]) ? uids[0] : null;
}

/** Pure helper (exported for tests): the per-frame captions the bridge prints
 *  under each image.
 *
 *  `included` must be the refs whose pixels were actually fetched, in the
 *  order they appear in the images array — a PACS fetch that failed drops its
 *  image, and a caption list that still counted it would caption every
 *  following frame with the wrong series.
 *
 *  The number is the frame's position on the sheet rather than its DICOM
 *  Instance Number: it is what someone reading the printout can actually
 *  count along to. */
export function buildPrintLabels(
  included: Array<{ seriesInstanceUid?: string }>,
  seriesDescriptionByUid: Record<string, string>,
): string[] {
  return included.map((ref, index) => {
    const description = (seriesDescriptionByUid[(ref.seriesInstanceUid || "").trim()] || "").trim();
    const number = `#${index + 1}`;
    return description ? `${description}  ${number}` : number;
  });
}

/** Pure helper (exported for tests): which film size this job should print on.
 *
 *  An explicit request wins, then PRINT_PAGE_SIZE_<MODALITY> (so CT and MR can
 *  go on A3+ while ultrasound stays on A4), then PRINT_PAGE_SIZE_DEFAULT.
 *  Returns "" when nothing is configured, in which case the size is left out
 *  of the payload entirely and the bridge's own PAGE_SIZE applies — the
 *  behaviour every existing install already has. */
export function resolvePrintPageSize(
  requested: unknown,
  modality: string | null | undefined,
  env: Record<string, string | undefined>,
): string {
  const explicit = typeof requested === "string" ? requested.trim() : "";
  if (explicit) return explicit;
  const key = (modality || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key) {
    const byModality = (env[`PRINT_PAGE_SIZE_${key}`] || "").trim();
    if (byModality) return byModality;
  }
  return (env.PRINT_PAGE_SIZE_DEFAULT || "").trim();
}

/** Pure helper (exported for tests): builds the POST /api/v1/print-jobs body
 *  for the print bridge from already-fetched image data URLs, the caller's
 *  copies/orientation/layout choices, and the clinic's branding row. Clinic
 *  branding rides along on every request rather than relying on the print
 *  bridge's own (possibly stale, separately-configured) header/footer env
 *  vars — clinic_settings is the ERP's single source of truth for the
 *  clinic's name/logo, used identically for bills/receipts.
 *
 *  `patient` adds the identification line the bridge already prints on films
 *  it receives from a modality, so an ERP-initiated print is just as
 *  traceable back to a patient. It is omitted unless it carries at least one
 *  non-empty field — a blank identification line is worse than none. */
export function buildPrintBridgePayload(
  images: string[],
  copies: unknown,
  orientation: unknown,
  layout: { rows?: number; cols?: number } | undefined,
  clinic: PrintClinic | null,
  patient?: PrintPatient | null,
  labels?: string[] | null,
  pageSize?: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    images,
    copies: Math.max(1, Math.min(20, Math.floor(Number(copies)) || 1)),
    orientation: orientation === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
  };
  if (layout?.rows && layout?.cols) {
    payload.layout = { rows: Math.max(1, Math.floor(layout.rows)), cols: Math.max(1, Math.floor(layout.cols)) };
  }
  if (clinic && (clinic.name || clinic.logoDataUrl)) {
    payload.header = {
      line1: clinic.tagline || "",
      line2: clinic.name || "",
      logo: clinic.logoDataUrl || undefined,
      align: "CENTER",
    };
  }
  if (clinic) {
    const footerLine2 = [clinic.phone, clinic.email].filter(Boolean).join("  |  ");
    if (clinic.address || footerLine2) {
      payload.footer = { line1: clinic.address || "", line2: footerLine2, align: "CENTER" };
    }
  }
  if (patient) {
    const fields = {
      name: (patient.name || "").trim(),
      id: (patient.id || "").trim(),
      studyDate: (patient.studyDate || "").trim(),
      modality: (patient.modality || "").trim().toUpperCase(),
    };
    if (Object.values(fields).some(Boolean)) {
      payload.patient = fields;
    }
  }
  if (labels && labels.length && labels.some((l) => (l || "").trim())) {
    payload.labels = labels;
  }
  if ((pageSize || "").trim()) {
    payload.pageSize = (pageSize as string).trim();
  }
  return payload;
}

router.post("/print-images", async (req, res): Promise<void> => {
  const body = req.body as {
    images?: Array<{
      studyInstanceUid?: string;
      seriesInstanceUid?: string;
      sopInstanceUid?: string;
      frameNumber?: number;
    }>;
    copies?: number;
    layout?: { rows?: number; cols?: number };
    orientation?: "PORTRAIT" | "LANDSCAPE";
    pageSize?: string;
  };

  if (!Array.isArray(body.images) || body.images.length === 0) {
    res.status(400).json({ error: "images array required" });
    return;
  }
  if (body.images.length > MAX_PRINT_IMAGES_PER_REQUEST) {
    res.status(400).json({ error: `At most ${MAX_PRINT_IMAGES_PER_REQUEST} images are allowed per print request` });
    return;
  }

  const cfg = await getRadiologyConfig();
  if (!cfg.printBridge.url || !cfg.printBridge.hasSecret) {
    res.status(503).json({
      error: "The print bridge isn't configured yet. Set PRINT_BRIDGE_URL and PRINT_BRIDGE_SECRET in the environment.",
    });
    return;
  }

  // Fetch each rendered image from Orthanc with bounded concurrency (same
  // worker-pool shape as reportImages.ts's resolveDraftKeyImages), and the
  // same reserve-upfront/refund-after-fetch total-byte budget so the request
  // to the print bridge can never balloon past what it'll accept — once the
  // budget's spent, remaining images are skipped gracefully (order preserved,
  // reported back to the caller as `skipped`) rather than the whole job
  // failing outright.
  const refs = body.images;
  const fetched: Array<{ bytes: Buffer; mime: string } | null> = new Array(refs.length).fill(null);
  let next = 0;
  let budget = PRINT_TOTAL_RAW_BYTES_BUDGET;
  async function worker(): Promise<void> {
    while (next < refs.length) {
      const i = next++;
      if (budget < PRINT_MAX_IMAGE_BYTES) continue; // budget spent: skip gracefully, keep order
      budget -= PRINT_MAX_IMAGE_BYTES;
      const r = refs[i];
      const result = await fetchPrintImageBytes({
        studyInstanceUid: r.studyInstanceUid ?? null,
        seriesInstanceUid: r.seriesInstanceUid ?? null,
        sopInstanceUid: r.sopInstanceUid ?? null,
        frameNumber: r.frameNumber ?? null,
      });
      if (!result) { budget += PRINT_MAX_IMAGE_BYTES; continue; }
      budget += PRINT_MAX_IMAGE_BYTES - result.bytes.length;
      fetched[i] = result;
    }
  }
  await Promise.all(Array.from({ length: Math.min(PRINT_FETCH_CONCURRENCY, refs.length) }, () => worker()));

  const images = fetched
    .filter((f): f is { bytes: Buffer; mime: string } => f !== null)
    .map((f) => `data:${f.mime};base64,${f.bytes.toString("base64")}`);

  // The refs behind the images that actually arrived, in the same order — a
  // failed PACS fetch drops its image, and captions built from the full ref
  // list would then label every following frame with the wrong series.
  const includedRefs = refs.filter((_, i) => fetched[i] !== null);

  if (images.length === 0) {
    res.status(502).json({ error: "Could not fetch any of the requested images from the PACS" });
    return;
  }

  const [clinicRow] = await db.select().from(clinicSettingsTable).limit(1);
  const clinic = clinicRow ? buildPrintClinic(clinicRow) : null;

  // Identify the sheet, but only when every image provably belongs to one
  // study — see singleStudyUidFor. A print that mixes studies goes out
  // unlabelled rather than carrying one patient's name over another's images.
  let patient: PrintPatient | null = null;
  let studyModality = "";
  const studyUid = singleStudyUidFor(refs);
  if (studyUid) {
    const [study] = await db
      .select({
        patientName: dicomStudiesTable.patientName,
        dicomPatientId: dicomStudiesTable.dicomPatientId,
        studyDate: dicomStudiesTable.studyDate,
        modality: dicomStudiesTable.modality,
      })
      .from(dicomStudiesTable)
      .where(eq(dicomStudiesTable.studyInstanceUID, studyUid))
      .limit(1);
    if (study) {
      studyModality = study.modality ?? "";
      patient = {
        name: study.patientName ?? "",
        id: study.dicomPatientId ?? "",
        studyDate: study.studyDate ?? "",
        modality: studyModality,
      };
    }
  }

  // Caption each frame with its series description. Unknown series just get
  // their position on the sheet, which is still worth printing.
  const seriesUids = [...new Set(
    includedRefs.map((r) => (r.seriesInstanceUid || "").trim()).filter(Boolean),
  )];
  const seriesDescriptionByUid: Record<string, string> = {};
  if (seriesUids.length > 0) {
    const rows = await db
      .select({
        uid: dicomStudySeriesTable.seriesInstanceUID,
        description: dicomStudySeriesTable.seriesDescription,
      })
      .from(dicomStudySeriesTable)
      .where(inArray(dicomStudySeriesTable.seriesInstanceUID, seriesUids));
    for (const row of rows) {
      if (row.description) seriesDescriptionByUid[row.uid] = row.description;
    }
  }
  const labels = buildPrintLabels(includedRefs, seriesDescriptionByUid);
  const pageSize = resolvePrintPageSize(body.pageSize, studyModality, process.env);

  const printPayload = buildPrintBridgePayload(
    images, body.copies, body.orientation, body.layout, clinic, patient, labels, pageSize,
  );

  try {
    const printRes = await fetch(`${cfg.printBridge.url}/api/v1/print-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.PRINT_BRIDGE_SECRET}`,
      },
      body: JSON.stringify(printPayload),
      signal: AbortSignal.timeout(15000),
    });
    const printData = (await printRes.json().catch(() => null)) as PrintBridgeResponse | null;

    if (!printRes.ok) {
      res.status(502).json({ error: printData?.error || `Print bridge returned HTTP ${printRes.status}` });
      return;
    }

    void logPacsEvent(
      "PRINT_BRIDGE", "PRINT_REQUESTED",
      `Sent ${images.length} image(s) to the print bridge (${printData?.pages ?? "?"} page(s))`,
      { studyInstanceUID: refs[0]?.studyInstanceUid },
    );

    res.json({
      success: true,
      requested: refs.length,
      fetched: images.length,
      skipped: refs.length - images.length,
      jobKey: printData?.jobKey,
      pages: printData?.pages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not reach the print bridge";
    res.status(502).json({ error: msg });
  }
});

interface PrintJobStatusResponse {
  jobKey?: string;
  status?: "queued" | "processing" | "completed" | "failed";
  pages?: number;
  images?: number;
  copies?: number;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// GET /api/radiology/print-jobs/:jobKey/status
// A print-jobs POST responds as soon as the bridge accepts the job, before
// it's actually printed - this is how the workspace finds out whether it
// went through, failed, or is still in flight, instead of "202" being the
// last word. Just a thin proxy: the bearer secret stays server-side, never
// reaching the browser.
router.get("/print-jobs/:jobKey/status", async (req, res): Promise<void> => {
  const jobKey = req.params.jobKey;
  if (!jobKey) {
    res.status(400).json({ error: "jobKey required" });
    return;
  }

  const cfg = await getRadiologyConfig();
  if (!cfg.printBridge.url || !cfg.printBridge.hasSecret) {
    res.status(503).json({ error: "The print bridge isn't configured" });
    return;
  }

  try {
    const statusRes = await fetch(`${cfg.printBridge.url}/api/v1/print-jobs/${encodeURIComponent(jobKey)}`, {
      headers: { Authorization: `Bearer ${process.env.PRINT_BRIDGE_SECRET}` },
      signal: AbortSignal.timeout(8000),
    });
    const statusData = (await statusRes.json().catch(() => null)) as PrintJobStatusResponse | null;

    if (statusRes.status === 404) {
      res.status(404).json({ error: "Unknown print job" });
      return;
    }
    if (!statusRes.ok) {
      res.status(502).json({ error: statusData?.error || `Print bridge returned HTTP ${statusRes.status}` });
      return;
    }

    res.json(statusData ?? {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not reach the print bridge";
    res.status(502).json({ error: msg });
  }
});

// GET /api/radiology/print-bridge/health
// Live printer/bridge reachability for a small indicator in the print
// picker, so staff see upfront that the printer is offline instead of only
// discovering it after selecting images and clicking Print. Always 200 -
// "reachable"/"printerStatus" in the body carry the actual condition, the
// same convention the bridge's own /api/v1/health uses.
router.get("/print-bridge/health", async (_req, res): Promise<void> => {
  const cfg = await getRadiologyConfig();
  if (!cfg.printBridge.url) {
    res.json({ configured: false, reachable: false, printerStatus: null, printerInfo: null });
    return;
  }

  try {
    const healthRes = await fetch(`${cfg.printBridge.url}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    if (!healthRes.ok) {
      res.json({
        configured: true, reachable: false, printerStatus: null,
        printerInfo: `Bridge returned HTTP ${healthRes.status}`,
      });
      return;
    }
    const data = (await healthRes.json().catch(() => null)) as { printerStatus?: string; printerInfo?: string } | null;
    res.json({
      configured: true,
      reachable: true,
      printerStatus: data?.printerStatus ?? null,
      printerInfo: data?.printerInfo ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not reach the print bridge";
    res.json({ configured: true, reachable: false, printerStatus: null, printerInfo: msg });
  }
});

export const pacsEnterpriseRouter = router;
