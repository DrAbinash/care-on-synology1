/**
 * Background AI Report Composer routes.
 * POST returns jobId immediately — never blocks on Ollama (Guard 7).
 * Apply does NOT overwrite report text on the server (Guard 3) — client applies
 * via canonical Zustand/pathologyPatch path, then confirms with /applied.
 */
import { Router } from "express";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import {
  AI_COMPOSE_JOB_KINDS,
  type AiComposeJobKind,
} from "@workspace/db/schema";
import {
  enqueueComposeJob,
  getComposeJob,
  getLatestComposeJob,
  publicJobView,
  evaluateJobFreshness,
  updateTrackedChangeState,
  markComposeApplied,
  discardComposeJob,
  composeDiagnostics,
  processComposeJob,
  pruneComposeSnapshots,
} from "../lib/reportComposer/jobService";
import { computeSnapshotHashes } from "../lib/reportComposer/snapshot";
import { ComposerInputSnapshotSchema } from "../lib/reportComposer/types";
import { runReportComposer } from "../lib/reportComposer/composeEngine";
import { validateComposerOutput } from "../lib/reportComposer/validateOutput";
import { resolveComposerRuntime } from "../lib/voiceReportComposer/runtimeConfig";
import { hashText } from "../lib/reportComposer/snapshot";
import { deterministicComposeFromSnapshot } from "../lib/reportComposer/deterministicCompose";
import {
  composerRuntimeStatusMessage,
  DETERMINISTIC_FALLBACK_USER_MESSAGE,
  resolveComposeDisplayStatus,
} from "../lib/reportComposer/composeDisplay";
import { CARE_PERSONA_VERSION } from "../lib/reportComposer/persona";

export const reportComposerRouter = Router();

const DEFAULT_COMPOSER_TEST_OBSERVATIONS = [
  "Loss of lumbar lordosis.",
  "Disc desiccation at L3-4, L4-5 and L5-S1.",
  "Diffuse disc bulge at L4-5 causing anterior thecal sac compression with mild bilateral nerve-root impingement.",
  "AP spinal canal diameters:",
  "L1-2 12.3 mm,",
  "L2-3 11.8 mm,",
  "L3-4 10.6 mm,",
  "L4-5 9.4 mm,",
  "L5-S1 12.1 mm.",
].join("\n");

function buildComposerTestSnapshot(body: Record<string, unknown>) {
  const region = String(body.region ?? "LS_SPINE").trim() || "LS_SPINE";
  const studyType = String(body.studyType ?? "MRI LS Spine").trim() || "MRI LS Spine";
  const observationsText = String(body.observationsText ?? DEFAULT_COMPOSER_TEST_OBSERVATIONS).trim();
  const lines = observationsText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ComposerInputSnapshotSchema.parse({
    worklistId: null,
    studyId: null,
    modality: String(body.modality ?? "MR"),
    region,
    studyType,
    clinicalHistory: String(body.clinicalHistory ?? "Low back pain"),
    technique: String(body.technique ?? "Multiplanar MRI lumbar spine"),
    findings: observationsText,
    impression: "",
    recommendation: "",
    observations: lines.slice(0, 24).map((findingsText, i) => ({
      concept: `obs_${i + 1}`,
      source: "manual" as const,
      findingsText,
    })),
    jobKindHint: "FULL_REPORT",
    aiMode: "TEXT_ONLY",
  });
}

function canUse(req: StaffAuthRequest): boolean {
  const s = req.staffSession;
  if (!s) return false;
  if (FULL_ACCESS_ROLES.has(s.role)) return true;
  return s.permissions?.includes("ai_reporting.use") ?? false;
}

function staffMeta(req: StaffAuthRequest) {
  const s = req.staffSession;
  return {
    createdBy: s?.subjectName ?? s?.role ?? "staff",
    createdByStaffId: s?.id ?? null,
  };
}

reportComposerRouter.post("/jobs", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const kindRaw = String(body.jobKind ?? "FULL_REPORT");
  if (!AI_COMPOSE_JOB_KINDS.includes(kindRaw as AiComposeJobKind)) {
    res.status(400).json({ ok: false, error: "invalid jobKind" });
    return;
  }
  const meta = staffMeta(req as StaffAuthRequest);
  const result = await enqueueComposeJob({
    snapshot: body.snapshot,
    jobKind: kindRaw as AiComposeJobKind,
    createdBy: meta.createdBy,
    createdByStaffId: meta.createdByStaffId,
    persistedContentToken: body.persistedContentToken ? String(body.persistedContentToken) : null,
  });
  if (!result.ok) {
    const status = result.code === "disabled" ? 403 : result.code === "finalized" ? 409 : 400;
    res.status(status).json(result);
    return;
  }
  res.status(202).json(result);
});

reportComposerRouter.get("/jobs/:id", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, error: "bad id" });
    return;
  }
  const job = await getComposeJob(id);
  if (!job) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, job: publicJobView(job) });
});

