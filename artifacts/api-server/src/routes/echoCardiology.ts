import { Router } from "express";
import { db } from "@workspace/db";
import {
  echoMeasurementsTable,
  echoValveAssessmentTable,
  echoRegionalWallTable,
  echoReportsTable,
  echoAuditLogsTable,
  fetalEchoStudiesTable,
  fetalEchoAuditLogsTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { generateAiForTask } from "@workspace/ai-providers";

const router = Router();

function staffOf(req: StaffAuthRequest): { subjectId?: number; subjectName?: string; role?: string } {
  return req.staffSession ?? {};
}

function audit(
  req: StaffAuthRequest,
  params: {
    entityType: string;
    entityId: number;
    action: string;
    details?: string;
  },
) {
  const s = staffOf(req);
  const table =
    params.entityType === "echo"
      ? echoAuditLogsTable
      : fetalEchoAuditLogsTable;
  void db
    .insert(table)
    .values({
      studyId: params.entityId,
      action: params.action,
      performedBy: s.subjectName ?? s.subjectId?.toString(),
      details: params.details ?? null,
    })
    .catch(() => {});
}

// ── Echo Measurements ────────────────────────────────────────────────────────

router.get("/measurements/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const rows = await db
    .select()
    .from(echoMeasurementsTable)
    .where(eq(echoMeasurementsTable.studyId, studyId))
    .orderBy(desc(echoMeasurementsTable.createdAt))
    .limit(1);
  const valves = await db
    .select()
    .from(echoValveAssessmentTable)
    .where(eq(echoValveAssessmentTable.studyId, studyId));
  const walls = await db
    .select()
    .from(echoRegionalWallTable)
    .where(eq(echoRegionalWallTable.studyId, studyId));
  res.json({ measurements: rows[0] ?? null, valves, walls });
});

