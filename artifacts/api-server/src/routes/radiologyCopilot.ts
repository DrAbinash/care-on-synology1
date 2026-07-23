import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyCopilotLogsTable,
  radiologyUserCopilotProfilesTable,
  radiologyStudiesTable,
  patientReportsTable,
  testsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { type StaffAuthRequest, requireStaffPermission } from "../middleware/requireStaffAuth";
import { z } from "zod";
import { PriorStudiesQuerySchema, type PriorStudiesResponse } from "@workspace/api-zod";
import { mergePriorStudies, type PriorReportRow } from "../lib/priorStudies";

export const radiologyCoPilotRouter = Router();

// Zod validation schemas
const logSchema = z.object({
  studyInstanceUID: z.string().optional(),
  suggestionType: z.string().min(1),
  suggestionContent: z.string().min(1),
  action: z.enum(["dismissed", "accepted"]),
});

const profileUpdateSchema = z.object({
  ignoredWarnings: z.array(z.string()).optional(),
  favoriteTemplates: z.array(z.string()).optional(),
  favoriteChocolateBox: z.array(z.string()).optional(),
});

// ── GET /api/radiology-copilot/prior-studies ──
// Prior studies for the same canonical patient, for the reporting workspace's
// Prior Reports comparison panels. Read-only; radiology-permission gated
// (mount provides requireStaffAuth; full-access roles bypass per convention).
// Two queries total (studies + linked reports) — no N+1.
radiologyCoPilotRouter.get(
  "/prior-studies",
  requireStaffPermission("/radiology"),
  async (req, res) => {
    const parsed = PriorStudiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({
        error: `Invalid prior-studies query: ${first ? `${first.path.join(".") || "query"} — ${first.message}` : "malformed query"}`,
      });
    }
    const { patientId, limit, excludeStudyId } = parsed.data;

    try {
      const filters = [
        eq(radiologyStudiesTable.patientId, patientId),
        ne(radiologyStudiesTable.status, "cancelled"),
      ];
      if (excludeStudyId) filters.push(ne(radiologyStudiesTable.id, excludeStudyId));

      const studies = await db
        .select({
          id: radiologyStudiesTable.id,
          accessionNumber: radiologyStudiesTable.accessionNumber,
          modality: radiologyStudiesTable.modality,
          bodyPart: radiologyStudiesTable.bodyPart,
          studyDate: radiologyStudiesTable.studyDate,
          status: radiologyStudiesTable.status,
          testName: testsTable.name,
          testCode: testsTable.code,
          finalReport: radiologyStudiesTable.finalReport,
          finalReportedBy: radiologyStudiesTable.finalReportedBy,
          finalReportedAt: radiologyStudiesTable.finalReportedAt,
          prelimReport: radiologyStudiesTable.prelimReport,
          prelimReportedBy: radiologyStudiesTable.prelimReportedBy,
          prelimReportedAt: radiologyStudiesTable.prelimReportedAt,
          studyDescription: radiologyStudiesTable.studyDescription,
        })
        .from(radiologyStudiesTable)
        .leftJoin(testsTable, eq(radiologyStudiesTable.testId, testsTable.id))
        .where(and(...filters))
        .orderBy(desc(radiologyStudiesTable.studyDate), desc(radiologyStudiesTable.id))
        .limit(limit);

      let reports: PriorReportRow[] = [];
      const studyIds = studies.map((s) => s.id);
      if (studyIds.length > 0) {
        reports = await db
          .select({
            id: patientReportsTable.id,
            studyId: patientReportsTable.studyId,
            status: patientReportsTable.status,
            impression: patientReportsTable.impression,
            body: patientReportsTable.body,
            createdAt: patientReportsTable.createdAt,
          })
          .from(patientReportsTable)
          .where(
            and(
              eq(patientReportsTable.patientId, patientId),
              eq(patientReportsTable.type, "radiology"),
              inArray(patientReportsTable.studyId, studyIds),
            ),
          );
      }

      const response: PriorStudiesResponse = { studies: mergePriorStudies(studies, reports) };
      return res.json(response);
    } catch (err) {
      req.log.error({ err }, "radiology-copilot: failed to load prior studies");
      return res.status(500).json({ error: "Failed to load prior studies" });
    }
  },
);

// ── POST /api/radiology-copilot/log ──
radiologyCoPilotRouter.post("/log", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const staffName = sReq.staffSession?.subjectName ?? "Unknown";

  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  try {
    const inserted = await db
      .insert(radiologyCopilotLogsTable)
      .values({
        staffName,
        studyInstanceUID: parsed.data.studyInstanceUID ?? null,
        suggestionType: parsed.data.suggestionType,
        suggestionContent: parsed.data.suggestionContent,
        action: parsed.data.action,
      })
      .returning();

    return res.json({ log: inserted[0] });
  } catch (err) {
    req.log.error({ err }, "radiology-copilot: failed to save log");
    return res.status(500).json({ error: "Failed to save co-pilot action log" });
  }
});

// ── GET /api/radiology-copilot/profile ──
radiologyCoPilotRouter.get("/profile", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const staffName = sReq.staffSession?.subjectName;

  if (!staffName) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let profile = await db
      .select()
      .from(radiologyUserCopilotProfilesTable)
      .where(eq(radiologyUserCopilotProfilesTable.staffName, staffName))
      .then((rows) => rows[0]);

    if (!profile) {
      // Create default profile
      const newProfiles = await db
        .insert(radiologyUserCopilotProfilesTable)
        .values({
          staffName,
          ignoredWarnings: [],
          favoriteTemplates: [],
          favoriteChocolateBox: [],
        })
        .returning();
      profile = newProfiles[0];
    }

    return res.json({ profile });
  } catch (err) {
    req.log.error({ err }, "radiology-copilot: failed to get profile");
    return res.status(500).json({ error: "Failed to retrieve co-pilot profile" });
  }
});

// ── PATCH /api/radiology-copilot/profile ──
radiologyCoPilotRouter.patch("/profile", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const staffName = sReq.staffSession?.subjectName;

  if (!staffName) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  try {
    // Get existing profile
    const existing = await db
      .select()
      .from(radiologyUserCopilotProfilesTable)
      .where(eq(radiologyUserCopilotProfilesTable.staffName, staffName))
      .then((rows) => rows[0]);

    let updated;
    if (!existing) {
      updated = await db
        .insert(radiologyUserCopilotProfilesTable)
        .values({
          staffName,
          ignoredWarnings: parsed.data.ignoredWarnings ?? [],
          favoriteTemplates: parsed.data.favoriteTemplates ?? [],
          favoriteChocolateBox: parsed.data.favoriteChocolateBox ?? [],
        })
        .returning();
    } else {
      updated = await db
        .update(radiologyUserCopilotProfilesTable)
        .set({
          ignoredWarnings: parsed.data.ignoredWarnings ?? existing.ignoredWarnings,
          favoriteTemplates: parsed.data.favoriteTemplates ?? existing.favoriteTemplates,
          favoriteChocolateBox: parsed.data.favoriteChocolateBox ?? existing.favoriteChocolateBox,
          updatedAt: new Date(),
        })
        .where(eq(radiologyUserCopilotProfilesTable.staffName, staffName))
        .returning();
    }

    return res.json({ profile: updated[0] });
  } catch (err) {
    req.log.error({ err }, "radiology-copilot: failed to update profile");
    return res.status(500).json({ error: "Failed to update co-pilot profile" });
  }
});
