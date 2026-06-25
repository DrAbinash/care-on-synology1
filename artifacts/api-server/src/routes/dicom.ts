import { Router, type IRouter } from "express";
import { db, dicomNodesTable, dicomPullJobsTable, insertDicomNodeSchema } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";
import { getPacsProvider, tcpProbe } from "../lib/pacs/providers";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

const router: IRouter = Router();

// Defense-in-depth: enforce staff authentication at the router level.
// The /test-connection endpoint performs server-side TCP probes; without auth
// it could be used as an unauthenticated internal network scanner.
router.use(requireStaffAuth);

// Drizzle/node-postgres wraps the underlying PG error, so the SQLSTATE code may
// live on `err`, `err.cause`, or deeper. Walk the chain.
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ("code" in cur && (cur as { code: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|violates unique constraint/i.test(msg);
}

// DICOM PS3.3 C.7.3.1.1.1 modality codes (subset commonly used in diagnostic
// centers). We deliberately exclude colloquial aliases like "MRI"/"USG"/"DR"
// so the registry stores canonical codes — the UI maps them to friendly labels.
const VALID_MODALITIES = new Set([
  "CT", "MR", "CR", "DX", "US", "NM", "PT", "XA", "RF", "MG", "OT", "ES", "ECG",
]);

// ─── Provider info / health ─────────────────────────────────────────────────

router.get("/provider", async (_req, res) => {
  const p = await getPacsProvider();
  const health = await p.health();
  res.json({
    type: p.type,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    capabilities: p.capabilities,
    health,
  });
});

// ─── DICOM Node CRUD ────────────────────────────────────────────────────────

router.get("/nodes", async (_req, res) => {
  const rows = await db.select().from(dicomNodesTable).orderBy(dicomNodesTable.aeTitle);
  res.json({ nodes: rows });
});

router.get("/nodes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }
  res.json(row);
});

const createOrUpdateBody = insertDicomNodeSchema.extend({
  aeTitle: z.string().min(1, "AE Title is required").max(16, "AE Title cannot exceed 16 characters")
    .regex(/^[A-Za-z0-9_\- ]+$/, "AE Title may only contain letters, digits, _, -, space"),
  host: z.string().min(1, "Host is required").max(253),
  port: z.number().int().min(1).max(65535),
  modality: z.string().refine((m) => VALID_MODALITIES.has(m.toUpperCase()), {
    message: `Modality must be one of ${[...VALID_MODALITIES].join(", ")}`,
  }),
  // Auto-pull fields — all optional so old clients don't break
  autoPull: z.boolean().optional(),
  pullIntervalSeconds: z.number().int().min(30).max(86400).optional(),
  queryLookbackHours: z.number().int().min(1).max(720).optional(),
  conquestAeTitle: z.string().max(16).optional(),
  conquestHost: z.string().max(253).optional(),
  conquestPort: z.number().int().min(1).max(65535).optional(),
  preferredRetrieveMethod: z.enum([
    "C_MOVE", "C_GET", "C_STORE", "WATCH_FOLDER",
    "C_STORE_OR_WATCH_FOLDER", "USB_DICOMDIR", "NON_DICOM_JPG_PNG",
  ]).optional(),
  // USG / file-system paths
  watchFolderPath: z.string().max(500).optional(),
  processedFolderPath: z.string().max(500).optional(),
  failedFolderPath: z.string().max(500).optional(),
  // Acquisition & matching flags
  allowNonDicomImages: z.boolean().optional(),
  maxUploadSizeMB: z.number().int().min(1).max(2048).optional(),
  thumbnailPreview: z.boolean().optional(),
  multiFrameSupport: z.boolean().optional(),
  acquisitionModesJson: z.string().max(2000).optional(),
  matchingRulesJson: z.string().max(2000).optional(),
});

router.post("/nodes", async (req, res) => {
  const parsed = createOrUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  try {
    const [created] = await db.insert(dicomNodesTable).values({
      ...data,
      modality: data.modality.toUpperCase(),
      aeTitle: data.aeTitle.trim(),
      host: data.host.trim(),
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `A DICOM node with AE Title '${data.aeTitle.trim()}' already exists` });
      return;
    }
    throw err;
  }
});