router.post("/measurements/:studyId", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const b = req.body as Record<string, unknown>;
  // Upsert
  const existing = await db
    .select()
    .from(echoMeasurementsTable)
    .where(eq(echoMeasurementsTable.studyId, studyId))
    .limit(1);
  const s = staffOf(sReq);
  const payload = {
    studyId,
    patientId: b.patientId ? Number(b.patientId) : null,
    heightCm: b.heightCm ? Number(b.heightCm) : null,
    weightKg: b.weightKg ? Number(b.weightKg) : null,
    bsa: b.bsa ? Number(b.bsa) : null,
    bpSystolic: b.bpSystolic ? Number(b.bpSystolic) : null,
    bpDiastolic: b.bpDiastolic ? Number(b.bpDiastolic) : null,
    heartRate: b.heartRate ? Number(b.heartRate) : null,
    ivsd: b.ivsd ? Number(b.ivsd) : null,
    ivss: b.ivss ? Number(b.ivss) : null,
    lvidd: b.lvidd ? Number(b.lvidd) : null,
    lvids: b.lvids ? Number(b.lvids) : null,
    lvpwd: b.lvpwd ? Number(b.lvpwd) : null,
    lvpws: b.lvpws ? Number(b.lvpws) : null,
    laDiameter: b.laDiameter ? Number(b.laDiameter) : null,
    laVolume: b.laVolume ? Number(b.laVolume) : null,
    laVolumeIndex: b.laVolumeIndex ? Number(b.laVolumeIndex) : null,
    raSize: b.raSize ? Number(b.raSize) : null,
    aorticRoot: b.aorticRoot ? Number(b.aorticRoot) : null,
    ascendingAorta: b.ascendingAorta ? Number(b.ascendingAorta) : null,
    rvBasal: b.rvBasal ? Number(b.rvBasal) : null,
    rvMid: b.rvMid ? Number(b.rvMid) : null,
    rvLength: b.rvLength ? Number(b.rvLength) : null,
    tapase: b.tapase ? Number(b.tapase) : null,
    rvsp: b.rvsp ? Number(b.rvsp) : null,
    efSimpson: b.efSimpson ? Number(b.efSimpson) : null,
    efTeichholz: b.efTeichholz ? Number(b.efTeichholz) : null,
    fractionalShortening: b.fractionalShortening ? Number(b.fractionalShortening) : null,
    lvMass: b.lvMass ? Number(b.lvMass) : null,
    lvMassIndex: b.lvMassIndex ? Number(b.lvMassIndex) : null,
    mvE: b.mvE ? Number(b.mvE) : null,
    mvA: b.mvA ? Number(b.mvA) : null,
    mvEaRatio: b.mvEaRatio ? Number(b.mvEaRatio) : null,
    mvDecelTime: b.mvDecelTime ? Number(b.mvDecelTime) : null,
    mvEePrime: b.mvEePrime ? Number(b.mvEePrime) : null,
    septalEPrime: b.septalEPrime ? Number(b.septalEPrime) : null,
    lateralEPrime: b.lateralEPrime ? Number(b.lateralEPrime) : null,
    avVelocity: b.avVelocity ? Number(b.avVelocity) : null,
    avGradient: b.avGradient ? Number(b.avGradient) : null,
    avArea: b.avArea ? Number(b.avArea) : null,
    trVelocity: b.trVelocity ? Number(b.trVelocity) : null,
    trGradient: b.trGradient ? Number(b.trGradient) : null,
    pulmonaryVelocity: b.pulmonaryVelocity ? Number(b.pulmonaryVelocity) : null,
    pulmonaryGradient: b.pulmonaryGradient ? Number(b.pulmonaryGradient) : null,
    lvh: b.lvh ? Boolean(b.lvh) : null,
    relativeWallThickness: b.relativeWallThickness ? Number(b.relativeWallThickness) : null,
    lvGeometry: b.lvGeometry ? String(b.lvGeometry) : null,
    diastolicDysfunctionGrade: b.diastolicDysfunctionGrade ? String(b.diastolicDysfunctionGrade) : null,
    pulmonaryHypertension: b.pulmonaryHypertension ? Boolean(b.pulmonaryHypertension) : null,
    createdBy: s.subjectName ?? null,
  };
  let row;
  if (existing[0]) {
    [row] = await db
      .update(echoMeasurementsTable)
      .set(payload)
      .where(eq(echoMeasurementsTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db.insert(echoMeasurementsTable).values(payload).returning();
  }
  audit(sReq, { entityType: "echo", entityId: studyId, action: "measurement_entered", details: "measurements_saved" });
  res.json({ success: true, data: row });
});

// Valve assessment
router.post("/valves/:studyId", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const b = req.body as {
    valveName: string;
    morphology?: string;
    stenosis?: string;
    stenosisNotes?: string;
    regurgitation?: string;
    regurgitationNotes?: string;
    additionalFindings?: string;
  };
  if (!b.valveName) { res.status(400).json({ error: "valveName required" }); return; }
  const existing = await db
    .select()
    .from(echoValveAssessmentTable)
    .where(and(eq(echoValveAssessmentTable.studyId, studyId), eq(echoValveAssessmentTable.valveName, b.valveName)))
    .limit(1);
  let row;
  if (existing[0]) {
    [row] = await db
      .update(echoValveAssessmentTable)
      .set({ ...b, updatedAt: new Date() })
      .where(eq(echoValveAssessmentTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db.insert(echoValveAssessmentTable).values({ studyId, ...b }).returning();
  }
  audit(sReq, { entityType: "echo", entityId: studyId, action: "valve_assessment_saved", details: b.valveName });
  res.json({ success: true, data: row });
});

// Regional walls
router.post("/walls/:studyId", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const b = req.body as { segment: string; motion: string; notes?: string };
  if (!b.segment) { res.status(400).json({ error: "segment required" }); return; }
  const existing = await db
    .select()
    .from(echoRegionalWallTable)
    .where(and(eq(echoRegionalWallTable.studyId, studyId), eq(echoRegionalWallTable.segment, b.segment)))
    .limit(1);
  let row;
  if (existing[0]) {
    [row] = await db
      .update(echoRegionalWallTable)
      .set({ ...b, createdAt: new Date() })
      .where(eq(echoRegionalWallTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db.insert(echoRegionalWallTable).values({ studyId, ...b }).returning();
  }
  audit(sReq, { entityType: "echo", entityId: studyId, action: "wall_motion_saved", details: b.segment });
  res.json({ success: true, data: row });
});

// ── Echo Reports ──────────────────────────────────────────────────────────────

router.get("/reports/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const rows = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  res.json({ report: rows[0] ?? null });
});

router.post("/reports/:studyId", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const b = req.body as Record<string, unknown>;
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  const payload = {
    studyId,
    patientId: b.patientId ? Number(b.patientId) : null,
    leftVentricle: b.leftVentricle ? String(b.leftVentricle) : null,
    rightVentricle: b.rightVentricle ? String(b.rightVentricle) : null,
    leftAtrium: b.leftAtrium ? String(b.leftAtrium) : null,
    rightAtrium: b.rightAtrium ? String(b.rightAtrium) : null,
    interatrialSeptum: b.interatrialSeptum ? String(b.interatrialSeptum) : null,
    interventricularSeptum: b.interventricularSeptum ? String(b.interventricularSeptum) : null,
    aorticValve: b.aorticValve ? String(b.aorticValve) : null,
    mitralValve: b.mitralValve ? String(b.mitralValve) : null,
    tricuspidValve: b.tricuspidValve ? String(b.tricuspidValve) : null,
    pulmonaryValve: b.pulmonaryValve ? String(b.pulmonaryValve) : null,
    pericardium: b.pericardium ? String(b.pericardium) : null,
    dopplerFindings: b.dopplerFindings ? String(b.dopplerFindings) : null,
    impression: b.impression ? String(b.impression) : null,
    recommendation: b.recommendation ? String(b.recommendation) : null,
    status: b.status ? String(b.status) : "draft",
    draftedBy: s.subjectName ?? null,
  };
  let row;
  if (existing[0]) {
    [row] = await db
      .update(echoReportsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(echoReportsTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db.insert(echoReportsTable).values(payload).returning();
  }
  audit(sReq, { entityType: "echo", entityId: studyId, action: "draft_saved", details: payload.status });
  res.json({ success: true, data: row });
});

router.post("/reports/:studyId/review", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No report draft found" }); return; }
  const [row] = await db
    .update(echoReportsTable)
    .set({
      status: "reviewed",
      reviewedBy: s.subjectName ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(echoReportsTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "echo", entityId: studyId, action: "reviewed", details: "doctor_reviewed" });
  res.json({ success: true, data: row });
});

router.post("/reports/:studyId/finalize", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No report draft found" }); return; }
  // Require critical alerts acknowledged
  if (!existing[0].criticalAlertsAcknowledged) {
    const hasCritical = await detectCriticalAlerts(studyId);
    if (hasCritical) { res.status(400).json({ error: "Critical alerts not acknowledged. Please review before finalizing." }); return; }
  }
  const [row] = await db
    .update(echoReportsTable)
    .set({
      status: "final",
      finalizedBy: s.subjectName ?? null,
      finalizedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(echoReportsTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "echo", entityId: studyId, action: "finalized", details: "report_finalized" });
  res.json({ success: true, data: row });
});

// Critical alerts
async function detectCriticalAlerts(studyId: number): Promise<boolean> {
  const m = await db
    .select()
    .from(echoMeasurementsTable)
    .where(eq(echoMeasurementsTable.studyId, studyId))
    .limit(1);
  if (!m[0]) return false;
  const meas = m[0];
  // Severe LV dysfunction (EF < 30)
  if ((meas.efSimpson ?? 0) < 30 || (meas.efTeichholz ?? 0) < 30) return true;
  // Severe AS (AV area < 1.0)
  if ((meas.avArea ?? 999) < 1.0) return true;
  // Pulmonary hypertension (RVSP > 40)
  if ((meas.rvsp ?? 0) > 40) return true;
  // Severe valve regurgitation
  const valves = await db
    .select()
    .from(echoValveAssessmentTable)
    .where(eq(echoValveAssessmentTable.studyId, studyId));
  for (const v of valves) {
    if (v.regurgitation === "severe" || v.stenosis === "severe") return true;
  }
  return false;
}

router.get("/reports/:studyId/critical-alerts", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const alerts: string[] = [];
  const m = await db
    .select()
    .from(echoMeasurementsTable)
    .where(eq(echoMeasurementsTable.studyId, studyId))
    .limit(1);
  if (m[0]) {
    const meas = m[0];
    if ((meas.efSimpson ?? 0) < 30) alerts.push("Severe LV dysfunction (EF < 30%)");
    if ((meas.efTeichholz ?? 0) < 30) alerts.push("Severe LV dysfunction (EF < 30%)");
    if ((meas.avArea ?? 999) < 1.0) alerts.push("Severe aortic stenosis (AVA < 1.0 cm²)");
    if ((meas.rvsp ?? 0) > 40) alerts.push("Pulmonary hypertension (RVSP > 40 mmHg)");
  }
  const valves = await db
    .select()
    .from(echoValveAssessmentTable)
    .where(eq(echoValveAssessmentTable.studyId, studyId));
  for (const v of valves) {
    if (v.regurgitation === "severe") alerts.push(`Severe ${v.valveName} regurgitation`);
    if (v.stenosis === "severe") alerts.push(`Severe ${v.valveName} stenosis`);
  }
  res.json({ alerts, hasCritical: alerts.length > 0 });
});

router.post("/reports/:studyId/acknowledge-critical", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const existing = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No report draft found" }); return; }
  const [row] = await db
    .update(echoReportsTable)
    .set({ criticalAlertsAcknowledged: true, updatedAt: new Date() })
    .where(eq(echoReportsTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "echo", entityId: studyId, action: "critical_acknowledged", details: "acknowledged" });
  res.json({ success: true, data: row });
});

// ── Fetal Echo ──────────────────────────────────────────────────────────────

router.get("/fetal/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const rows = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  res.json({ study: rows[0] ?? null });
});

