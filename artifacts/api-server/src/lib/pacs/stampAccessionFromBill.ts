/**
 * STAMP_ACCESSION_FROM_BILL — when a USG bill is created/finalized and Orthanc
 * holds a single-hit study with EMPTY AccessionNumber, stamp 00080050 via
 * Orthanc REST /studies/{id}/modify. The value written is the bill's own CARE
 * accession in the separator-free form the worklist publishes, so the study
 * links by accession afterwards; the bill number is used only when the bill
 * carries several USG studies or an accession that cannot fit SH.
 *
 * Guards:
 *  - Never overwrite a non-empty accession
 *  - Refuse multi-hit or name-only matches
 *  - Offer an accession only when the bill holds exactly one USG study
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
import { DICOM_SH_MAX_BYTES } from "./mwlWorklistWriter";
import { isSingleHitExact, parseStudyDate } from "../studioWorklistBillJoin";

export const STAMP_ACCESSION_FLAG = "STAMP_ACCESSION_FROM_BILL";
export const STAMP_AUDIT_ACTION = "ACCESSION_STAMPED";

/**
 * The accession in the only form a modality may carry — the same separator-free
 * 16-byte key the worklist publishes — or "" when the study's accession cannot
 * fit it. Never the `mwlAccession` tail-slice fallback: half an accession is a
 * key that matches nothing, and this value has to survive accession matching.
 */
export function compactAccessionForStamp(raw: string | null | undefined): string {
  const compact = (raw ?? "").trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return compact && Buffer.byteLength(compact, "utf8") <= DICOM_SH_MAX_BYTES ? compact : "";
}

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

/**
 * Feature-flag precedence — the feature_flags row is authoritative.
 *
 * A disabled (or absent) DB flag keeps stamping dead regardless of the
 * environment variable: an enabled env var must never resurrect a DICOM-write
 * path the database has disabled. Only an explicit DB-enabled row can turn the
 * feature on, and the env var remains a pure kill-switch on top of it — env
 * "0/false/no" still forces the feature off even when the DB row is enabled.
 * This is deliberately stricter than the old "env true wins" short-circuit,
 * which let a stray .env flip override the database and reactivate Orthanc
 * /studies/{id}/modify writes.
 */
export async function isStampAccessionEnabled(): Promise<boolean> {
  const dbEnabled = await isFeatureEnabledServer(STAMP_ACCESSION_FLAG);
  if (!dbEnabled) return false;
  const env = (process.env[STAMP_ACCESSION_FLAG] ?? "").trim().toLowerCase();
  return env !== "0" && env !== "false" && env !== "no";
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
  accessionNumber: string,
): Promise<{ ok: boolean; status: number; body?: string }> {
  const base = orthancBase();
  if (!base) return { ok: false, status: 0, body: "ORTHANC_URL not configured" };

  const resp = await fetch(`${base}/studies/${encodeURIComponent(orthancId)}/modify`, {
    method: "POST",
    headers: orthancHeaders(),
    body: JSON.stringify({
      Replace: { AccessionNumber: accessionNumber },
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
  /**
   * The CARE accession to write, present only when this bill holds exactly one
   * USG study. Writing the accession instead of the bill number puts the same
   * key in (0008,0050) that the worklist published, so the study then links by
   * accession like every other arrival. Withheld when the bill holds several:
   * the Orthanc find cannot tell those studies apart, and a wrong accession is
   * trusted downstream in a way a bill number never is.
   */
  accessionNumber?: string | null;
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
  const stampValue = compactAccessionForStamp(ctx.accessionNumber) || billNumber;

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

  const modified = await modifyOrthancAccession(orthancId, stampValue);
  if (!modified.ok) {
    logger.warn(
      { orthancId, billNumber, stampValue, status: modified.status, body: modified.body },
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
    { studyUid: hit.studyInstanceUID, billNumber, stampValue, orthancId, ymd },
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
        accessionNumber: radiologyStudiesTable.accessionNumber,
      })
      .from(radiologyStudiesTable)
      .where(
        and(
          eq(radiologyStudiesTable.billId, bill.id),
          ne(radiologyStudiesTable.status, "cancelled"),
        ),
      );

    const usgStudies = studies.filter((s) => isUltrasoundModality(s.modality));
    // Only an unambiguous single USG booking may be stamped with its accession.
    const soleAccession = usgStudies.length === 1 ? usgStudies[0]!.accessionNumber : null;

    for (const study of usgStudies) {
      await stampBlankAccessionForBill({
        billId: bill.id,
        billNumber: bill.billNumber,
        patientName,
        modality: study.modality,
        studyDate: study.studyDate || new Date().toISOString().slice(0, 10),
        accessionNumber: soleAccession,
      });
    }
  } catch (err) {
    logger.warn({ err, billId: opts.billId }, "stamp-accession: post-bill hook failed");
  }
}
