/**
 * One-click AI Pipeline Self-Test — diagnostic only.
 *
 * Probes (sequential):
 *   Direct /api/generate (1 img)
 *   Direct /api/chat production-shaped (1 img)
 *   Provider-only generateAiForTask (1 img) — stop before parser
 *   Provider-only generateAiForTask (up to 6 imgs)
 *   Full CARE draft path (1 img) — parse sections
 *   Full CARE draft path (up to 6 imgs)
 *
 * Never creates/finalizes clinical reports, never bulk-enqueues.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { pacsSettingsTable, radiologyWorklistTable } from "@workspace/db/schema";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  buildOllamaChatPayload,
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
  estimateBase64DecodedBytes,
  generateAiForTask,
  loadProviderConfig,
  probeOllamaReachable,
  resolveTaskRoute,
} from "@workspace/ai-providers";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import { orthancAuthHeaders, resolveOrthancBaseFromSources } from "./studyImageFetch";
import { logger } from "../logger";
import {
  assertDiagnosticReportPhiSafe,
  buildFullCareStages,
  buildProviderOnlyStages,
  deriveSelfTestFinal,
  parseDraftSections,
  selfTestSafetyContract,
  type PathProbeResult,
  type PipelineStageResult,
  type SelfTestFinal,
} from "./aiPipelineSelfTestLogic";
import {
  classifyContextBudgetCheck,
  estimateVisionPromptTokens,
  maxImagesForContextBudget,
  parseOllamaContextExceeded,
  resolveInteractiveDraftNumCtx,
} from "./contextBudget";

export type SelfTestStepStatus = "pending" | "running" | "pass" | "fail" | "skip";

export interface SelfTestStep {
  id: string;
  group: string;
  name: string;
  status: SelfTestStepStatus;
  detail: string;
  elapsedMs?: number;
}

export interface AiPipelineSelfTestResult {
  id: string;
  status: "queued" | "running" | "completed";
  final: SelfTestFinal;
  summary: string;
  steps: SelfTestStep[];
  probes: PathProbeResult[];
  stagesByProbe: Record<string, PipelineStageResult[]>;
  technical: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  progressLabel: string;
  safety: ReturnType<typeof selfTestSafetyContract>;
}

type JobRecord = AiPipelineSelfTestResult & { _timer?: ReturnType<typeof setTimeout> };

const JOBS = new Map<string, JobRecord>();
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS = 20;

const CONNECTIVITY_PROMPT =
  "This is a connectivity test. Confirm that you can see and analyze the supplied medical image. Do not provide a diagnosis.";

/** Same instruction block as POST /api/ai-reporting/draft (production-shaped). */
const DRAFT_PROMPT = [
  "Provide a detailed radiology report based on the supplied imaging.",
  "",
  "=== INSTRUCTION ===",
  "Generate a refined radiology report. Return ONLY two sections:",
  "FINDINGS: (structured findings)",
  "IMPRESSION: (concise impression)",
  "Do not include any other text or explanations.",
  "",
  "This is a diagnostic self-test. Do not invent patient demographics.",
].join("\n");

function upsertStep(job: JobRecord, step: SelfTestStep): void {
  const idx = job.steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) job.steps[idx] = step;
  else job.steps.push(step);
  job.progressLabel = `${step.group}: ${step.name} — ${step.status}`;
}

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of JOBS) {
    const t = new Date(job.finishedAt ?? job.startedAt).getTime();
    if (now - t > JOB_TTL_MS) JOBS.delete(id);
  }
  while (JOBS.size > MAX_JOBS) {
    const oldest = [...JOBS.entries()].sort(
      (a, b) => new Date(a[1].startedAt).getTime() - new Date(b[1].startedAt).getTime(),
    )[0];
    if (oldest) JOBS.delete(oldest[0]);
    else break;
  }
}

async function resolveOrthancBase(): Promise<string | null> {
  const rows = await db
    .select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value })
    .from(pacsSettingsTable);
  const val = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return resolveOrthancBaseFromSources({
    envInternal: process.env.ORTHANC_INTERNAL_URL,
    envPublic: process.env.ORTHANC_URL,
    orthancBaseUrl: val("orthanc_base_url"),
    orthancUrl: val("orthanc_url"),
    orthancDicomWebUrl: val("orthanc_dicomweb_url"),
  });
}

export interface RecentMriStudyOption {
  worklistId: number;
  studyInstanceUid: string;
  modality: string;
  studyDescription: string | null;
  accessionNumber: string | null;
}

/** Admin picker: recent MRI worklist rows (ids only — no patient names). */
export async function listRecentMriStudies(limit = 20): Promise<RecentMriStudyOption[]> {
  const rows = await db
    .select({
      id: radiologyWorklistTable.id,
      studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
      modality: radiologyWorklistTable.modality,
      studyDescription: radiologyWorklistTable.studyDescription,
      accessionNumber: radiologyWorklistTable.accessionNumber,
    })
    .from(radiologyWorklistTable)
    .where(
      and(
        isNotNull(radiologyWorklistTable.studyInstanceUID),
        or(
          sql`upper(${radiologyWorklistTable.modality}) in ('MR','MRI')`,
          sql`upper(coalesce(${radiologyWorklistTable.studyDescription}, '')) like '%MRI%'`,
        ),
      ),
    )
    .orderBy(desc(radiologyWorklistTable.id))
    .limit(Math.min(50, Math.max(1, limit)));

  return rows
    .filter((r) => !!r.studyInstanceUID)
    .map((r) => ({
      worklistId: r.id,
      studyInstanceUid: r.studyInstanceUID!,
      modality: r.modality ?? "MR",
      studyDescription: r.studyDescription ?? null,
      accessionNumber: r.accessionNumber ?? null,
    }));
}

