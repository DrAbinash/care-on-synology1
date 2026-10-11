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
import {
  DEEPSEEK_TEXT_MODEL,
  deepseekConfiguredPublicStatus,
} from "../lib/reportComposer/providers/deepseekConfig";
import { qwenConfiguredPublicStatus, QWEN_DEFAULT_MODEL } from "../lib/reportComposer/providers/qwenConfig";
import { openaiConfiguredPublicStatus } from "../lib/reportComposer/providers/openaiConfig";
import { localOpenAiConfiguredPublicStatus } from "../lib/reportComposer/providers/localOpenAiCompatibleConfig";
import {
  defaultModelFor,
  parseComposerProviderName,
  unsupportedComposerProviderMessage,
  type ComposerProviderName,
} from "../lib/reportComposer/providers";
import { runDeepSeekVisionAbTrial } from "../lib/reportComposer/providers/deepseekVisionTrial";
import { getOvernightOpsControls } from "../lib/ai/clinicalConfigService";
import {
  BUILTIN_PROVIDER_CONFIGS,
  listBuiltinModels,
  listModelPricing,
  isCompatibleProviderConfigured,
} from "@workspace/ai-providers";

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

function buildComposerTestSnapshot(body: Record<string, unknown>, kind = "FULL_REPORT") {
  const region = String(body.region ?? "LS_SPINE").trim() || "LS_SPINE";
  const studyType = String(body.studyType ?? "MRI LS Spine").trim() || "MRI LS Spine";
  const observationsText = String(body.observationsText ?? DEFAULT_COMPOSER_TEST_OBSERVATIONS).trim();
  const lines = observationsText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // A COMBINE test needs a second report to merge. Synthetic only, like every
  // other field here — this panel must never be the thing that puts a real
  // patient's text in front of a vendor.
  //
  // Note the divergence: these sources carry no `worklistId` / `reportId`, which
  // `POST /jobs` now refuses. This panel runs the engine directly — it creates no
  // job, and nothing it produces can be applied to a report — so there is no
  // patient for an unverified merge to reach. A real combination goes through the
  // job route and the identity gate.
  const additionalReportsRaw = Array.isArray(body.additionalReports)
    ? body.additionalReports.slice(0, 4).map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        return {
          label: String(row.label ?? "supplied report"),
          findings: String(row.findings ?? ""),
          impression: String(row.impression ?? ""),
        };
      })
    : [];
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
    instruction: String(body.instruction ?? ""),
    ...(additionalReportsRaw.length ? { additionalReports: additionalReportsRaw } : {}),
    observations: lines.slice(0, 24).map((findingsText, i) => ({
      concept: `obs_${i + 1}`,
      source: "manual" as const,
      findingsText,
    })),
    jobKindHint: kind,
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
    const status =
      result.code === "disabled"
        ? 403
        : result.code === "finalized"
          || result.code === "compose_locked"
          // PROMPT 4: the baseline is a read of the saved report. If that read
          // failed, or two draft rows made it ambiguous, the condition is
          // temporary and retryable — a 400 would tell the clinician their
          // request was malformed when the database was simply unclear.
          || result.code === "compose_persistence_unavailable"
          || result.code === "compose_baseline_ambiguous"
          // A refused source identity is the same class of answer: the request was
          // well-formed, and what conflicts is the DATA behind it — the study is
          // another patient's, or is not linked to a patient yet. 409 also tells
          // the workspace this is a refusal to show as a refusal, not as a bug.
          || String(result.code ?? "").startsWith("compose_source_")
          ? 409
          : 400;
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
 *
 * `target` names the study the clinician is applying INTO. It is required, and
 * the server resolves it from its own rows before comparing it with the study
 * the job was bound to at enqueue time — so this is the boundary where "a draft
 * generated for Patient A applied to Patient B" is refused, whatever the
 * browser believed.
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
    target?: { worklistId?: number | null; studyId?: number | null; reportId?: number | null };
  };
  const acceptedChangeIds = Array.isArray(body.acceptedChangeIds) ? body.acceptedChangeIds : [];
  const result = await markComposeApplied({
    jobId: Number(req.params.id),
    appliedBy: meta.createdBy,
    appliedByStaffId: meta.createdByStaffId,
    staffId: (req as StaffAuthRequest).staffSession?.subjectId ?? null,
    target: body.target ?? null,
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
  const ds = deepseekConfiguredPublicStatus();
  const qw = qwenConfiguredPublicStatus();
  const oa = openaiConfiguredPublicStatus();
  let nightVisionProvider: string = "local";
  let deepseekCloudVisionAllowed = false;
  try {
    const ops = await getOvernightOpsControls();
    nightVisionProvider = ops.nightVisionProvider;
    deepseekCloudVisionAllowed = ops.deepseekCloudVisionAllowed === true;
  } catch {
    /* soft */
  }
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
      defaultProvider: "ollama",
      deepSeekConfigured: ds.configured,
      deepSeekBaseUrl: ds.baseUrl,
      deepSeekTextModel: DEEPSEEK_TEXT_MODEL,
      deepSeekVisionModel: "deepseek-v4-flash-vision-exp",
      qwenConfigured: qw.configured,
      qwenBaseUrl: qw.baseUrl,
      qwenDefaultModel: QWEN_DEFAULT_MODEL,
      openaiConfigured: oa.configured,
      openaiBaseUrl: oa.baseUrl,
      nightVisionProvider,
      deepseekCloudVisionAllowed,
      cloudVisionAllowed: deepseekCloudVisionAllowed,
      deepSeekNote: ds.configured
        ? "DeepSeek official API key is configured server-side. Local Ollama remains default. Cloud vision requires explicit trial confirmation."
        : "DeepSeek API key not configured (set DEEPSEEK_API_KEY). Local Ollama remains default.",
      qwenNote: qw.configured
        ? "Qwen Model Studio key configured. Local Ollama remains default overnight."
        : "Qwen API key not configured (set QWEN_API_KEY). Local Ollama remains default.",
      openaiNote: oa.configured
        ? "OpenAI key configured. Enable via provider/model selection — not used by default."
        : "OpenAI API key not configured (set OPENAI_API_KEY).",
    },
    aiProviders: Object.keys(BUILTIN_PROVIDER_CONFIGS).map((id) => ({
      id,
      label: BUILTIN_PROVIDER_CONFIGS[id]?.label ?? id,
      execution:
        id === "ollama" || id === "local_openai_compatible" ? "LOCAL" : "CLOUD",
      configured:
        id === "ollama"
          ? null
          : id === "deepseek" || id === "qwen" || id === "openai"
            ? isCompatibleProviderConfigured(id)
            : id === "local_openai_compatible"
              ? isCompatibleProviderConfigured(id)
              : undefined,
    })),
    models: listBuiltinModels().map((m) => ({
      provider: m.provider,
      modelId: m.model,
      displayName: m.displayName,
      text: true,
      vision: m.supportsVision,
      local: m.isLocal,
      experimental: m.experimental === true,
    })),
    pricing: listModelPricing().map((p) => ({
      ...p,
      estimateOnly: true as const,
    })),
    queue: diag,
  });
});

