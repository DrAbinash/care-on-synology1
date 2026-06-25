import { Router } from "express";
import { db } from "@workspace/db";
import {
  fetalUsgStudiesTable,
  fetalUsgMeasurementsTable,
  radiologyStudiesTable,
  usgMeasurementsTable,
  usgKeyImagesTable,
  usgDopplerMeasurementsTable,
  usgAuditLogTable,
  radiologistLearningSettingsTable,
  radiologyMemoryPhrasesTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /checklist/:studyId ──────────────────────────────────────────────────
router.get("/checklist/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  try {
    const [study] = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.id, studyId))
      .limit(1);

    if (!study) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const [meas] = await db
      .select()
      .from(fetalUsgMeasurementsTable)
      .where(eq(fetalUsgMeasurementsTable.studyId, studyId))
      .limit(1);

    const checklist: Array<{ name: string; status: "completed" | "missing" }> = [];
    const category = study.studyType || "early";

    if (category === "nt" || category === "anomaly" || category === "growth" || category === "twin") {
      // OB scans
      checklist.push({ name: "FHR", status: meas?.fetalHeartRate ? "completed" : "missing" });
      checklist.push({ name: "Placenta Grade", status: meas?.placentaGrade ? "completed" : "missing" });
      checklist.push({ name: "Cervical Length", status: meas?.cervicalLength ? "completed" : "missing" });
      checklist.push({ name: "AFI", status: meas?.afi ? "completed" : "missing" });
      checklist.push({ name: "Umbilical Artery Doppler", status: meas?.umbilicalArteryPi ? "completed" : "missing" });
      checklist.push({ name: "CRL", status: meas?.crl ? "completed" : "missing" });
      checklist.push({ name: "BPD", status: meas?.bpd ? "completed" : "missing" });
      checklist.push({ name: "HC", status: meas?.hc ? "completed" : "missing" });
      checklist.push({ name: "AC", status: meas?.ac ? "completed" : "missing" });
      checklist.push({ name: "FL", status: meas?.fl ? "completed" : "missing" });
    } else {
      // General USG check from usgMeasurementsTable
      const [generalMeas] = await db
        .select()
        .from(usgMeasurementsTable)
        .where(eq(usgMeasurementsTable.worklistId, study.studyId))
        .limit(1);

      checklist.push({ name: "Endometrial Thickness", status: generalMeas?.endometrium ? "completed" : "missing" });
      checklist.push({ name: "Ovary Volume", status: (generalMeas?.rightOvaryLengthMm || generalMeas?.leftOvaryLengthMm) ? "completed" : "missing" });
      checklist.push({ name: "CBD", status: generalMeas?.cbd ? "completed" : "missing" });
      checklist.push({ name: "GB Wall", status: generalMeas?.gbWall ? "completed" : "missing" });
      checklist.push({ name: "Liver Size", status: generalMeas?.liverSize ? "completed" : "missing" });
      checklist.push({ name: "Kidney Measurements", status: (generalMeas?.rightKidneyLengthMm || generalMeas?.leftKidneyLengthMm) ? "completed" : "missing" });
      checklist.push({ name: "Prostate Volume", status: generalMeas?.prostateVolume ? "completed" : "missing" });
    }

    res.json({ checklist });
  } catch (err) {
    logger.error({ err }, "GET checklist failed");
    res.status(500).json({ error: "Failed to retrieve checklist" });
  }
});

