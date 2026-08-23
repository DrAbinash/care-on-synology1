// ============================================================================
// Electronic Film API — ingest status, reconciliation, preview, HOPE delivery.
// ============================================================================
import { Router, type Response } from "express";
import path from "node:path";
import { existsSync, createReadStream } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, electronicFilmArtifactsTable, radiologyStudiesTable } from "@workspace/db";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  getElectronicFilmSettings,
  updateElectronicFilmSettings,
  ensureImportCutover,
} from "../services/electronicFilm/settings";
import { pollElectronicFilmJobs, manualMatchFilm } from "../services/electronicFilm/poller";
import { getMatchCandidatesForArtifact } from "../services/electronicFilm/matcher";
import { enqueueElectronicFilmToHope } from "../services/electronicFilm/hopeEmitter";
import {
  runElectronicFilmPipelineSelfTest,
  buildDiagnosticReport,
} from "../services/electronicFilm/diagnostics";

const UPLOAD_BASE_DIR = path.join(process.cwd(), "data", "uploads");

function resolveInsideUploadDir(filePath: string): string | null {
  const resolvedBase = path.resolve(UPLOAD_BASE_DIR);
  const resolved = path.resolve(resolvedBase, filePath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) return null;
  if (!existsSync(resolved)) return null;
  return resolved;
}

export const electronicFilmRouter = Router();

electronicFilmRouter.get("/settings", requireStaffAuth, async (_req, res: Response) => {
  const settings = await getElectronicFilmSettings();
  res.json({ settings });
});

const SettingsPatch = z.object({
  integrationEnabled: z.boolean().optional(),
  autoImport: z.boolean().optional(),
  autoSendHope: z.boolean().optional(),
  importEnabledAt: z.string().nullable().optional(),
  pollIntervalSeconds: z.number().int().min(30).max(3600).optional(),
  bridgeUrl: z.string().optional(),
  bridgeSecret: z.string().optional(),
  activateCutoverNow: z.boolean().optional(),
});

electronicFilmRouter.put("/settings", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  const parsed = SettingsPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings", details: parsed.error.issues });
    return;
  }
  if (parsed.data.activateCutoverNow) {
    await ensureImportCutover();
  }
  const settings = await updateElectronicFilmSettings(parsed.data, parsed.data.bridgeSecret);
  res.json({ settings });
});

electronicFilmRouter.post("/poll", requireStaffAuth, async (_req, res: Response) => {
  const result = await pollElectronicFilmJobs();
  res.json({ ok: true, result });
});

electronicFilmRouter.post("/self-test", requireStaffAuth, async (_req, res: Response) => {
  const result = await runElectronicFilmPipelineSelfTest();
  res.json(result);
});

electronicFilmRouter.get("/match-required", requireStaffAuth, async (_req, res: Response) => {
  const rows = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.ingestStatus, "MATCH_REQUIRED"))
    .orderBy(desc(electronicFilmArtifactsTable.importedAt))
    .limit(50);
  res.json({ artifacts: rows });
});

electronicFilmRouter.get("/study/:studyId", requireStaffAuth, async (req, res: Response) => {
  const studyId = Number(req.params.studyId);
  const rows = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.studyId, studyId))
    .orderBy(desc(electronicFilmArtifactsTable.version));
  const current = rows.find((r) => r.isCurrent) ?? null;
  res.json({ artifacts: rows, current });
});

electronicFilmRouter.get("/:id", requireStaffAuth, async (req, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(electronicFilmArtifactsTable).where(eq(electronicFilmArtifactsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const candidates = row.ingestStatus === "MATCH_REQUIRED" ? await getMatchCandidatesForArtifact(id) : [];
  res.json({ artifact: row, candidates });
});

electronicFilmRouter.get("/:id/trace", requireStaffAuth, async (req, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(electronicFilmArtifactsTable).where(eq(electronicFilmArtifactsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    trace: {
      dicomToWindows: {
        jobKey: row.sourceJobKey,
        imageCount: row.imageCount,
        pageCount: row.pageCount,
        identitySummary: row.identitySummary,
        sourceAe: row.sourceAe,
      },
      identity: {
        accessionPresent: !!row.accessionNumber,
        studyUidPresent: !!row.studyInstanceUid,
        matchMethod: row.matchMethod,
        matchRequired: row.ingestStatus === "MATCH_REQUIRED",
      },
      care: {
        ingestStatus: row.ingestStatus,
        studyId: row.studyId,
        stored: row.filePath != null,
        version: row.version,
        isCurrent: row.isCurrent,
      },
      hope: {
        deliveryStatus: row.hopeDeliveryStatus,
        sentAt: row.hopeSentAt,
        outboxId: row.emittedOutboxId,
      },
    },
    diagnosticReport: buildDiagnosticReport(row),
  });
});

electronicFilmRouter.get("/:id/diagnostic-report", requireStaffAuth, async (req, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(electronicFilmArtifactsTable).where(eq(electronicFilmArtifactsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ report: buildDiagnosticReport(row) });
});

electronicFilmRouter.get("/:id/artifact", requireStaffAuth, async (req, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(electronicFilmArtifactsTable).where(eq(electronicFilmArtifactsTable.id, id)).limit(1);
  if (!row?.filePath) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  const resolved = resolveInsideUploadDir(row.filePath);
  if (!resolved) {
    res.status(404).json({ error: "File missing" });
    return;
  }
  res.setHeader("Content-Type", row.mimeType || "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${row.fileName || "electronic-film.pdf"}"`);
  createReadStream(resolved).pipe(res);
});

// Public token access for HOPE / signed links — mounted at /electronic-film/public/:token
export const electronicFilmPublicRouter = Router();

electronicFilmPublicRouter.get("/:token", async (req, res: Response) => {
  const token = req.params.token;
  const [row] = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.accessToken, token))
    .limit(1);
  if (!row?.filePath) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const resolved = resolveInsideUploadDir(row.filePath);
  if (!resolved) {
    res.status(404).json({ error: "File missing" });
    return;
  }
  res.setHeader("Content-Type", row.mimeType || "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${row.fileName || "electronic-film.pdf"}"`);
  createReadStream(resolved).pipe(res);
});

const MatchBody = z.object({ studyId: z.number().int().positive() });

electronicFilmRouter.post("/:id/match", requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const parsed = MatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "studyId required" });
    return;
  }
  const result = await manualMatchFilm(id, parsed.data.studyId, req.staff?.name ?? req.staff?.username ?? "staff");
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

electronicFilmRouter.post("/:id/send-hope", requireStaffAuth, async (req, res: Response) => {
  const id = Number(req.params.id);
  const result = await enqueueElectronicFilmToHope(id, { force: true });
  res.json(result);
});

export default electronicFilmRouter;
