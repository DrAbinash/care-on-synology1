import { Router } from "express";
import { db } from "@workspace/db";
import { dicomPullAgentLogsTable, dicomPullAgentStatusTable } from "@workspace/db/schema";
import { and, desc, gte, lte, ilike, eq, sql } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

// GET /api/dicom-agent/status — all known agent status rows (most recent heartbeat first)
router.get("/status", async (_req: StaffAuthRequest, res) => {
  const agents = await db
    .select()
    .from(dicomPullAgentStatusTable)
    .orderBy(desc(dicomPullAgentStatusTable.lastHeartbeatAt));
  res.json({ agents });
});

// GET /api/dicom-agent/logs — paginated, filterable log listing
router.get("/logs", async (req: StaffAuthRequest, res) => {
  const page    = Math.max(1, Number(req.query.page   ?? 1));
  const limit   = Math.min(200, Math.max(10, Number(req.query.limit ?? 50)));
  const offset  = (page - 1) * limit;

  const dateFrom  = typeof req.query.dateFrom  === "string" ? req.query.dateFrom  : null;
  const dateTo    = typeof req.query.dateTo    === "string" ? req.query.dateTo    : null;
  const status    = typeof req.query.status    === "string" ? req.query.status    : null;
  const modality  = typeof req.query.modality  === "string" ? req.query.modality  : null;
  const patient   = typeof req.query.patient   === "string" ? req.query.patient   : null;
  const accession = typeof req.query.accession === "string" ? req.query.accession : null;

  const conds = [];
  if (dateFrom)  conds.push(gte(dicomPullAgentLogsTable.createdAt, new Date(`${dateFrom}T00:00:00+05:30`)));
  if (dateTo)    conds.push(lte(dicomPullAgentLogsTable.createdAt, new Date(`${dateTo}T23:59:59.999+05:30`)));
  if (status)    conds.push(eq(dicomPullAgentLogsTable.status, status.toUpperCase()));
  if (modality)  conds.push(eq(dicomPullAgentLogsTable.modality, modality.toUpperCase()));
  if (patient)   conds.push(ilike(dicomPullAgentLogsTable.patientName, `%${patient}%`));
  if (accession) conds.push(ilike(dicomPullAgentLogsTable.accessionNumber, `%${accession}%`));

  const where = conds.length > 0 ? and(...conds) : undefined;

  const [logs, countResult] = await Promise.all([
    db.select()
      .from(dicomPullAgentLogsTable)
      .where(where)
      .orderBy(desc(dicomPullAgentLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(dicomPullAgentLogsTable)
      .where(where),
  ]);

  res.json({ logs, total: countResult[0]?.count ?? 0, page, limit });
});

export default router;