router.post("/fetal/:studyId", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const b = req.body as Record<string, unknown>;
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  const payload = {
    studyId,
    patientId: b.patientId ? Number(b.patientId) : null,
    gaWeeks: b.gaWeeks ? Number(b.gaWeeks) : null,
    gaDays: b.gaDays ? Number(b.gaDays) : null,
    edd: b.edd ? String(b.edd) : null,
    lmp: b.lmp ? String(b.lmp) : null,
    fetalHeartRate: b.fetalHeartRate ? Number(b.fetalHeartRate) : null,
    situs: b.situs ? String(b.situs) : null,
    cardiacAxis: b.cardiacAxis ? String(b.cardiacAxis) : null,
    cardiacPosition: b.cardiacPosition ? String(b.cardiacPosition) : null,
    avConcordance: b.avConcordance ? String(b.avConcordance) : null,
    vaConcordance: b.vaConcordance ? String(b.vaConcordance) : null,
    raNormal: b.raNormal !== undefined ? Boolean(b.raNormal) : true,
    laNormal: b.laNormal !== undefined ? Boolean(b.laNormal) : true,
    rvNormal: b.rvNormal !== undefined ? Boolean(b.rvNormal) : true,
    lvNormal: b.lvNormal !== undefined ? Boolean(b.lvNormal) : true,
    fourChamberView: b.fourChamberView ? String(b.fourChamberView) : null,
    lvot: b.lvot ? String(b.lvot) : null,
    rvot: b.rvot ? String(b.rvot) : null,
    threeVesselView: b.threeVesselView ? String(b.threeVesselView) : null,
    threeVesselTracheaView: b.threeVesselTracheaView ? String(b.threeVesselTracheaView) : null,
    aorticArch: b.aorticArch ? String(b.aorticArch) : null,
    ductalArch: b.ductalArch ? String(b.ductalArch) : null,
    interatrialSeptum: b.interatrialSeptum ? String(b.interatrialSeptum) : null,
    interventricularSeptum: b.interventricularSeptum ? String(b.interventricularSeptum) : null,
    mitralValve: b.mitralValve ? String(b.mitralValve) : null,
    tricuspidValve: b.tricuspidValve ? String(b.tricuspidValve) : null,
    aorticValve: b.aorticValve ? String(b.aorticValve) : null,
    pulmonaryValve: b.pulmonaryValve ? String(b.pulmonaryValve) : null,
    rhythm: b.rhythm ? String(b.rhythm) : null,
    rhythmNotes: b.rhythmNotes ? String(b.rhythmNotes) : null,
    umbilicalArteryPi: b.umbilicalArteryPi ? Number(b.umbilicalArteryPi) : null,
    umbilicalArteryRi: b.umbilicalArteryRi ? Number(b.umbilicalArteryRi) : null,
    ductusVenoususPi: b.ductusVenoususPi ? Number(b.ductusVenoususPi) : null,
    ductusVenoususAWave: b.ductusVenoususAWave ? String(b.ductusVenoususAWave) : null,
    mcaPi: b.mcaPi ? Number(b.mcaPi) : null,
    mcaRi: b.mcaRi ? Number(b.mcaRi) : null,
    suspectedAbnormalities: b.suspectedAbnormalities ? String(b.suspectedAbnormalities) : null,
    status: b.status ? String(b.status) : "draft",
    draftedBy: s.subjectName ?? null,
  };
  let row;
  if (existing[0]) {
    [row] = await db
      .update(fetalEchoStudiesTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(fetalEchoStudiesTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db.insert(fetalEchoStudiesTable).values(payload).returning();
  }
  audit(sReq, { entityType: "fetal_echo", entityId: studyId, action: "draft_saved", details: payload.status });
  res.json({ success: true, data: row });
});

router.post("/fetal/:studyId/review", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No fetal echo draft found" }); return; }
  const [row] = await db
    .update(fetalEchoStudiesTable)
    .set({
      status: "reviewed",
      reviewedBy: s.subjectName ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(fetalEchoStudiesTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "fetal_echo", entityId: studyId, action: "reviewed", details: "doctor_reviewed" });
  res.json({ success: true, data: row });
});

router.post("/fetal/:studyId/finalize", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const s = staffOf(sReq);
  const existing = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No fetal echo draft found" }); return; }
  // Check for fetal echo critical alerts
  const critical = await detectFetalEchoCritical(studyId);
  if (critical.length > 0 && !existing[0].criticalAlertsAcknowledged) {
    res.status(400).json({ error: "Critical alerts not acknowledged", alerts: critical });
    return;
  }
  const [row] = await db
    .update(fetalEchoStudiesTable)
    .set({
      status: "final",
      finalizedBy: s.subjectName ?? null,
      finalizedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(fetalEchoStudiesTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "fetal_echo", entityId: studyId, action: "finalized", details: "report_finalized" });
  res.json({ success: true, data: row });
});

async function detectFetalEchoCritical(studyId: number): Promise<string[]> {
  const alerts: string[] = [];
  const rows = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  if (!rows[0]) return alerts;
  const f = rows[0];
  if (f.fetalHeartRate && f.fetalHeartRate < 100) alerts.push("Fetal bradycardia (FHR < 100)");
  if (f.fetalHeartRate && f.fetalHeartRate > 180) alerts.push("Fetal tachycardia (FHR > 180)");
  if (f.rhythm === "arrhythmia") alerts.push("Fetal arrhythmia detected");
  const abnormals = JSON.parse(f.suspectedAbnormalities ?? "[]") as string[];
  const criticalConditions = [
    "HLHS", "TGA", "TOF", "DORV", "Ebstein anomaly", "cardiomegaly", "hydrops fetalis",
  ];
  for (const a of abnormals) {
    if (criticalConditions.some((c) => a.toLowerCase().includes(c.toLowerCase()))) {
      alerts.push(`Critical congenital anomaly: ${a}`);
    }
  }
  return alerts;
}

router.get("/fetal/:studyId/critical-alerts", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const alerts = await detectFetalEchoCritical(studyId);
  res.json({ alerts, hasCritical: alerts.length > 0 });
});