router.put("/nodes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = createOrUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const [existing] = await db.select().from(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }
  try {
    const updatePayload: Record<string, unknown> = {
      ...data,
      modality: data.modality.toUpperCase(),
      aeTitle: data.aeTitle.trim(),
      host: data.host.trim(),
    };
    if (data.preferredRetrieveMethod) updatePayload.preferredRetrieveMethod = data.preferredRetrieveMethod;
    const [updated] = await db.update(dicomNodesTable).set(updatePayload).where(eq(dicomNodesTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `A DICOM node with AE Title '${data.aeTitle.trim()}' already exists` });
      return;
    }
    throw err;
  }
});

router.delete("/nodes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }
  await db.delete(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  res.status(204).send();
});

// ─── Connection test (TCP reachability) ─────────────────────────────────────

router.post("/nodes/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [node] = await db.select().from(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  if (!node) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }
  const result = await tcpProbe(node.host, node.port, 4000);
  await db.update(dicomNodesTable).set({
    lastTestAt: new Date(),
    lastTestStatus: result.ok ? "success" : "failed",
    lastTestMessage: result.message,
    lastTestLatencyMs: result.latencyMs,
  }).where(eq(dicomNodesTable.id, id));
  res.json({
    ok: result.ok,
    latencyMs: result.latencyMs,
    message: result.message,
    note: "TCP reachability probe — confirms the host is listening on the configured port. A full DICOM C-ECHO requires DIMSE protocol support.",
  });
});

// Test arbitrary host:port without persisting (used during the create form).
router.post("/test-connection", async (req, res) => {
  const body = z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "host and port required" });
    return;
  }
  const result = await tcpProbe(body.data.host, body.data.port, 4000);
  res.json(result);
});

// ─── Pull Jobs ───────────────────────────────────────────────────────────────
// Staff-accessible pull job management. The actual execution happens in the
// DICOM Pull Agent (dicom-pull-agent/) via the /api/internal/dicom/* endpoints.

// List all pull jobs, optionally filtered by nodeId
router.get("/pull-jobs", async (req, res) => {
  const nodeId = req.query.nodeId ? Number(req.query.nodeId) : null;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const rows = nodeId
    ? await db.select().from(dicomPullJobsTable)
        .where(eq(dicomPullJobsTable.nodeId, nodeId))
        .orderBy(desc(dicomPullJobsTable.createdAt))
        .limit(limit)
    : await db.select().from(dicomPullJobsTable)
        .orderBy(desc(dicomPullJobsTable.createdAt))
        .limit(limit);

  res.json({ jobs: rows });
});

// Manually trigger a pull job for a node
router.post("/nodes/:id/pull", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [node] = await db.select().from(dicomNodesTable).where(eq(dicomNodesTable.id, id));
  if (!node) {
    res.status(404).json({ error: "DICOM node not found" });
    return;
  }
  if (!node.isActive) {
    res.status(409).json({ error: "Node is disabled" });
    return;
  }

  // Check for already-pending job on this node to avoid duplicate queuing
  const [existing] = await db.select().from(dicomPullJobsTable)
    .where(and(eq(dicomPullJobsTable.nodeId, id), eq(dicomPullJobsTable.status, "pending")))
    .limit(1);
  if (existing) {
    res.json({ job: existing, alreadyQueued: true });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const hoursBack = node.queryLookbackHours ?? 24;
  const daysBack = Math.max(1, Math.ceil(hoursBack / 24));
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (daysBack - 1));
  fromDate.setHours(0, 0, 0, 0);
  const fromStr = fromDate.toISOString().split("T")[0];

  const [job] = await db.insert(dicomPullJobsTable).values({
    nodeId: id,
    triggerType: "manual",
    status: "pending",
    queryDateFrom: fromStr,
    queryDateTo: today,
  }).returning();

  res.status(201).json({ job });
});

// Cancel a pending job
router.delete("/pull-jobs/:jobId", async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) {
    res.status(400).json({ error: "Invalid jobId" });
    return;
  }
  const [job] = await db.select().from(dicomPullJobsTable).where(eq(dicomPullJobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "pending") {
    res.status(409).json({ error: `Cannot cancel job in status '${job.status}'` });
    return;
  }
  await db.update(dicomPullJobsTable).set({ status: "failed", errorMessage: "Cancelled by staff" })
    .where(eq(dicomPullJobsTable.id, jobId));
  res.json({ ok: true });
});

export default router;