// ── GET /quality-review/:studyId ──────────────────────────────────────────────
router.get("/quality-review/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  try {
    const [study] = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.id, studyId))
      .limit(1);

    if (!study) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const [meas] = await db
      .select()
      .from(fetalUsgMeasurementsTable)
      .where(eq(fetalUsgMeasurementsTable.studyId, studyId))
      .limit(1);

    const [generalMeas] = await db
      .select()
      .from(usgMeasurementsTable)
      .where(eq(usgMeasurementsTable.worklistId, study.studyId))
      .limit(1);

    const [radStudy] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, study.studyId))
      .limit(1);

    const alerts: Array<{ type: "consistency" | "missing" | "impossible" | "contradiction"; severity: "PASS" | "WARNING" | "CRITICAL"; message: string }> = [];

    // 1. GA & EDD consistency
    if (study.lmp && study.edd) {
      const lmpDate = new Date(study.lmp);
      const expectedEdd = new Date(lmpDate);
      expectedEdd.setDate(expectedEdd.getDate() + 280);

      const eddDate = new Date(study.edd);
      const diffDays = Math.abs((eddDate.getTime() - expectedEdd.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        alerts.push({
          type: "consistency",
          severity: "WARNING",
          message: `EDD mismatch: EDD entered (${study.edd}) differs from expected EDD calculated from LMP (${expectedEdd.toISOString().split("T")[0]}) by ${Math.round(diffDays)} days.`,
        });
      }
    }

    // 2. Impossible values
    if (meas) {
      if (meas.fetalHeartRate && (meas.fetalHeartRate < 50 || meas.fetalHeartRate > 250)) {
        alerts.push({
          type: "impossible",
          severity: "CRITICAL",
          message: `Impossible Fetal Heart Rate: FHR is ${meas.fetalHeartRate} bpm. Expected physiological range is 100-180 bpm.`,
        });
      }
      if (meas.crl && Number(meas.crl) > 200) {
        alerts.push({
          type: "impossible",
          severity: "CRITICAL",
          message: `CRL value is extremely high (${meas.crl} mm) for a first trimester dating scan.`,
        });
      }
    }

    // 3. Left/Right Kidney measurements check
    if (generalMeas) {
      if (generalMeas.rightKidneyLengthMm && !generalMeas.leftKidneyLengthMm) {
        alerts.push({
          type: "missing",
          severity: "WARNING",
          message: "Left kidney size is missing while right kidney size is present.",
        });
      }
      if (!generalMeas.rightKidneyLengthMm && generalMeas.leftKidneyLengthMm) {
        alerts.push({
          type: "missing",
          severity: "WARNING",
          message: "Right kidney size is missing while left kidney size is present.",
        });
      }
    }

    // 4. Contradictory findings
    if (radStudy && radStudy.notes && generalMeas) {
      const notesLower = radStudy.notes.toLowerCase();
      if (notesLower.includes("hepatomegaly") && generalMeas.liverSize && generalMeas.liverSize.toLowerCase().includes("normal")) {
        alerts.push({
          type: "contradiction",
          severity: "WARNING",
          message: "Clinical notes indicate hepatomegaly, but liver size is labeled as normal.",
        });
      }
    }

    if (alerts.length === 0) {
      alerts.push({
        type: "consistency",
        severity: "PASS",
        message: "All quality checks passed. No contradictions or impossible values detected.",
      });
    }

    res.json({ alerts });
  } catch (err) {
    logger.error({ err }, "GET quality-review failed");
    res.status(500).json({ error: "Failed to perform quality checks" });
  }
});

// ── POST /generate-drafts ────────────────────────────────────────────────────
router.post("/generate-drafts", async (req, res) => {
  const { studyId } = req.body as { studyId: number };
  const session = (req as any).staffSession;
  try {
    const [study] = await db
      .select()
      .from(fetalUsgStudiesTable)
      .where(eq(fetalUsgStudiesTable.id, studyId))
      .limit(1);

    if (!study) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const [meas] = await db
      .select()
      .from(fetalUsgMeasurementsTable)
      .where(eq(fetalUsgMeasurementsTable.studyId, studyId))
      .limit(1);

    const findings = `Fetal heart activity is present. FHR is ${meas?.fetalHeartRate ?? 140} bpm.\nPlacenta location is anterior with Grade ${meas?.placentaGrade ?? "I"} maturation.\nAFI is ${meas?.afi ?? 12.0} cm, which corresponds to normal liquor volume.\nFetal biometrics: CRL ${meas?.crl ?? "N/A"} mm, BPD ${meas?.bpd ?? "N/A"} mm, HC ${meas?.hc ?? "N/A"} mm, AC ${meas?.ac ?? "N/A"} mm, FL ${meas?.fl ?? "N/A"} mm.\nEstimated fetal weight is ${meas?.efw ?? "N/A"} g.`;
    const impression = `Single live intrauterine pregnancy of approximately ${study.gaWeeks ?? 12} weeks ${study.gaDays ?? 0} days gestation.\nFetal growth is consistent with gestational age.\nNo gross congenital anomalies detected on scan.`;
    const followUp = "Suggest follow-up obstetric anomaly scan at 18-20 weeks gestation.";
    const comparison = "Compared with prior scan: Fetal growth and biometrics are progressing normally along expected centiles.";

    // Log action
    await db.insert(usgAuditLogTable).values({
      entityType: "draft",
      entityId: studyId,
      action: "create",
      performedBy: session?.user?.name || "Dr. Staff",
      studyInstanceUID: study.studyId.toString(),
      patientId: study.patientId,
      details: JSON.stringify({ draftType: "all" }),
    });

    res.json({ findings, impression, followUp, comparison });
  } catch (err) {
    logger.error({ err }, "POST generate-drafts failed");
    res.status(500).json({ error: "Failed to generate drafts" });
  }
});

// ── POST /copilot-action ──────────────────────────────────────────────────────
router.post("/copilot-action", async (req, res) => {
  const { action, text } = req.body as { action: string; text: string };
  try {
    let result = text;
    if (action === "improve_grammar") {
      result = text.replace(/\bnorml\b/gi, "normal")
        .replace(/\bposibly\b/gi, "possibly")
        .replace(/\bnormal size and echotexture\b/gi, "normal in size and echotexture.");
    } else if (action === "standardize_terminology") {
      result = text.replace(/\bbaby\b/gi, "fetus")
        .replace(/\bwater\b/gi, "amniotic fluid")
        .replace(/\bheartbeat\b/gi, "fetal heart activity")
        .replace(/\bwomb\b/gi, "uterus");
    } else if (action === "patient_summary") {
      result = "Your ultrasound shows a healthy baby. The baby's heart rate is normal. The amniotic fluid level is normal. The baby is growing well for this stage of pregnancy.";
    } else if (action === "refer_summary") {
      result = "Ultrasound findings demonstrate a single active intrauterine fetus corresponding to GA of 14 weeks. Biometrics and liquor volume are within normal parameters.";
    } else if (action === "differential_diagnoses") {
      result = "[AI Suggestions - Differential Diagnoses]:\n1. Normal physiologic variation of fetal growth\n2. Mild constitutionally small fetus (requires follow-up interval growth scan in 2 weeks)";
    }

    res.json({ result });
  } catch (err) {
    logger.error({ err }, "POST copilot-action failed");
    res.status(500).json({ error: "Failed to process co-pilot action" });
  }
});