router.post("/fetal/:studyId/acknowledge-critical", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const existing = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  if (!existing[0]) { res.status(404).json({ error: "No fetal echo draft found" }); return; }
  const [row] = await db
    .update(fetalEchoStudiesTable)
    .set({ criticalAlertsAcknowledged: true, updatedAt: new Date() })
    .where(eq(fetalEchoStudiesTable.id, existing[0].id))
    .returning();
  audit(sReq, { entityType: "fetal_echo", entityId: studyId, action: "critical_acknowledged", details: "acknowledged" });
  res.json({ success: true, data: row });
});

// AI Draft generation — uses pluggable AI provider (Gemini/OpenAI/Ollama) with template fallback
router.post("/reports/:studyId/generate-draft", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const m = await db
    .select()
    .from(echoMeasurementsTable)
    .where(eq(echoMeasurementsTable.studyId, studyId))
    .limit(1);
  const valves = await db
    .select()
    .from(echoValveAssessmentTable)
    .where(eq(echoValveAssessmentTable.studyId, studyId));
  const walls = await db
    .select()
    .from(echoRegionalWallTable)
    .where(eq(echoRegionalWallTable.studyId, studyId));
  const meas = m[0];

  // Always generate template fallback
  const templateDraft = generateEchoDraft(meas, valves, walls);

  // Try AI provider (Gemini/OpenAI/Ollama) if configured
  let aiDraft = templateDraft;
  let providerUsed = "template";
  try {
    const prompt = buildEchoAiPrompt(meas, valves, walls);
    const aiResult = await generateAiForTask("echo_draft", prompt, [], { maxTokens: 2048 });
    if (aiResult.success && aiResult.text) {
      aiDraft = aiResult.text;
      providerUsed = "ai";
    }
  } catch (err) {
    logger.warn({ err, studyId }, "AI draft generation failed, using template fallback");
  }

  const existing = await db
    .select()
    .from(echoReportsTable)
    .where(eq(echoReportsTable.studyId, studyId))
    .limit(1);
  let row;
  if (existing[0]) {
    [row] = await db
      .update(echoReportsTable)
      .set({ aiDraft, aiDraftAt: new Date(), updatedAt: new Date() })
      .where(eq(echoReportsTable.id, existing[0].id))
      .returning();
  } else {
    [row] = await db
      .insert(echoReportsTable)
      .values({ studyId, aiDraft, aiDraftAt: new Date(), status: "draft" })
      .returning();
  }
  audit(sReq, { entityType: "echo", entityId: studyId, action: "ai_draft_generated", details: providerUsed });
  res.json({ success: true, aiDraft, templateDraft, providerUsed, data: row });
});

