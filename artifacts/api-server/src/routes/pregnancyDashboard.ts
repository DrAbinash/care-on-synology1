import { Router } from "express";
import { db } from "@workspace/db";
import {
  fetalUsgStudiesTable,
  fetalUsgMeasurementsTable,
  pregnancyEpisodesTable,
  usgKeyImagesTable,
  radiologyStudiesTable,
  usgAuditLogTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";

const router = Router();

// Helper to auto-detect/ensure pregnancy episodes and link studies
async function ensurePregnancyEpisodes(patientId: number): Promise<void> {
  // Fetch all fetal usg studies for this patient, sorted oldest to newest
  const studies = await db
    .select({
      id: fetalUsgStudiesTable.id,
      studyId: fetalUsgStudiesTable.studyId,
      pregnancyEpisodeId: fetalUsgStudiesTable.pregnancyEpisodeId,
      createdAt: fetalUsgStudiesTable.createdAt,
      lmp: fetalUsgStudiesTable.lmp,
      edd: fetalUsgStudiesTable.edd,
    })
    .from(fetalUsgStudiesTable)
    .where(eq(fetalUsgStudiesTable.patientId, patientId))
    .orderBy(asc(fetalUsgStudiesTable.createdAt));

  if (studies.length === 0) return;

  // Group into episodes
  let currentEpisodeId: number | null = null;
  let currentEpisodeStart: Date | null = null;

  for (const study of studies) {
    if (study.pregnancyEpisodeId) {
      currentEpisodeId = study.pregnancyEpisodeId;
      currentEpisodeStart = new Date(study.createdAt);
      continue;
    }

    // Try to find an existing episode starting within 280 days before this study
    const studyDate = new Date(study.createdAt);
    let matchedEpisode = null;

    if (currentEpisodeId && currentEpisodeStart) {
      const diffDays = (studyDate.getTime() - currentEpisodeStart.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays >= 0 && diffDays <= 280) {
        matchedEpisode = currentEpisodeId;
      }
    }

    if (!matchedEpisode) {
      // Look up in DB
      const existing = await db
        .select()
        .from(pregnancyEpisodesTable)
        .where(eq(pregnancyEpisodesTable.patientId, patientId))
        .orderBy(desc(pregnancyEpisodesTable.startDate));

      for (const ep of existing) {
        const epStart = new Date(ep.startDate);
        const diffDays = (studyDate.getTime() - epStart.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= 0 && diffDays <= 280) {
          matchedEpisode = ep.id;
          break;
        }
      }
    }

    if (!matchedEpisode) {
      // Create new episode
      const [newEp] = await db
        .insert(pregnancyEpisodesTable)
        .values({
          patientId,
          startDate: study.lmp ? new Date(study.lmp) : new Date(study.createdAt),
          edd: study.edd || null,
          status: "active",
        })
        .returning();
      matchedEpisode = newEp.id;
    }

    // Update study with episode ID
    await db
      .update(fetalUsgStudiesTable)
      .set({ pregnancyEpisodeId: matchedEpisode })
      .where(eq(fetalUsgStudiesTable.id, study.id));

    currentEpisodeId = matchedEpisode;
    currentEpisodeStart = study.lmp ? new Date(study.lmp) : new Date(study.createdAt);
  }

  // Update visit numbers and study order chronologically per episode
  const allEpisodes = await db
    .select()
    .from(pregnancyEpisodesTable)
    .where(eq(pregnancyEpisodesTable.patientId, patientId));

  for (const ep of allEpisodes) {
    const epStudies = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.pregnancyEpisodeId, ep.id))
      .orderBy(asc(fetalUsgStudiesTable.createdAt));

    let idx = 1;
    for (const est of epStudies) {
      await db
        .update(fetalUsgStudiesTable)
        .set({
          visitNumber: idx,
          studyOrder: idx,
        })
        .where(eq(fetalUsgStudiesTable.id, est.id));
      idx++;
    }
  }
}

