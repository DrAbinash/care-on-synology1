import { Router } from "express";
import { z } from "zod/v4";
import { db, auditLogsTable } from "@workspace/db";
import { desc, and, gte, lte, eq, like, sql, count } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { requireSuperAdminUsb } from "../middleware/requireSuperAdminUsb";
import { logger } from "../lib/logger";

const router = Router();

// Super-admin only — immutable audit trail
router.use(requireSuperAdminUsb);
router.use(requireSuperAdmin);

const ListQuery = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(50),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.coerce.number().positive().optional(),
  userName: z.string().trim().optional(),
  module: z.string().trim().optional(),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
});

router.get("/", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  const q = parsed.data;

  const conditions = [];
  if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(q.from + "T00:00:00")));
  if (q.to) conditions.push(lte(auditLogsTable.createdAt, new Date(q.to + "T23:59:59")));
  if (q.userId) conditions.push(eq(auditLogsTable.userId, q.userId));
  if (q.userName) conditions.push(like(auditLogsTable.userName, `%${q.userName}%`));
  if (q.module) conditions.push(eq(auditLogsTable.module, q.module));
  if (q.action) conditions.push(eq(auditLogsTable.action, q.action));
  if (q.entityType) conditions.push(eq(auditLogsTable.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLogsTable.entityId, q.entityId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (q.page - 1) * q.pageSize;

  try {
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(q.pageSize)
        .offset(offset),
      db.select({ count: count() }).from(auditLogsTable).where(where),
    ]);

    res.json({
      data: rows,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total: total[0]?.count ?? 0,
        totalPages: Math.ceil((total[0]?.count ?? 0) / q.pageSize),
      },
    });
  } catch (err) {
    logger.error({ err }, "Audit log query failed");
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});


// GET /api/admin/audit-logs/export — CSV export of filtered rows (capped at 10k)
router.get("/export", async (req, res) => {
  const q = req.query;
  const conditions = [];
  if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(String(q.from) + "T00:00:00")));
  if (q.to) conditions.push(lte(auditLogsTable.createdAt, new Date(String(q.to) + "T23:59:59")));
  if (q.userId) conditions.push(eq(auditLogsTable.userId, Number(q.userId)));
  if (q.userName) conditions.push(like(auditLogsTable.userName, `%${String(q.userName)}%`));
  if (q.module) conditions.push(eq(auditLogsTable.module, String(q.module)));
  if (q.action) conditions.push(eq(auditLogsTable.action, String(q.action)));
  if (q.entityType) conditions.push(eq(auditLogsTable.entityType, String(q.entityType)));
  if (q.entityId) conditions.push(eq(auditLogsTable.entityId, String(q.entityId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(10000);

    const header = "ID,Timestamp,User,Role,Action,Module,EntityType,EntityId,Reason,IP\n";
    const csv = rows
      .map((r) =>
        [
          r.id,
          r.createdAt ? new Date(r.createdAt).toISOString() : "",
          `"${(r.userName ?? "").replace(/"/g, '""')}"`,
          r.role,
          r.action,
          r.module,
          r.entityType ?? "",
          r.entityId ?? "",
          `"${(r.reason ?? "").replace(/"/g, '""')}"`,
          r.ipAddress ?? "",
        ].join(","),
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(header + csv);
  } catch (err) {
    logger.error({ err }, "Audit export failed");
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

export { router as auditLogsRouter };
