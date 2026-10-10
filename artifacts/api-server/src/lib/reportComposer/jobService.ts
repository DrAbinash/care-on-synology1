/**
 * Background AI Report Composer job service.
 *
 * Canonical input model (Guard 8): Model B — frozen snapshot is authoritative.
 * Server verifies revision/hashes from the snapshot and against persisted report
 * when present. Worker never re-reads the live editor.
 *
 * Apply is CLIENT-SIDE through Zustand/pathologyPatch (Guard 3) — server only
 * records applied/discarded after client confirms, or marks APPLIED metadata.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiReportComposeJobsTable,
  radiologyWorklistTable,
  patientReportsTable,
  clinicSettingsTable,
  type AiComposeJobKind,
  type AiComposeJobStatus,
} from "@workspace/db/schema";
import { enqueueRadiologyJob } from "../radiologyJobs";
import {
  ComposerInputSnapshotSchema,
  COMPOSER_MAX_SELECTED_KEY_IMAGES,
  type ComposerInputSnapshot,
  type TrackedChange,
} from "./types";
import { computeSnapshotHashes, dedupeObservations, isComposeJobStale, summarizeSources } from "./snapshot";
import { runReportComposer } from "./composeEngine";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges } from "./trackedChanges";
import {
  resolveVerifiedComposeIdentity,
  verifyComposeJobIdentity,
  type ComposeStudyRefs,
} from "./composeIdentity";
import {
  captureComposeBaseline,
  verifyComposeDurabilityTx,
  type ComposeAcceptedField,
} from "./composePersistence";

export const AI_REPORT_COMPOSE_JOB = "ai_report_compose";

function executeComposeRows<T>(res: unknown): T[] {
  const withRows = res as { rows?: T[] };
  if (Array.isArray(withRows.rows)) return withRows.rows;
  return Array.isArray(res) ? (res as T[]) : [];
}

const ACTIVE = ["QUEUED", "COMPOSING"] as const;
const TERMINAL_FOR_DEDUPE = ["QUEUED", "COMPOSING"] as const;

export type EnqueueComposeArgs = {
  snapshot: unknown;
  jobKind?: AiComposeJobKind;
  createdBy?: string;
  createdByStaffId?: number | null;
  /** Optional client hint of persisted report content hash — verified server-side. */
  persistedContentToken?: string | null;
};

export type EnqueueComposeResult =
  | { ok: true; jobId: number; deduped: boolean; status: string; reportRevision: string; inputHash: string; sources: Record<string, number> }
  | { ok: false; error: string; code?: string };

function priorityForKind(kind: AiComposeJobKind): number {
  // Lower number = higher priority in our table; claim order uses this + FIFO.
  // selection/section > full compose > overnight (overnight is separate queue lane)
  switch (kind) {
    case "SELECTION_EDIT":
    case "SECTION_EDIT":
    case "REPHRASE":
    case "SHORTEN":
    case "EXPAND":
    case "TRANSLATE":
      return 10;
    case "IMPRESSION":
      return 20;
    case "FULL_REPORT":
    default:
      return 40;
  }
}

async function loadPersistedReportToken(reportId: number | null | undefined): Promise<{
  status: string | null;
  token: string | null;
  finalized: boolean;
  /** A reportId was supplied but its row could not be read — which is NOT the
   * same as "not finalized". Callers must refuse rather than treat an
   * unreadable report as an open one. */
  unresolved: boolean;
}> {
  if (!reportId) return { status: null, token: null, finalized: false, unresolved: false };
  if (!Number.isInteger(reportId)) return { status: null, token: null, finalized: false, unresolved: true };
  try {
    const [row] = await db
      .select({
        status: patientReportsTable.status,
        impression: patientReportsTable.impression,
        body: patientReportsTable.body,
      })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, reportId))
      .limit(1);
    if (!row) return { status: null, token: null, finalized: false, unresolved: true };
    const finalized = ["final", "FINAL", "signed", "SIGNED", "amended", "verified", "delivered"].includes(
      String(row.status),
    );
    const token = createHash("sha256")
      .update(`${row.body ?? ""}\u001e${row.impression ?? ""}`)
      .digest("hex")
      .slice(0, 32);
    return { status: row.status, token, finalized, unresolved: false };
  } catch {
    return { status: null, token: null, finalized: false, unresolved: true };
  }
}