router.post("/fetal/:studyId/generate-draft", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const studyId = Number(req.params.studyId);
  const rows = await db
    .select()
    .from(fetalEchoStudiesTable)
    .where(eq(fetalEchoStudiesTable.studyId, studyId))
    .limit(1);
  if (!rows[0]) { res.status(404).json({ error: "No fetal echo data found" }); return; }

  const templateDraft = generateFetalEchoDraft(rows[0]);
  let aiDraft = templateDraft;
  let providerUsed = "template";
  try {
    const prompt = buildFetalEchoAiPrompt(rows[0]);
    const aiResult = await generateAiForTask("fetal_echo_draft", prompt, [], { maxTokens: 2048 });
    if (aiResult.success && aiResult.text) {
      aiDraft = aiResult.text;
      providerUsed = "ai";
    }
  } catch (err) {
    logger.warn({ err, studyId }, "Fetal echo AI draft generation failed, using template fallback");
  }

  const [row] = await db
    .update(fetalEchoStudiesTable)
    .set({ aiDraft, aiDraftAt: new Date(), updatedAt: new Date() })
    .where(eq(fetalEchoStudiesTable.id, rows[0].id))
    .returning();
  audit(sReq, { entityType: "fetal_echo", entityId: studyId, action: "ai_draft_generated", details: providerUsed });
  res.json({ success: true, aiDraft, templateDraft, providerUsed, data: row });
});