reportComposerRouter.get("/latest", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  const worklistId = Number(req.query.worklistId);
  if (!Number.isInteger(worklistId) || worklistId <= 0) {
    res.status(400).json({ ok: false, error: "worklistId required" });
    return;
  }
  const job = await getLatestComposeJob(worklistId);
  if (!job) {
    res.json({ ok: true, job: null });
    return;
  }
  res.json({ ok: true, job: publicJobView(job) });
});

/** Client reports live editor hashes + live canonical inputHash → may flip READY to STALE_READY. */
reportComposerRouter.post("/jobs/:id/freshness", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "AI reporting permission required" });
    return;
  }
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const findings = String(b.findings ?? "");
  const impression = String(b.impression ?? "");
  const recommendation = String(b.recommendation ?? "");
  const findingsHash = hashText(findings);
  const impressionHash = hashText(impression);
  const recommendationHash = hashText(recommendation);
  // NOTE: server recomputes a *narrative-only* reportRevision here for legacy
  // backward compatibility — it does NOT include observations or study context.
  // New clients MUST send `reportRevision` (computed via `computeSnapshotHashes`
  // on the client, which includes obsCanon) so observation changes also flip
  // READY → STALE_READY per PR #654.
  const reportRevision = hashText(`${findingsHash}:${impressionHash}:${recommendationHash}:`);
  // PR #656: new clients also send `inputHash` computed via the client-side
  // `computeSnapshotHashes` over the FULL live canonical snapshot (modality,
  // region, regions, bodyPart, family, spineSegment, protocol, reportTitle +
  // clinicalHistory + technique + findings + impression + recommendation +
  // observations + selectionText + instruction + templateSections +
  // jobKindHint). When present, a mismatch against the stored enqueue-time
  // inputHash flips READY → STALE_READY so study-identity changes (Plain →
  // Contrast, region add/remove, bodyPart change, etc.) cannot be silently
  // applied as if current. Optional — legacy clients omit and retain the
  // reportRevision-only behavior.
  const inputHashRaw = b.inputHash;
  const inputHash = typeof inputHashRaw === "string" && inputHashRaw.length > 0 ? inputHashRaw : undefined;
  const result = await evaluateJobFreshness(id, {
    findingsHash,
    impressionHash,
    recommendationHash,
    reportRevision: b.reportRevision ? String(b.reportRevision) : reportRevision,
    ...(inputHash !== undefined ? { inputHash } : {}),
  });
  res.json({ ok: true, ...result });
});

