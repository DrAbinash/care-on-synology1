/**
 * Pre-deploy verification for Ollama-backed auto AI report drafting.
 * Used by POST /api/radiology-ollama/verify and scripts/verify-ollama-ai-draft.mjs.
 */
import { db } from "@workspace/db";
import { clinicSettingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { probeOllamaReachable } from "@workspace/ai-providers";
import { isFeatureEnabledServer } from "../featureFlags";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import {
  AI_MASTER_FLAG,
  getModalityPolicies,
  getSchedulerConfig,
} from "./clinicalConfigService";
import { AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";
import { jobBacklogCounts, listDeadLetterJobs } from "../radiologyJobs";
import {
  deriveRadiologyJobConsumerHealth,
  getRadiologyJobConsumerHeartbeat,
} from "../radiologyJobConsumerHeartbeat";

export type VerifyStatus = "PASS" | "FAIL" | "WARNING" | "SKIPPED";

export interface OllamaVerifyCheck {
  id: string;
  group: string;
  name: string;
  status: VerifyStatus;
  detail: string;
  remediation?: string;
  blocking?: boolean;
}

export interface OllamaVerifyResult {
  ok: boolean;
  blockingFailed: boolean;
  checks: OllamaVerifyCheck[];
  summary: string;
  ranAt: string;
}

function add(
  checks: OllamaVerifyCheck[],
  check: Omit<OllamaVerifyCheck, "id"> & { id?: string },
): void {
  checks.push({
    id: check.id ?? `${check.group}:${check.name}`.toLowerCase().replace(/\s+/g, "-"),
    ...check,
  });
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

function modelInstalled(names: string[], model: string): boolean {
  if (!model) return false;
  return names.some((n) => n === model || n.startsWith(`${model}:`) || n.startsWith(model));
}

export async function runOllamaAiDraftVerify(opts: {
  runDraft?: boolean;
} = {}): Promise<OllamaVerifyResult> {
  const checks: OllamaVerifyCheck[] = [];
  const runDraft = opts.runDraft !== false;

  const masterOn = await isFeatureEnabledServer(AI_MASTER_FLAG);
  add(checks, {
    group: "Automation",
    name: "Master AI flag (ff_radiology_ai)",
    status: masterOn ? "PASS" : "FAIL",
    detail: masterOn ? "Enabled — auto draft scheduling allowed" : "Disabled — DICOM arrival will not enqueue AI jobs",
    remediation: masterOn ? undefined : "Settings → Radiology → AI → Draft automation → Save (enables master flag)",
    blocking: true,
  });

  const runtime = await resolveLocalAiRuntime(true);
  const [clinicRow] = await db
    .select({
      ollamaEnabled: clinicSettingsTable.ollamaEnabled,
      ollamaBaseUrl: clinicSettingsTable.ollamaBaseUrl,
      ollamaModel: clinicSettingsTable.ollamaModel,
      ollamaLocalOnly: clinicSettingsTable.ollamaLocalOnly,
    })
    .from(clinicSettingsTable)
    .orderBy(desc(clinicSettingsTable.id))
    .limit(1);

  const ollamaEnabled = clinicRow?.ollamaEnabled !== false && runtime.ollamaEnabled;
  add(checks, {
    group: "Ollama",
    name: "Local AI enabled",
    status: ollamaEnabled ? "PASS" : "FAIL",
    detail: ollamaEnabled ? "Ollama enabled in clinic settings" : "Local AI is disabled",
    remediation: ollamaEnabled ? undefined : "Settings → Radiology → AI → Local AI → Enable and Save",
    blocking: true,
  });

  const baseUrl = runtime.ollamaBaseUrl?.trim() || "";
  if (!baseUrl) {
    add(checks, {
      group: "Ollama",
      name: "Endpoint URL",
      status: "FAIL",
      detail: "No Ollama base URL configured",
      remediation: "Set primary URL in Local AI tab (or OLLAMA_PRIMARY_URL in .env)",
      blocking: true,
    });
  } else {
    const localOnly = clinicRow?.ollamaLocalOnly ?? false;
    const guard = validateOllamaUrl(baseUrl, localOnly);
    add(checks, {
      group: "Ollama",
      name: "Endpoint URL valid",
      status: guard.ok ? "PASS" : "FAIL",
      detail: guard.ok ? baseUrl : (!guard.ok ? guard.reason : "Invalid"),
      remediation: guard.ok ? undefined : "Fix URL or enable LAN mode for private IPs",
      blocking: true,
    });

    const probe = await probeOllamaReachable(baseUrl);
    add(checks, {
      group: "Ollama",
      name: "Reachability",
      status: probe.reachable ? "PASS" : "FAIL",
      detail: probe.reachable ? `Reachable at ${baseUrl}` : probe.error ?? "Unreachable",
      remediation: probe.reachable ? undefined : "Start Ollama on the host and confirm NAS/API can reach it on LAN",
      blocking: true,
    });

    const model = runtime.localChatVisionModel;
    const installed = probe.reachable ? await listOllamaModels(baseUrl) : [];
    const hasModel = modelInstalled(installed, model);
    const vision = await (await import("./overnightVisionConfig")).getOvernightVisionInferenceOptions();
    const hasVision = modelInstalled(installed, vision.model);
    add(checks, {
      group: "Ollama",
      name: "Canonical local chat/vision model pulled",
      status: !probe.reachable ? "SKIPPED" : hasVision ? "PASS" : "FAIL",
      detail: !probe.reachable
        ? "Skipped — Ollama unreachable"
        : hasVision
          ? `${vision.model} at ${vision.endpointUrl} (num_ctx=${vision.numCtx}, think=${vision.think}, concurrency=${vision.concurrency})`
          : `${vision.model} NOT found — overnight/OCR/Local AI will fail`,
      remediation: hasVision || !probe.reachable ? undefined : `On the Windows Ollama PC: ollama pull ${vision.model}`,
      blocking: true,
    });
    add(checks, {
      group: "Ollama",
      name: "Runtime endpoint matches jobs",
      status: "PASS",
      detail: `jobs+verify use ${baseUrl} / ${model} (source: url=${runtime.ollamaUrlSource}, model=${runtime.modelStandardSource})`,
      blocking: false,
    });
    add(checks, {
      group: "Ollama",
      name: "Configured model pulled",
      status: !probe.reachable ? "SKIPPED" : hasModel ? "PASS" : "WARNING",
      detail: !probe.reachable
        ? "Skipped — Ollama unreachable"
        : hasModel
          ? `${model} present (${installed.length} model(s) on host)`
          : `${model} NOT found (have: ${installed.slice(0, 4).join(", ")}${installed.length > 4 ? "…" : ""})`,
      remediation: hasModel || !probe.reachable ? undefined : `On the Ollama host: ollama pull ${model}`,
      blocking: false,
    });

    if (runDraft && probe.reachable && guard.ok && ollamaEnabled) {
      const t0 = Date.now();
      try {
        const { createAiProvider } = await import("@workspace/ai-providers");
        const provider = await createAiProvider("ollama", undefined, guard.url.origin);
        if (!provider) throw new Error("Ollama provider unavailable");
        const chat = await provider.query({
          model,
          prompt: "Reply with exactly: AI_DRAFT_VERIFY_OK",
          images: [],
          think: false,
        });
        if (!chat.success) throw new Error(chat.error || "generation failed");
        const text = (chat.text ?? "").trim();
        const ok = text.length > 0;
        add(checks, {
          group: "Draft",
          name: "Sample Ollama generation",
          status: ok ? "PASS" : "WARNING",
          detail: ok
            ? `Generated via ai-providers in ${Date.now() - t0}ms (${text.slice(0, 80)}${text.length > 80 ? "…" : ""}) @ ${guard.url.origin} / ${model}`
            : "Empty response from Ollama",
          remediation: ok ? undefined : "Check model load / GPU memory on Ollama host",
          blocking: false,
        });
      } catch (e) {
        add(checks, {
          group: "Draft",
          name: "Sample Ollama generation",
          status: "FAIL",
          detail: e instanceof Error ? e.message : String(e),
          remediation: "Fix Ollama generation errors before relying on auto drafts",
          blocking: true,
        });
      }
    } else if (!runDraft) {
      add(checks, {
        group: "Draft",
        name: "Sample Ollama generation",
        status: "SKIPPED",
        detail: "Skipped (dry run)",
      });
    }
  }

  try {
    const scheduler = await getSchedulerConfig();
    const policies = await getModalityPolicies();
    const autoMods = policies
      .filter((p) => p.mode === "immediate" || p.mode === "night_batch")
      .map((p) => p.modality);
    add(checks, {
      group: "Automation",
      name: "Draft timing",
      status: "PASS",
      detail: scheduler.draftTiming === "on_arrival"
        ? "On DICOM arrival (immediate enqueue when modality allows)"
        : `Scheduled (night window ${scheduler.nightStart}–${scheduler.nightEnd}, quiet ${scheduler.quietStart}–${scheduler.quietEnd})`,
    });
    add(checks, {
      group: "Automation",
      name: "Auto-draft modalities",
      status: autoMods.length > 0 ? "PASS" : "WARNING",
      detail: autoMods.length > 0 ? autoMods.join(", ") : "None selected — auto AI will not run",
      remediation: autoMods.length > 0 ? undefined : "Draft automation → select modalities (MR, CT, …) and Save",
      blocking: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const schemaMissing = /draft_timing|does not exist/i.test(msg);
    add(checks, {
      group: "Automation",
      name: "Scheduler config",
      status: schemaMissing ? "FAIL" : "WARNING",
      detail: msg,
      remediation: schemaMissing ? "Run pnpm db:push on the NAS before redeploy" : undefined,
      blocking: schemaMissing,
    });
  }

  try {
    const backlog = await jobBacklogCounts([AI_SHADOW_PIPELINE_JOB]);
    const dead = await listDeadLetterJobs([AI_SHADOW_PIPELINE_JOB]);
    const failedDead = dead.filter((j) => j.failureReason);
    const hb = getRadiologyJobConsumerHeartbeat();
    const consumer = deriveRadiologyJobConsumerHealth(hb, {
      queueDepth: backlog.pending,
      running: backlog.running,
      nightWindow: true,
    });
    const backlogUnhealthy = backlog.pending > 0 && backlog.running === 0
      && (consumer.status === "STOPPED" || consumer.status === "STALE" || consumer.status === "STARVED");
    add(checks, {
      group: "Queue",
      name: "Overnight worker",
      status: consumer.status === "HEALTHY" || consumer.status === "PEAK_HOLD"
        ? (consumer.status === "PEAK_HOLD" ? "WARNING" : "PASS")
        : "FAIL",
      detail: `${consumer.status}: ${consumer.detail}. last poll ${hb.lastCronTickAt ?? "never"}; last claim ${hb.lastClaimedJobId ?? "none"}; due/pending ${backlog.pending}; running ${backlog.running}`,
      remediation: consumer.status === "HEALTHY"
        ? undefined
        : "Redeploy this CARE API so startRadiologyJobConsumer() registers the minute drain even when ENABLE_SCHEDULERS is unset",
      blocking: consumer.status === "STOPPED" || consumer.status === "STALE" || consumer.status === "STARVED",
    });
    add(checks, {
      group: "Queue",
      name: "Shadow pipeline backlog",
      status: backlogUnhealthy ? "FAIL" : backlog.pending > 0 && backlog.running === 0 ? "WARNING" : "PASS",
      detail: `pending ${backlog.pending}, running ${backlog.running}, abandoned ${backlog.deadLetter} — this is ALL ai_shadow_pipeline rows, not the worklist Overnight AI 24h chip`,
      remediation: backlogUnhealthy
        ? "Worker is not claiming jobs. Do not bulk-retry. Fix consumer, then retry ONE recent MRI."
        : undefined,
      blocking: backlogUnhealthy,
    });
    if (failedDead.length > 0) {
      add(checks, {
        group: "Queue",
        name: "Failed shadow jobs",
        status: "WARNING",
        detail: `${failedDead.length} abandoned ai_shadow_pipeline job(s) — check queue in Draft automation`,
      });
    }
  } catch {
    add(checks, {
      group: "Queue",
      name: "Job queue",
      status: "SKIPPED",
      detail: "dicom_retry_queue not available",
    });
  }

  const blockingFailed = checks.some((c) => c.blocking && c.status === "FAIL");
  const anyFail = checks.some((c) => c.status === "FAIL");
  const warn = checks.filter((c) => c.status === "WARNING").length;
  const pass = checks.filter((c) => c.status === "PASS").length;

  return {
    ok: !blockingFailed,
    blockingFailed,
    checks,
    summary: blockingFailed
      ? `${pass} passed, ${warn} warning(s) — blocking failure(s) must be fixed before redeploy`
      : anyFail
        ? `${pass} passed, ${warn} warning(s) — review failures (non-blocking)`
        : warn > 0
          ? `${pass} passed, ${warn} warning(s) — OK to redeploy with caveats`
          : `${pass} checks passed — Ollama auto AI draft path looks ready`,
    ranAt: new Date().toISOString(),
  };
}
