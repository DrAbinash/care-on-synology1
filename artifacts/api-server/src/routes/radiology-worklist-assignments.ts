/**
 * radiology-worklist-assignments.ts — Ticket M1.6B1: assignment endpoints.
 *
 * Mounted under /api/radiology (requireStaffAuth + requireStaffPermission
 * ("/radiology")). Actor identity is server-derived; typed outcomes ride on
 * 200 (same protocol as the M1.6A lock routes); FORBIDDEN rides 403.
 *
 *   POST /worklist-assignment/:id/assign    { radiologistId, reason? }
 *   POST /worklist-assignment/:id/unassign  { reason? }
 *   GET  /worklist-assignment/:id
 *   GET  /radiologists
 *   GET  /workload
 */

import { Router, type Response } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  assignStudy, getAssignment, listRadiologists, workloadSummary,
  type AssignmentActor,
} from "../lib/studyAssignments";

export const radiologyWorklistAssignmentsRouter = Router();

function actorOf(req: StaffAuthRequest): AssignmentActor | null {
  const s = req.staffSession;
  if (!s) return null;
  return { userId: s.subjectId, userName: s.subjectName, role: s.role, permissions: s.permissions };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const OK_OUTCOMES = new Set(["ASSIGNED", "REASSIGNED", "UNASSIGNED", "ALREADY_ASSIGNED"]);

radiologyWorklistAssignmentsRouter.post("/worklist-assignment/:id/assign", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  const body = (req.body ?? {}) as { radiologistId?: unknown; reason?: unknown };
  const radiologistId = Number(body.radiologistId);
  if (!id || !actor || !Number.isInteger(radiologistId) || radiologistId <= 0) {
    res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist or radiologist id" });
    return;
  }
  const reason = typeof body.reason === "string" ? body.reason : null;
  const result = await assignStudy(id, actor, radiologistId, reason);
  res.status(result.outcome === "FORBIDDEN" ? 403 : 200)
    .json({ success: OK_OUTCOMES.has(result.outcome), ...result });
});

radiologyWorklistAssignmentsRouter.post("/worklist-assignment/:id/unassign", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  if (!id || !actor) { res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist id" }); return; }
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason : null;
  const result = await assignStudy(id, actor, null, reason);
  res.status(result.outcome === "FORBIDDEN" ? 403 : 200)
    .json({ success: OK_OUTCOMES.has(result.outcome), ...result });
});

radiologyWorklistAssignmentsRouter.get("/worklist-assignment/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  if (!id) { res.status(400).json({ success: false, error: "Invalid worklist id" }); return; }
  const assignment = await getAssignment(id);
  if (!assignment) { res.status(404).json({ success: false, error: "Worklist row not found" }); return; }
  res.json({ success: true, assignment });
});

radiologyWorklistAssignmentsRouter.get("/radiologists", async (_req: StaffAuthRequest, res: Response) => {
  res.json({ success: true, radiologists: await listRadiologists() });
});

radiologyWorklistAssignmentsRouter.get("/workload", async (_req: StaffAuthRequest, res: Response) => {
  res.json({ success: true, ...(await workloadSummary()) });
});
