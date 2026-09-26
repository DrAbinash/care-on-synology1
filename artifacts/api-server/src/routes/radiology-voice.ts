/**
 * radiology-voice.ts — Ticket M1.6B2 Phase 11: high-risk voice-command audit.
 *
 * Mounted under /api/radiology (requireStaffAuth + requireStaffPermission
 * ("/radiology")). The frontend voice layer reports HIGH_RISK command
 * attempts (finalize/verify) and their outcomes into the hash-chained audit
 * log with MINIMAL metadata: command type, actor (server-derived from the
 * staff session), study id, outcome, timestamp. Never the transcript, never
 * audio — dictated clinical text is not diagnostic telemetry.
 *
 *   POST /voice-command-audit  { commandType, studyId, outcome }
 */

import { Router, type Response } from "express";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";

export const radiologyVoiceRouter = Router();

const AUDITED_COMMANDS = new Set(["finalize", "verify"]);
const OUTCOMES = new Set(["executed", "cancelled", "rejected"]);

radiologyVoiceRouter.post("/voice-command-audit", async (req: StaffAuthRequest, res: Response) => {
  const s = req.staffSession;
  if (!s) { res.status(401).json({ success: false, error: "No session" }); return; }
  const body = (req.body ?? {}) as { commandType?: unknown; studyId?: unknown; outcome?: unknown };
  const commandType = typeof body.commandType === "string" ? body.commandType : "";
  const outcome = typeof body.outcome === "string" ? body.outcome : "";
  const studyId = Number(body.studyId);
  if (!AUDITED_COMMANDS.has(commandType) || !OUTCOMES.has(outcome) || !Number.isInteger(studyId) || studyId <= 0) {
    res.status(400).json({ success: false, error: "commandType (finalize|verify), outcome (executed|cancelled|rejected) and studyId are required" });
    return;
  }
  await auditFromRequest(req, {
    userId: s.subjectId,
    userName: s.subjectName,
    role: s.role,
    action: "voice_command",
    module: "radiology",
    entityType: "radiology_worklist",
    entityId: String(studyId),
    newValue: JSON.stringify({ commandType, outcome, source: "voice" }),
  });
  res.json({ success: true });
});

/**
 * Best-effort workspace UX telemetry (open→sign, abnormal strip, format apply).
 * Accepts a small batch; never stores transcripts. 204 even on soft failure so
 * the reporting loop is never blocked.
 */
radiologyVoiceRouter.post("/workspace-telemetry", async (req: StaffAuthRequest, res: Response) => {
  const s = req.staffSession;
  if (!s) { res.status(401).json({ success: false, error: "No session" }); return; }
  const body = (req.body ?? {}) as { events?: unknown };
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  if (events.length === 0) {
    res.status(204).end();
    return;
  }
  try {
    req.log?.info?.(
      { count: events.length, sampleType: (events[0] as { type?: string })?.type ?? null },
      "[workspace-telemetry] batch",
    );
  } catch { /* ignore */ }
  res.status(204).end();
});