async function getComposerSettings(): Promise<{
  backgroundEnabled: boolean;
  concurrency: number;
  retentionDays: number;
}> {
  try {
    const [row] = await db
      .select({
        backgroundEnabled: clinicSettingsTable.reportComposerBackgroundEnabled,
        concurrency: clinicSettingsTable.reportComposerConcurrency,
        retentionDays: clinicSettingsTable.reportComposerSnapshotRetentionDays,
      })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);
    return {
      backgroundEnabled: row?.backgroundEnabled !== false,
      concurrency: Math.max(1, Math.min(3, Number(row?.concurrency ?? 1))),
      retentionDays: Math.max(1, Math.min(90, Number(row?.retentionDays ?? 14))),
    };
  } catch {
    return { backgroundEnabled: true, concurrency: 1, retentionDays: 14 };
  }
}

export async function enqueueComposeJob(args: EnqueueComposeArgs): Promise<EnqueueComposeResult> {
  const settings = await getComposerSettings();
  if (!settings.backgroundEnabled) {
    return { ok: false, error: "Background report composer is disabled", code: "disabled" };
  }

  const parsed = ComposerInputSnapshotSchema.safeParse(args.snapshot);
  if (!parsed.success) {
    return { ok: false, error: "Invalid composition snapshot", code: "bad_snapshot" };
  }

  const snapshot: ComposerInputSnapshot = {
    ...parsed.data,
    observations: dedupeObservations(parsed.data.observations ?? []),
  };
  const jobKind = (args.jobKind ?? "FULL_REPORT") as AiComposeJobKind;
  snapshot.jobKindHint = jobKind;

  // Normalize / gate AI mode: IMPRESSION + micro-edits are always text-only.
  const textOnlyKinds = new Set([
    "IMPRESSION",
    "SELECTION_EDIT",
    "SECTION_EDIT",
    "REPHRASE",
    "SHORTEN",
    "EXPAND",
    "TRANSLATE",
  ]);
  if (textOnlyKinds.has(jobKind) || !snapshot.aiMode) {
    snapshot.aiMode = "TEXT_ONLY";
    snapshot.selectedKeyImages = [];
  }
  if (snapshot.aiMode === "SELECTED_IMAGES") {
    const refs = snapshot.selectedKeyImages ?? [];
    if (refs.length === 0) {
      return {
        ok: false,
        error: "Selected-image drafting requires at least one AI-selected key image.",
        code: "selected_images_empty",
      };
    }
    if (refs.length > COMPOSER_MAX_SELECTED_KEY_IMAGES) {
      return {
        ok: false,
        error: `At most ${COMPOSER_MAX_SELECTED_KEY_IMAGES} key images may be selected for AI.`,
        code: "selected_images_limit",
      };
    }
    // Never persist base64 / data URLs in the frozen snapshot (client must not send them).
    for (const ref of refs) {
      const caption = ref.caption ?? "";
      if (/^data:image\//i.test(caption) || caption.length > 2000) {
        return {
          ok: false,
          error: "Invalid key-image metadata in composition snapshot.",
          code: "bad_image_ref",
        };
      }
    }
  }

  const hashes = computeSnapshotHashes(snapshot);

  // Server-verified revision: if client sent a hint that disagrees with snapshot-derived revision, reject.
  if (snapshot.clientRevisionHint && snapshot.clientRevisionHint !== hashes.reportRevision) {
    // Allow if client hint is a prior hash they think they have — treat as stale browser state
    return {
      ok: false,
      error: "Browser report state is outdated relative to the composition snapshot. Refresh and try again.",
      code: "stale_browser",
    };
  }

  const worklistRef = snapshot.worklistId ?? null;
  const studyRef = snapshot.studyId ?? null;
  const reportRef = snapshot.reportId ?? null;

  // Server-verified study identity. The snapshot's ids are references to look
  // up, never evidence of whose study this is: a job must not be able to name
  // Patient A's worklist row while its clinical text came from Patient B's
  // screen, and it must not be able to name a row that does not exist. The
  // frozen snapshot itself is left byte-for-byte untouched (Model B) — only the
  // job's own identity columns carry the resolved values.
  const identity = await resolveVerifiedComposeIdentity({
    worklistId: worklistRef,
    studyId: studyRef,
    reportId: reportRef,
  });
  if (!identity.ok) {
    return { ok: false, error: identity.message, code: identity.code };
  }
  const worklistId = identity.identity.worklistId;
  const reportId = identity.identity.reportId;
  const persisted = await loadPersistedReportToken(reportId);
  if (persisted.finalized) {
    return { ok: false, error: "Report is finalized — composition not allowed", code: "finalized" };
  }
  if (persisted.unresolved) {
    // `resolveVerifiedComposeIdentity` already proved this reportId belongs to
    // this worklist, so an unreadable row means it went away mid-request.
    return {
      ok: false,
      error: "CARE could not read the report for this study. Nothing was queued — try again.",
      code: "compose_identity_unavailable",
    };
  }
  if (args.persistedContentToken && persisted.token && args.persistedContentToken !== persisted.token) {
    return {
      ok: false,
      error: "Persisted report changed in another session. Re-open the study and compose again.",
      code: "stale_persisted",
    };
  }

  // Server-derived persistence baseline.
  //
  // `args.persistedContentToken` above and the four `source*Hash` columns below
  // are all the browser's own account of the text in its editor. None of them
  // says what the database held, which is the thing an Apply has to be checked
  // against — a second workstation's save, a reload, or a draft that was never
  // saved at all are indistinguishable from that side. So the job records the
  // token of the study's authoritative draft row as the server read it here,
  // before the AI is asked to draft, and Apply is only ever allowed against
  // that. `patient_reports` cannot carry this duty: a workspace study has no
  // such row until it is signed.
  const baseline = await captureComposeBaseline(worklistId, identity.identity.patientId);
  if (!baseline.ok) {
    return { ok: false, error: baseline.message, code: baseline.code };
  }

  // Dedupe active identical jobs
  if (worklistId) {
    const [existing] = await db
      .select()
      .from(aiReportComposeJobsTable)
      .where(
        and(
          eq(aiReportComposeJobsTable.worklistId, worklistId),
          eq(aiReportComposeJobsTable.sourceReportRevision, hashes.reportRevision),
          eq(aiReportComposeJobsTable.inputHash, hashes.inputHash),
          eq(aiReportComposeJobsTable.jobKind, jobKind),
          inArray(aiReportComposeJobsTable.status, [...TERMINAL_FOR_DEDUPE]),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        ok: true,
        jobId: existing.id,
        deduped: true,
        status: existing.status,
        reportRevision: hashes.reportRevision,
        inputHash: hashes.inputHash,
        sources: summarizeSources(snapshot.observations),
      };
    }
  }

  const [inserted] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(aiReportComposeJobsTable)
      .values({
        // Resolved server-side from the worklist row, not from the browser:
        // study_id holds the billed radiology_studies.id that row points at,
        // worklist_id its primary key, report_id the report of record bound to it.
        studyId: identity.identity.studyId,
        worklistId,
        reportId,
        jobKind,
        status: "QUEUED",
        sourceReportRevision: hashes.reportRevision,
        sourceFindingsHash: hashes.findingsHash,
        sourceImpressionHash: hashes.impressionHash,
        sourceRecommendationHash: hashes.recommendationHash,
        inputHash: hashes.inputHash,
        inputSnapshotJson: JSON.stringify(snapshot),
        createdBy: args.createdBy ?? null,
        createdByStaffId: args.createdByStaffId ?? null,
        priority: priorityForKind(jobKind),
      })
      .returning();

    // The server-derived baseline, written in the same transaction as the job so
    // a job can never exist without the evidence that says what the saved report
    // held when the AI was asked to draft it. Raw SQL because these columns are
    // only ever touched transactionally (see composePersistence.ts) and because
    // the insert must not become two commits.
    await tx.execute(sql`
      UPDATE ai_report_compose_jobs
         SET source_persisted_token = ${baseline.token},
             source_draft_id = ${baseline.draftId},
             applied_persisted_token = NULL
       WHERE id = ${row.id}`);
    return [row];
  });

  const queue = await enqueueRadiologyJob({
    operationType: AI_REPORT_COMPOSE_JOB,
    entityType: "ai_report_compose_job",
    entityId: inserted.id,
    payload: { composeJobId: inserted.id, jobKind, priority: priorityForKind(jobKind) },
    idempotencyKey: `ai:compose:${worklistId ?? "x"}:${hashes.reportRevision}:${hashes.inputHash}:${jobKind}`,
    maxRetries: 2,
  });

  await db
    .update(aiReportComposeJobsTable)
    .set({ queueJobId: queue.id > 0 ? queue.id : null, updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, inserted.id));

  if (worklistId) {
    await db
      .update(radiologyWorklistTable)
      .set({
        aiComposeStatus: "QUEUED",
        aiComposeJobId: inserted.id,
        aiComposeUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, worklistId));
  }

  return {
    ok: true,
    jobId: inserted.id,
    deduped: false,
    status: "QUEUED",
    reportRevision: hashes.reportRevision,
    inputHash: hashes.inputHash,
    sources: summarizeSources(snapshot.observations),
  };
}

