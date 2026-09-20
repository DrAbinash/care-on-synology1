/**
 * STAMP_ACCESSION_FROM_BILL — when a USG bill is created/finalized and Orthanc
 * holds a single-hit study with EMPTY AccessionNumber, stamp 00080050 with the
 * bill number via Orthanc REST /studies/{id}/modify.
 *
 * Guards:
 *  - Never overwrite a non-empty accession
 *  - Refuse multi-hit or name-only matches
 *  - Audit every successful stamp (studyUid, billNumber, matchedKey, ts)
 *  - Skip if the same studyUid+billNumber was already stamped (loop guard)
 */
import { db } from "@workspace/db";
import {
  billsTable,
  patientsTable,
  radiologyAuditLogTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { isFeatureEnabledServer } from "../featureFlags";
import { logger } from "../logger";
import { isUltrasoundModality, normalizeModality } from "../usgModality";
import { findOrthancStudies } from "./orthancStudyFind";
import { isSingleHitExact, parseStudyDate } from "../studioWorklistBillJoin";

export const STAMP_ACCESSION_FLAG = "STAMP_ACCESSION_FROM_BILL";
export const STAMP_AUDIT_ACTION = "ACCESSION_STAMPED";

export type StampResult =
  | { ok: true; stamped: true; orthancId: string; studyUid: string; matchedKey: "singleHit" }
  | { ok: true; stamped: false; reason: string }
  | { ok: false; error: string };

function orthancBase(): string | null {
  const raw = process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

function orthancHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (user || pass) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

/** Env override OR feature_flags row — both must be opt-in (default off). */
export async function isStampAccessionEnabled(): Promise<boolean> {
  const env = (process.env[STAMP_ACCESSION_FLAG] ?? "").trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;
  if (env === "0" || env === "false" || env === "no") return false;
  return isFeatureEnabledServer(STAMP_ACCESSION_FLAG);
}

export async function alreadyStamped(studyUid: string, billNumber: string): Promise<boolean> {
  const rows = await db
    .select({ id: radiologyAuditLogTable.id, details: radiologyAuditLogTable.details })
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.action, STAMP_AUDIT_ACTION))
    .orderBy(desc(radiologyAuditLogTable.createdAt))
    .limit(50);

  for (const row of rows) {
    try {
      const d = JSON.parse(row.details ?? "{}") as {
        studyUid?: string;
        billNumber?: string;
      };
      if (d.studyUid === studyUid && d.billNumber === billNumber) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export async function writeStampAudit(opts: {
  studyUid: string;
  billNumber: string;
  matchedKey: string;
  orthancId?: string;
  worklistId?: number | null;
}): Promise<void> {
  await db.insert(radiologyAuditLogTable).values({
    worklistId: opts.worklistId ?? null,
    accessionNumber: opts.billNumber,
    action: STAMP_AUDIT_ACTION,
    actor: "stamp-accession-from-bill",
    details: JSON.stringify({
      studyUid: opts.studyUid,
      billNumber: opts.billNumber,
      matchedKey: opts.matchedKey,
      orthancId: opts.orthancId ?? null,
      ts: new Date().toISOString(),
    }),
  });
}

/**
 * Resolve Orthanc ID for a StudyInstanceUID (exact find).
 */
export async function resolveOrthancStudyId(studyUid: string): Promise<string | null> {
  const base = orthancBase();
  if (!base || !studyUid.trim()) return null;
  try {
    const resp = await fetch(`${base}/tools/find`, {
      method: "POST",
      headers: orthancHeaders(),
      body: JSON.stringify({
        Level: "Study",
        Query: { StudyInstanceUID: studyUid.trim() },
      }),
    });
    if (!resp.ok) return null;
    const ids = (await resp.json()) as string[];
    return Array.isArray(ids) && ids.length === 1 ? ids[0]! : null;
  } catch (err) {
    logger.warn({ err, studyUid }, "stamp-accession: Orthanc find failed");
    return null;
  }
}

/**
 * Read AccessionNumber from Orthanc study shared tags.
 */
export async function readOrthancAccession(orthancId: string): Promise<string> {
  const base = orthancBase();
  if (!base) return "";
  try {
    const resp = await fetch(`${base}/studies/${encodeURIComponent(orthancId)}`, {
      headers: orthancHeaders(),
    });
    if (!resp.ok) return "";
    const body = (await resp.json()) as {
      MainDicomTags?: { AccessionNumber?: string };
    };
    return (body.MainDicomTags?.AccessionNumber ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * POST /studies/{id}/modify — replace AccessionNumber (00080050).
 * KeepSource=false so Orthanc replaces in place; Force=true for stable studies.
 */
export async function modifyOrthancAccession(
  orthancId: string,
  billNumber: string,
): Promise<{ ok: boolean; status: number; body?: string }> {
  const base = orthancBase();
  if (!base) return { ok: false, status: 0, body: "ORTHANC_URL not configured" };

  const resp = await fetch(`${base}/studies/${encodeURIComponent(orthancId)}/modify`, {
    method: "POST",
    headers: orthancHeaders(),
    body: JSON.stringify({
      Replace: { AccessionNumber: billNumber },
      Force: true,
      KeepSource: true,
    }),
  });
  const text = await resp.text().catch(() => "");
  return { ok: resp.ok, status: resp.status, body: text.slice(0, 500) };
}

export type StampBillContext = {
  billId: number;
  billNumber: string;
  patientName: string;
  modality: string;
  studyDate: string; // YYYY-MM-DD or YYYYMMDD
};

/**
 * Core stamp attempt for one billed USG study context.
 * Pure-ish: Orthanc I/O + audit write. Safe to call from bill fan-out.
 */
export async function stampBlankAccessionForBill(
  ctx: StampBillContext,
): Promise<StampResult> {
  if (!(await isStampAccessionEnabled())) {
    return { ok: true, stamped: false, reason: "flag_disabled" };
  }
  if (!isUltrasoundModality(ctx.modality)) {
    return { ok: true, stamped: false, reason: "not_usg" };
  }
  const billNumber = ctx.billNumber.trim();
  if (!billNumber) return { ok: true, stamped: false, reason: "blank_bill_number" };

  const studyDay = parseStudyDate(ctx.studyDate) ?? new Date();
  const ymd = studyDay.toISOString().slice(0, 10);
  const dayBefore = new Date(studyDay.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dayAfter = new Date(studyDay.getTime() + 86_400_000).toISOString().slice(0, 10);

  // Orthanc find: name + date window + modality. Refuse name-only.
  const found = await findOrthancStudies({
    patientName: ctx.patientName,
    dateFrom: dayBefore,
    dateTo: dayAfter,
    modality: normalizeModality(ctx.modality) === "US" ? "US" : ctx.modality,
    limit: 20,
  });

  if (found.error && found.source === "NONE") {
    return { ok: false, error: found.error };
  }

  // Keep only EMPTY accession hits that match modality.
  const blankHits = found.rows.filter((r) => {
    if ((r.accessionNumber ?? "").trim()) return false;
    if (normalizeModality(r.modality) !== normalizeModality(ctx.modality)) return false;
    return true;
  });

  if (!isSingleHitExact({ candidateCount: blankHits.length, nameOnly: false })) {
    return {
      ok: true,
      stamped: false,
      reason: blankHits.length === 0 ? "no_blank_hit" : "multi_hit",
    };
  }

  const hit = blankHits[0]!;
  if (!hit.studyInstanceUID) {
    return { ok: true, stamped: false, reason: "missing_study_uid" };
  }

  if (await alreadyStamped(hit.studyInstanceUID, billNumber)) {
    return { ok: true, stamped: false, reason: "already_stamped" };
  }

  const orthancId = await resolveOrthancStudyId(hit.studyInstanceUID);
  if (!orthancId) {
    return { ok: true, stamped: false, reason: "orthanc_id_unresolved" };
  }

  // Re-check emptiness right before modify (race with another stamp).
  const currentAcc = await readOrthancAccession(orthancId);
  if (currentAcc) {
    return { ok: true, stamped: false, reason: "accession_already_set" };
  }

  const modified = await modifyOrthancAccession(orthancId, billNumber);
  if (!modified.ok) {
    logger.warn(
      { orthancId, billNumber, status: modified.status, body: modified.body },
      "stamp-accession: Orthanc modify failed",
    );
    return { ok: false, error: `orthanc_modify_${modified.status}` };
  }

  await writeStampAudit({
    studyUid: hit.studyInstanceUID,
    billNumber,
    matchedKey: "singleHit",
    orthancId,
  });

  logger.info(
    { studyUid: hit.studyInstanceUID, billNumber, orthancId, ymd },
    "stamp-accession: stamped Orthanc AccessionNumber from bill",
  );

  return {
    ok: true,
    stamped: true,
    orthancId,
    studyUid: hit.studyInstanceUID,
    matchedKey: "singleHit",
  };
}

/**
 * After generateStudiesForOrder — attempt stamp for each USG study on the bill.
 */
export async function maybeStampAccessionsAfterBill(opts: {
  billId: number;
}): Promise<void> {
  try {
    if (!(await isStampAccessionEnabled())) return;

    const [bill] = await db
      .select({
        id: billsTable.id,
        billNumber: billsTable.billNumber,
        patientId: billsTable.patientId,
      })
      .from(billsTable)
      .where(eq(billsTable.id, opts.billId))
      .limit(1);
    if (!bill) return;

    const [patient] = await db
      .select({
        firstName: patientsTable.firstName,
        lastName: patientsTable.lastName,
      })
      .from(patientsTable)
      .where(eq(patientsTable.id, bill.patientId))
      .limit(1);

    const patientName = `${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    if (!patientName) return;

    const studies = await db
      .select({
        modality: radiologyStudiesTable.modality,
        studyDate: radiologyStudiesTable.studyDate,
      })
      .from(radiologyStudiesTable)
      .where(
        and(
          eq(radiologyStudiesTable.billId, bill.id),
          ne(radiologyStudiesTable.status, "cancelled"),
        ),
      );

    for (const study of studies) {
      if (!isUltrasoundModality(study.modality)) continue;
      await stampBlankAccessionForBill({
        billId: bill.id,
        billNumber: bill.billNumber,
        patientName,
        modality: study.modality,
        studyDate: study.studyDate || new Date().toISOString().slice(0, 10),
      });
    }
  } catch (err) {
    logger.warn({ err, billId: opts.billId }, "stamp-accession: post-bill hook failed");
  }
}
