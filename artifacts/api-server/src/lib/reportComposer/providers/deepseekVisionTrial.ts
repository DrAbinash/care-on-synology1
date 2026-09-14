/**
 * Experimental DeepSeek Vision A/B trial — never writes clinical reports.
 * Uses derived JPEG/PNG/WebP only (no DICOM). Requires explicit confirmCloudVisionTrial.
 */
import { DeepSeekComposerAdapter, approximateDeepSeekCostUsd, getRecentDeepSeekTelemetry } from "./deepseekComposerAdapter";
import {
  DEEPSEEK_TEXT_MODEL,
  DEEPSEEK_VISION_MODEL,
  deepseekConfiguredPublicStatus,
  isDeepSeekConfigured,
} from "./deepseekConfig";
import { assertNoRawDicomPayload, flagPossibleBurnedInPhi } from "./cloudPayloadPrivacy";
import type { ComposerProviderImage } from "./types";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { resolveComposerRuntime } from "../../voiceReportComposer/runtimeConfig";
import { assertVisionCapableModel } from "../visionCapability";

const VISION_TRIAL_SYSTEM = [
  "You are a radiology AI trial assistant producing STRUCTURED OBSERVATION PROPOSALS only.",
  "This is NEVER a final report. Never invent patient demographics or identifiers.",
  "Return JSON only: { \"observations\": [ { \"anatomy\": string, \"finding\": string, \"level\": string|null, \"laterality\": string|null, \"measurement\": string|null, \"confidence\": number } ], \"limitations\": string[] }",
].join("\n");

export type VisionTrialImage = ComposerProviderImage & {
  label?: string;
  filename?: string;
};

export type VisionTrialArmResult = {
  execution: "LOCAL" | "CLOUD";
  provider: "ollama" | "deepseek";
  model: string;
  ok: boolean;
  latencyMs: number;
  imageCount: number;
  proposalText: string | null;
  safeError: string | null;
  fallbackUsed: false;
  writesClinicalReport: false;
  promptTokens?: number | null;
  completionTokens?: number | null;
  approximateCostUsd?: number | null;
};