export async function processComposeJob(composeJobId: number): Promise<{ ok: boolean; detail?: string }> {
  const [job] = await db
    .select()
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.id, composeJobId))
    .limit(1);
  if (!job) return { ok: true, detail: "compose job missing — no-op" };
  if (["APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE"].includes(job.status)) {
    return { ok: true, detail: `already ${job.status}` };
  }

  // Finalized report → OBSOLETE, never mutate
  const persisted = await loadPersistedReportToken(job.reportId);
  if (persisted.finalized) {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "OBSOLETE", completedAt: new Date(), safeError: "report_finalized", updatedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, job.id));
    await syncWorklistStatus(job.worklistId, "OBSOLETE", job.id);
    return { ok: true, detail: "obsolete — finalized" };
  }

  await db
    .update(aiReportComposeJobsTable)
    .set({ status: "COMPOSING", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, job.id));
  await syncWorklistStatus(job.worklistId, "COMPOSING", job.id);

  let snapshot: ComposerInputSnapshot;
  try {
    snapshot = ComposerInputSnapshotSchema.parse(JSON.parse(job.inputSnapshotJson));
  } catch {
    await failJob(job.id, job.worklistId, "bad_stored_snapshot");
    return { ok: false, detail: "bad_stored_snapshot" };
  }

  // Resolve authoritative draft for SELECTED_IMAGES ownership (never draftId: null).
  const { resolveAuthoritativeComposeDraft } = await import("./resolveComposeDraft");
  const authDraft = await resolveAuthoritativeComposeDraft({
    worklistId: job.worklistId,
    studyId: job.studyId ?? snapshot.studyId ?? null,
  });
  const ownership = {
    draftId: authDraft?.draftId ?? null,
    studyId: job.studyId ?? snapshot.studyId ?? authDraft?.studyId ?? null,
    worklistId: job.worklistId ?? authDraft?.worklistId ?? null,
    patientId: authDraft?.patientId ?? null,
    draftStudyId: authDraft?.studyId ?? null,
    draftWorklistId: authDraft?.worklistId ?? null,
    draftPatientId: authDraft?.patientId ?? null,
  };

  const run = await runReportComposer({
    kind: job.jobKind as AiComposeJobKind,
    snapshot,
    allowDeterministicFallback: true,
    ownership,
  });

  if (!run.ok || !run.draft) {
    await failJob(
      job.id,
      job.worklistId,
      run.safeError ?? "compose_failed",
      run.model,
      run.fallbackUsed,
      run.latencyMs,
      run.provenance ? { provenance: run.provenance } : undefined,
    );
    // Do not retry endlessly on config / vision / image resolution errors
    if (
      run.safeError === "composer_model_not_configured" ||
      run.safeError === "composer_provider_not_configured" ||
      run.safeError === "malformed_json" ||
      // A server that answers with chain-of-thought only will answer that way
      // every time; retrying just burns the clinic GPU overnight and delays the
      // drafts that could have been written.
      run.safeError === "empty_final_content" ||
      run.safeError === "vision_model_required" ||
      run.safeError === "vision_capability_unverified" ||
      run.safeError === "composer_num_ctx_insufficient" ||
      run.safeError === "composer_context_budget_exceeded" ||
      run.safeError?.startsWith("selected_images_")
    ) {
      return { ok: true, detail: run.safeError };
    }
    return { ok: false, detail: run.safeError };
  }

  const validation = validateComposerOutput(snapshot, run.draft);
  if (!validation.ok) {
    await failJob(
      job.id,
      job.worklistId,
      validation.errors.join(",") || "validation_failed",
      run.model,
      run.fallbackUsed,
      run.latencyMs,
      { ...validation, provenance: run.provenance ?? null },
    );
    return { ok: true, detail: "validation_failed" };
  }

  const tracked = buildTrackedChanges({
    jobId: job.id,
    model: run.model,
    originalFindings: snapshot.findings,
    originalImpression: snapshot.impression,
    originalRecommendation: snapshot.recommendation,
    draft: run.draft,
  });

  // STALE check: compare frozen snapshot revision to any newer READY job supersession only.
  // Worker uses frozen snapshot — does not read live editor. STALE is decided at read/apply time
  // when client presents current hashes; here we mark READY.
  await db
    .update(aiReportComposeJobsTable)
    .set({
      status: "READY",
      outputPlanJson: JSON.stringify(run.draft),
      trackedChangesJson: JSON.stringify(tracked),
      proposedFindings: run.draft.findings,
      proposedImpression: run.draft.impression,
      proposedRecommendation: run.draft.recommendation,
      validationJson: JSON.stringify({ ...validation, provenance: run.provenance ?? null }),
      model: run.model ?? null,
      fallbackUsed: run.fallbackUsed ?? false,
      latencyMs: run.latencyMs ?? null,
      completedAt: new Date(),
      safeError: null,
      updatedAt: new Date(),
    })
    .where(eq(aiReportComposeJobsTable.id, job.id));
  await syncWorklistStatus(job.worklistId, "READY", job.id);

  return { ok: true, detail: `ready changes=${tracked.length}` };
}