async function pickRecentMri(studyInstanceUid?: string): Promise<{
  worklistId: number;
  studyInstanceUid: string;
  modality: string;
} | null> {
  if (studyInstanceUid?.trim()) {
    const [row] = await db
      .select({
        id: radiologyWorklistTable.id,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        modality: radiologyWorklistTable.modality,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUid.trim()))
      .limit(1);
    if (row?.studyInstanceUID) {
      return {
        worklistId: row.id,
        studyInstanceUid: row.studyInstanceUID,
        modality: row.modality ?? "MR",
      };
    }
    // Allow direct Orthanc UID even if not on worklist
    return {
      worklistId: 0,
      studyInstanceUid: studyInstanceUid.trim(),
      modality: "MR",
    };
  }
  const list = await listRecentMriStudies(15);
  const first = list[0];
  if (!first) return null;
  return {
    worklistId: first.worklistId,
    studyInstanceUid: first.studyInstanceUid,
    modality: first.modality,
  };
}

type DcmTag = { Value?: (string | { Alphabetic?: string })[] };
type DcmEntry = Record<string, DcmTag>;

function tagStr(entry: DcmEntry | undefined, tag: string): string {
  const v = entry?.[tag]?.Value?.[0];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "Alphabetic" in v) return String(v.Alphabetic ?? "");
  return "";
}

export interface SelectedImageMeta {
  seriesUid: string;
  instanceUid: string;
  seriesDescription: string;
  byteSize: number;
  selectionReason: string;
  jpegBase64: string;
}

/**
 * Mirror POST /api/ai-reporting/draft image selection:
 * middle instance per series, maxImages (default 6), JPEG (optionally resized).
 */