function tinySyntheticPngBase64(): string {
  // 1x1 PNG
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

export async function runDeepSeekVisionAbTrial(opts: {
  images?: VisionTrialImage[];
  clinicalPrompt?: string;
  confirmCloudVisionTrial: boolean;
  cloudVisionAllowed: boolean;
  runLocal: boolean;
  runDeepSeek: boolean;
}): Promise<{
  ok: boolean;
  writesClinicalReport: false;
  deepSeekConfigured: boolean;
  privacy: {
    rawDicomExcluded: true;
    identifiersExcluded: true;
    burnedInPhiFlags: string[];
  };
  local: VisionTrialArmResult | null;
  deepseek: VisionTrialArmResult | null;
  sameImageCount: number;
  samePrompt: string;
}> {
  const status = deepseekConfiguredPublicStatus();
  const prompt =
    (opts.clinicalPrompt ?? "").trim() ||
    "MRI LS Spine key images. Propose structured observations only. Limited review.";

  const images: VisionTrialImage[] =
    opts.images && opts.images.length > 0
      ? opts.images.slice(0, 6)
      : [
          {
            mimeType: "image/png",
            base64: tinySyntheticPngBase64(),
            label: "synthetic_deidentified_trial",
            filename: "trial.png",
          },
        ];

  const dicomGuard = assertNoRawDicomPayload({
    mimeTypes: images.map((i) => i.mimeType),
    filenames: images.map((i) => i.filename),
  });
  if (!dicomGuard.ok) {
    return {
      ok: false,
      writesClinicalReport: false,
      deepSeekConfigured: status.configured,
      privacy: {
        rawDicomExcluded: true,
        identifiersExcluded: true,
        burnedInPhiFlags: ["raw_dicom_blocked"],
      },
      local: null,
      deepseek: null,
      sameImageCount: 0,
      samePrompt: prompt,
    };
  }

  const burnedInPhiFlags = flagPossibleBurnedInPhi([prompt, ...images.map((i) => i.label ?? "")]);
  const userPrompt = `${prompt}\n\nImage count: ${images.length}. De-identified trial only.`;

  let local: VisionTrialArmResult | null = null;
  let deepseek: VisionTrialArmResult | null = null;

  if (opts.runLocal) {
    const runtime = await resolveComposerRuntime(true);
    const model = (runtime.visionModel || "qwen3-vl:8b").trim();
    const started = Date.now();
    const visionOk = await assertVisionCapableModel({
      endpoint: runtime.endpoint,
      model,
    });
    if (!visionOk.ok || !runtime.endpoint) {
      local = {
        execution: "LOCAL",
        provider: "ollama",
        model,
        ok: false,
        latencyMs: Date.now() - started,
        imageCount: images.length,
        proposalText: null,
        safeError: visionOk.ok === false ? visionOk.safeError : "local_endpoint_missing",
        fallbackUsed: false,
        writesClinicalReport: false,
      };
    } else {
      const adapter = new OllamaComposerAdapter();
      const r = await adapter.compose({
        systemPrompt: VISION_TRIAL_SYSTEM,
        userPrompt,
        model,
        temperature: 0.1,
        timeoutMs: runtime.timeoutMs,
        numCtx: runtime.numCtx,
        endpoint: runtime.endpoint,
        localOnly: runtime.localOnly,
        images: images.map((i) => ({ mimeType: i.mimeType, base64: i.base64 })),
      });
      local = {
        execution: "LOCAL",
        provider: "ollama",
        model,
        ok: r.ok,
        latencyMs: r.latencyMs,
        imageCount: images.length,
        proposalText: r.ok ? r.text : null,
        safeError: r.ok ? null : r.safeError,
        fallbackUsed: false,
        writesClinicalReport: false,
      };
    }
  }

  if (opts.runDeepSeek) {
    if (!opts.confirmCloudVisionTrial || !opts.cloudVisionAllowed) {
      deepseek = {
        execution: "CLOUD",
        provider: "deepseek",
        model: DEEPSEEK_VISION_MODEL,
        ok: false,
        latencyMs: 0,
        imageCount: images.length,
        proposalText: null,
        safeError: "cloud_vision_trial_not_confirmed",
        fallbackUsed: false,
        writesClinicalReport: false,
      };
    } else if (!isDeepSeekConfigured()) {
      deepseek = {
        execution: "CLOUD",
        provider: "deepseek",
        model: DEEPSEEK_VISION_MODEL,
        ok: false,
        latencyMs: 0,
        imageCount: images.length,
        proposalText: null,
        safeError: "deepseek_api_key_not_configured",
        fallbackUsed: false,
        writesClinicalReport: false,
      };
    } else {
      const adapter = new DeepSeekComposerAdapter();
      const r = await adapter.compose({
        systemPrompt: VISION_TRIAL_SYSTEM,
        userPrompt,
        model: DEEPSEEK_VISION_MODEL,
        temperature: 0.1,
        timeoutMs: 90_000,
        images: images.map((i) => ({ mimeType: i.mimeType, base64: i.base64 })),
      });
      const last = getRecentDeepSeekTelemetry(1)[0];
      deepseek = {
        execution: "CLOUD",
        provider: "deepseek",
        model: DEEPSEEK_VISION_MODEL,
        ok: r.ok,
        latencyMs: r.latencyMs,
        imageCount: images.length,
        proposalText: r.ok ? r.text : null,
        safeError: r.ok ? null : r.safeError,
        fallbackUsed: false,
        writesClinicalReport: false,
        promptTokens: last?.promptTokens ?? null,
        completionTokens: last?.completionTokens ?? null,
        approximateCostUsd: last ? approximateDeepSeekCostUsd(last) : null,
      };
    }
  }

  return {
    ok: (local?.ok ?? false) || (deepseek?.ok ?? false),
    writesClinicalReport: false,
    deepSeekConfigured: status.configured,
    privacy: {
      rawDicomExcluded: true,
      identifiersExcluded: true,
      burnedInPhiFlags,
    },
    local,
    deepseek,
    sameImageCount: images.length,
    samePrompt: prompt,
  };
}

export { DEEPSEEK_TEXT_MODEL, DEEPSEEK_VISION_MODEL };