async function failJob(
  id: number,
  worklistId: number | null,
  safeError: string,
  model?: string,
  fallbackUsed?: boolean,
  latencyMs?: number,
  validation?: unknown,
): Promise<void> {
  await db
    .update(aiReportComposeJobsTable)
    .set({
      status: "FAILED",
      safeError,
      model: model ?? null,
      fallbackUsed: fallbackUsed ?? false,
      latencyMs: latencyMs ?? null,
      validationJson: validation ? JSON.stringify(validation) : null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiReportComposeJobsTable.id, id));
  await syncWorklistStatus(worklistId, "FAILED", id);
}

async function syncWorklistStatus(
  worklistId: number | null,
  status: string,
  jobId: number,
): Promise<void> {
  if (!worklistId) return;
  await db
    .update(radiologyWorklistTable)
    .set({
      aiComposeStatus: status,
      aiComposeJobId: jobId,
      aiComposeUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(radiologyWorklistTable.id, worklistId));
}

export async function getComposeJob(id: number) {
  const [job] = await db.select().from(aiReportComposeJobsTable).where(eq(aiReportComposeJobsTable.id, id)).limit(1);
  return job ?? null;
}

export async function getLatestComposeJob(worklistId: number) {
  const [job] = await db
    .select()
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.worklistId, worklistId))
    .orderBy(desc(aiReportComposeJobsTable.id))
    .limit(1);
  return job ?? null;
}

