/**
 * Orthanc study purge + ERP imaging-cache scrub.
 *
 * Deletes Orthanc pixel data by StudyDate range (or reconcile-only by UID list),
 * then removes matching ERP imaging/worklist cache rows. Never deletes billing
 * (`radiology_studies`), finalized reports, Form F, or MWL schedule rows.
 */

import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiExtractionResultsTable,
  canonicalStudyTable,
  dicomFailedRetrievalQueueTable,
  dicomIncomingStudiesTable,
  dicomPulledStudiesTable,
  dicomStudiesTable,
  dicomStudySeriesTable,
  pacsArchiveLifecycleTable,
  pacsLogsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  technicianWorkflowTable,
} from "@workspace/db/schema";
import { auditLog } from "../audit";
import { todayIST } from "../istDate";
import { logger } from "../logger";
import {
  PURGE_CONFIRM_PHRASE,
  PURGE_HARD_CAP,
  PURGE_SAMPLE_LIMIT,
  buildStudyDateQuery,
  resolvePurgePeriod as resolvePurgePeriodCore,
  type PurgePeriodInput,
  type PurgePreset,
  type ResolvedPurgePeriod,
} from "./orthancPurgePeriod";

export {
  PURGE_CONFIRM_PHRASE,
  PURGE_HARD_CAP,
  PURGE_SAMPLE_LIMIT,
  type PurgePeriodInput,
  type PurgePreset,
  type ResolvedPurgePeriod,
};

export function resolvePurgePeriod(input: PurgePeriodInput, today = todayIST()): ResolvedPurgePeriod {
  return resolvePurgePeriodCore(input, today);
}

export type OrthancPurgeHit = {
  orthancId: string;
  studyInstanceUID: string;
  accessionNumber: string;
  patientName: string;
  modality: string;
  studyDate: string;
  studyDescription: string | null;
};

export type ErpScrubCounts = {
  dicomStudies: number;
  dicomSeries: number;
  pulled: number;
  failedQueue: number;
  incoming: number;
  archiveLifecycle: number;
  worklistDeleted: number;
  worklistScrubbed: number;
  radiologyStudiesCleared: number;
  canonicalDeleted: number;
  canonicalScrubbed: number;
};

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getOrthancRestBase(): string | null {
  const raw = (process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "").trim();
  return raw ? stripSlash(raw) : null;
}

export function orthancAuthHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  if (!user || !pass) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
  };
}

