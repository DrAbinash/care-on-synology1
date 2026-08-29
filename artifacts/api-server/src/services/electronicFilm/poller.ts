// ============================================================================
// Poll DicomToWindows for completed electronic film jobs and import into CARE.
// ============================================================================
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, electronicFilmArtifactsTable } from "@workspace/db";
import { getElectronicFilmSettings, resolveBridgeCredentials } from "./settings";
import { matchElectronicFilmToStudy } from "./matcher";
import {
  mintFilmAccessToken,
  storeElectronicFilmBytes,
} from "./storage";
import { enqueueElectronicFilmToHope } from "./hopeEmitter";

interface BridgeJob {
  jobKey: string;
  source?: string;
  captureStatus?: string;
  receivedAt?: string;
  completedAt?: string;
  imageCount?: number;
  pages?: number;
  patientId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyInstanceUID?: string;
  modality?: string;
  sourceCallingAE?: string;
  filmSessionUID?: string;
  identitySummary?: { status?: string };
  artifactFormat?: string;
  importedAt?: string;
}

export interface PollResult {
  discovered: number;
  imported: number;
  matchRequired: number;
  skipped: number;
  errors: number;
}

async function bridgeFetch(path: string, creds: { url: string; secret: string }): Promise<Response> {
  const url = `${creds.url}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    headers: { Authorization: `Bearer ${creds.secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
}

export async function pollElectronicFilmJobs(): Promise<PollResult> {
  const settings = await getElectronicFilmSettings();
  const result: PollResult = { discovered: 0, imported: 0, matchRequired: 0, skipped: 0, errors: 0 };

  if (!settings.integrationEnabled || !settings.autoImport) {
    return result;
  }

  const creds = await resolveBridgeCredentials();
  if (!creds) {
    console.warn("[electronic-film] bridge not configured");
    return result;
  }

  const listRes = await bridgeFetch("/api/v1/print-jobs?limit=100&source=DICOM", creds);
  if (!listRes.ok) {
    console.warn("[electronic-film] job list failed", listRes.status);
    result.errors++;
    return result;
  }

  const body = await listRes.json() as { jobs?: BridgeJob[] };
  const jobs = body.jobs ?? [];
  const cutover = settings.importEnabledAt ? new Date(settings.importEnabledAt) : null;

  for (const job of jobs) {
    if (job.captureStatus !== "captured") continue;
    if (cutover && job.receivedAt && new Date(job.receivedAt) < cutover) {
      result.skipped++;
      continue;
    }

    const [existing] = await db
      .select({ id: electronicFilmArtifactsTable.id })
      .from(electronicFilmArtifactsTable)
      .where(and(
        eq(electronicFilmArtifactsTable.sourceSystem, "DICOMTOWINDOWS"),
        eq(electronicFilmArtifactsTable.sourceJobKey, job.jobKey),
      ))
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
    }

    result.discovered++;
    try {
      await importBridgeJob(job, creds, settings.autoSendHope);
      if (await wasMatchRequired(job.jobKey)) result.matchRequired++;
      else result.imported++;
    } catch (e) {
      console.error("[electronic-film] import failed", job.jobKey, (e as Error)?.message);
      result.errors++;
    }
  }

  return result;
}

async function wasMatchRequired(jobKey: string): Promise<boolean> {
  const [row] = await db
    .select({ ingestStatus: electronicFilmArtifactsTable.ingestStatus })
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.sourceJobKey, jobKey))
    .limit(1);
  return row?.ingestStatus === "MATCH_REQUIRED";
}