// ── AI Draft Helpers ──────────────────────────────────────────────────────

function generateEchoDraft(
  meas: typeof echoMeasurementsTable.$inferSelect | undefined,
  valves: Array<typeof echoValveAssessmentTable.$inferSelect>,
  walls: Array<typeof echoRegionalWallTable.$inferSelect>,
): string {
  const parts: string[] = [];
  parts.push("LEFT VENTRICLE:");
  if (meas) {
    parts.push(
      `LVEDD ${meas.lvidd ?? "-"} mm, LVESD ${meas.lvids ?? "-"} mm. ` +
      `EF (Simpson) ${meas.efSimpson ?? "-"}%, EF (Teichholz) ${meas.efTeichholz ?? "-"}%. ` +
      `LV mass index ${meas.lvMassIndex ?? "-"}. ` +
      `Geometry: ${meas.lvGeometry ?? "normal"}.`,
    );
  } else {
    parts.push("Not assessed.");
  }
  parts.push("");
  parts.push("RIGHT VENTRICLE:");
  parts.push(meas?.tapase ? `TAPSE ${meas.tapase} mm.` : "Not assessed.");
  parts.push("");
  parts.push("VALVES:");
  for (const v of valves) {
    parts.push(
      `${v.valveName.toUpperCase()}: ${v.morphology ?? "normal"}; ` +
      `stenosis ${v.stenosis ?? "none"}; regurgitation ${v.regurgitation ?? "none"}.`,
    );
  }
  if (valves.length === 0) parts.push("All valves appear structurally normal.");
  parts.push("");
  parts.push("REGIONAL WALL MOTION:");
  const abnormal = walls.filter((w) => w.motion !== "normal");
  if (abnormal.length > 0) {
    parts.push(abnormal.map((w) => `${w.segment}: ${w.motion}`).join("; "));
  } else {
    parts.push("All segments contracting normally.");
  }
  parts.push("");
  parts.push("DOPPLER:");
  if (meas) {
    parts.push(
      `MV E/A ${meas.mvEaRatio ?? "-"}, E/e’ ${meas.mvEePrime ?? "-"}. ` +
      `AV Vmax ${meas.avVelocity ?? "-"} m/s, gradient ${meas.avGradient ?? "-"} mmHg. ` +
      `TR gradient ${meas.trGradient ?? "-"} mmHg.`,
    );
  } else {
    parts.push("Not assessed.");
  }
  parts.push("");
  parts.push("IMPRESSION:");
  parts.push("AI Draft – Requires Radiologist Review.");
  return parts.join("\n");
}