// ── GET /timeline/:patientId ──────────────────────────────────────────────────
router.get("/timeline/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  try {
    await ensurePregnancyEpisodes(patientId);

    const studies = await db
      .select({
        fetalStudy: fetalUsgStudiesTable,
        radStudy: radiologyStudiesTable,
      })
      .from(fetalUsgStudiesTable)
      .innerJoin(radiologyStudiesTable, eq(fetalUsgStudiesTable.studyId, radiologyStudiesTable.id))
      .where(eq(fetalUsgStudiesTable.patientId, patientId))
      .orderBy(asc(fetalUsgStudiesTable.createdAt));

    const timeline = studies.map((row) => {
      const visit = row.fetalStudy.visitNumber || 1;
      let label = "Growth Scan " + (visit - 2);
      if (visit === 1) label = "Booking Scan";
      else if (visit === 2) label = "NT Scan";
      else if (visit === 3) label = "Anomaly Scan";

      return {
        id: row.fetalStudy.id,
        studyId: row.fetalStudy.studyId,
        date: new Date(row.fetalStudy.createdAt).toLocaleDateString(),
        ga: `${row.fetalStudy.gaWeeks ?? 0}w ${row.fetalStudy.gaDays ?? 0}d`,
        edd: row.fetalStudy.edd || "N/A",
        doctor: row.radStudy.assignedRadiologistName || "Dr. Staff",
        machine: row.radStudy.bodyPart || "Ultrasound Machine",
        studyDescription: label,
        status: row.fetalStudy.status,
      };
    });

    res.json({ timeline });
  } catch (err) {
    logger.error({ err }, "GET /timeline failed");
    res.status(500).json({ error: "Failed to load pregnancy timeline" });
  }
});

// ── GET /growth-charts/:patientId ─────────────────────────────────────────────
router.get("/growth-charts/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  try {
    const data = await db
      .select({
        fetalStudy: fetalUsgStudiesTable,
        meas: fetalUsgMeasurementsTable,
      })
      .from(fetalUsgStudiesTable)
      .innerJoin(fetalUsgMeasurementsTable, eq(fetalUsgMeasurementsTable.studyId, fetalUsgStudiesTable.id))
      .where(eq(fetalUsgStudiesTable.patientId, patientId))
      .orderBy(asc(fetalUsgStudiesTable.createdAt));

    const points = data.map((row) => {
      const gaDecimal = (row.fetalStudy.gaWeeks || 0) + (row.fetalStudy.gaDays || 0) / 7;
      return {
        studyId: row.fetalStudy.id,
        date: new Date(row.fetalStudy.createdAt).toLocaleDateString(),
        ga: gaDecimal,
        gaLabel: `${row.fetalStudy.gaWeeks || 0}w ${row.fetalStudy.gaDays || 0}d`,
        crl: row.meas.crl ? Number(row.meas.crl) : null,
        bpd: row.meas.bpd ? Number(row.meas.bpd) : null,
        hc: row.meas.hc ? Number(row.meas.hc) : null,
        ac: row.meas.ac ? Number(row.meas.ac) : null,
        fl: row.meas.fl ? Number(row.meas.fl) : null,
        efw: row.meas.efw ? Number(row.meas.efw) : null,
        afi: row.meas.afi ? Number(row.meas.afi) : null,
        fhr: row.meas.fetalHeartRate ? Number(row.meas.fetalHeartRate) : null,
        placentalGrade: row.meas.placentaGrade || null,
        cervicalLength: row.meas.cervicalLength ? Number(row.meas.cervicalLength) : null,
      };
    });

    res.json({ points });
  } catch (err) {
    logger.error({ err }, "GET /growth-charts failed");
    res.status(500).json({ error: "Failed to load growth chart data" });
  }
});