/**
 * The Test Lab's provider name. Empty means "whatever the clinic defaults to",
 * which is Ollama — a named-but-unsupported provider is NOT silently run as
 * Ollama; it is a 400 (see `/test`). A test panel that reports "OpenAI" while a
 * local model answered is the least useful thing this screen can do.
 */
function parseProviderOverride(raw: unknown): ComposerProviderName | null {
  const v = String(raw ?? "").trim();
  if (!v) return "ollama";
  return parseComposerProviderName(v);
}

async function runComposerTestOnce(opts: {
  body: Record<string, unknown>;
  provider: ComposerProviderName;
  modelOverride?: string | null;
  /** Which task to exercise. Defaults to the report draft, as it always did. */
  kind?: AiComposeJobKind;
}) {
  const kind = opts.kind ?? "FULL_REPORT";
  const snapshot = buildComposerTestSnapshot(opts.body, kind);
  const hashes = computeSnapshotHashes(snapshot);
  const runtimeBefore = await resolveComposerRuntime(true);
  const modelOverride =
    (opts.modelOverride ?? "").trim() ||
    (opts.provider === "ollama"
      ? null
      : defaultModelFor(opts.provider, "text"));
  const run = await runReportComposer({
    kind,
    snapshot,
    allowDeterministicFallback: opts.provider === "ollama",
    providerOverride: opts.provider,
    modelOverride,
    cloudVisionAllowed: false,
  });
  const validation = run.draft
    ? validateComposerOutput(snapshot, run.draft, { kind })
    : { ok: false, errors: ["no_draft"], warnings: [] as string[], unsupportedMentions: [] };
  const displayStatus = resolveComposeDisplayStatus({
    ok: run.ok,
    fallbackUsed: run.fallbackUsed,
    model: run.model,
    provider: run.provenance?.provider,
    warnings: [...(run.draft?.warnings ?? []), ...validation.warnings],
  });
  const provider = (run.provenance?.provider ?? opts.provider) as string;
  const isCloud = provider === "deepseek" || provider === "qwen" || provider === "openai";
  const isLocalOpenAi = provider === "local_openai_compatible";
  const cloudCalled =
    run.ok === true && run.fallbackUsed !== true && isCloud;
  const localCalled =
    run.ok === true &&
    run.fallbackUsed !== true &&
    (run.model ?? "").toLowerCase() !== "deterministic" &&
    (provider === "ollama" || isLocalOpenAi);
  const personaLoaded = Boolean(
    (localCalled || cloudCalled) && run.provenance?.personaVersion,
  );
  const requestedProvider = opts.provider;
  const requestedModel = modelOverride || runtimeBefore.model;
  const provenanceIntact = provider === requestedProvider;
  return {
    ok: run.ok,
    validationOk: validation.ok,
    writesClinicalReport: false as const,
    execution: isCloud ? ("CLOUD" as const) : ("LOCAL" as const),
    requestedProvider,
    requestedModel,
    actualProvider: provider,
    actualModel: run.model ?? null,
    provenanceIntact,
    runtime: {
      enabled: runtimeBefore.enabled,
      model: runtimeBefore.model,
      fallbackModel: runtimeBefore.fallbackModel,
      endpoint: isCloud
        ? provider === "qwen"
          ? qwenConfiguredPublicStatus().baseUrl
          : provider === "openai"
            ? openaiConfiguredPublicStatus().baseUrl
            : deepseekConfiguredPublicStatus().baseUrl
        : isLocalOpenAi
          ? localOpenAiConfiguredPublicStatus().baseUrl
          : runtimeBefore.endpoint,
      endpointSource: isCloud
        ? `${provider}_official_api`
        : isLocalOpenAi
          ? "local_openai_compatible"
          : runtimeBefore.endpointSource,
      hasFallback: !!runtimeBefore.fallbackModel,
      statusMessage: composerRuntimeStatusMessage(runtimeBefore),
      localOnly: runtimeBefore.localOnly,
      transport: isCloud
        ? `${provider}_official`
        : isLocalOpenAi
          ? "openai_compatible_local"
          : "ollama",
    },
    hashes,
    compose: {
      ok: run.ok,
      model: run.model,
      fallbackUsed: run.fallbackUsed,
      latencyMs: run.latencyMs,
      safeError: run.safeError,
      displayStatus,
      ollamaCalled: localCalled && provider === "ollama",
      localOpenAiCalled: localCalled && isLocalOpenAi,
      deepseekCalled: provider === "deepseek" && cloudCalled,
      qwenCalled: provider === "qwen" && cloudCalled,
      openaiCalled: provider === "openai" && cloudCalled,
      personaLoaded,
      personaVersion: run.provenance?.personaVersion ?? null,
      expectedPersonaVersion: CARE_PERSONA_VERSION,
      provider,
      httpStatus: localCalled || cloudCalled ? 200 : null,
      // The provider reports these and CARE has been throwing them away: an arm
      // comparison that cannot say which answer cost more, or whether one was
      // cut off at the token ceiling, is not a comparison.
      promptTokens: run.usage?.promptTokens ?? null,
      completionTokens: run.usage?.completionTokens ?? null,
      totalTokens: run.usage?.totalTokens ?? null,
      approximateCostUsd: run.usage?.approximateCostUsd ?? null,
      draft: run.draft
        ? {
            findings: run.draft.findings,
            impression: run.draft.impression,
            recommendation: run.draft.recommendation,
            warnings: run.draft.warnings ?? [],
            observations: run.draft.observations ?? [],
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
            : displayStatus === "CLOUD_AI_SUCCESS"
              ? `${String(provider).toUpperCase()} CLOUD SUCCESS`
              : null,
    },
    validation,
  };
}

/** Synthetic non-PHI self-test — exercises real runReportComposer (no patient write). */
reportComposerRouter.post("/test", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provider = parseProviderOverride(body.provider);
  if (!provider) {
    // Named, but CARE has no adapter for it. Refused out loud rather than run
    // on Ollama behind a label that says otherwise.
    res.status(400).json({
      ok: false,
      safeError: "composer_provider_not_supported",
      error: unsupportedComposerProviderMessage(body.provider),
    });
    return;
  }
  const kind = testKind(body);
  if (!kind) {
    res.status(400).json({
      ok: false,
      safeError: "composer_job_kind_not_supported",
      error:
        `Unknown composer task "${String(body.kind ?? "").slice(0, 48)}". Supported: `
        + `${AI_COMPOSE_JOB_KINDS.join(", ")}.`,
    });
    return;
  }
  const modelOverride = typeof body.model === "string" ? body.model : null;
  const result = await runComposerTestOnce({ body, provider, modelOverride, kind });
  res.json({
    ...result,
    deterministicSample: deterministicComposeFromSnapshot(
      buildComposerTestSnapshot(body, kind),
      kind,
    ),
  });
});