function generateFetalEchoDraft(
  f: typeof fetalEchoStudiesTable.$inferSelect,
): string {
  const parts: string[] = [];
  parts.push(`GESTATIONAL AGE: ${f.gaWeeks ?? "-"} weeks ${f.gaDays ?? "-"} days.`);
  parts.push(`FETAL HEART RATE: ${f.fetalHeartRate ?? "-"} bpm.`);
  parts.push("");
  parts.push("CARDIAC SITUS:");
  parts.push(f.situs ?? "Not documented.");
  parts.push("");
  parts.push("FOUR CHAMBER VIEW:");
  parts.push(f.fourChamberView ?? "Not assessed.");
  parts.push("");
  parts.push("OUTFLOW TRACTS:");
  parts.push(`LVOT: ${f.lvot ?? "-"}, RVOT: ${f.rvot ?? "-"}.`);
  parts.push("");
  parts.push("ARCHES:");
  parts.push(`Aortic arch: ${f.aorticArch ?? "-"}, Ductal arch: ${f.ductalArch ?? "-"}.`);
  parts.push("");
  parts.push("SEPTA:");
  parts.push(`IAS: ${f.interatrialSeptum ?? "-"}, IVS: ${f.interventricularSeptum ?? "-"}.`);
  parts.push("");
  parts.push("VALVES:");
  parts.push(
    `MV: ${f.mitralValve ?? "-"}, TV: ${f.tricuspidValve ?? "-"}, ` +
    `AV: ${f.aorticValve ?? "-"}, PV: ${f.pulmonaryValve ?? "-"}.`,
  );
  parts.push("");
  parts.push("RHYTHM:");
  parts.push(f.rhythm ?? "Not assessed.");
  parts.push("");
  parts.push("DOPPLER:");
  parts.push(
    `UA PI ${f.umbilicalArteryPi ?? "-"}, MCA PI ${f.mcaPi ?? "-"}. ` +
    `DV: ${f.ductusVenoususAWave ?? "-"}.`,
  );
  parts.push("");
  const abnormals = JSON.parse(f.suspectedAbnormalities ?? "[]") as string[];
  if (abnormals.length > 0) {
    parts.push("SUSPECTED ABNORMALITIES:");
    parts.push(abnormals.join("; "));
    parts.push("");
  }
  parts.push("IMPRESSION:");
  parts.push("AI Draft – Requires Radiologist Review.");
  return parts.join("\n");
}

function buildEchoAiPrompt(
  meas: typeof echoMeasurementsTable.$inferSelect | undefined,
  valves: Array<typeof echoValveAssessmentTable.$inferSelect>,
  walls: Array<typeof echoRegionalWallTable.$inferSelect>,
): string {
  const parts: string[] = [];
  parts.push("You are an expert cardiologist. Generate a structured 2D echocardiography report from the following measurements. Use professional medical terminology.");
  parts.push("");
  if (meas) {
    parts.push("Patient vitals: " + (meas.bpSystolic ? `BP ${meas.bpSystolic}/${meas.bpDiastolic} mmHg, ` : "") + (meas.heartRate ? `HR ${meas.heartRate} bpm` : ""));
    parts.push("");
    parts.push("LEFT VENTRICLE:");
    parts.push(`LVEDD ${meas.lvidd ?? "-"} mm, LVESD ${meas.lvids ?? "-"} mm. EF (Simpson) ${meas.efSimpson ?? "-"}%, EF (Teichholz) ${meas.efTeichholz ?? "-"}%. LV mass index ${meas.lvMassIndex ?? "-"}. Geometry: ${meas.lvGeometry ?? "normal"}. LVH: ${meas.lvh ? "Yes" : "No"}. RWT: ${meas.relativeWallThickness ?? "-"}.`);
    parts.push("");
    parts.push("RIGHT VENTRICLE:");
    parts.push(`TAPSE ${meas.tapase ?? "-"} mm. RVSP ${meas.rvsp ?? "-"} mmHg.`);
    parts.push("");
    parts.push("DOPPLER:");
    parts.push(`MV E/A ${meas.mvEaRatio ?? "-"}, E/e' ${meas.mvEePrime ?? "-"}. AV Vmax ${meas.avVelocity ?? "-"} m/s, gradient ${meas.avGradient ?? "-"} mmHg. TR gradient ${meas.trGradient ?? "-"} mmHg. Diastolic dysfunction: ${meas.diastolicDysfunctionGrade ?? "none"}. Pulmonary hypertension: ${meas.pulmonaryHypertension ? "Yes" : "No"}.`);
  }
  parts.push("");
  parts.push("VALVES:");
  for (const v of valves) {
    parts.push(`${v.valveName.toUpperCase()}: morphology ${v.morphology ?? "normal"}, stenosis ${v.stenosis ?? "none"}, regurgitation ${v.regurgitation ?? "none"}.`);
  }
  if (valves.length === 0) parts.push("All valves structurally normal.");
  parts.push("");
  parts.push("REGIONAL WALL MOTION:");
  const abnormal = walls.filter((w) => w.motion !== "normal");
  if (abnormal.length > 0) {
    parts.push(abnormal.map((w) => `${w.segment}: ${w.motion}`).join("; "));
  } else {
    parts.push("All segments contracting normally.");
  }
  parts.push("");
  parts.push("Generate a structured report with sections: LEFT VENTRICLE, RIGHT VENTRICLE, VALVES, REGIONAL WALL MOTION, DOPPLER, IMPRESSION, RECOMMENDATION.");
  return parts.join("\n");
}