async function fetchDraftShapedImages(
  orthancBase: string,
  studyUid: string,
  maxImages: number,
): Promise<{
  ok: boolean;
  seriesCount: number;
  images: SelectedImageMeta[];
  totalImageBytes: number;
  detail: string;
  fetchElapsedMs: number;
}> {
  const t0 = Date.now();
  const base = orthancBase.replace(/\/$/, "");
  const auth = orthancAuthHeaders();
  const dicomWeb = `${base}/dicom-web`;
  const empty = {
    ok: false,
    seriesCount: 0,
    images: [] as SelectedImageMeta[],
    totalImageBytes: 0,
    detail: "fetch failed",
    fetchElapsedMs: 0,
  };

  const seriesResp = await fetch(`${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series`, {
    headers: { ...auth, Accept: "application/json" },
  }).catch(() => null);

  let seriesList: DcmEntry[] = [];
  if (seriesResp?.ok) {
    seriesList = (await seriesResp.json().catch(() => [])) as DcmEntry[];
  } else {
    empty.fetchElapsedMs = Date.now() - t0;
    empty.detail = "DICOMweb series list failed";
    return empty;
  }

  const images: SelectedImageMeta[] = [];
  const cap = Math.min(maxImages, 20);

  for (const series of seriesList) {
    if (images.length >= cap) break;
    const seriesUID = tagStr(series, "0020000E");
    if (!seriesUID) continue;
    const seriesDescription =
      tagStr(series, "0008103E") || tagStr(series, "00080060") || "series";

    const instancesResp = await fetch(
      `${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUID)}/instances`,
      { headers: { ...auth, Accept: "application/json" } },
    ).catch(() => null);
    if (!instancesResp?.ok) continue;
    const instances = (await instancesResp.json().catch(() => [])) as DcmEntry[];
    if (!instances.length) continue;

    const midIdx = Math.floor(instances.length / 2);
    const inst = instances[midIdx]!;
    const instanceUID = tagStr(inst, "00080018");
    if (!instanceUID) continue;

    const rendered = await fetch(
      `${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(instanceUID)}/rendered`,
      { headers: { ...auth, Accept: "image/jpeg" } },
    ).catch(() => null);
    if (!rendered?.ok) continue;

    try {
      const rawArr = new Uint8Array(await rendered.arrayBuffer());
      let b64: string;
      let byteLen = rawArr.byteLength;
      try {
        const sharp = (await import("sharp")).default;
        const resized = await sharp(rawArr)
          .resize({ width: 512, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        b64 = resized.toString("base64");
        byteLen = resized.byteLength;
      } catch {
        b64 = Buffer.from(rawArr).toString("base64");
      }
      images.push({
        seriesUid: seriesUID,
        instanceUid: instanceUID,
        seriesDescription: seriesDescription.slice(0, 120),
        byteSize: byteLen,
        selectionReason: `middle slice of series (${midIdx + 1}/${instances.length} instances)`,
        jpegBase64: b64,
      });
    } catch {
      continue;
    }
  }

  const totalImageBytes = images.reduce((a, i) => a + i.byteSize, 0);
  return {
    ok: images.length > 0,
    seriesCount: seriesList.length,
    images,
    totalImageBytes,
    detail: images.length
      ? `selected ${images.length}/${cap} (series available ${seriesList.length})`
      : "no rendered images",
    fetchElapsedMs: Date.now() - t0,
  };
}

async function directGenerate(opts: {
  endpoint: string;
  model: string;
  jpegBase64: string;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  elapsedMs: number;
  responseLength: number;
  requestBodyBytes: number;
  thinkingLength: number;
  finishReason: string | null;
  totalDurationNs: number | null;
  loadDurationNs: number | null;
  promptEvalCount: number | null;
  evalCount: number | null;
  error?: string;
}> {
  const body = {
    model: opts.model,
    prompt: CONNECTIVITY_PROMPT,
    images: [opts.jpegBase64],
    stream: false,
    think: false,
  };
  const bodyJson = JSON.stringify(body);
  const t0 = Date.now();
  try {
    const resp = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: AbortSignal.timeout(180_000),
    });
    const elapsedMs = Date.now() - t0;
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return {
        ok: false,
        httpStatus: resp.status,
        elapsedMs,
        responseLength: 0,
        requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
        thinkingLength: 0,
        finishReason: null,
        totalDurationNs: null,
        loadDurationNs: null,
        promptEvalCount: null,
        evalCount: null,
        error: `Ollama /api/generate ${resp.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }
    const data = (await resp.json()) as {
      response?: string;
      thinking?: string;
      done_reason?: string;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = (data.response ?? "").trim();
    return {
      ok: text.length > 0,
      httpStatus: resp.status,
      elapsedMs,
      responseLength: text.length,
      requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
      thinkingLength: (data.thinking ?? "").length,
      finishReason: data.done_reason ?? null,
      totalDurationNs: typeof data.total_duration === "number" ? data.total_duration : null,
      loadDurationNs: typeof data.load_duration === "number" ? data.load_duration : null,
      promptEvalCount: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
      evalCount: typeof data.eval_count === "number" ? data.eval_count : null,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      elapsedMs: Date.now() - t0,
      responseLength: 0,
      requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
      thinkingLength: 0,
      finishReason: null,
      totalDurationNs: null,
      loadDurationNs: null,
      promptEvalCount: null,
      evalCount: null,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}

/** Production-shaped /api/chat (same payload builder as OllamaProvider). */
async function directChatProductionShaped(opts: {
  endpoint: string;
  model: string;
  jpegBase64: string;
  /** Match /api/ai-reporting/draft: think is NOT sent today. */
  matchDraftThink?: boolean;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  elapsedMs: number;
  responseLength: number;
  requestBodyBytes: number;
  thinkSent: boolean;
  thinkValue: boolean | null;
  thinkingLength: number;
  finishReason: string | null;
  totalDurationNs: number | null;
  loadDurationNs: number | null;
  promptEvalCount: number | null;
  evalCount: number | null;
  error?: string;
}> {
  // Draft path currently omits `think` entirely (options = { model } only).
  const payload = buildOllamaChatPayload({
    model: opts.model,
    prompt: CONNECTIVITY_PROMPT,
    images: [opts.jpegBase64],
    ...(opts.matchDraftThink === false ? { think: false as const } : {}),
  });
  const thinkSent = Object.prototype.hasOwnProperty.call(payload, "think");
  const thinkValue = thinkSent ? Boolean(payload.think) : null;
  const bodyJson = JSON.stringify(payload);
  const t0 = Date.now();
  try {
    const resp = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: AbortSignal.timeout(180_000),
    });
    const elapsedMs = Date.now() - t0;
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return {
        ok: false,
        httpStatus: resp.status,
        elapsedMs,
        responseLength: 0,
        requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
        thinkSent,
        thinkValue,
        thinkingLength: 0,
        finishReason: null,
        totalDurationNs: null,
        loadDurationNs: null,
        promptEvalCount: null,
        evalCount: null,
        error: `Ollama /api/chat ${resp.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }
    const data = (await resp.json()) as {
      message?: { content?: string; thinking?: string };
      response?: string;
      done_reason?: string;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = (data.message?.content ?? data.response ?? "").trim();
    return {
      ok: text.length > 0,
      httpStatus: resp.status,
      elapsedMs,
      responseLength: text.length,
      requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
      thinkSent,
      thinkValue,
      thinkingLength: (data.message?.thinking ?? "").length,
      finishReason: data.done_reason ?? null,
      totalDurationNs: typeof data.total_duration === "number" ? data.total_duration : null,
      loadDurationNs: typeof data.load_duration === "number" ? data.load_duration : null,
      promptEvalCount: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
      evalCount: typeof data.eval_count === "number" ? data.eval_count : null,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      elapsedMs: Date.now() - t0,
      responseLength: 0,
      requestBodyBytes: Buffer.byteLength(bodyJson, "utf8"),
      thinkSent,
      thinkValue,
      thinkingLength: 0,
      finishReason: null,
      totalDurationNs: null,
      loadDurationNs: null,
      promptEvalCount: null,
      evalCount: null,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}

async function runGenerateAiForTaskProbe(opts: {
  label: string;
  model: string;
  endpointUrl: string;
  images: string[];
  imageFetchMs: number;
  imageFetchOk: boolean;
  fullPipeline: boolean;
  /** When undefined, omit num_ctx (legacy draft bug). When set, send options.num_ctx. */
  numCtx?: number | null;
  configuredNumCtx?: number | null;
}): Promise<PathProbeResult> {
  const imageBytes = opts.images.reduce((s, i) => s + estimateBase64DecodedBytes(i), 0);
  if (!opts.imageFetchOk || opts.images.length === 0) {
    const stages = opts.fullPipeline
      ? buildFullCareStages({
          imageFetchOk: false,
          imageFetchMs: opts.imageFetchMs,
          providerReturned: false,
          providerElapsedMs: 0,
          httpStatus: null,
          safeError: "no images",
          parserSuccess: null,
          candidateCount: null,
          jsonParseOk: null,
        })
      : buildProviderOnlyStages({
          imageFetchOk: false,
          imageFetchMs: opts.imageFetchMs,
          providerReturned: false,
          providerElapsedMs: 0,
          httpStatus: null,
          safeError: "no images",
        });
    return {
      label: opts.label,
      pass: false,
      model: opts.model,
      endpoint: opts.endpointUrl,
      imageCount: 0,
      totalImageBytes: 0,
      requestBodyBytes: null,
      elapsedMs: opts.imageFetchMs,
      httpStatus: null,
      responseLength: 0,
      parserSuccess: null,
      candidateCount: null,
      safeError: "image fetch failed",
      stages,
      configuredNumCtx: opts.configuredNumCtx ?? null,
      requestedNumCtx: opts.numCtx ?? null,
    };
  }

  const t0 = Date.now();
  const callOpts: {
    model: string;
    endpointUrl: string;
    numCtx?: number;
  } = {
    model: opts.model,
    endpointUrl: opts.endpointUrl,
  };
  if (opts.numCtx != null && Number.isFinite(opts.numCtx)) {
    callOpts.numCtx = Math.floor(opts.numCtx);
  }
  const aiResult = await generateAiForTask("radiology_draft", DRAFT_PROMPT, opts.images, callOpts);
  const elapsedMs = Date.now() - t0;
  const d = aiResult.diagnostics;
  const providerReturned = aiResult.success;
  const parsed = providerReturned ? parseDraftSections(aiResult.text ?? "") : null;
  const ctxErr = parseOllamaContextExceeded(aiResult.error ?? d?.errorMessage ?? "");
  const errorCode = d?.errorCode ?? (ctxErr ? "CONTEXT_BUDGET_EXCEEDED" : null);
  const safeError = providerReturned
    ? null
    : errorCode === "CONTEXT_BUDGET_EXCEEDED"
      ? `CONTEXT_BUDGET_EXCEEDED requestTokens=${d?.ollamaRequestTokens ?? ctxErr?.requestTokens} availableContext=${d?.ollamaAvailableContext ?? ctxErr?.availableContext}`
      : (d?.errorMessage ?? aiResult.error ?? "provider failed").slice(0, 400);

  const common = {
    model: d?.model ?? opts.model,
    endpoint: d?.resolvedEndpoint ?? opts.endpointUrl,
    imageCount: d?.numberOfImages ?? opts.images.length,
    totalImageBytes: d?.totalImageBytes ?? imageBytes,
    requestBodyBytes: d?.requestBodyBytes ?? null,
    elapsedMs,
    httpStatus: d?.httpStatus ?? (providerReturned ? 200 : 502),
    responseLength: d?.responseLength ?? (aiResult.text?.length ?? 0),
    thinkSent: d?.thinkSent ?? false,
    thinkValue: d?.thinkValue ?? null,
    thinkingLength: d?.thinkingLength ?? null,
    finishReason: d?.finishReason ?? null,
    ollamaTotalDurationNs: d?.ollamaTotalDurationNs ?? null,
    ollamaLoadDurationNs: d?.ollamaLoadDurationNs ?? null,
    ollamaPromptEvalCount: d?.ollamaPromptEvalCount ?? null,
    ollamaEvalCount: d?.ollamaEvalCount ?? null,
    configuredNumCtx: opts.configuredNumCtx ?? null,
    requestedNumCtx: d?.requestedNumCtx ?? opts.numCtx ?? null,
    ollamaAvailableContext: d?.ollamaAvailableContext ?? ctxErr?.availableContext ?? null,
    ollamaRequestTokens: d?.ollamaRequestTokens ?? ctxErr?.requestTokens ?? null,
    errorCode,
  };

  if (!opts.fullPipeline) {
    const stages = buildProviderOnlyStages({
      imageFetchOk: true,
      imageFetchMs: opts.imageFetchMs,
      providerReturned,
      providerElapsedMs: elapsedMs,
      httpStatus: d?.httpStatus ?? null,
      safeError,
    });
    return {
      label: opts.label,
      pass: providerReturned,
      parserSuccess: null,
      candidateCount: null,
      safeError,
      stages,
      ...common,
    };
  }

  const parserSuccess = parsed?.parserSuccess ?? false;
  const candidateCount = parsed?.candidateCount ?? 0;
  const stages = buildFullCareStages({
    imageFetchOk: true,
    imageFetchMs: opts.imageFetchMs,
    providerReturned,
    providerElapsedMs: elapsedMs,
    httpStatus: d?.httpStatus ?? null,
    safeError,
    parserSuccess: providerReturned ? parserSuccess : null,
    candidateCount: providerReturned ? candidateCount : null,
    jsonParseOk: providerReturned ? (parsed?.jsonParseOk ?? null) : null,
  });
  const pass = providerReturned && parserSuccess && candidateCount > 0;
  return {
    label: opts.label,
    pass,
    parserSuccess: providerReturned ? parserSuccess : null,
    candidateCount: providerReturned ? candidateCount : null,
    safeError: pass
      ? null
      : !providerReturned
        ? safeError
        : "parser/final_shape failed — empty or unusable draft sections",
    stages,
    ...common,
  };
}

function probeToStep(probe: PathProbeResult, group: string, id: string, name: string): SelfTestStep {
  const stageHint = probe.stages
    .filter((s) => s.status === "fail")
    .map((s) => `${s.id}: ${s.detail}`)
    .slice(0, 2)
    .join("; ");
  return {
    id,
    group,
    name,
    status: probe.pass ? "pass" : "fail",
    elapsedMs: probe.elapsedMs,
    detail: [
      probe.pass ? "PASS" : "FAIL",
      probe.errorCode === "CONTEXT_BUDGET_EXCEEDED" ? "CONTEXT_BUDGET_EXCEEDED" : null,
      `images=${probe.imageCount}`,
      `bytes=${probe.totalImageBytes}`,
      probe.requestBodyBytes != null ? `bodyBytes=${probe.requestBodyBytes}` : null,
      `requestedNumCtx=${probe.requestedNumCtx ?? "NOT_SENT"}`,
      probe.ollamaRequestTokens != null ? `requestTokens=${probe.ollamaRequestTokens}` : null,
      probe.ollamaAvailableContext != null ? `availableCtx=${probe.ollamaAvailableContext}` : null,
      `HTTP ${probe.httpStatus ?? "?"}`,
      `respLen=${probe.responseLength}`,
      probe.parserSuccess != null ? `parser=${probe.parserSuccess}` : null,
      probe.candidateCount != null ? `candidates=${probe.candidateCount}` : null,
      probe.safeError,
      stageHint || null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

async function executeSelfTest(job: JobRecord, opts: { studyInstanceUid?: string }): Promise<void> {
  job.status = "running";
  job.final = "RUNNING";
  const technical: Record<string, unknown> = {
    safety: selfTestSafetyContract(),
  };
  const probes: PathProbeResult[] = [];

  try {
    upsertStep(job, {
      id: "runtime",
      group: "Runtime",
      name: "CARE API runtime config",
      status: "running",
      detail: "Resolving…",
    });
    const runtime = await resolveLocalAiRuntime(true);
    const orthancBase = await resolveOrthancBase();
    const taskRoute = await resolveTaskRoute("radiology_draft");
    const prov = await loadProviderConfig(taskRoute?.provider ?? "ollama");
    const model =
      taskRoute?.model ||
      runtime.localChatVisionModel ||
      runtime.modelVision ||
      CANONICAL_LOCAL_CHAT_VISION_MODEL;
    const endpoint = runtime.ollamaBaseUrl || CANONICAL_OLLAMA_ENDPOINT;
    technical.ollamaEndpoint = endpoint;
    technical.model = model;
    technical.orthancEndpoint = orthancBase;
    technical.provider = taskRoute?.provider ?? prov?.provider ?? "ollama";
    technical.taskRoute = taskRoute;
    technical.configuredNumCtx = runtime.ollamaNumCtx;
    technical.draftPathThinkNote =
      "POST /api/ai-reporting/draft now sends explicit options.num_ctx (previously omitted → Ollama ~4096 default).";
    const draftCtxPlan = resolveInteractiveDraftNumCtx({
      configuredNumCtx: runtime.ollamaNumCtx,
      imageCount: 6,
      draftNumCtxOverride: process.env.OLLAMA_DRAFT_NUM_CTX
        ? Number(process.env.OLLAMA_DRAFT_NUM_CTX)
        : null,
    });
    technical.interactiveDraftNumCtxPlan = draftCtxPlan;
    const overnightBudget = maxImagesForContextBudget({
      numCtx: runtime.ollamaNumCtx,
      hardCap: 20,
    });
    technical.overnightImageBudget = {
      ...overnightBudget,
      estimatedTokensIf20: estimateVisionPromptTokens({ imageCount: 20 }),
      estimatedTokensAtCap: estimateVisionPromptTokens({ imageCount: overnightBudget.maxImages }),
      note: "Overnight was hard-capped at 20; now capped by context budget to avoid mass abandonments.",
    };
    upsertStep(job, {
      id: "runtime",
      group: "Runtime",
      name: "CARE API runtime config",
      status: endpoint && orthancBase ? "pass" : "fail",
      detail: `Ollama ${endpoint} · model ${model} · Orthanc ${orthancBase ?? "MISSING"} · configuredNumCtx=${runtime.ollamaNumCtx} · draftNumCtx→${draftCtxPlan.requestedNumCtx} · overnightMaxImages→${overnightBudget.maxImages}`,
    });

    upsertStep(job, {
      id: "ollama-health",
      group: "Runtime",
      name: "Ollama health",
      status: "running",
      detail: "GET /api/tags…",
    });
    const probeTags = await probeOllamaReachable(endpoint, 6000);
    const hasModel = (probeTags.models ?? []).some(
      (m) => m === model || m.startsWith(`${model}:`) || m.includes("qwen3-vl"),
    );
    technical.qwenInstalled = hasModel;
    upsertStep(job, {
      id: "ollama-health",
      group: "Runtime",
      name: "Ollama health",
      status: probeTags.reachable && hasModel ? "pass" : "fail",
      detail: probeTags.reachable
        ? hasModel
          ? `GET /api/tags OK — ${model} present`
          : `${model} NOT found`
        : probeTags.error ?? "unreachable",
    });

    upsertStep(job, {
      id: "orthanc-health",
      group: "Runtime",
      name: "Orthanc health",
      status: "running",
      detail: "GET /system…",
    });
    let orthancOk = false;
    if (orthancBase) {
      const sys = await fetch(`${orthancBase.replace(/\/$/, "")}/system`, {
        headers: { ...orthancAuthHeaders(), Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      orthancOk = Boolean(sys?.ok);
      technical.orthancSystemHttp = sys?.status ?? 0;
    }
    upsertStep(job, {
      id: "orthanc-health",
      group: "Runtime",
      name: "Orthanc health",
      status: orthancOk ? "pass" : "fail",
      detail: orthancOk ? `GET /system ${technical.orthancSystemHttp}` : "failed",
    });

    if (!orthancOk || !orthancBase) {
      job.final = "FAIL";
      job.summary = "FAIL — Orthanc unreachable";
      return;
    }

    const study = await pickRecentMri(opts.studyInstanceUid);
    if (!study) {
      upsertStep(job, {
        id: "mri-study",
        group: "Image path",
        name: "MRI study found",
        status: "fail",
        detail: "Could not run image test — no eligible MRI found.",
      });
      const derived = deriveSelfTestFinal({
        noMri: true,
        directGeneratePass: null,
        directChatPass: null,
        providerOnly1Pass: null,
        providerOnly6Pass: null,
        fullCare1Pass: null,
        fullCare6Pass: null,
      });
      job.final = derived.final;
      job.summary = derived.summary;
      return;
    }
    technical.worklistId = study.worklistId;
    technical.studyInstanceUid = study.studyInstanceUid;
    technical.modality = study.modality;
    upsertStep(job, {
      id: "mri-study",
      group: "Image path",
      name: "MRI study found",
      status: "pass",
      detail: `worklist #${study.worklistId || "n/a"} · ${study.modality}`,
    });

    upsertStep(job, {
      id: "image-fetch",
      group: "Image path",
      name: "Draft-shaped image selection",
      status: "running",
      detail: "Fetching up to 6 middle-slice JPEGs…",
    });
    const fetched = await fetchDraftShapedImages(orthancBase, study.studyInstanceUid, 6);
    technical.imageSelection = {
      seriesCount: fetched.seriesCount,
      selectedCount: fetched.images.length,
      totalImageBytes: fetched.totalImageBytes,
      perImageByteSizes: fetched.images.map((i) => i.byteSize),
      seriesDescriptions: fetched.images.map((i) => i.seriesDescription),
      selectionReasons: fetched.images.map((i) => i.selectionReason),
      seriesUids: fetched.images.map((i) => i.seriesUid),
      instanceUids: fetched.images.map((i) => i.instanceUid),
      fetchElapsedMs: fetched.fetchElapsedMs,
      detail: fetched.detail,
    };
    upsertStep(job, {
      id: "image-fetch",
      group: "Image path",
      name: "Draft-shaped image selection",
      status: fetched.ok ? "pass" : "fail",
      detail: fetched.ok
        ? `${fetched.images.length} images · ${Math.round(fetched.totalImageBytes / 1024)} KB total · ${fetched.seriesCount} series in study`
        : fetched.detail,
      elapsedMs: fetched.fetchElapsedMs,
    });
    if (!fetched.ok) {
      job.final = "FAIL";
      job.summary = "FAIL — could not fetch rendered MRI JPEG(s)";
      return;
    }

    const img1 = [fetched.images[0]!.jpegBase64];
    const img6 = fetched.images.map((i) => i.jpegBase64);
    const bytes1 = fetched.images[0]!.byteSize;

    // A. Direct /api/generate 1 image
    upsertStep(job, {
      id: "direct-generate",
      group: "Direct Ollama",
      name: "/api/generate 1 image",
      status: "running",
      detail: "…",
    });
    const gen = await directGenerate({ endpoint, model, jpegBase64: img1[0]! });
    const genProbe: PathProbeResult = {
      label: "Direct /api/generate 1 image",
      pass: gen.ok,
      model,
      endpoint,
      imageCount: 1,
      totalImageBytes: bytes1,
      requestBodyBytes: gen.requestBodyBytes,
      elapsedMs: gen.elapsedMs,
      httpStatus: gen.httpStatus,
      responseLength: gen.responseLength,
      parserSuccess: null,
      candidateCount: null,
      safeError: gen.error ?? null,
      stages: [],
      thinkSent: true,
      thinkValue: false,
      thinkingLength: gen.thinkingLength,
      finishReason: gen.finishReason,
      ollamaTotalDurationNs: gen.totalDurationNs,
      ollamaLoadDurationNs: gen.loadDurationNs,
      ollamaPromptEvalCount: gen.promptEvalCount,
      ollamaEvalCount: gen.evalCount,
    };
    probes.push(genProbe);
    upsertStep(job, probeToStep(genProbe, "Direct Ollama", "direct-generate", "/api/generate 1 image"));

    // B. Direct /api/chat production-shaped (think NOT sent — matches draft)
    upsertStep(job, {
      id: "direct-chat",
      group: "Direct Ollama",
      name: "/api/chat 1 image (draft-shaped)",
      status: "running",
      detail: "…",
    });
    const chat = await directChatProductionShaped({
      endpoint,
      model,
      jpegBase64: img1[0]!,
      matchDraftThink: true,
    });
    const chatProbe: PathProbeResult = {
      label: "Direct /api/chat 1 image (draft-shaped)",
      pass: chat.ok,
      model,
      endpoint,
      imageCount: 1,
      totalImageBytes: bytes1,
      requestBodyBytes: chat.requestBodyBytes,
      elapsedMs: chat.elapsedMs,
      httpStatus: chat.httpStatus,
      responseLength: chat.responseLength,
      parserSuccess: null,
      candidateCount: null,
      safeError: chat.error ?? null,
      stages: [],
      thinkSent: chat.thinkSent,
      thinkValue: chat.thinkValue,
      thinkingLength: chat.thinkingLength,
      finishReason: chat.finishReason,
      ollamaTotalDurationNs: chat.totalDurationNs,
      ollamaLoadDurationNs: chat.loadDurationNs,
      ollamaPromptEvalCount: chat.promptEvalCount,
      ollamaEvalCount: chat.evalCount,
    };
    probes.push(chatProbe);
    upsertStep(
      job,
      probeToStep(chatProbe, "Direct Ollama", "direct-chat", "/api/chat 1 image (draft-shaped)"),
    );
    technical.thinkBehavior = {
      draftPathSendsThink: false,
      directGenerateSentThinkFalse: true,
      directGenerateThinkingLength: gen.thinkingLength,
      directChatDraftShapedThinkSent: chat.thinkSent,
      directChatThinkingLength: chat.thinkingLength,
      note: "If thinkingLength>0 despite think:false or omitted, Ollama is still emitting thinking.",
    };

    // C. Provider-only 1 image (production-shaped num_ctx)
    const prod1Ctx = resolveInteractiveDraftNumCtx({
      configuredNumCtx: runtime.ollamaNumCtx,
      imageCount: 1,
      draftNumCtxOverride: process.env.OLLAMA_DRAFT_NUM_CTX
        ? Number(process.env.OLLAMA_DRAFT_NUM_CTX)
        : null,
    });
    upsertStep(job, {
      id: "provider-1",
      group: "Provider-only",
      name: "generateAiForTask 1 image",
      status: "running",
      detail: "…",
    });
    const p1 = await runGenerateAiForTaskProbe({
      label: "Provider-only 1 image",
      model,
      endpointUrl: endpoint,
      images: img1,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: false,
      numCtx: prod1Ctx.requestedNumCtx,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(p1);
    upsertStep(job, probeToStep(p1, "Provider-only", "provider-1", "generateAiForTask 1 image"));

    // D. Provider-only up to 6 — LEGACY (num_ctx NOT sent) to prove CONTEXT_BUDGET_EXCEEDED
    upsertStep(job, {
      id: "provider-6-legacy",
      group: "Context probes",
      name: `6 images num_ctx=NOT_SENT (legacy)`,
      status: "running",
      detail: "…",
    });
    const p6legacy = await runGenerateAiForTaskProbe({
      label: "Provider-only 6 images num_ctx=NOT_SENT",
      model,
      endpointUrl: endpoint,
      images: img6,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: false,
      numCtx: null,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(p6legacy);
    upsertStep(
      job,
      probeToStep(p6legacy, "Context probes", "provider-6-legacy", "6 images num_ctx=NOT_SENT (legacy)"),
    );

    // E. 6 images + 8192
    upsertStep(job, {
      id: "provider-6-8192",
      group: "Context probes",
      name: "6 images num_ctx=8192",
      status: "running",
      detail: "…",
    });
    const p68192 = await runGenerateAiForTaskProbe({
      label: "Provider-only 6 images num_ctx=8192",
      model,
      endpointUrl: endpoint,
      images: img6,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: false,
      numCtx: 8192,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(p68192);
    upsertStep(job, probeToStep(p68192, "Context probes", "provider-6-8192", "6 images num_ctx=8192"));

    // F. 6 images + 16384
    upsertStep(job, {
      id: "provider-6-16384",
      group: "Context probes",
      name: "6 images num_ctx=16384",
      status: "running",
      detail: "…",
    });
    const p616384 = await runGenerateAiForTaskProbe({
      label: "Provider-only 6 images num_ctx=16384",
      model,
      endpointUrl: endpoint,
      images: img6,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: false,
      numCtx: 16384,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(p616384);
    upsertStep(job, probeToStep(p616384, "Context probes", "provider-6-16384", "6 images num_ctx=16384"));

    const prod6Ctx = resolveInteractiveDraftNumCtx({
      configuredNumCtx: runtime.ollamaNumCtx,
      imageCount: img6.length,
      draftNumCtxOverride: process.env.OLLAMA_DRAFT_NUM_CTX
        ? Number(process.env.OLLAMA_DRAFT_NUM_CTX)
        : null,
    });

    // G. Provider-only 6 with production draft num_ctx
    upsertStep(job, {
      id: "provider-6",
      group: "Provider-only",
      name: `generateAiForTask ${img6.length} images (draft num_ctx=${prod6Ctx.requestedNumCtx})`,
      status: "running",
      detail: "…",
    });
    const p6 = await runGenerateAiForTaskProbe({
      label: `Provider-only ${img6.length} images (production draft num_ctx)`,
      model,
      endpointUrl: endpoint,
      images: img6,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: false,
      numCtx: prod6Ctx.requestedNumCtx,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(p6);
    upsertStep(
      job,
      probeToStep(
        p6,
        "Provider-only",
        "provider-6",
        `generateAiForTask ${img6.length} images (draft num_ctx=${prod6Ctx.requestedNumCtx})`,
      ),
    );

    technical.contextBudgetCheck = classifyContextBudgetCheck({
      configuredNumCtx: runtime.ollamaNumCtx,
      requestedNumCtx: prod6Ctx.requestedNumCtx,
      availableContext: p6.ollamaAvailableContext ?? p6legacy.ollamaAvailableContext ?? null,
      requestTokens: p6.ollamaRequestTokens ?? p6legacy.ollamaRequestTokens ?? null,
      estimatedTokens: estimateVisionPromptTokens({
        imageCount: img6.length,
        promptLength: DRAFT_PROMPT.length,
      }),
    });

    // H. Full CARE 1 image
    upsertStep(job, {
      id: "full-1",
      group: "Full CARE pipeline",
      name: "draft path 1 image",
      status: "running",
      detail: "…",
    });
    const f1 = await runGenerateAiForTaskProbe({
      label: "Full CARE pipeline 1 image",
      model,
      endpointUrl: endpoint,
      images: img1,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: true,
      numCtx: prod1Ctx.requestedNumCtx,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(f1);
    upsertStep(job, probeToStep(f1, "Full CARE pipeline", "full-1", "draft path 1 image"));

    // I. Full CARE up to 6 with production num_ctx
    upsertStep(job, {
      id: "full-6",
      group: "Full CARE pipeline",
      name: `draft path ${img6.length} images (num_ctx=${prod6Ctx.requestedNumCtx})`,
      status: "running",
      detail: "…",
    });
    const f6 = await runGenerateAiForTaskProbe({
      label: `Full CARE pipeline ${img6.length} images`,
      model,
      endpointUrl: endpoint,
      images: img6,
      imageFetchMs: fetched.fetchElapsedMs,
      imageFetchOk: true,
      fullPipeline: true,
      numCtx: prod6Ctx.requestedNumCtx,
      configuredNumCtx: runtime.ollamaNumCtx,
    });
    probes.push(f6);
    upsertStep(
      job,
      probeToStep(
        f6,
        "Full CARE pipeline",
        "full-6",
        `draft path ${img6.length} images (num_ctx=${prod6Ctx.requestedNumCtx})`,
      ),
    );

    job.probes = probes;
    job.stagesByProbe = Object.fromEntries(probes.map((p) => [p.label, p.stages]));

    const contextBudgetExceeded =
      p6legacy.errorCode === "CONTEXT_BUDGET_EXCEEDED" ||
      Boolean(parseOllamaContextExceeded(p6legacy.safeError));

    const derived = deriveSelfTestFinal({
      noMri: false,
      directGeneratePass: genProbe.pass,
      directChatPass: chatProbe.pass,
      providerOnly1Pass: p1.pass,
      providerOnly6Pass: p6.pass,
      fullCare1Pass: f1.pass,
      fullCare6Pass: f6.pass,
      contextProbe8192Pass: p68192.pass,
      contextProbe16384Pass: p616384.pass,
      contextBudgetExceeded,
    });
    job.final = derived.final;
    job.summary = derived.summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    logger.error({ err, selfTestId: job.id }, "ai pipeline self-test crashed");
    upsertStep(job, {
      id: "crash",
      group: "Runtime",
      name: "Self-test error",
      status: "fail",
      detail: msg,
    });
    job.final = "FAIL";
    job.summary = `FAIL — self-test error: ${msg}`;
    technical.crash = msg;
  } finally {
    // Drop image payloads from memory references in technical
    technical.jpegHeld = false;
    job.technical = technical;
    job.probes = probes;
    job.stagesByProbe = Object.fromEntries(probes.map((p) => [p.label, p.stages]));
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
  }
}

export function getAiPipelineSelfTest(id: string): AiPipelineSelfTestResult | null {
  const job = JOBS.get(id);
  if (!job) return null;
  const { _timer: _t, ...rest } = job;
  return rest;
}

export function startAiPipelineSelfTest(opts: {
  studyInstanceUid?: string;
} = {}): AiPipelineSelfTestResult {
  pruneJobs();
  const id = randomUUID();
  const job: JobRecord = {
    id,
    status: "queued",
    final: "RUNNING",
    summary: "Queued…",
    steps: [],
    probes: [],
    stagesByProbe: {},
    technical: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progressLabel: "Queued",
    safety: selfTestSafetyContract(),
  };
  JOBS.set(id, job);
  setImmediate(() => {
    void executeSelfTest(job, opts);
  });
  const { _timer: _t, ...rest } = job;
  return rest;
}

export function formatSelfTestReport(result: AiPipelineSelfTestResult): string {
  const lines: string[] = [
    "AI PIPELINE SELF-TEST",
    `id: ${result.id}`,
    `final: ${result.final}`,
    `summary: ${result.summary}`,
    `startedAt: ${result.startedAt}`,
    `finishedAt: ${result.finishedAt ?? "—"}`,
    `safety: ${JSON.stringify(result.safety)}`,
    "",
    "=== STEPS ===",
  ];
  for (const s of result.steps) {
    const mark =
      s.status === "pass" ? "✓" : s.status === "fail" ? "✕" : s.status === "skip" ? "—" : "…";
    lines.push(`[${s.group}] ${mark} ${s.name}`);
    lines.push(`  ${s.detail}${s.elapsedMs != null ? ` (${s.elapsedMs} ms)` : ""}`);
  }
  lines.push("");
  lines.push("=== PROBES ===");
  for (const p of result.probes ?? []) {
    lines.push(`--- ${p.label} ---`);
    lines.push(`  result: ${p.pass ? "PASS" : "FAIL"}`);
    lines.push(`  model: ${p.model}`);
    lines.push(`  endpoint: ${p.endpoint}`);
    lines.push(`  imageCount: ${p.imageCount}`);
    lines.push(`  totalImageBytes: ${p.totalImageBytes}`);
    lines.push(`  requestBodyBytes: ${p.requestBodyBytes}`);
    lines.push(`  configuredNumCtx: ${p.configuredNumCtx}`);
    lines.push(`  requestedNumCtx: ${p.requestedNumCtx ?? "NOT_SENT"}`);
    lines.push(`  ollamaRequestTokens: ${p.ollamaRequestTokens}`);
    lines.push(`  ollamaAvailableContext: ${p.ollamaAvailableContext}`);
    lines.push(`  errorCode: ${p.errorCode}`);
    lines.push(`  elapsedMs: ${p.elapsedMs}`);
    lines.push(`  httpStatus: ${p.httpStatus}`);
    lines.push(`  responseLength: ${p.responseLength}`);
    lines.push(`  parserSuccess: ${p.parserSuccess}`);
    lines.push(`  candidateCount: ${p.candidateCount}`);
    lines.push(`  thinkSent: ${p.thinkSent} thinkValue: ${p.thinkValue} thinkingLength: ${p.thinkingLength}`);
    lines.push(`  finishReason: ${p.finishReason}`);
    lines.push(
      `  ollama: total_duration_ns=${p.ollamaTotalDurationNs} load_duration_ns=${p.ollamaLoadDurationNs} prompt_eval=${p.ollamaPromptEvalCount} eval=${p.ollamaEvalCount}`,
    );
    lines.push(`  safeError: ${p.safeError ?? "—"}`);
    for (const st of p.stages) {
      lines.push(`  stage ${st.id}: ${st.status.toUpperCase()} ${st.detail}${st.elapsedMs != null ? ` (${st.elapsedMs}ms)` : ""}`);
    }
  }
  lines.push("");
  lines.push("=== TECHNICAL (PHI-safe) ===");
  lines.push(JSON.stringify(result.technical, null, 2));

  const report = lines.join("\n");
  const safety = assertDiagnosticReportPhiSafe(report);
  if (!safety.ok) {
    return `${report}\n\nWARNING: report failed PHI-safe checks: ${safety.reasons.join(", ")}`;
  }
  return report;
}

export { assertDiagnosticReportPhiSafe, deriveSelfTestFinal, parseDraftSections };
