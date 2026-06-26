import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyCopilotLogsTable,
  radiologyUserCopilotProfilesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { z } from "zod";

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