/**
 * Evaluate STALE against client-provided current hashes (live editor + live
 * canonical study context). Never mutates report.
 *
 * Two invalidation axes (PR #656 final safety hardening):
 *
 *  1. `reportRevision` (clinically EDITABLE report state — findings text,
 *     impression text, recommendation text, canonical observations).
 *     Captures radiologist edits to the report content while the AI was
 *     composing. Was already validated by PR #654.
 *
 *  2. `inputHash` (full frozen AI input — including canonical STUDY CONTEXT
 *     such as modality, region, regions, bodyPart, family, spineSegment,
 *     protocol, reportTitle). Captures study-identity changes such as
 *     Plain → Contrast, or LS Spine + Whole Spine Screening → LS Spine only,
 *     even when the narrative text and observations did NOT change.
 *     Without this axis a READY draft generated for "MRI Brain Plain" would
 *     remain blindly applicable after the radiologist switched the protocol
 *     to "MRI Brain Contrast" — that is unsafe and exactly the blocker
 *     PR #656 fixes.
 *
 * Backward compatibility:
 *  - If `current.inputHash` is absent (legacy client), only axis 1 is
 *    enforced. New clients always provide `inputHash`.
 *
 * Model B preserved:
 *  - The worker still uses the frozen enqueue-time snapshot to compose.
 *  - This function ONLY performs apply/review freshness safety.
 *  - No live reread of workspace context happens by the worker.
 *
 * The pure stale-decision is delegated to `isComposeJobStale` in
 * `snapshot.ts` so it can be unit-tested without a live database.
 */
export async function evaluateJobFreshness(
  jobId: number,
  current: {
    findingsHash: string;
    impressionHash: string;
    recommendationHash: string;
    reportRevision: string;
    /** Optional live `inputHash` recomputed by the client from the SAME
     * canonical snapshot fields the client used at enqueue time. When
     * present, a mismatch against the job's stored `inputHash` flips
     * READY → STALE_READY so study-context changes cannot be silently
     * applied as if current. Backward compatible — legacy clients omit. */
    inputHash?: string;
  },
): Promise<{ status: AiComposeJobStatus; stale: boolean }> {
  const job = await getComposeJob(jobId);
  if (!job) return { status: "FAILED", stale: false };
  if (!["READY", "STALE_READY"].includes(job.status)) {
    return { status: job.status as AiComposeJobStatus, stale: false };
  }
  const { stale } = isComposeJobStale({
    jobStatus: job.status,
    storedReportRevision: job.sourceReportRevision,
    storedFindingsHash: job.sourceFindingsHash,
    storedImpressionHash: job.sourceImpressionHash,
    storedInputHash: job.inputHash,
    current,
  });
  if (stale && job.status === "READY") {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "STALE_READY", updatedAt: new Date() })
      .where(eq(aiReportComposeJobsTable.id, jobId));
    await syncWorklistStatus(job.worklistId, "STALE_READY", jobId);
    return { status: "STALE_READY", stale: true };
  }
  return { status: job.status as AiComposeJobStatus, stale };
}

