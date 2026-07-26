// pathologyFlagPreview.ts — flag-preview for the pathology result-entry grid
// (ReportHub.tsx).
//
// The Universal Pathology Analyte & Panel Registry (@workspace/pathology)
// already exposes a flag-preview endpoint at POST /api/pathology-registry/flag
// — but that router is mounted admin-only (requireStaffAuth +
// requireAdminRole, routes/index.ts), which the ordinary reporting staff
// entering results in the result-entry grid do not have. This route wraps
// the exact same pure flagValue()/resolveReferenceInterval() functions
// behind the permission the grid itself already requires ("/reports"), and
// resolves the patient's sex/age server-side from patientId so the frontend
// never needs to look them up or send them.
//
// Pure computation plus one read-only patient lookup; no report data is
// read or written here.

import { Router, type IRouter } from "express";
import { db, patientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveAnalyte, flagValue, resolveReferenceInterval, type PatientContext } from "@workspace/pathology";

export const pathologyFlagPreviewRouter: IRouter = Router();

function ageFromDob(dob: string | null | undefined): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

pathologyFlagPreviewRouter.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patientId = Number(body.patientId);
  const analyteInput = String(body.analyte ?? "").trim();
  if (!Number.isInteger(patientId) || patientId < 1 || !analyteInput) {
    res.status(400).json({ error: "patientId and analyte are required" });
    return;
  }

  const hit = resolveAnalyte(analyteInput);
  if (!hit) {
    res.status(404).json({ error: `unknown analyte "${analyteInput}"` });
    return;
  }

  const [patient] = await db
    .select({ gender: patientsTable.gender, dateOfBirth: patientsTable.dateOfBirth })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId));

  const ctx: PatientContext = {
    sex: patient?.gender,
    ageYears: ageFromDob(patient?.dateOfBirth),
  };
  const unit = typeof body.unit === "string" && body.unit ? body.unit : undefined;
  const result = flagValue(hit.definition, body.value, ctx, unit);
  const referenceRange = resolveReferenceInterval(hit.definition, ctx);
  res.json({ analyteId: hit.definition.id, displayName: hit.definition.displayName, result, referenceRange });
});
