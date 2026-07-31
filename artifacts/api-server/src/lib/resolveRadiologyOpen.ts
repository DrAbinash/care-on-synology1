/**
 * Resolve a CARE billing order (and/or patient) to a radiology_worklist row
 * so external systems (Hope OPD) can deep-link into Reporting Workspace.
 *
 * Prefer: orders.id → radiology_studies.order_id → worklist.study_id
 * Fallback: worklist.patient_id (+ optional modality filter)
 */

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyStudiesTable, radiologyWorklistTable } from "@workspace/db/schema";
import {
  canonicalizeModalityFilter,
  radiologyOpenFallbackPath,
} from "./resolveRadiologyOpenShared";

export type RadiologyOpenTarget = {
  worklistId: number;
  studyId: number | null;
  orderId: number | null;
  patientId: number | null;
  patientName: string;
  modality: string;
  status: string;
  match: "order_study" | "patient_modality";
};

export { canonicalizeModalityFilter, radiologyOpenFallbackPath };

function modalityMatchSql(column: { name: string }, canon: string): SQL {
  if (canon === "MR") {
    return sql`(upper(${column}) IN ('MR', 'MRI') OR upper(${column}) LIKE '%MAGNETIC%')`;
  }
  if (canon === "US") {
    return sql`(upper(${column}) IN ('US', 'USG') OR upper(${column}) LIKE '%ULTRASOUND%' OR upper(${column}) LIKE '%DOPPLER%')`;
  }
  if (canon === "CR") {
    return sql`upper(${column}) IN ('CR', 'DX', 'XR', 'XRAY', 'X-RAY')`;
  }
  return sql`upper(${column}) = ${canon}`;
}

export async function resolveRadiologyOpen(opts: {
  orderId?: number | null;
  patientId?: number | null;
  modality?: string | null;
}): Promise<RadiologyOpenTarget | null> {
  const orderId = opts.orderId != null && Number.isFinite(opts.orderId) && opts.orderId > 0
    ? Math.trunc(opts.orderId)
    : null;
  const patientId = opts.patientId != null && Number.isFinite(opts.patientId) && opts.patientId > 0
    ? Math.trunc(opts.patientId)
    : null;
  const modality = canonicalizeModalityFilter(opts.modality);

  if (orderId != null) {
    const studyConds: SQL[] = [eq(radiologyStudiesTable.orderId, orderId)];
    if (modality) studyConds.push(modalityMatchSql(radiologyStudiesTable.modality, modality));

    const studies = await db
      .select({
        id: radiologyStudiesTable.id,
        patientId: radiologyStudiesTable.patientId,
        modality: radiologyStudiesTable.modality,
        orderId: radiologyStudiesTable.orderId,
      })
      .from(radiologyStudiesTable)
      .where(and(...studyConds))
      .orderBy(desc(radiologyStudiesTable.id))
      .limit(20);

    if (studies.length) {
      const studyIds = studies.map((s) => s.id);
      const wlConds: SQL[] = [inArray(radiologyWorklistTable.studyId, studyIds)];
      if (modality) wlConds.push(modalityMatchSql(radiologyWorklistTable.modality, modality));

      const [wl] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(and(...wlConds))
        .orderBy(desc(radiologyWorklistTable.id))
        .limit(1);

      if (wl) {
        const study = studies.find((s) => s.id === wl.studyId) ?? studies[0]!;
        return {
          worklistId: wl.id,
          studyId: wl.studyId,
          orderId: study.orderId,
          patientId: wl.patientId ?? study.patientId,
          patientName: wl.patientName,
          modality: wl.modality,
          status: wl.status,
          match: "order_study",
        };
      }
    }
  }

  if (patientId != null) {
    const wlConds: SQL[] = [eq(radiologyWorklistTable.patientId, patientId)];
    if (modality) wlConds.push(modalityMatchSql(radiologyWorklistTable.modality, modality));

    // Prefer open / in-progress reporting over already-final studies.
    const [wl] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(and(...wlConds))
      .orderBy(
        sql`CASE
          WHEN ${radiologyWorklistTable.status} IN ('REPORT_IN_PROGRESS', 'AI_DRAFT_READY', 'STUDY_RECEIVED') THEN 0
          WHEN ${radiologyWorklistTable.status} = 'REPORT_FINAL' THEN 1
          ELSE 2
        END`,
        desc(radiologyWorklistTable.id),
      )
      .limit(1);

    if (wl) {
      return {
        worklistId: wl.id,
        studyId: wl.studyId,
        orderId: orderId,
        patientId: wl.patientId,
        patientName: wl.patientName,
        modality: wl.modality,
        status: wl.status,
        match: "patient_modality",
      };
    }
  }

  // Last resort when only orderId is known: any worklist row whose linked
  // study shares the order's patient (order→study patient, no modality hit).
  if (orderId != null && !patientId) {
    const [study] = await db
      .select({ patientId: radiologyStudiesTable.patientId })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.orderId, orderId))
      .orderBy(desc(radiologyStudiesTable.id))
      .limit(1);
    if (study?.patientId) {
      return resolveRadiologyOpen({ orderId: null, patientId: study.patientId, modality });
    }
  }

  return null;
}