/** `body.kind`, validated against the same list `POST /jobs` uses. */
function testKind(body: Record<string, unknown>): AiComposeJobKind | null {
  const raw = String(body.kind ?? "FULL_REPORT").trim() || "FULL_REPORT";
  return AI_COMPOSE_JOB_KINDS.includes(raw as AiComposeJobKind)
    ? (raw as AiComposeJobKind)
    : null;
}

/**
 * Compare SAME frozen observations across 2–4 provider/model arms.
 * One arm's output never becomes another arm's input.
 */
reportComposerRouter.post("/test/compare", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = testKind(body);
  if (!kind) {
    res.status(400).json({
      ok: false,
      safeError: "composer_job_kind_not_supported",
      error:
        `Unknown composer task "${String(body.kind ?? "").slice(0, 48)}". Supported: `
        + `${AI_COMPOSE_JOB_KINDS.join(", ")}.`,
    });
    return;
  }
  const armsRaw = Array.isArray(body.arms) ? body.arms : null;
  const armSpecs: Array<Record<string, unknown>> = armsRaw
    ? armsRaw.slice(0, 4).map((a) => (a ?? {}) as Record<string, unknown>)
    : [
        { provider: "ollama" },
        { provider: "qwen", model: QWEN_DEFAULT_MODEL },
        { provider: "deepseek", model: DEEPSEEK_TEXT_MODEL },
      ];
  const arms: Array<{ provider: ComposerProviderName; model: string | null }> = [];
  for (const row of armSpecs) {
    const provider = parseProviderOverride(row.provider);
    if (!provider) {
      // One unrunnable arm name fails the whole comparison rather than being
      // quietly replaced by Ollama, because the point of this screen is that the
      // arms differ.
      res.status(400).json({
        ok: false,
        safeError: "composer_provider_not_supported",
        error: unsupportedComposerProviderMessage(row.provider),
      });
      return;
    }
    arms.push({
      provider,
      model: typeof row.model === "string" ? row.model : null,
    });
  }

  const results = [];
  for (const arm of arms) {
    results.push(
      await runComposerTestOnce({
        body,
        provider: arm.provider,
        modelOverride: arm.model,
        kind,
      }),
    );
  }

  res.json({
    ok: true,
    writesClinicalReport: false,
    frozenInput: true,
    armCount: results.length,
    deepSeekConfigured: deepseekConfiguredPublicStatus().configured,
    qwenConfigured: qwenConfiguredPublicStatus().configured,
    openaiConfigured: openaiConfiguredPublicStatus().configured,
    results,
    // Back-compat for #709 UI
    local: results.find((r) => r.actualProvider === "ollama") ?? results[0] ?? null,
    deepseek: results.find((r) => r.actualProvider === "deepseek") ?? null,
    qwen: results.find((r) => r.actualProvider === "qwen") ?? null,
  });
});

