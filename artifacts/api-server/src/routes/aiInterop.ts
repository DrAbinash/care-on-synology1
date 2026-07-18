/**
 * AI Enterprise Interoperability routes — Phase P4 / Gate G22.
 * Mounted at /api/ai/interop (staff-auth + /radiology permission upstream).
 *
 * The enterprise API surface: immutable AI timeline, provisional versions +
 * comparison, evidence anchors + viewer deep-links, structured-report (DICOM
 * SR) and FHIR export, and the human feedback dataset. EVERY endpoint is gated
 * by the same master flag + per-scope policy as the clinical router (default
 * OFF). Reads require radiologist visibility; export/admin actions require a
 * full-access role. Nothing here signs, writes patient_reports, or retrains.
 */
import { Router, type Request } from "express";
import { z } from "zod/v4";
import { FULL_ACCESS_ROLES, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { resolveAiEnablementForUser } from "../lib/ai/clinicalConfigService";
import {
  getStudyTimeline, listVersions, compareVersions, exportStructuredReport, exportFhir,
  getFeedbackDataset, getInteropStatus, getStudyEvidenceAnchors,
} from "../lib/ai/interop/interopService";
import { buildFindingViewerLinks } from "../lib/ai/interop/viewerDeepLinks";

export const aiInteropRouter = Router();

function staff(req: Request) {
  return (req as StaffAuthRequest).staffSession ?? null;
}
function isAdmin(req: Request): boolean {
  const s = staff(req);
  return !!s && FULL_ACCESS_ROLES.has(s.role);
}
/** Reads are visible only when AI is pilot/production for this user. */
async function requireVisible(req: Request, res: import("express").Response): Promise<boolean> {
  const s = staff(req);
  const modality = typeof req.query.modality === "string" ? req.query.modality : null;
  const enablement = await resolveAiEnablementForUser({ staffId: s?.id ?? null, modality });
  if (!enablement.visibleToRadiologist) { res.status(204).end(); return false; }
  return true;
}
function requireAdmin(req: Request, res: import("express").Response): boolean {
  if (!isAdmin(req)) { res.status(403).json({ error: "admin role required" }); return false; }
  return true;
}
/**
 * Export/PHI-egress actions (DICOM SR, FHIR, feedback dataset) require BOTH a
 * full-access role AND that AI is enabled (master flag on). Without the second
 * check these endpoints stayed live even with ff_radiology_ai OFF — the
 * documented default-OFF kill-switch must also cover the export surface (P5 fix).
 */
async function requireAdminAndEnabled(req: Request, res: import("express").Response): Promise<boolean> {
  if (!requireAdmin(req, res)) return false;
  const s = staff(req);
  const enablement = await resolveAiEnablementForUser({ staffId: s?.id ?? null, modality: null });
  if (!enablement.enabled) { res.status(403).json({ error: "AI is not enabled (ff_radiology_ai is off)" }); return false; }
  return true;
}

// ── G19: immutable AI timeline ───────────────────────────────────────────────
aiInteropRouter.get("/timeline", async (req, res) => {
  if (!(await requireVisible(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : "";
  if (!uid) { res.status(400).json({ error: "studyInstanceUid required" }); return; }
  res.json(await getStudyTimeline(uid));
});

// ── provisional versions (metadata) ──────────────────────────────────────────
aiInteropRouter.get("/versions", async (req, res) => {
  if (!(await requireVisible(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : "";
  if (!uid) { res.status(400).json({ error: "studyInstanceUid required" }); return; }
  res.json(await listVersions(uid));
});

// ── G20: compare two AI versions ─────────────────────────────────────────────
aiInteropRouter.get("/comparison", async (req, res) => {
  if (!(await requireVisible(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : "";
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!uid || !Number.isInteger(from) || !Number.isInteger(to)) {
    res.status(400).json({ error: "studyInstanceUid, from, to required" }); return;
  }
  const result = await compareVersions(uid, from, to);
  if (!result) { res.status(404).json({ error: "one or both versions not found" }); return; }
  res.json(result);
});

// ── evidence anchors + viewer deep-links (G18 sync) ──────────────────────────
aiInteropRouter.get("/evidence", async (req, res) => {
  if (!(await requireVisible(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : "";
  if (!uid) { res.status(400).json({ error: "studyInstanceUid required" }); return; }
  const anchors = await getStudyEvidenceAnchors(uid);
  const ohifBase = typeof req.query.ohifBase === "string" ? req.query.ohifBase : "";
  const wadoBase = typeof req.query.wadoBase === "string" ? req.query.wadoBase : null;
  const links = ohifBase
    ? buildFindingViewerLinks(ohifBase, wadoBase, anchors.map((a) => ({
        key: a.key, studyInstanceUid: a.studyInstanceUid, seriesInstanceUid: a.seriesInstanceUid,
        sopInstanceUid: a.sopInstanceUid, frameNumber: a.frameNumber,
      })))
    : [];
  res.json({ anchors, links });
});

// ── interop status (SR/PDF/MPPS/storage-commitment) ──────────────────────────
aiInteropRouter.get("/status", async (req, res) => {
  if (!(await requireVisible(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : "";
  if (!uid) { res.status(400).json({ error: "studyInstanceUid required" }); return; }
  res.json(await getInteropStatus(uid));
});

// ── G12: structured-report (DICOM SR) export — admin-gated write ─────────────
aiInteropRouter.post("/structured-report", async (req, res) => {
  if (!(await requireAdminAndEnabled(req, res))) return;
  const parsed = z.object({ studyInstanceUid: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staff(req);
  const result = await exportStructuredReport(parsed.data.studyInstanceUid, { id: s?.id ?? null, name: s?.subjectName ?? null });
  res.status(result.ok ? 200 : 422).json(result);
});

// ── G17: FHIR export (backend log; no external send) — admin-gated write ─────
aiInteropRouter.post("/fhir-export", async (req, res) => {
  if (!(await requireAdminAndEnabled(req, res))) return;
  const parsed = z.object({ studyInstanceUid: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const result = await exportFhir(parsed.data.studyInstanceUid);
  res.status(result.ok ? 200 : 422).json(result);
});

// ── G21: human feedback dataset (analytics/export only; admin-gated) ─────────
aiInteropRouter.get("/feedback-dataset", async (req, res) => {
  if (!(await requireAdminAndEnabled(req, res))) return;
  const uid = typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  res.json(await getFeedbackDataset({ studyInstanceUid: uid, action }));
});
