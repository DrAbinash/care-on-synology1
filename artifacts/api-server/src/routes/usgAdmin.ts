/**
 * usgAdmin — the P9 USG Companion admin / rollout control plane (final-integration
 * wiring). Renders the readiness matrix and performs server-ENFORCED, audited
 * flag enablement/rollback. This is the one surface that turns USG phase flags
 * on or off, and it is admin/super_admin only for every mutation.
 *
 * Safe-rollout guarantees enforced here (never merely in the UI):
 *   - a flag cannot be enabled while a dependency flag is OFF;
 *   - a not-yet-clinic-validated phase requires an explicit admin acknowledgement
 *     (force + reason ≥ 3 chars), which is audited;
 *   - disable / kill-switch are always allowed (rollback) and audited.
 *
 * Mounted at /api/usg-admin behind requireStaffAuth + requireStaffPermission("/radiology").
 * The control plane itself is gated by admin ROLE, not by a USG feature flag —
 * you cannot hide the rollout controls behind the very flags they manage.
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { featureFlagsTable, usgAuditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAdminRole } from "../middleware/requireStaffAuth";
import { invalidateFeatureFlagCache } from "../lib/featureFlags";
import { logger } from "../lib/logger";
import {
  loadLiveFlags, buildReadinessMatrix, decideEnable, killSwitchTargets, usgPhaseFlags,
} from "../lib/usgReadinessService";

const router = Router();

type ReqWithStaff = Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } };
function staffOf(req: Request) {
  return (req as ReqWithStaff).staffSession ?? {};
}
function audit(req: Request, action: string, details: Record<string, unknown>) {
  const s = staffOf(req);
  void db.insert(usgAuditLogTable).values({
    entityType: "usg_rollout",
    entityId: null,
    action,
    performedBy: s.subjectName ?? "system",
    performedById: s.subjectId ?? null,
    performedByRole: s.role ?? null,
    studyInstanceUID: null,
    patientId: null,
    details: JSON.stringify(details),
  }).catch((err: unknown) => logger.warn({ err }, "usg-admin audit insert failed"));
}

/** Upsert a feature_flags row (the registry is the source of known keys). */
async function setFlag(key: string, enabled: boolean, actor: string) {
  await db.insert(featureFlagsTable)
    .values({ key, enabled, updatedBy: actor, updatedAt: new Date() })
    .onConflictDoUpdate({ target: featureFlagsTable.key, set: { enabled, updatedBy: actor, updatedAt: new Date() } });
  invalidateFeatureFlagCache();
}

// ── GET /readiness — the rollout matrix (any radiology staff may read) ──────────
router.get("/readiness", async (_req, res) => {
  const live = await loadLiveFlags();
  res.json(buildReadinessMatrix(live));
});

// ── POST /flags/:key/enable — admin only, dependency + validation enforced ──────
router.post("/flags/:key/enable", requireAdminRole, async (req: Request, res) => {
  const key = String(req.params.key);
  const body = (req.body ?? {}) as { force?: boolean; reason?: string };
  if (!usgPhaseFlags().includes(key)) {
    res.status(404).json({ error: `Unknown USG phase flag: ${key}` });
    return;
  }
  const live = await loadLiveFlags();
  const decision = decideEnable(key, live, { force: body.force, reason: body.reason });
  if (!decision.ok) {
    audit(req, "usg_flag_enable_denied", { flag: key, reason: decision.reason, blockers: decision.blockers });
    res.status(409).json({ error: decision.reason, blockers: decision.blockers });
    return;
  }

  await setFlag(key, true, staffOf(req).subjectName ?? "system");
  audit(req, decision.requiresForce ? "usg_flag_enable_forced" : "usg_flag_enable", {
    flag: key,
    forced: decision.requiresForce,
    ...(decision.requiresForce ? { reason: body.reason, acknowledgement: "phase not clinic-validated" } : {}),
  });
  res.json({ enabled: true, forced: decision.requiresForce, matrix: buildReadinessMatrix(await loadLiveFlags()) });
});

// ── POST /flags/:key/disable — admin only, always allowed (rollback) ────────────
router.post("/flags/:key/disable", requireAdminRole, async (req: Request, res) => {
  const key = String(req.params.key);
  if (!usgPhaseFlags().includes(key)) {
    res.status(404).json({ error: `Unknown USG phase flag: ${key}` });
    return;
  }
  const before = await loadLiveFlags();
  const matrixBefore = buildReadinessMatrix(before);
  const status = matrixBefore.flags.find((f) => f.flag === key);

  await setFlag(key, false, staffOf(req).subjectName ?? "system");
  audit(req, "usg_flag_disable", { flag: key, dependentsStillOn: status?.enabledDependents ?? [] });
  res.json({
    enabled: false,
    // Honest warning: dependents left ON now have an unmet dependency.
    dependentsStillOn: status?.enabledDependents ?? [],
    matrix: buildReadinessMatrix(await loadLiveFlags()),
  });
});

// ── POST /kill-switch — admin only, disable every enabled USG flag at once ──────
router.post("/kill-switch", requireAdminRole, async (req: Request, res) => {
  const live = await loadLiveFlags();
  const { disabled } = killSwitchTargets(live);
  const actor = staffOf(req).subjectName ?? "system";
  for (const key of disabled) await setFlag(key, false, actor);
  audit(req, "usg_kill_switch", { disabled });
  res.json({ disabled, matrix: buildReadinessMatrix(await loadLiveFlags()) });
});

export default router;