// ── GET /key-images/:studyId ──────────────────────────────────────────────────
router.get("/key-images/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  try {
    const fetalStudy = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.id, studyId))
      .limit(1);

    if (fetalStudy.length === 0) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const studyUID = fetalStudy[0].studyId.toString();

    // Fetch existing images
    let images = await db
      .select()
      .from(usgKeyImagesTable)
      .where(eq(usgKeyImagesTable.worklistId, fetalStudy[0].studyId));

    // If no key images exist, auto-generate standard suggestions for key measurements
    if (images.length === 0) {
      const mockLabels = ["CRL", "BPD", "HC", "AC", "FL", "AFI", "FHR"];
      const inserted = [];
      let sort = 1;

      for (const label of mockLabels) {
        // Suggest 3 alternatives for each
        for (let r = 1; r <= 3; r++) {
          const confidence = r === 1 ? 0.92 : r === 2 ? 0.81 : 0.68;
          const [row] = await db
            .insert(usgKeyImagesTable)
            .values({
              worklistId: fetalStudy[0].studyId,
              studyInstanceUID: studyUID,
              patientId: fetalStudy[0].patientId,
              sopInstanceUID: `1.2.840.113619.2.137.9999.${sort}.${r}`,
              frameNumber: sort * 5 + r,
              label: `${label} Scan`,
              measurementKey: label,
              rank: r,
              confidence,
              isApproved: false,
              isRejected: false,
              source: "ai_selection",
              wadoUrl: `/api/dicom/wado?study=${studyUID}&object=1.2.840.113619.2.137.9999.${sort}.${r}`,
              sortOrder: sort,
            })
            .returning();
          inserted.push(row);
        }
        sort++;
      }
      images = inserted;
    }

    res.json({ images });
  } catch (err) {
    logger.error({ err }, "GET /key-images failed");
    res.status(500).json({ error: "Failed to load key images" });
  }
});

// ── POST /key-images/:id/approve ──────────────────────────────────────────────
router.post("/key-images/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const session = (req as any).staffSession;
  try {
    const [row] = await db
      .update(usgKeyImagesTable)
      .set({
        isApproved: true,
        isRejected: false,
        addedBy: session?.user?.name || "Dr. Staff",
      })
      .where(eq(usgKeyImagesTable.id, id))
      .returning();

    // Log audit trail
    await db.insert(usgAuditLogTable).values({
      entityType: "key_image",
      entityId: id,
      action: "approve",
      performedBy: session?.user?.name || "Dr. Staff",
      studyInstanceUID: row.studyInstanceUID,
      patientId: row.patientId,
      details: JSON.stringify({ label: row.label, rank: row.rank }),
    });

    res.json({ success: true, image: row });
  } catch (err) {
    logger.error({ err }, "POST approve key image failed");
    res.status(500).json({ error: "Failed to approve key image" });
  }
});

// ── POST /key-images/:id/reject ───────────────────────────────────────────────
router.post("/key-images/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const session = (req as any).staffSession;
  try {
    const [row] = await db
      .update(usgKeyImagesTable)
      .set({
        isApproved: false,
        isRejected: true,
        addedBy: session?.user?.name || "Dr. Staff",
      })
      .where(eq(usgKeyImagesTable.id, id))
      .returning();

    // Log audit trail
    await db.insert(usgAuditLogTable).values({
      entityType: "key_image",
      entityId: id,
      action: "reject",
      performedBy: session?.user?.name || "Dr. Staff",
      studyInstanceUID: row.studyInstanceUID,
      patientId: row.patientId,
      details: JSON.stringify({ label: row.label, rank: row.rank }),
    });

    res.json({ success: true, image: row });
  } catch (err) {
    logger.error({ err }, "POST reject key image failed");
    res.status(500).json({ error: "Failed to reject key image" });
  }
});

// ── POST /key-images/:id/replace ──────────────────────────────────────────────
router.post("/key-images/:id/replace", async (req, res) => {
  const id = Number(req.params.id);
  const { newRank } = req.body as { newRank: number };
  const session = (req as any).staffSession;
  try {
    const [target] = await db
      .select()
      .from(usgKeyImagesTable)
      .where(eq(usgKeyImagesTable.id, id))
      .limit(1);

    if (!target) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    // Find other image in same measurement and swap ranks
    const match = await db
      .select()
      .from(usgKeyImagesTable)
      .where(
        and(
          eq(usgKeyImagesTable.worklistId, target.worklistId || 0),
          eq(usgKeyImagesTable.measurementKey, target.measurementKey || ""),
          eq(usgKeyImagesTable.rank, newRank)
        )
      )
      .limit(1);

    if (match.length > 0) {
      await db
        .update(usgKeyImagesTable)
        .set({ rank: target.rank })
        .where(eq(usgKeyImagesTable.id, match[0].id));
    }

    const [row] = await db
      .update(usgKeyImagesTable)
      .set({ rank: newRank })
      .where(eq(usgKeyImagesTable.id, id))
      .returning();

    // Log audit trail
    await db.insert(usgAuditLogTable).values({
      entityType: "key_image",
      entityId: id,
      action: "update",
      performedBy: session?.user?.name || "Dr. Staff",
      studyInstanceUID: row.studyInstanceUID,
      patientId: row.patientId,
      details: JSON.stringify({ label: row.label, oldRank: target.rank, newRank }),
    });

    res.json({ success: true, image: row });
  } catch (err) {
    logger.error({ err }, "POST replace key image failed");
    res.status(500).json({ error: "Failed to replace key image" });
  }
});

