/**
 * pacsEnterprise.ts
 * Enterprise PACS/RIS routes — Parts 1–7 of the enterprise upgrade.
 *
 * Mounted at /api/radiology by routes/index.ts, behind
 * requireStaffAuth + requireStaffPermission("/orders").
 */
import { Router } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import { tcpProbe } from "../lib/pacs/providers.js";
import { testNodeConnection } from "../services/dicom-pull-agent/dimse-agent";
import { getRadiologyConfig } from "../lib/pacs/pacsConfig.js";
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
    const tcpResult = await tcpProbe(host, port, 5000);
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

// ─── ROUTING RULES ────────────────────────────────────────────────────────────

const DEFAULT_VIEWER_SETTINGS: Record<string, string> = {
  ohif_base_url: "http://192.168.1.137:3010",
  dicom_web_base_url: "http://192.168.1.137:8042/dicom-web",
  ohif_study_url_template: "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
  wado_uri_base_url: "http://192.168.1.137:8042/wado",
  weasis_manifest_url_template: 'weasis://$dicom:get -w "http://192.168.1.137:8042/wado?studyUID={studyInstanceUID}"',
  pacs_ip: "192.168.1.137",
  pacs_port: "5678",
  pacs_ae_title: "ORTHANC",
  viewer_mode: "BOTH",
  default_viewer: "OHIF",
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
// Redirects client browser to local weasis:// protocol handler directly
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

router.get("/studies/:studyInstanceUID/ohif-launch", async (req, res) => {
  const { studyInstanceUID } = req.params;
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
      dicomWebBaseUrl: dicomWebUrl || null,
      pacsType,
    });
    return;
  }

  const ohifUrl = studyTemplate
    ? studyTemplate
        .replace(/\{OHIF_BASE_URL\}/g, ohifBase.replace(/\/$/, ""))
        .replace(/\{studyInstanceUID\}/g, encodeURIComponent(studyInstanceUID))
    : `${ohifBase.replace(/\/$/, "")}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;

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

  void logPacsEvent("OHIF_VIEWER_LAUNCH", "VIEWER_LAUNCHED", `OHIF viewer launched for study ${studyInstanceUID}`, {
    studyInstanceUID,
    accessionNumber,
  });

  res.json({
    studyInstanceUID,
    patientName,
    accessionNumber,
    viewerType: "OHIF",
    ohifUrl,
    dicomWebBaseUrl: dicomWebUrl,
    pacsType,
  });
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

  res.json(row);
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
    accessionNumber: string;
    studyInstanceUID: string | null;
    modality: string;
    patientName: string | null;
    patientId: number | null;
    studyDate: string | null;
    referringDoctor: string | null;
    status: string;
    source: string;
  };

  const byAccession = new Map<string, QrRow>();
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

router.patch("/network/settings", async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    
    for (const [key, val] of Object.entries(body)) {
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
        .select({ id: pacsSettingsTable.id })
        .from(pacsSettingsTable)
        .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, category)))
        .limit(1);

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
    }

    res.json({ ok: true });
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

    // run probes concurrently
    const [orthancHttp, orthancDicom, ohifHttp, weasisWado, conquestDicom, ollamaAi] = await Promise.all([
      // Orthanc HTTP
      fetchWithTimeout(cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, "/system")),
      // Orthanc DICOM Port
      tcpProbe(cfg.orthanc.ip, cfg.orthanc.dicomPort),
      // OHIF
      fetchWithTimeout(cfg.ohif.baseUrl),
      // Weasis WADO
      fetchWithTimeout(cfg.weasis.wadoUrl),
      // Conquest DICOM
      cfg.conquest.ip ? tcpProbe(cfg.conquest.ip, cfg.conquest.dicomPort) : Promise.resolve({ ok: false, latencyMs: 0, message: "Conquest IP not set" }),
      // Ollama AI
      fetchWithTimeout("http://192.168.1.250:11434/api/tags").then(res => 
        res.ok ? res : fetchWithTimeout("http://172.16.1.140:11434/api/tags") // fallback
      )
    ]);

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      services: {
        orthancHttp: {
          name: "Orthanc REST API",
          endpoint: cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, ""),
          status: orthancHttp.ok ? "green" : "red",
          details: orthancHttp.ok ? "Reachable" : orthancHttp.error || "HTTP Error",
        },
        orthancDicom: {
          name: "Orthanc DICOM Port",
          endpoint: `${cfg.orthanc.ip}:${cfg.orthanc.dicomPort}`,
          status: orthancDicom.ok ? "green" : "red",
          details: orthancDicom.message,
        },
        ohifHttp: {
          name: "OHIF Viewer Base",
          endpoint: cfg.ohif.baseUrl,
          status: ohifHttp.ok ? "green" : "red",
          details: ohifHttp.ok ? "Reachable" : ohifHttp.error || "HTTP Error",
        },
        weasisWado: {
          name: "Weasis WADO Server",
          endpoint: cfg.weasis.wadoUrl,
          status: weasisWado.ok ? "green" : "red",
          details: weasisWado.ok ? "Reachable" : weasisWado.error || "HTTP Error",
        },
        conquestDicom: {
          name: "Conquest DICOM SCP",
          endpoint: cfg.conquest.ip ? `${cfg.conquest.ip}:${cfg.conquest.dicomPort}` : "Unconfigured",
          status: !cfg.conquest.ip ? "yellow" : conquestDicom.ok ? "green" : "red",
          details: !cfg.conquest.ip ? "Conquest IP not configured" : conquestDicom.message,
        },
        ollamaAi: {
          name: "Ollama AI (Radiology Copilot)",
          endpoint: "http://192.168.1.250:11434",
          status: ollamaAi.ok ? "green" : "yellow",
          details: ollamaAi.ok ? "Reachable" : "Offline / Unreachable (radiology copilot will fail)",
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

    // Check for Docker Bridge IP leaks
    const isBridgeIp = (ip: string) => ip.startsWith("172.16.1.") || ip.startsWith("172.");
    
    if (isBridgeIp(cfg.orthanc.ip)) {
      warnings.push("Orthanc IP uses Docker bridge network (172.x.x.x) which is unreachable by LAN workstations.");
    }
    if (isBridgeIp(cfg.conquest.ip)) {
      warnings.push("Conquest IP uses Docker bridge network (172.x.x.x) which is unreachable by LAN workstations.");
    }
    if (cfg.ohif.baseUrl.includes("172.16.1.")) {
      warnings.push("OHIF Base URL uses Docker bridge IP (172.x.x.x) - browser clients will fail to launch OHIF.");
    }
    if (cfg.weasis.wadoUrl.includes("172.16.1.")) {
      warnings.push("Weasis WADO endpoint uses Docker bridge IP (172.x.x.x) - local Weasis installations cannot read scans.");
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

export const pacsEnterpriseRouter = router;
