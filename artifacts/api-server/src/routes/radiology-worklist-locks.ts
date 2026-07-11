/**
 * radiology-worklist-locks.ts — Ticket M1.6A: claim / heartbeat / release /
 * force-release / read endpoints for study locks.
 *
 * Mounted under /api/radiology (requireStaffAuth + requireStaffPermission
 * ("/radiology") in routes/index.ts), so every request carries a validated
 * staff session — the lock owner identity is ALWAYS server-derived from that
 * session; nothing in a request body can name an owner.
 *
 * Endpoints (relative to /api/radiology):
 *   POST /worklist-lock/:id/claim       { workstation? }
 *   POST /worklist-lock/:id/heartbeat
 *   POST /worklist-lock/:id/release     { reason? }
 *   POST /worklist-lock/:id/force-release { reason? }   — admin/override only
 *   GET  /worklist-lock/:id
 */

import { Router, type Response } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  claimStudy, refreshStudyLock, releaseStudy, forceReleaseStudy, getStudyLock,
  type LockActor,
} from "../lib/studyLocks";

export const radiologyWorklistLocksRouter = Router();

function actorOf(req: StaffAuthRequest): LockActor | null {
  const s = req.staffSession;
  if (!s) return null;
  return { userId: s.subjectId, userName: s.subjectName, role: s.role, permissions: s.permissions };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

radiologyWorklistLocksRouter.post("/worklist-lock/:id/claim", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  if (!id || !actor) { res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist id" }); return; }
  const workstation = typeof (req.body as { workstation?: unknown })?.workstation === "string"
    ? (req.body as { workstation: string }).workstation
    : null;
  const result = await claimStudy(id, actor, workstation);
  // Typed outcomes ride on 200: the REQUEST succeeded even when the CLAIM
  // didn't (the frontend transport surfaces non-2xx as opaque errors, which
  // would discard the outcome). Non-2xx is reserved for transport problems.
  const ok = result.outcome === "CLAIMED" || result.outcome === "ALREADY_OWNED" || result.outcome === "EXPIRED_AND_RECLAIMED";
  res.status(200).json({ success: ok, ...result });
});

radiologyWorklistLocksRouter.post("/worklist-lock/:id/heartbeat", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  if (!id || !actor) { res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist id" }); return; }
  const result = await refreshStudyLock(id, actor);
  res.status(200).json({ success: result.outcome === "REFRESHED", ...result });
});

radiologyWorklistLocksRouter.post("/worklist-lock/:id/release", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  if (!id || !actor) { res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist id" }); return; }
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason : null;
  const result = await releaseStudy(id, actor, { reason });
  // RELEASED and NOT_LOCKED both leave the study unlocked.
  res.status(200).json({ success: result.outcome === "RELEASED" || result.outcome === "NOT_LOCKED", ...result });
});

radiologyWorklistLocksRouter.post("/worklist-lock/:id/force-release", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  const actor = actorOf(req);
  if (!id || !actor) { res.status(400).json({ success: false, outcome: "NOT_FOUND", error: "Invalid worklist id" }); return; }
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason : null;
  const result = await forceReleaseStudy(id, actor, reason);
  // FORBIDDEN is an AUTHORIZATION failure (admin-only override) — unlike the
  // claim-protocol outcomes it rides a real 403.
  res.status(result.outcome === "FORBIDDEN" ? 403 : 200)
    .json({ success: result.outcome === "RELEASED", ...result });
});

radiologyWorklistLocksRouter.get("/worklist-lock/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(String(req.params.id));
  if (!id) { res.status(400).json({ success: false, error: "Invalid worklist id" }); return; }
  const lock = await getStudyLock(id);
  if (!lock) { res.status(404).json({ success: false, error: "Worklist row not found" }); return; }
  res.json({ success: true, lock });
});