function normalizeStudyDate(d: string | null | undefined): string {
  if (!d) return "";
  const raw = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

export async function findOrthancStudiesForPurge(
  period: ResolvedPurgePeriod,
  opts?: { max?: number },
): Promise<{ hits: OrthancPurgeHit[]; truncated: boolean; error?: string }> {
  const base = getOrthancRestBase();
  if (!base) return { hits: [], truncated: false, error: "ORTHANC_URL / ORTHANC_INTERNAL_URL not configured" };

  const max = Math.min(Math.max(opts?.max ?? PURGE_HARD_CAP + 1, 1), PURGE_HARD_CAP + 1);
  const studyDate = buildStudyDateQuery(period);
  const auth = orthancAuthHeaders();
  const hits: OrthancPurgeHit[] = [];
  let since = 0;
  let truncated = false;

  // Orthanc /tools/find supports Limit; page with Since when available.
  while (hits.length < max) {
    const pageLimit = Math.min(200, max - hits.length);
    const body: Record<string, unknown> = {
      Level: "Study",
      Query: { StudyDate: studyDate },
      Expand: true,
      Limit: pageLimit,
    };
    if (since > 0) body.Since = since;

    let findResp: Response;
    try {
      findResp = await fetch(`${base}/tools/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        hits,
        truncated,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!findResp.ok) {
      return { hits, truncated, error: `Orthanc /tools/find returned ${findResp.status}` };
    }

    const raw = (await findResp.json()) as Record<string, unknown>[];
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const s of raw) {
      const orthancId = String(s.ID ?? "").trim();
      const mt = (s.MainDicomTags as Record<string, string>) ?? {};
      const pt = (s.PatientMainDicomTags as Record<string, string>) ?? {};
      const uid = (mt.StudyInstanceUID ?? "").trim();
      if (!orthancId || !uid) continue;
      hits.push({
        orthancId,
        studyInstanceUID: uid,
        accessionNumber: mt.AccessionNumber ?? "",
        patientName: pt.PatientName ?? mt.PatientName ?? "",
        modality: mt.ModalitiesInStudy || mt.Modality || "",
        studyDate: normalizeStudyDate(mt.StudyDate ?? null),
        studyDescription: mt.StudyDescription ?? null,
      });
      if (hits.length >= max) {
        truncated = true;
        break;
      }
    }

    since += raw.length;
    if (raw.length < pageLimit) break;
  }

  if (hits.length > PURGE_HARD_CAP) {
    truncated = true;
    hits.length = PURGE_HARD_CAP + 1;
  }

  return { hits, truncated };
}

export async function deleteOrthancStudy(orthancId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const base = getOrthancRestBase();
  if (!base) return { ok: false, error: "Orthanc URL not configured" };
  try {
    const res = await fetch(`${base}/studies/${encodeURIComponent(orthancId)}`, {
      method: "DELETE",
      headers: orthancAuthHeaders(),
    });
    if (res.status === 404) return { ok: true, status: 404 }; // already gone
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function emptyScrubCounts(): ErpScrubCounts {
  return {
    dicomStudies: 0,
    dicomSeries: 0,
    pulled: 0,
    failedQueue: 0,
    incoming: 0,
    archiveLifecycle: 0,
    worklistDeleted: 0,
    worklistScrubbed: 0,
    radiologyStudiesCleared: 0,
    canonicalDeleted: 0,
    canonicalScrubbed: 0,
  };
}

const PRESERVE_WORKLIST_STATUSES = new Set(["REPORT_FINAL", "DELIVERED"]);

export async function scrubErpStudyCache(studyInstanceUIDs: string[]): Promise<ErpScrubCounts> {
  const uids = [...new Set(studyInstanceUIDs.map((u) => u.trim()).filter(Boolean))];
  const counts = emptyScrubCounts();
  if (uids.length === 0) return counts;

  // dicom_studies + children
  const dicomRows = await db
    .select({ id: dicomStudiesTable.id, studyInstanceUID: dicomStudiesTable.studyInstanceUID })
    .from(dicomStudiesTable)
    .where(inArray(dicomStudiesTable.studyInstanceUID, uids));
  const dicomIds = dicomRows.map((r) => r.id);
  if (dicomIds.length > 0) {
    const series = await db
      .delete(dicomStudySeriesTable)
      .where(inArray(dicomStudySeriesTable.studyId, dicomIds))
      .returning({ id: dicomStudySeriesTable.id });
    counts.dicomSeries = series.length;

    await db.delete(aiExtractionResultsTable).where(inArray(aiExtractionResultsTable.studyId, dicomIds));
    await db.delete(technicianWorkflowTable).where(inArray(technicianWorkflowTable.studyId, dicomIds));
    // Keep dicom_study_audit_log rows (append-only); they may orphan study_id.

    const deleted = await db
      .delete(dicomStudiesTable)
      .where(inArray(dicomStudiesTable.id, dicomIds))
      .returning({ id: dicomStudiesTable.id });
    counts.dicomStudies = deleted.length;
  }

  const pulled = await db
    .delete(dicomPulledStudiesTable)
    .where(inArray(dicomPulledStudiesTable.studyInstanceUID, uids))
    .returning({ id: dicomPulledStudiesTable.id });
  counts.pulled = pulled.length;

  const failed = await db
    .delete(dicomFailedRetrievalQueueTable)
    .where(inArray(dicomFailedRetrievalQueueTable.studyInstanceUID, uids))
    .returning({ id: dicomFailedRetrievalQueueTable.id });
  counts.failedQueue = failed.length;

  const incoming = await db
    .delete(dicomIncomingStudiesTable)
    .where(inArray(dicomIncomingStudiesTable.studyInstanceUID, uids))
    .returning({ id: dicomIncomingStudiesTable.id });
  counts.incoming = incoming.length;

  const archive = await db
    .delete(pacsArchiveLifecycleTable)
    .where(inArray(pacsArchiveLifecycleTable.studyInstanceUID, uids))
    .returning({ id: pacsArchiveLifecycleTable.id });
  counts.archiveLifecycle = archive.length;

  // Worklist: delete only when no report and not final; else scrub imaging fields
  const worklists = await db
    .select({
      id: radiologyWorklistTable.id,
      reportId: radiologyWorklistTable.reportId,
      status: radiologyWorklistTable.status,
    })
    .from(radiologyWorklistTable)
    .where(inArray(radiologyWorklistTable.studyInstanceUID, uids));

  const toDelete: number[] = [];
  const toScrub: number[] = [];
  for (const w of worklists) {
    if (w.reportId == null && !PRESERVE_WORKLIST_STATUSES.has(w.status)) {
      toDelete.push(w.id);
    } else {
      toScrub.push(w.id);
    }
  }

  if (toDelete.length > 0) {
    const deleted = await db
      .delete(radiologyWorklistTable)
      .where(inArray(radiologyWorklistTable.id, toDelete))
      .returning({ id: radiologyWorklistTable.id });
    counts.worklistDeleted = deleted.length;
  }

  if (toScrub.length > 0) {
    const scrubbed = await db
      .update(radiologyWorklistTable)
      .set({
        studyInstanceUID: null,
        weasisUrl: null,
        dicomMetadata: null,
        sourcePacs: null,
        sourceAeTitle: null,
        aeTitle: null,
        ipAddress: null,
        port: null,
        lockUserId: null,
        lockUserName: null,
        lockTime: null,
        lockLastActivityAt: null,
        lockWorkstation: null,
        updatedAt: new Date(),
      })
      .where(inArray(radiologyWorklistTable.id, toScrub))
      .returning({ id: radiologyWorklistTable.id });
    counts.worklistScrubbed = scrubbed.length;
  }

  // Billing spine: clear PACS linkage only
  const cleared = await db
    .update(radiologyStudiesTable)
    .set({
      studyInstanceUid: null,
      pacsInstanceId: null,
      updatedAt: new Date(),
    })
    .where(inArray(radiologyStudiesTable.studyInstanceUid, uids))
    .returning({ id: radiologyStudiesTable.id });
  counts.radiologyStudiesCleared = cleared.length;

  // Canonical crosswalk
  const canonical = await db
    .select({
      id: canonicalStudyTable.id,
      radiologyStudyId: canonicalStudyTable.radiologyStudyId,
    })
    .from(canonicalStudyTable)
    .where(inArray(canonicalStudyTable.studyInstanceUid, uids));

  const canonDelete: number[] = [];
  const canonScrub: number[] = [];
  for (const c of canonical) {
    if (c.radiologyStudyId == null) canonDelete.push(c.id);
    else canonScrub.push(c.id);
  }
  if (canonDelete.length > 0) {
    const deleted = await db
      .delete(canonicalStudyTable)
      .where(inArray(canonicalStudyTable.id, canonDelete))
      .returning({ id: canonicalStudyTable.id });
    counts.canonicalDeleted = deleted.length;
  }
  if (canonScrub.length > 0) {
    const scrubbed = await db
      .update(canonicalStudyTable)
      .set({
        worklistId: null,
        dicomIncomingId: null,
        updatedAt: new Date(),
      })
      .where(inArray(canonicalStudyTable.id, canonScrub))
      .returning({ id: canonicalStudyTable.id });
    counts.canonicalScrubbed = scrubbed.length;
  }

  return counts;
}

export async function logPurgeEvent(opts: {
  message: string;
  studyInstanceUIDs?: string[];
  payload?: unknown;
  severity?: string;
}): Promise<void> {
  try {
    await db.insert(pacsLogsTable).values({
      logType: "orthanc_purge",
      severity: opts.severity ?? "warning",
      source: "care-erp",
      eventType: "ORTHANC_PURGE",
      message: opts.message,
      studyInstanceUid: opts.studyInstanceUIDs?.[0] ?? null,
      payload: opts.payload ? JSON.stringify(opts.payload).slice(0, 60000) : null,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to write pacs_logs for Orthanc purge");
  }
}

export async function runOrthancPurge(opts: {
  period: ResolvedPurgePeriod;
  forceLarge?: boolean;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
}): Promise<{
  orthancDeleted: number;
  orthancFailed: Array<{ orthancId: string; studyInstanceUID: string; error: string }>;
  erp: ErpScrubCounts;
  count: number;
  truncated: boolean;
  label: string;
}> {
  const found = await findOrthancStudiesForPurge(opts.period);
  if (found.error) throw new Error(found.error);

  const overCap = found.hits.length > PURGE_HARD_CAP;
  if (overCap && !opts.forceLarge) {
    throw new Error(
      `Preview matched more than ${PURGE_HARD_CAP} studies. Narrow the date range or pass forceLarge: true.`,
    );
  }

  const targets = overCap ? found.hits.slice(0, PURGE_HARD_CAP) : found.hits;
  const orthancFailed: Array<{ orthancId: string; studyInstanceUID: string; error: string }> = [];
  const deletedUids: string[] = [];

  for (const hit of targets) {
    const result = await deleteOrthancStudy(hit.orthancId);
    if (!result.ok) {
      orthancFailed.push({
        orthancId: hit.orthancId,
        studyInstanceUID: hit.studyInstanceUID,
        error: result.error || `HTTP ${result.status}`,
      });
      continue;
    }
    deletedUids.push(hit.studyInstanceUID);
  }

  const erp = await scrubErpStudyCache(deletedUids);

  void auditLog({
    userId: opts.actorUserId ?? undefined,
    userName: opts.actorName ?? "system",
    role: opts.actorRole ?? "admin",
    action: "orthanc_purge",
    module: "radiology",
    entityType: "orthanc_studies",
    newValue: JSON.stringify({
      label: opts.period.label,
      orthancDeleted: deletedUids.length,
      orthancFailed: orthancFailed.length,
      erp,
    }),
  });

  await logPurgeEvent({
    message: `Orthanc purge: deleted ${deletedUids.length} studies (${opts.period.label})`,
    studyInstanceUIDs: deletedUids,
    payload: {
      period: opts.period,
      orthancDeleted: deletedUids.length,
      orthancFailed,
      erp,
    },
  });

  return {
    orthancDeleted: deletedUids.length,
    orthancFailed,
    erp,
    count: targets.length,
    truncated: found.truncated || overCap,
    label: opts.period.label,
  };
}