function buildFetalEchoAiPrompt(
  f: typeof fetalEchoStudiesTable.$inferSelect,
): string {
  const parts: string[] = [];
  parts.push("You are an expert pediatric cardiologist. Generate a structured fetal echocardiography report from the following parameters.");
  parts.push("");
  parts.push(`GA: ${f.gaWeeks ?? "-"} weeks ${f.gaDays ?? "-"} days. FHR: ${f.fetalHeartRate ?? "-"} bpm.`);
  parts.push(`Situs: ${f.situs ?? "not documented"}. Cardiac axis: ${f.cardiacAxis ?? "-"}. Position: ${f.cardiacPosition ?? "-"}.`);
  parts.push(`AV concordance: ${f.avConcordance ?? "-"}. VA concordance: ${f.vaConcordance ?? "-"}.`);
  parts.push(`RA: ${f.raNormal ? "normal" : "abnormal"}, LA: ${f.laNormal ? "normal" : "abnormal"}, RV: ${f.rvNormal ? "normal" : "abnormal"}, LV: ${f.lvNormal ? "normal" : "abnormal"}.`);
  parts.push(`Four-chamber view: ${f.fourChamberView ?? "-"}. LVOT: ${f.lvot ?? "-"}. RVOT: ${f.rvot ?? "-"}.`);
  parts.push(`3-vessel view: ${f.threeVesselView ?? "-"}. 3-vessel trachea view: ${f.threeVesselTracheaView ?? "-"}.`);
  parts.push(`Aortic arch: ${f.aorticArch ?? "-"}. Ductal arch: ${f.ductalArch ?? "-"}.`);
  parts.push(`IAS: ${f.interatrialSeptum ?? "-"}. IVS: ${f.interventricularSeptum ?? "-"}.`);
  parts.push(`Mitral valve: ${f.mitralValve ?? "-"}. Tricuspid valve: ${f.tricuspidValve ?? "-"}. Aortic valve: ${f.aorticValve ?? "-"}. Pulmonary valve: ${f.pulmonaryValve ?? "-"}.`);
  parts.push(`Rhythm: ${f.rhythm ?? "-"}. ${f.rhythmNotes ?? ""}`);
  parts.push(`Doppler: UA PI ${f.umbilicalArteryPi ?? "-"}, MCA PI ${f.mcaPi ?? "-"}, DV a-wave ${f.ductusVenoususAWave ?? "-"}.`);
  const abnormals = JSON.parse(f.suspectedAbnormalities ?? "[]") as string[];
  if (abnormals.length > 0) parts.push(`Suspected abnormalities: ${abnormals.join("; ")}`);
  parts.push("");
  parts.push("Generate a structured report with sections: CARDIAC SITUS, FOUR CHAMBER VIEW, OUTFLOW TRACTS, ARCHES, SEPTA, VALVES, RHYTHM, DOPPLER, IMPRESSION, RECOMMENDATION.");
  return parts.join("\n");
}

export default router;
