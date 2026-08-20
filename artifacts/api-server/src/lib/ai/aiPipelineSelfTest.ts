/**
 * One-click AI Pipeline Self-Test — diagnostic only.
 *
 * Distinguishes DIRECT qwen vision (proven healthy in production) from the
 * CARE application path (/api/ai-reporting/draft → provider/gateway).
 *
 * Never creates/finalizes clinical reports, never bulk-enqueues, never stores
 * images/base64/full prompts/full model responses.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { pacsSettingsTable, radiologyWorklistTable } from "@workspace/db/schema";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
  generateAiForTask,
  loadProviderConfig,
  probeOllamaReachable,
  resolveTaskRoute,
} from "@workspace/ai-providers";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import { orthancAuthHeaders, resolveOrthancBaseFromSources } from "./studyImageFetch";
import { logger } from "../logger";

export type SelfTestStepStatus = "pending" | "running" | "pass" | "fail" | "skip";

export interface SelfTestStep {
  id: string;
  group: string;
  name: string;
  status: SelfTestStepStatus;
  detail: string;
  elapsedMs?: number;
}

export type SelfTestFinal =
  | "PASS"
  | "FAIL"
  | "PARTIAL"
  | "RUNNING"
  | "NO_MRI";

export interface AiPipelineSelfTestResult {
  id: string;
  status: "queued" | "running" | "completed";
  final: SelfTestFinal;
  summary: string;
  steps: SelfTestStep[];
  technical: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  progressLabel: string;
}

type JobRecord = AiPipelineSelfTestResult & { _timer?: ReturnType<typeof setTimeout> };

const JOBS = new Map<string, JobRecord>();
const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS = 20;

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
  }

  const rows = await db
    .select({
      id: radiologyWorklistTable.id,
      studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
      modality: radiologyWorklistTable.modality,
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
    .limit(15);

  for (const r of rows) {
    if (r.studyInstanceUID) {
      return {
        worklistId: r.id,
        studyInstanceUid: r.studyInstanceUID,
        modality: r.modality ?? "MR",
      };
    }
  }
  return null;
}

async function fetchOneRenderedJpeg(
  orthancBase: string,
  studyUid: string,
): Promise<{
  ok: boolean;
  httpStatus: number;
  contentType: string | null;
  imageBytes: number;
  seriesUid: string | null;
  instanceUid: string | null;
  seriesCount: number;
  instanceCount: number;
  jpegBase64: string | null;
  detail: string;
}> {
  const base = orthancBase.replace(/\/$/, "");
  const auth = orthancAuthHeaders();
  const dicomWeb = `${base}/dicom-web`;

  const seriesResp = await fetch(`${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series`, {
    headers: { ...auth, Accept: "application/json" },
  }).catch(() => null);
  if (!seriesResp?.ok) {
    // REST fallback: find study then series
    const findResp = await fetch(`${base}/tools/find`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: studyUid } }),
    }).catch(() => null);
    if (!findResp?.ok) {
      return {
        ok: false,
        httpStatus: seriesResp?.status ?? findResp?.status ?? 0,
        contentType: null,
        imageBytes: 0,
        seriesUid: null,
        instanceUid: null,
        seriesCount: 0,
        instanceCount: 0,
        jpegBase64: null,
        detail: "Could not list series for study",
      };
    }
    const studyIds = (await findResp.json().catch(() => [])) as string[];
    const studyId = studyIds[0];
    if (!studyId) {
      return {
        ok: false,
        httpStatus: 404,
        contentType: null,
        imageBytes: 0,
        seriesUid: null,
        instanceUid: null,
        seriesCount: 0,
        instanceCount: 0,
        jpegBase64: null,
        detail: "Study not found in Orthanc",
      };
    }
    const seriesListResp = await fetch(`${base}/studies/${studyId}/series`, {
      headers: { ...auth, Accept: "application/json" },
    }).catch(() => null);
    const seriesIds = seriesListResp?.ok ? ((await seriesListResp.json().catch(() => [])) as string[]) : [];
    if (seriesIds.length === 0) {
      return {
        ok: false,
        httpStatus: seriesListResp?.status ?? 404,
        contentType: null,
        imageBytes: 0,
        seriesUid: null,
        instanceUid: null,
        seriesCount: 0,
        instanceCount: 0,
        jpegBase64: null,
        detail: "No series in Orthanc study",
      };
    }
    const seriesId = seriesIds[0]!;
    const instResp = await fetch(`${base}/series/${seriesId}/instances`, {
      headers: { ...auth, Accept: "application/json" },
    }).catch(() => null);
    const instIds = instResp?.ok ? ((await instResp.json().catch(() => [])) as string[]) : [];
    if (instIds.length === 0) {
      return {
        ok: false,
        httpStatus: instResp?.status ?? 404,
        contentType: null,
        imageBytes: 0,
        seriesUid: seriesId,
        instanceUid: null,
        seriesCount: seriesIds.length,
        instanceCount: 0,
        jpegBase64: null,
        detail: "No instances in series",
      };
    }
    const mid = instIds[Math.floor(instIds.length / 2)]!;
    const preview = await fetch(`${base}/instances/${mid}/preview`, {
      headers: { ...auth, Accept: "image/jpeg" },
    }).catch(() => null);
    if (!preview?.ok) {
      return {
        ok: false,
        httpStatus: preview?.status ?? 0,
        contentType: preview?.headers.get("content-type") ?? null,
        imageBytes: 0,
        seriesUid: seriesId,
        instanceUid: mid,
        seriesCount: seriesIds.length,
        instanceCount: instIds.length,
        jpegBase64: null,
        detail: "Orthanc preview fetch failed",
      };
    }
    const buf = Buffer.from(await preview.arrayBuffer());
    return {
      ok: true,
      httpStatus: preview.status,
      contentType: preview.headers.get("content-type"),
      imageBytes: buf.byteLength,
      seriesUid: seriesId,
      instanceUid: mid,
      seriesCount: seriesIds.length,
      instanceCount: instIds.length,
      jpegBase64: buf.toString("base64"),
      detail: `Rendered JPEG ${buf.byteLength} bytes`,
    };
  }

  type DcmTag = { Value?: (string | { Alphabetic?: string })[] };
  type DcmEntry = Record<string, DcmTag>;
  const seriesList = (await seriesResp.json().catch(() => [])) as DcmEntry[];
  if (!Array.isArray(seriesList) || seriesList.length === 0) {
    return {
      ok: false,
      httpStatus: seriesResp.status,
      contentType: null,
      imageBytes: 0,
      seriesUid: null,
      instanceUid: null,
      seriesCount: 0,
      instanceCount: 0,
      jpegBase64: null,
      detail: "Empty series list",
    };
  }
  const seriesUID = (seriesList[0]!["0020000E"]?.Value?.[0] as string | undefined) ?? "";
  const instResp = await fetch(
    `${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUID)}/instances`,
    { headers: { ...auth, Accept: "application/json" } },
  ).catch(() => null);
  const instances = instResp?.ok ? ((await instResp.json().catch(() => [])) as DcmEntry[]) : [];
  if (!instances.length) {
    return {
      ok: false,
      httpStatus: instResp?.status ?? 0,
      contentType: null,
      imageBytes: 0,
      seriesUid: seriesUID || null,
      instanceUid: null,
      seriesCount: seriesList.length,
      instanceCount: 0,
      jpegBase64: null,
      detail: "No instances in DICOMweb series",
    };
  }
  const mid = instances[Math.floor(instances.length / 2)]!;
  const instanceUID = (mid["00080018"]?.Value?.[0] as string | undefined) ?? "";
  const rendered = await fetch(
    `${dicomWeb}/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(instanceUID)}/rendered`,
    { headers: { ...auth, Accept: "image/jpeg" } },
  ).catch(() => null);
  if (!rendered?.ok) {
    return {
      ok: false,
      httpStatus: rendered?.status ?? 0,
      contentType: rendered?.headers.get("content-type") ?? null,
      imageBytes: 0,
      seriesUid: seriesUID || null,
      instanceUid: instanceUID || null,
      seriesCount: seriesList.length,
      instanceCount: instances.length,
      jpegBase64: null,
      detail: "DICOMweb rendered fetch failed",
    };
  }
  const buf = Buffer.from(await rendered.arrayBuffer());
  return {
    ok: true,
    httpStatus: rendered.status,
    contentType: rendered.headers.get("content-type"),
    imageBytes: buf.byteLength,
    seriesUid: seriesUID || null,
    instanceUid: instanceUID || null,
    seriesCount: seriesList.length,
    instanceCount: instances.length,
    jpegBase64: buf.toString("base64"),
    detail: `Rendered JPEG ${buf.byteLength} bytes`,
  };
}

/** Direct Ollama /api/generate vision probe — same shape as the manual care-api proof. */
async function directQwenVision(opts: {
  endpoint: string;
  model: string;
  jpegBase64: string;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  elapsedMs: number;
  responseLength: number;
  nonEmpty: boolean;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${opts.endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt:
          "This is a connectivity test. Confirm that you can see and analyze the supplied medical image. Do not provide a diagnosis.",
        images: [opts.jpegBase64],
        stream: false,
        think: false,
      }),
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
        nonEmpty: false,
        error: `Ollama /api/generate ${resp.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }
    const data = (await resp.json()) as { response?: string };
    const text = (data.response ?? "").trim();
    return {
      ok: text.length > 0,
      httpStatus: resp.status,
      elapsedMs,
      responseLength: text.length,
      nonEmpty: text.length > 0,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      elapsedMs: Date.now() - t0,
      responseLength: 0,
      nonEmpty: false,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}

async function runCareDraftPath(opts: {
  worklistId: number;
  modality: string;
  model: string;
  jpegBase64: string;
  endpointUrl: string;
}): Promise<{
  ok: boolean;
  httpEquivalentStatus: number;
  elapsedMs: number;
  providerReturned: boolean;
  responseLength: number;
  parserSuccess: boolean;
  findingsLength: number;
  impressionLength: number;
  errorClass: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  resolvedEndpoint: string | null;
  resolvedModel: string | null;
  numberOfImages: number;
  totalImageBytes: number;
}> {
  const prompt = [
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

  const t0 = Date.now();
  // Same provider stack as POST /api/ai-reporting/draft (generateAiForTask),
  // but with ONE representative image (not up to 6) so we isolate path failure
  // from multi-image payload cost. Endpoint pinned to resolved Local AI runtime.
  const aiResult = await generateAiForTask("radiology_draft", prompt, [opts.jpegBase64], {
    model: opts.model,
    endpointUrl: opts.endpointUrl,
    think: false,
  });
  const elapsedMs = Date.now() - t0;
  let findingsLength = 0;
  let impressionLength = 0;
  let parserSuccess = false;
  if (aiResult.success && aiResult.text) {
    const findingsMatch = aiResult.text.match(/FINDINGS:?\s*([\s\S]*?)(?=IMPRESSION:|$)/i);
    const impressionMatch = aiResult.text.match(/IMPRESSION:?\s*([\s\S]*?)$/i);
    const findings = findingsMatch?.[1]?.trim() ?? aiResult.text.trim();
    const impression = impressionMatch?.[1]?.trim() ?? "";
    findingsLength = findings.length;
    impressionLength = impression.length;
    parserSuccess = findingsLength > 0 || impressionLength > 0;
  }

  return {
    ok: aiResult.success && parserSuccess,
    httpEquivalentStatus: aiResult.success ? 200 : 502,
    elapsedMs,
    providerReturned: aiResult.success,
    responseLength: aiResult.diagnostics?.responseLength ?? (aiResult.text?.length ?? 0),
    parserSuccess,
    findingsLength,
    impressionLength,
    errorClass: aiResult.diagnostics?.errorClass ?? (aiResult.success ? null : "AiProviderError"),
    errorCode: aiResult.diagnostics?.errorCode ?? (aiResult.success ? null : "AI_PROVIDER_ERROR"),
    errorMessage: aiResult.success
      ? null
      : (aiResult.diagnostics?.errorMessage ?? aiResult.error ?? "AI provider error").slice(0, 300),
    resolvedEndpoint: aiResult.diagnostics?.resolvedEndpoint ?? opts.endpointUrl,
    resolvedModel: aiResult.diagnostics?.model ?? opts.model,
    numberOfImages: aiResult.diagnostics?.numberOfImages ?? 1,
    totalImageBytes: aiResult.diagnostics?.totalImageBytes ?? 0,
  };
}

async function executeSelfTest(job: JobRecord, opts: { studyInstanceUid?: string }): Promise<void> {
  job.status = "running";
  job.final = "RUNNING";
  const technical: Record<string, unknown> = {};

  try {
    // 1. Runtime
    upsertStep(job, {
      id: "runtime",
      group: "Runtime",
      name: "CARE API runtime config",
      status: "running",
      detail: "Resolving Local AI + Orthanc…",
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
    technical.ollamaUrlSource = runtime.ollamaUrlSource;
    technical.model = model;
    technical.modelSource = runtime.modelStandardSource;
    technical.orthancEndpoint = orthancBase;
    technical.provider = taskRoute?.provider ?? prov?.provider ?? "ollama";
    technical.taskRoute = taskRoute;
    technical.canonicalEndpoint = CANONICAL_OLLAMA_ENDPOINT;
    technical.canonicalModel = CANONICAL_LOCAL_CHAT_VISION_MODEL;
    upsertStep(job, {
      id: "runtime",
      group: "Runtime",
      name: "CARE API runtime config",
      status: orthancBase && endpoint ? "pass" : "fail",
      detail: `Ollama ${endpoint} · model ${model} · Orthanc ${orthancBase ?? "MISSING"} · provider ${technical.provider}`,
    });
    if (!endpoint) {
      job.final = "FAIL";
      job.summary = "FAIL — Ollama endpoint not resolved";
      return;
    }

    // 2. Ollama health
    upsertStep(job, {
      id: "ollama-health",
      group: "Runtime",
      name: "Ollama health",
      status: "running",
      detail: "GET /api/tags…",
    });
    const probe = await probeOllamaReachable(endpoint, 6000);
    const hasModel =
      (probe.models ?? []).some(
        (m) => m === model || m.startsWith(`${model}:`) || m.startsWith(model),
      ) ||
      (probe.models ?? []).some((m) => m.includes("qwen3-vl"));
    technical.ollamaModelsSample = (probe.models ?? []).slice(0, 8);
    technical.qwenInstalled = hasModel;
    upsertStep(job, {
      id: "ollama-health",
      group: "Runtime",
      name: "Ollama health",
      status: probe.reachable && hasModel ? "pass" : "fail",
      detail: probe.reachable
        ? hasModel
          ? `GET /api/tags OK — ${model} present`
          : `GET /api/tags OK — ${model} NOT found`
        : probe.error ?? "unreachable",
    });

    // 3. Orthanc health
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
      detail: orthancOk ? `GET /system ${technical.orthancSystemHttp}` : "Orthanc /system failed",
    });

    if (!orthancOk || !orthancBase) {
      job.final = "FAIL";
      job.summary = "FAIL — Orthanc unreachable; cannot run image test";
      return;
    }

    // 4–6. MRI + rendered JPEG
    upsertStep(job, {
      id: "mri-study",
      group: "Image path",
      name: "MRI study found",
      status: "running",
      detail: "Selecting recent MRI…",
    });
    const study = await pickRecentMri(opts.studyInstanceUid);
    if (!study) {
      upsertStep(job, {
        id: "mri-study",
        group: "Image path",
        name: "MRI study found",
        status: "fail",
        detail: "Could not run image test — no eligible MRI found.",
      });
      job.final = "NO_MRI";
      job.summary = "Could not run image test — no eligible MRI found.";
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
      detail: `worklist #${study.worklistId} · modality ${study.modality}`,
    });

    upsertStep(job, {
      id: "image-fetch",
      group: "Image path",
      name: "Rendered JPEG fetched",
      status: "running",
      detail: "Fetching one representative slice…",
    });
    const img = await fetchOneRenderedJpeg(orthancBase, study.studyInstanceUid);
    technical.seriesUid = img.seriesUid;
    technical.instanceUid = img.instanceUid;
    technical.seriesCount = img.seriesCount;
    technical.instanceCount = img.instanceCount;
    technical.imageBytes = img.imageBytes;
    technical.imageHttpStatus = img.httpStatus;
    technical.imageContentType = img.contentType;
    upsertStep(job, {
      id: "series",
      group: "Image path",
      name: "Series found",
      status: img.seriesCount > 0 ? "pass" : "fail",
      detail: `${img.seriesCount} series`,
    });
    upsertStep(job, {
      id: "instance",
      group: "Image path",
      name: "Instance found",
      status: img.instanceCount > 0 ? "pass" : "fail",
      detail: `${img.instanceCount} instance(s)`,
    });
    upsertStep(job, {
      id: "image-fetch",
      group: "Image path",
      name: "Rendered JPEG fetched",
      status: img.ok ? "pass" : "fail",
      detail: img.ok
        ? `HTTP ${img.httpStatus} · ${img.contentType ?? "?"} · ${Math.round(img.imageBytes / 1024)} KB`
        : img.detail,
      elapsedMs: undefined,
    });
    if (!img.ok || !img.jpegBase64) {
      job.final = "FAIL";
      job.summary = "FAIL — could not fetch rendered MRI JPEG";
      return;
    }

    // 7. Direct qwen vision
    upsertStep(job, {
      id: "direct-vision",
      group: "Direct qwen vision",
      name: "Ollama /api/generate",
      status: "running",
      detail: "Sending one MRI JPEG…",
    });
    const direct = await directQwenVision({
      endpoint,
      model,
      jpegBase64: img.jpegBase64,
    });
    technical.directVision = {
      httpStatus: direct.httpStatus,
      elapsedMs: direct.elapsedMs,
      responseLength: direct.responseLength,
      nonEmpty: direct.nonEmpty,
      error: direct.error ?? null,
    };
    upsertStep(job, {
      id: "direct-vision",
      group: "Direct qwen vision",
      name: "Ollama /api/generate",
      status: direct.ok ? "pass" : "fail",
      detail: direct.ok
        ? `HTTP ${direct.httpStatus} · ${(direct.elapsedMs / 1000).toFixed(1)} sec · non-empty (${direct.responseLength} chars)`
        : direct.error ?? `HTTP ${direct.httpStatus}`,
      elapsedMs: direct.elapsedMs,
    });

    // 8. CARE application path (same stack as /api/ai-reporting/draft)
    upsertStep(job, {
      id: "care-pipeline",
      group: "CARE AI pipeline",
      name: "/api/ai-reporting/draft path",
      status: "running",
      detail: "generateAiForTask(radiology_draft)…",
    });
    const care = await runCareDraftPath({
      worklistId: study.worklistId,
      modality: study.modality,
      model,
      jpegBase64: img.jpegBase64,
      endpointUrl: endpoint,
    });
    technical.carePipeline = {
      httpEquivalentStatus: care.httpEquivalentStatus,
      elapsedMs: care.elapsedMs,
      providerReturned: care.providerReturned,
      responseLength: care.responseLength,
      parserSuccess: care.parserSuccess,
      findingsLength: care.findingsLength,
      impressionLength: care.impressionLength,
      errorClass: care.errorClass,
      errorCode: care.errorCode,
      errorMessage: care.errorMessage,
      resolvedEndpoint: care.resolvedEndpoint,
      resolvedModel: care.resolvedModel,
      numberOfImages: care.numberOfImages,
      totalImageBytes: care.totalImageBytes,
      candidateCountBeforeTrust: null,
      candidateCountAccepted: null,
      candidateCountQuarantined: null,
      note: "Interactive draft path does not run overnight trust gauntlet; trust counts are N/A here.",
    };
    upsertStep(job, {
      id: "care-pipeline",
      group: "CARE AI pipeline",
      name: "/api/ai-reporting/draft path",
      status: care.providerReturned ? "pass" : "fail",
      detail: care.providerReturned
        ? `provider OK · ${(care.elapsedMs / 1000).toFixed(1)} sec · response ${care.responseLength} chars`
        : `${care.httpEquivalentStatus} after ${(care.elapsedMs / 1000).toFixed(1)} sec — ${care.errorClass}/${care.errorCode}: ${care.errorMessage}`,
      elapsedMs: care.elapsedMs,
    });
    upsertStep(job, {
      id: "parser",
      group: "Parser",
      name: "FINDINGS/IMPRESSION parse",
      status: !care.providerReturned ? "skip" : care.parserSuccess ? "pass" : "fail",
      detail: !care.providerReturned
        ? "not reached"
        : care.parserSuccess
          ? `findings ${care.findingsLength} · impression ${care.impressionLength}`
          : "provider returned but sections empty/unparseable",
    });
    upsertStep(job, {
      id: "trust",
      group: "Trust layer",
      name: "Overnight trust gauntlet",
      status: "skip",
      detail: "not reached on interactive draft path (shadow pipeline only)",
    });

    if (direct.ok && care.ok) {
      job.final = "PASS";
      job.summary = "PASS — end-to-end AI pipeline healthy";
    } else if (direct.ok && !care.providerReturned) {
      job.final = "PARTIAL";
      job.summary = "PARTIAL / FAIL — Direct vision healthy; CARE application path failed.";
    } else if (direct.ok && care.providerReturned && !care.parserSuccess) {
      job.final = "PARTIAL";
      job.summary = "PARTIAL — Direct vision OK; CARE provider returned but parser found no usable sections.";
    } else {
      job.final = "FAIL";
      job.summary = !direct.ok
        ? "FAIL — direct qwen vision failed"
        : "FAIL — CARE AI pipeline failed";
    }
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
    job.technical = technical;
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    // Drop JPEG from memory if any residual reference
    technical.jpegHeld = false;
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
    technical: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progressLabel: "Queued",
  };
  JOBS.set(id, job);

  // Fire-and-forget — do not block the HTTP response for 30–120s.
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
    "",
  ];
  for (const s of result.steps) {
    const mark =
      s.status === "pass" ? "✓" : s.status === "fail" ? "✕" : s.status === "skip" ? "—" : "…";
    lines.push(`[${s.group}] ${mark} ${s.name}`);
    lines.push(`  ${s.detail}${s.elapsedMs != null ? ` (${s.elapsedMs} ms)` : ""}`);
  }
  lines.push("");
  lines.push("TECHNICAL (PHI-safe)");
  lines.push(JSON.stringify(result.technical, null, 2));
  return lines.join("\n");
}