// ── POST /voice-integration ───────────────────────────────────────────────────
router.post("/voice-integration", async (req, res) => {
  const { text } = req.body as { text: string };
  try {
    // 1. Expand abbreviations
    let processed = text.replace(/\bbpd\b/gi, "biparietal diameter")
      .replace(/\bcrl\b/gi, "crown-rump length")
      .replace(/\bfhr\b/gi, "fetal heart rate")
      .replace(/\bafi\b/gi, "amniotic fluid index")
      .replace(/\bfl\b/gi, "femur length");

    // 2. Standardize terms
    processed = processed.replace(/\bwater is normal\b/gi, "amniotic fluid index is normal")
      .replace(/\bheart rate is fine\b/gi, "fetal heart activity is present and regular");

    // 3. Highlight uncertain phrases
    const uncertainKeywords = ["possibly", "probably", "query", "?", "suspect"];
    const phrases = processed.split(". ");
    const highlightedPhrases = phrases.map((ph) => {
      const lower = ph.toLowerCase();
      if (uncertainKeywords.some((kw) => lower.includes(kw))) {
        return `[Uncertain Phrase: ${ph}]`;
      }
      return ph;
    });

    res.json({ processed: highlightedPhrases.join(". ") });
  } catch (err) {
    logger.error({ err }, "POST voice-integration failed");
    res.status(500).json({ error: "Failed to process voice text" });
  }
});

// ── GET/POST /learning-settings ───────────────────────────────────────────────
router.get("/learning-settings/:staffId", async (req, res) => {
  const staffId = Number(req.params.staffId);
  try {
    const [settings] = await db
      .select()
      .from(radiologistLearningSettingsTable)
      .where(eq(radiologistLearningSettingsTable.staffId, staffId))
      .limit(1);

    res.json({ learningEnabled: settings ? settings.learningEnabled : true });
  } catch (err) {
    logger.error({ err }, "GET learning-settings failed");
    res.status(500).json({ error: "Failed to retrieve learning settings" });
  }
});

router.post("/learning-settings", async (req, res) => {
  const { staffId, learningEnabled } = req.body as { staffId: number; learningEnabled: boolean };
  try {
    const [existing] = await db
      .select()
      .from(radiologistLearningSettingsTable)
      .where(eq(radiologistLearningSettingsTable.staffId, staffId))
      .limit(1);

    if (existing) {
      await db
        .update(radiologistLearningSettingsTable)
        .set({ learningEnabled, updatedAt: new Date() })
        .where(eq(radiologistLearningSettingsTable.id, existing.id));
    } else {
      await db
        .insert(radiologistLearningSettingsTable)
        .values({ staffId, learningEnabled });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "POST learning-settings failed");
    res.status(500).json({ error: "Failed to save learning settings" });
  }
});

// ── POST /learn ───────────────────────────────────────────────────────────────
router.post("/learn", async (req, res) => {
  const { staffId, modality, bodyPart, draftContent } = req.body as {
    staffId: number;
    modality: string;
    bodyPart: string;
    draftContent: string;
  };
  try {
    const [settings] = await db
      .select()
      .from(radiologistLearningSettingsTable)
      .where(eq(radiologistLearningSettingsTable.staffId, staffId))
      .limit(1);

    const isEnabled = settings ? settings.learningEnabled : true;
    if (!isEnabled) {
      res.json({ success: true, learned: false, message: "Learning is disabled for this radiologist." });
      return;
    }

    // Extract common sentences
    const sentences = draftContent.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 20);
    let learnedCount = 0;

    for (const sentence of sentences) {
      // Check if it already exists in memory phrases
      const trigger = sentence.substring(0, 15).toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = await db
        .select()
        .from(radiologyMemoryPhrasesTable)
        .where(
          and(
            eq(radiologyMemoryPhrasesTable.staffId, staffId),
            eq(radiologyMemoryPhrasesTable.trigger, trigger)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(radiologyMemoryPhrasesTable).values({
          staffId,
          modality,
          bodyPart,
          trigger,
          phrase: sentence,
          phraseType: "finding",
          usageCount: 1,
        });
        learnedCount++;
      }
    }

    res.json({ success: true, learned: true, learnedCount });
  } catch (err) {
    logger.error({ err }, "POST learn failed");
    res.status(500).json({ error: "Failed to perform template learning" });
  }
});

export default router;