/**
 * Experimental Cloud Vision Trial A/B — explicit confirm required.
 * Never writes clinical reports. Derived JPEG/PNG only (no DICOM).
 */
reportComposerRouter.post("/vision-trial", async (req, res): Promise<void> => {
  if (!canUse(req as StaffAuthRequest)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const confirmCloudVisionTrial = body.confirmCloudVisionTrial === true;
  // The admin setting is the only authority here. The request body used to be
  // able to grant itself cloud vision — both directly, and again when the ops
  // settings failed to load — which made "clinical images need an explicit
  // opt-in" a suggestion the caller could overrule. The confirm checkbox stays:
  // it records that the operator acknowledged the trial, it does not authorise
  // it. Denials are the fail-closed branch.
  let cloudVisionAllowed = false;
  try {
    const ops = await getOvernightOpsControls();
    cloudVisionAllowed = ops.deepseekCloudVisionAllowed === true;
  } catch {
    cloudVisionAllowed = false;
  }

  const imagesRaw = Array.isArray(body.images) ? body.images : [];
  const images = imagesRaw
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const mime = String(r.mimeType ?? "image/jpeg");
      if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
      const base64 = String(r.base64 ?? "").trim();
      if (!base64 || base64.length > 3_500_000) return null;
      return {
        mimeType: mime as "image/jpeg" | "image/png" | "image/webp",
        base64,
        label: typeof r.label === "string" ? r.label.slice(0, 80) : undefined,
        filename: typeof r.filename === "string" ? r.filename.slice(0, 120) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .slice(0, 6);

  const result = await runDeepSeekVisionAbTrial({
    images,
    clinicalPrompt: typeof body.clinicalPrompt === "string" ? body.clinicalPrompt : undefined,
    confirmCloudVisionTrial,
    cloudVisionAllowed,
    runLocal: body.runLocal !== false,
    runDeepSeek: body.runDeepSeek !== false,
  });
  res.json(result);
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