export async function updateTrackedChangeState(
  jobId: number,
  changeId: string,
  reviewState: TrackedChange["reviewState"],
): Promise<{ ok: boolean; changes?: TrackedChange[]; error?: string }> {
  const job = await getComposeJob(jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (!["READY", "STALE_READY"].includes(job.status)) return { ok: false, error: "not_ready" };
  let changes: TrackedChange[] = [];
  try {
    changes = JSON.parse(job.trackedChangesJson ?? "[]") as TrackedChange[];
  } catch {
    return { ok: false, error: "bad_changes" };
  }
  const now = new Date().toISOString();
  const next = changes.map((c) => {
    if (c.id !== changeId) return c;
    return {
      ...c,
      reviewState,
      acceptedAt: reviewState === "ACCEPTED" || reviewState === "EDITED" ? now : c.acceptedAt,
      rejectedAt: reviewState === "REJECTED" ? now : c.rejectedAt,
    };
  });
  await db
    .update(aiReportComposeJobsTable)
    .set({ trackedChangesJson: JSON.stringify(next), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, jobId));
  // Job remains READY — change review state is separate (Guard 2)
  return { ok: true, changes: next };
}

export async function markComposeApplied(opts: {
  jobId: number;
  appliedBy?: string;
  appliedByStaffId?: number | null;
  /** Client must confirm which change ids were accepted into canonical report. */
  acceptedChangeIds: string[];
  /**
   * Which study the clinician is applying into. Required — and resolved
   * against `radiology_worklist` / `patient_reports` on the server, never
   * trusted as given. An Apply that does not name a target is refused:
   * unverifiable identity is not permitted identity.
   */
  target?: ComposeStudyRefs | null;
  /** `req.staffSession.subjectId` — checked against an active study write lock,
   * on the same terms as POST /save-draft. */
  staffId?: number | null;
  /**
   * Live hashes at Apply time (required for new clients). When provided,
   * READY jobs that no longer match the live editor/ledger/study context
   * are flipped to STALE_READY and Apply is rejected — closes the
   * READY→edit→Apply race where poll already stopped.
   */
  findingsHash?: string;
  impressionHash?: string;
  recommendationHash?: string;
  reportRevision?: string;
  inputHash?: string;
}): Promise<{ ok: boolean; error?: string; code?: string; message?: string }> {
  const job = await getComposeJob(opts.jobId);
  // `error` stays the machine token every existing caller and test matches on;
  // `message` is the clinician-facing sentence, so the wording lives in one
  // place instead of being re-invented by each client that renders a refusal.
  if (!job) {
    return {
      ok: false,
      error: "not_found",
      message: "This AI draft no longer exists. Nothing was changed.",
    };
  }
  if (!["READY", "STALE_READY"].includes(job.status)) {
    return {
      ok: false,
      error: "not_ready",
      message: `This AI draft is ${String(job.status).toLowerCase()}, so it cannot be applied. Nothing was changed.`,
    };
  }
  if (job.status === "STALE_READY") {
    return {
      ok: false,
      error: "stale_ready",
      message: "The report has changed since this AI draft was generated. Please review and regenerate.",
    };
  }

  // Verified study identity, BEFORE anything is recorded as applied. The job's
  // stored binding and the caller's target are each re-read from server rows
  // and must describe the same study, the same patient and the same report —
  // comparing two client integers would prove nothing, because both sides can
  // be forged.
  const identity = await verifyComposeJobIdentity({
    job,
    target: opts.target ?? {},
    staffId: opts.staffId ?? null,
  });
  if (!identity.ok) {
    return { ok: false, error: identity.code, code: identity.code, message: identity.message };
  }

  if (opts.reportRevision) {
    const freshness = await evaluateJobFreshness(opts.jobId, {
      findingsHash: opts.findingsHash ?? "",
      impressionHash: opts.impressionHash ?? "",
      recommendationHash: opts.recommendationHash ?? "",
      reportRevision: opts.reportRevision,
      ...(opts.inputHash ? { inputHash: opts.inputHash } : {}),
    });
    if (freshness.stale || freshness.status === "STALE_READY") {
      return { ok: false, error: "stale_ready" };
    }
  }

  const persisted = await loadPersistedReportToken(job.reportId);
  if (persisted.finalized) {
    return {
      ok: false,
      error: "finalized",
      message: "The target report is finalized. AI changes cannot be applied.",
    };
  }
  if (persisted.unresolved) {
    return {
      ok: false,
      error: "compose_identity_unavailable",
      code: "compose_identity_unavailable",
      message:
        "CARE could not read the report this draft was generated against, so it cannot confirm the apply is safe. Nothing was changed.",
    };
  }

  let changes: TrackedChange[] = [];
  try {
    changes = JSON.parse(job.trackedChangesJson ?? "[]") as TrackedChange[];
  } catch {
    return { ok: false, error: "bad_changes" };
  }
  const now = new Date().toISOString();
  const accepted = new Set(opts.acceptedChangeIds);
  const next = changes.map((c) =>
    accepted.has(c.id)
      ? { ...c, reviewState: "ACCEPTED" as const, acceptedAt: now }
      : c.reviewState === "PENDING"
        ? { ...c, reviewState: "REJECTED" as const, rejectedAt: now }
        : c,
  );

  // Durability before attribution.
  //
  // The accepted text has to be in the study's saved report before this job may
  // say it was applied. That is the whole of PROMPT 4's final objective, and the
  // order matters: the proof is read and the status is flipped in ONE
  // transaction, with the draft row locked, so an APPLIED row is never a promise
  // about a write that has not happened. Before this, the sequence was
  // "client mutates its editor → server marks APPLIED → autosave may or may not
  // persist later", which let a crash, a closed tab or a failing autosave leave
  // a job recorded as applied while its accepted sentences were in no database.
  //
  // The refusal never touches the clinician's text: nothing here writes clinical
  // content, and the workspace's own save path is untouched apart from the
  // composer-tagged compare-and-set in `authoriseComposeSaveTx`.
  const acceptedChanges = next
    .filter((c) => accepted.has(c.id))
    .map((c) => ({
      field: (c.field === "IMPRESSION"
        ? "impression"
        : c.field === "RECOMMENDATION"
          ? "recommendation"
          : "findings") as ComposeAcceptedField,
      text: c.proposedText ?? "",
      originalText: c.originalText ?? "",
    }));

  const outcome = await db.transaction(async (tx) => {
    const durability = await verifyComposeDurabilityTx(tx, {
      jobId: opts.jobId,
      worklistId: identity.identity.worklistId,
      patientId: identity.identity.patientId,
      accepted: acceptedChanges,
    });
    if (!durability.ok) return { kind: "refused" as const, code: durability.code, message: durability.message };

    // Compare-and-set on the status the caller actually reviewed. Two Apply
    // requests for one READY job (double-click, retry after a timeout, a second
    // workstation on the same study) used to both pass every check above and
    // both write APPLIED, so the second one re-recorded an apply that had already
    // happened. The status column is the only durable evidence of the transition,
    // so the transition itself has to be the guard.
    const flipped = await tx
      .update(aiReportComposeJobsTable)
      .set({
        status: "APPLIED",
        trackedChangesJson: JSON.stringify(next),
        appliedAt: new Date(),
        appliedBy: opts.appliedBy ?? null,
        appliedByStaffId: opts.appliedByStaffId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(aiReportComposeJobsTable.id, opts.jobId), eq(aiReportComposeJobsTable.status, "READY")))
      .returning({ id: aiReportComposeJobsTable.id });
    if (flipped.length === 0) return { kind: "already" as const };
    return { kind: "applied" as const };
  });

  if (outcome.kind === "refused") {
    return { ok: false, error: outcome.code, code: outcome.code, message: outcome.message };
  }
  if (outcome.kind === "already") {
    return {
      ok: false,
      error: "already_applied",
      code: "already_applied",
      message:
        "This AI draft has already been applied or superseded, so it was not applied again. Nothing was changed.",
    };
  }
  await syncWorklistStatus(job.worklistId, "APPLIED", opts.jobId);
  return { ok: true };
}

export async function discardComposeJob(opts: {
  jobId: number;
  by?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const job = await getComposeJob(opts.jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (ACTIVE.includes(job.status as (typeof ACTIVE)[number])) {
    await db
      .update(aiReportComposeJobsTable)
      .set({ status: "CANCELLED", discardedAt: new Date(), updatedAt: new Date(), safeError: "cancelled_by_user" })
      .where(eq(aiReportComposeJobsTable.id, opts.jobId));
    await syncWorklistStatus(job.worklistId, "CANCELLED", opts.jobId);
    return { ok: true };
  }
  await db
    .update(aiReportComposeJobsTable)
    .set({ status: "DISCARDED", discardedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiReportComposeJobsTable.id, opts.jobId));
  await syncWorklistStatus(job.worklistId, "DISCARDED", opts.jobId);
  void opts.by;
  return { ok: true };
}

/** PHI retention: prune input snapshots for terminal jobs older than retention days. */
export async function pruneComposeSnapshots(): Promise<number> {
  const { retentionDays } = await getComposerSettings();
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const result = await db
    .update(aiReportComposeJobsTable)
    .set({
      inputSnapshotJson: "{\"pruned\":true}",
      snapshotPrunedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(aiReportComposeJobsTable.status, ["APPLIED", "DISCARDED", "FAILED", "CANCELLED", "OBSOLETE"]),
        lt(aiReportComposeJobsTable.completedAt, cutoff),
        sql`${aiReportComposeJobsTable.snapshotPrunedAt} IS NULL`,
      ),
    )
    .returning({ id: aiReportComposeJobsTable.id });
  return result.length;
}

export function publicJobView(job: typeof aiReportComposeJobsTable.$inferSelect) {
  let trackedChanges: TrackedChange[] = [];
  let validation: unknown = null;
  let draft: unknown = null;
  try {
    trackedChanges = JSON.parse(job.trackedChangesJson ?? "[]");
  } catch { /* ignore */ }
  try {
    validation = job.validationJson ? JSON.parse(job.validationJson) : null;
  } catch { /* ignore */ }
  try {
    draft = job.outputPlanJson ? JSON.parse(job.outputPlanJson) : null;
  } catch { /* ignore */ }

  let sources: Record<string, number> = {};
  try {
    const snap = JSON.parse(job.inputSnapshotJson) as ComposerInputSnapshot;
    sources = summarizeSources(snap.observations ?? []);
  } catch { /* pruned */ }

  return {
    id: job.id,
    studyId: job.studyId,
    worklistId: job.worklistId,
    reportId: job.reportId,
    jobKind: job.jobKind,
    status: job.status,
    sourceReportRevision: job.sourceReportRevision,
    sourceFindingsHash: job.sourceFindingsHash,
    sourceImpressionHash: job.sourceImpressionHash,
    sourceRecommendationHash: job.sourceRecommendationHash,
    inputHash: job.inputHash,
    proposedFindings: job.proposedFindings,
    proposedImpression: job.proposedImpression,
    proposedRecommendation: job.proposedRecommendation,
    trackedChanges,
    draft,
    validation,
    sources,
    model: job.model,
    fallbackUsed: job.fallbackUsed,
    latencyMs: job.latencyMs,
    safeError: job.safeError,
    createdBy: job.createdBy,
    appliedBy: job.appliedBy,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    appliedAt: job.appliedAt,
    discardedAt: job.discardedAt,
    // Never return full input snapshot in list/GET by default — PHI
    hasSnapshot: !job.snapshotPrunedAt && job.inputSnapshotJson !== "{\"pruned\":true}",
  };
}

export async function composeDiagnostics() {
  const settings = await getComposerSettings();
  const counts = await db.execute(sql`
    SELECT status, count(*)::int AS c
    FROM ai_report_compose_jobs
    WHERE created_at > now() - interval '7 days'
    GROUP BY status
  `);
  const rows = executeComposeRows<{ status: string; c: number }>(counts);
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.c;

  const [lastOk] = await db
    .select({ id: aiReportComposeJobsTable.id, completedAt: aiReportComposeJobsTable.completedAt, model: aiReportComposeJobsTable.model })
    .from(aiReportComposeJobsTable)
    .where(inArray(aiReportComposeJobsTable.status, ["READY", "APPLIED"]))
    .orderBy(desc(aiReportComposeJobsTable.completedAt))
    .limit(1);
  const [lastFail] = await db
    .select({ id: aiReportComposeJobsTable.id, completedAt: aiReportComposeJobsTable.completedAt, safeError: aiReportComposeJobsTable.safeError })
    .from(aiReportComposeJobsTable)
    .where(eq(aiReportComposeJobsTable.status, "FAILED"))
    .orderBy(desc(aiReportComposeJobsTable.completedAt))
    .limit(1);

  return {
    backgroundEnabled: settings.backgroundEnabled,
    concurrency: settings.concurrency,
    retentionDays: settings.retentionDays,
    queueDepth: (byStatus.QUEUED ?? 0) + (byStatus.COMPOSING ?? 0),
    byStatus,
    lastSuccess: lastOk ?? null,
    lastFailure: lastFail ?? null,
  };
}