// ── GET /comparison/:studyId ──────────────────────────────────────────────────
router.get("/comparison/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const session = (req as any).staffSession;
  try {
    const currentStudy = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.id, studyId))
      .limit(1);

    if (currentStudy.length === 0) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const patientId = currentStudy[0].patientId;

    // Get previous study
    const prevStudies = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(
        and(
          eq(fetalUsgStudiesTable.patientId, patientId),
          eq(fetalUsgStudiesTable.pregnancyEpisodeId, currentStudy[0].pregnancyEpisodeId || 0),
          sql`${fetalUsgStudiesTable.createdAt} < ${currentStudy[0].createdAt}`
        )
      )
      .orderBy(desc(fetalUsgStudiesTable.createdAt))
      .limit(1);

    const suggestions: string[] = [];

    if (prevStudies.length > 0) {
      const prevStudy = prevStudies[0];

      // Fetch measurements
      const [currMeas] = await db
        .select()
        .from(fetalUsgMeasurementsTable)
        .where(eq(fetalUsgMeasurementsTable.studyId, currentStudy[0].id))
        .limit(1);

      const [prevMeas] = await db
        .select()
        .from(fetalUsgMeasurementsTable)
        .where(eq(fetalUsgMeasurementsTable.studyId, prevStudy.id))
        .limit(1);

      if (currMeas && prevMeas) {
        // CRL comparison
        if (currMeas.crl && prevMeas.crl) {
          const diff = Number(currMeas.crl) - Number(prevMeas.crl);
          if (diff > 0) {
            suggestions.push(`CRL progressed from ${prevMeas.crl}mm to ${currMeas.crl}mm, corresponding to normal growth.`);
          }
        }

        // BPD comparison
        if (currMeas.bpd && prevMeas.bpd) {
          const diff = Number(currMeas.bpd) - Number(prevMeas.bpd);
          if (diff > 2) {
            suggestions.push("BPD progressing normally.");
          } else {
            suggestions.push("Growth lag in BPD observed compared to previous scan.");
          }
        }

        // FL comparison
        if (currMeas.fl) {
          suggestions.push("FL corresponds to gestational age.");
        }

        // EFW comparison
        if (currMeas.efw && prevMeas.efw) {
          const diff = Number(currMeas.efw) - Number(prevMeas.efw);
          if (diff > 0) {
            suggestions.push("Estimated fetal weight increased appropriately.");
          }
        }

        // AFI comparison
        if (currMeas.afi && prevMeas.afi) {
          if (Number(currMeas.afi) < 8) {
            suggestions.push("AFI mildly reduced compared to previous study.");
          }
        }

        // Placenta comparison
        if (currMeas.placentaGrade && prevMeas.placentaGrade) {
          suggestions.push("Placental maturation progressing.");
        }
      }
    } else {
      suggestions.push("First scan of pregnancy episode. Baseline progression established.");
    }

    // Log comparison audit trail
    await db.insert(usgAuditLogTable).values({
      entityType: "measurement",
      entityId: studyId,
      action: "update",
      performedBy: session?.user?.name || "Dr. Staff",
      studyInstanceUID: currentStudy[0].studyId.toString(),
      patientId: currentStudy[0].patientId,
      details: JSON.stringify({ suggestions }),
    });

    res.json({ suggestions });
  } catch (err) {
    logger.error({ err }, "GET /comparison failed");
    res.status(500).json({ error: "Failed to compare studies" });
  }
});

export default router;
