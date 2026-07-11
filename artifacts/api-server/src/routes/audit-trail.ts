import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { and, desc, eq, ilike, or, count } from "drizzle-orm";

/**
 * Read-only viewer for the immutable audit trail (audit_logs), surfaced in the
 * main ERP under Settings → Audit Log. Covers login / logout / failed-login /
 * password-change / account-admin events (written by portal.ts + users.ts) as
 * well as every other module that calls auditLog()/auditFromRequest().
 *
 * Mounted behind requireStaffAuth + requireStaffSubPermission("/settings",
 * "security") in routes/index.ts, so only admins / security-permitted staff can
 * read it. The large oldValue/newValue snapshots are intentionally NOT returned
 * in the list to keep payloads small and avoid leaking bulk record contents.
 */
const router = Router();

// GET /api/audit-trail?action=&module=&q=&limit=&offset=
router.get("/", async (req, res) => {
  const action = String(req.query.action ?? "").trim();
  const moduleName = String(req.query.module ?? "").trim();
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds = [];
  if (action) conds.push(eq(auditLogsTable.action, action));
  if (moduleName) conds.push(eq(auditLogsTable.module, moduleName));
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(auditLogsTable.userName, like),
        ilike(auditLogsTable.reason, like),
        ilike(auditLogsTable.entityId, like),
        ilike(auditLogsTable.ipAddress, like),
      ),
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const [rows, totalRes] = await Promise.all([
    db
      .select({
        id: auditLogsTable.id,
        userId: auditLogsTable.userId,
        userName: auditLogsTable.userName,
        role: auditLogsTable.role,
        action: auditLogsTable.action,
        module: auditLogsTable.module,
        entityType: auditLogsTable.entityType,
        entityId: auditLogsTable.entityId,
        reason: auditLogsTable.reason,
        ipAddress: auditLogsTable.ipAddress,
        userAgent: auditLogsTable.userAgent,
        createdAt: auditLogsTable.createdAt,
      })
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLogsTable).where(where),
  ]);

  res.json({ rows, total: Number(totalRes[0]?.total ?? 0), limit, offset });
});

// GET /api/audit-trail/facets — distinct actions & modules for filter dropdowns
router.get("/facets", async (_req, res) => {
  const [actions, modules] = await Promise.all([
    db.selectDistinct({ action: auditLogsTable.action }).from(auditLogsTable),
    db.selectDistinct({ module: auditLogsTable.module }).from(auditLogsTable),
  ]);
  res.json({
    actions: actions.map((a) => a.action).filter(Boolean).sort(),
    modules: modules.map((m) => m.module).filter(Boolean).sort(),
  });
});

export default router;