reportComposerRouter.post("/jobs/:id/changes/:changeId/accept", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const result = await updateTrackedChangeState(Number(req.params.id), String(req.params.changeId), "ACCEPTED");
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

reportComposerRouter.post("/jobs/:id/changes/:changeId/reject", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const result = await updateTrackedChangeState(Number(req.params.id), String(req.params.changeId), "REJECTED");
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

/**
 * Confirm that client already applied accepted changes via canonical workspace mutation.
 * Does NOT write Findings/Impression on the server.
 */
reportComposerRouter.post("/jobs/:id/applied", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const meta = staffMeta(req as StaffAuthRequest);
  const body = (req.body ?? {}) as {
    acceptedChangeIds?: string[];
    findingsHash?: string;
    impressionHash?: string;
    recommendationHash?: string;
    reportRevision?: string;
    inputHash?: string;
  };
  const acceptedChangeIds = Array.isArray(body.acceptedChangeIds) ? body.acceptedChangeIds : [];
  const result = await markComposeApplied({
    jobId: Number(req.params.id),
    appliedBy: meta.createdBy,
    appliedByStaffId: meta.createdByStaffId,
    acceptedChangeIds,
    findingsHash: typeof body.findingsHash === "string" ? body.findingsHash : undefined,
    impressionHash: typeof body.impressionHash === "string" ? body.impressionHash : undefined,
    recommendationHash: typeof body.recommendationHash === "string" ? body.recommendationHash : undefined,
    reportRevision: typeof body.reportRevision === "string" ? body.reportRevision : undefined,
    inputHash: typeof body.inputHash === "string" ? body.inputHash : undefined,
  });
  if (!result.ok) {
    res.status(409).json(result);
    return;
  }
  res.json(result);
});

reportComposerRouter.post("/jobs/:id/discard", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const result = await discardComposeJob({
    jobId: Number(req.params.id),
    by: staffMeta(req as StaffAuthRequest).createdBy,
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

reportComposerRouter.get("/diagnostics", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const runtime = await resolveComposerRuntime(true);
  const diag = await composeDiagnostics();
  const statusMessage = composerRuntimeStatusMessage(runtime);
  const lastFailureError =
    diag.lastFailure && typeof diag.lastFailure === "object" && "safeError" in diag.lastFailure
      ? (diag.lastFailure as { safeError?: string | null }).safeError ?? null
      : null;
  res.json({
    ok: true,
    composer: {
      enabled: runtime.enabled,
      endpoint: runtime.endpoint,
      endpointSource: runtime.endpointSource,
      model: runtime.model || null,
      fallbackModel: runtime.fallbackModel,
      healthy: runtime.enabled && !!runtime.model,
      statusMessage,
      lastError: statusMessage ?? lastFailureError,
      timeoutMs: runtime.timeoutMs,
      numCtx: runtime.numCtx,
      localOnly: runtime.localOnly,
      transport: "ollama",
      deepSeekConfigured: false,
      deepSeekNote:
        "DeepSeek adapter is a fail-closed stub; Report Composer hard-wires provider=ollama. Manual/cloud tags may be typed in composer model fields but are sent to the configured Ollama endpoint only.",
    },
    queue: diag,
  });
});

/** Synthetic non-PHI self-test — exercises real runReportComposer (no patient write). */
reportComposerRouter.post("/test", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const snapshot = buildComposerTestSnapshot(body);
  const hashes = computeSnapshotHashes(snapshot);
  const runtimeBefore = await resolveComposerRuntime(true);
  const run = await runReportComposer({ kind: "FULL_REPORT", snapshot, allowDeterministicFallback: true });
  const validation = run.draft
    ? validateComposerOutput(snapshot, run.draft)
    : { ok: false, errors: ["no_draft"], warnings: [] as string[], unsupportedMentions: [] };
  // Display status reflects whether Local AI (Ollama) composed — not validator PASS/FAIL.
  // Validation is reported separately so measurement warnings do not mislabel a real compose.
  const displayStatus = resolveComposeDisplayStatus({
    ok: run.ok,
    fallbackUsed: run.fallbackUsed,
    model: run.model,
    provider: run.provenance?.provider,
    warnings: [...(run.draft?.warnings ?? []), ...validation.warnings],
  });
  const ollamaCalled =
    run.ok === true &&
    run.fallbackUsed !== true &&
    (run.model ?? "").toLowerCase() !== "deterministic" &&
    (run.provenance?.provider ?? "") === "ollama";
  const personaLoaded = Boolean(ollamaCalled && run.provenance?.personaVersion);
  res.json({
    ok: run.ok,
    validationOk: validation.ok,
    writesClinicalReport: false,
    runtime: {
      enabled: runtimeBefore.enabled,
      model: runtimeBefore.model,
      fallbackModel: runtimeBefore.fallbackModel,
      endpoint: runtimeBefore.endpoint,
      endpointSource: runtimeBefore.endpointSource,
      hasFallback: !!runtimeBefore.fallbackModel,
      statusMessage: composerRuntimeStatusMessage(runtimeBefore),
      localOnly: runtimeBefore.localOnly,
      transport: "ollama",
    },
    hashes,
    compose: {
      ok: run.ok,
      model: run.model,
      fallbackUsed: run.fallbackUsed,
      latencyMs: run.latencyMs,
      safeError: run.safeError,
      displayStatus,
      ollamaCalled,
      personaLoaded,
      personaVersion: run.provenance?.personaVersion ?? null,
      expectedPersonaVersion: CARE_PERSONA_VERSION,
      provider: run.provenance?.provider ?? null,
      httpStatus: ollamaCalled ? 200 : run.safeError?.startsWith("ollama_http_") ? Number(run.safeError.replace("ollama_http_", "")) || null : null,
      draft: run.draft
        ? {
            findings: run.draft.findings,
            impression: run.draft.impression,
            recommendation: run.draft.recommendation,
            warnings: run.draft.warnings ?? [],
          }
        : null,
      draftLengths: run.draft
        ? {
            findings: run.draft.findings.length,
            impression: run.draft.impression.length,
            recommendation: run.draft.recommendation.length,
          }
        : null,
      userMessage:
        displayStatus === "FALLBACK_DRAFT"
          ? DETERMINISTIC_FALLBACK_USER_MESSAGE
          : displayStatus === "LOCAL_AI_SUCCESS"
            ? "LOCAL AI SUCCESS"
            : null,
    },
    validation,
    deterministicSample: deterministicComposeFromSnapshot(snapshot, "FULL_REPORT"),
  });
});

/** Admin/dev: force-process one job (also drained by radiology other-job consumer). */
reportComposerRouter.post("/jobs/:id/process-now", async (req, res): Promise<void> => {
  const s = (req as StaffAuthRequest).staffSession;
  if (!s || !FULL_ACCESS_ROLES.has(s.role)) {
    res.status(403).json({ ok: false, error: "admin required" });
    return;
  }
  const result = await processComposeJob(Number(req.params.id));
  const job = await getComposeJob(Number(req.params.id));
  res.json({ ok: result.ok, detail: result.detail, job: job ? publicJobView(job) : null });
});

reportComposerRouter.post("/prune-snapshots", async (req, res): Promise<void> => {
  const s = (req as StaffAuthRequest).staffSession;
  if (!s || !FULL_ACCESS_ROLES.has(s.role)) {
    res.status(403).json({ ok: false, error: "admin required" });
    return;
  }
  const n = await pruneComposeSnapshots();
  res.json({ ok: true, pruned: n });
});