async function importBridgeJob(
  job: BridgeJob,
  creds: { url: string; secret: string },
  autoSendHope: boolean,
): Promise<void> {
  const correlationId = randomUUID();
  const identityStatus = job.identitySummary?.status ?? "UNMATCHED";

  const [row] = await db
    .insert(electronicFilmArtifactsTable)
    .values({
      sourceSystem: "DICOMTOWINDOWS",
      sourceJobKey: job.jobKey,
      ingestStatus: "DISCOVERED",
      dicomPatientId: job.patientId || null,
      accessionNumber: job.accessionNumber || null,
      studyInstanceUid: job.studyInstanceUID || null,
      modality: job.modality || null,
      sourceAe: job.sourceCallingAE || null,
      filmSessionUid: job.filmSessionUID || null,
      imageCount: job.imageCount ?? null,
      pageCount: job.pages ?? null,
      identitySummary: identityStatus,
      sourceCreatedAt: job.completedAt ? new Date(job.completedAt) : job.receivedAt ? new Date(job.receivedAt) : null,
      correlationId,
      accessToken: mintFilmAccessToken(),
    })
    .returning();

  const artifactId = row.id;

  await db
    .update(electronicFilmArtifactsTable)
    .set({ ingestStatus: "FETCHING", updatedAt: new Date() })
    .where(eq(electronicFilmArtifactsTable.id, artifactId));

  const artifactRes = await bridgeFetch(`/api/v1/print-jobs/${encodeURIComponent(job.jobKey)}/artifact`, creds);
  if (!artifactRes.ok) {
    await db
      .update(electronicFilmArtifactsTable)
      .set({
        ingestStatus: "FAILED",
        errorMessage: `artifact_fetch_http_${artifactRes.status}`,
        updatedAt: new Date(),
      })
      .where(eq(electronicFilmArtifactsTable.id, artifactId));
    return;
  }

  const mimeType = artifactRes.headers.get("content-type") || "application/pdf";
  const bytes = Buffer.from(await artifactRes.arrayBuffer());

  await db
    .update(electronicFilmArtifactsTable)
    .set({ ingestStatus: "FETCHED", mimeType, updatedAt: new Date() })
    .where(eq(electronicFilmArtifactsTable.id, artifactId));

  const version = await resolveVersion(job, bytes);
  const stored = storeElectronicFilmBytes(bytes, {
    jobKey: job.jobKey,
    mimeType,
    version,
  });

  const match = await matchElectronicFilmToStudy({
    studyInstanceUid: job.studyInstanceUID,
    accessionNumber: job.accessionNumber,
    modality: job.modality,
    dicomPatientId: job.patientId,
  });

  if (match.status === "MATCHED" && match.studyId) {
    await supersedePreviousVersions(match.studyId, artifactId);
    await db
      .update(electronicFilmArtifactsTable)
      .set({
        ingestStatus: "STORED",
        studyId: match.studyId,
        orderId: match.orderId,
        patientId: match.patientId,
        matchMethod: match.matchMethod,
        matchedAt: new Date(),
        matchLocked: true,
        filePath: stored.filePath,
        fileName: stored.fileName,
        artifactHash: stored.artifactHash,
        version,
        isCurrent: true,
        updatedAt: new Date(),
      })
      .where(eq(electronicFilmArtifactsTable.id, artifactId));

    if (autoSendHope) {
      await enqueueElectronicFilmToHope(artifactId);
    }
  } else {
    await db
      .update(electronicFilmArtifactsTable)
      .set({
        ingestStatus: "MATCH_REQUIRED",
        filePath: stored.filePath,
        fileName: stored.fileName,
        artifactHash: stored.artifactHash,
        version,
        isCurrent: true,
        updatedAt: new Date(),
      })
      .where(eq(electronicFilmArtifactsTable.id, artifactId));
  }
}

async function resolveVersion(job: BridgeJob, bytes: Buffer): Promise<number> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!job.studyInstanceUID && !job.accessionNumber) return 1;

  const conditions = [];
  if (job.studyInstanceUID) {
    const rows = await db
      .select({ id: electronicFilmArtifactsTable.id, artifactHash: electronicFilmArtifactsTable.artifactHash, version: electronicFilmArtifactsTable.version })
      .from(electronicFilmArtifactsTable)
      .where(eq(electronicFilmArtifactsTable.studyInstanceUid, job.studyInstanceUID));
    const dup = rows.find((r) => r.artifactHash === hash);
    if (dup) return dup.version;
    const maxV = rows.reduce((m, r) => Math.max(m, r.version ?? 1), 0);
    return maxV + 1;
  }
  return 1;
}

async function supersedePreviousVersions(studyId: number, newId: number): Promise<void> {
  const prev = await db
    .select({ id: electronicFilmArtifactsTable.id })
    .from(electronicFilmArtifactsTable)
    .where(and(
      eq(electronicFilmArtifactsTable.studyId, studyId),
      eq(electronicFilmArtifactsTable.isCurrent, true),
    ));
  for (const p of prev) {
    if (p.id === newId) continue;
    await db
      .update(electronicFilmArtifactsTable)
      .set({ isCurrent: false, supersededById: newId, updatedAt: new Date() })
      .where(eq(electronicFilmArtifactsTable.id, p.id));
  }
}

export async function manualMatchFilm(
  artifactId: number,
  studyId: number,
  matchedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const [art] = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.id, artifactId))
    .limit(1);
  if (!art) return { ok: false, error: "not_found" };
  if (art.matchLocked && art.studyId) return { ok: false, error: "already_locked" };

  const { radiologyStudiesTable } = await import("@workspace/db");
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);
  if (!study) return { ok: false, error: "study_not_found" };

  await supersedePreviousVersions(studyId, artifactId);
  await db
    .update(electronicFilmArtifactsTable)
    .set({
      ingestStatus: "STORED",
      studyId: study.id,
      orderId: study.orderId,
      patientId: study.patientId,
      matchMethod: "MANUAL",
      matchedBy,
      matchedAt: new Date(),
      matchLocked: true,
      updatedAt: new Date(),
    })
    .where(eq(electronicFilmArtifactsTable.id, artifactId));

  const settings = await getElectronicFilmSettings();
  if (settings.autoSendHope) {
    await enqueueElectronicFilmToHope(artifactId);
  }
  return { ok: true };
}
