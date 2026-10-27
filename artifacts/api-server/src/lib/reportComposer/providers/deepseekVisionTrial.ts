/**
 * Experimental DeepSeek Vision A/B trial — never writes clinical reports.
 * Uses derived JPEG/PNG/WebP only (no DICOM). Requires explicit confirmCloudVisionTrial.
 *
 * PRIVACY CLAIMS ARE POSTURES, NOT BOOLEANS. This response used to hard-code
 * `identifiersExcluded: true` on every return path — including the one that
 * inspected nothing, and including real patient pixels that no code anywhere
 * can check. A field that asserts a control exists when it does not is worse
 * than no field, because an auditor reads it as coverage. What is reported now
 * is only what was actually established:
 *  - `rawDicomExcluded`  — earned: the MIME/filename check ran on this payload.
 *  - `textIdentifiers`   — what the shared gate detected/redacted in the prompt.
 *  - `pixelIdentifiers`  — always `not_verified`. Nothing in CARE inspects
 *                          image pixels, so a burned-in name or UHID survives
 *                          every step of this trial. That is the truth the
 *                          operator needs before pointing it at real studies.
 */
import { DeepSeekComposerAdapter, approximateDeepSeekCostUsd, getRecentDeepSeekTelemetry } from "./deepseekComposerAdapter";
import {
  DEEPSEEK_TEXT_MODEL,
  DEEPSEEK_VISION_MODEL,
  deepseekConfiguredPublicStatus,
} from "./deepseekConfig";
import { assertNoRawDicomPayload, flagPossibleBurnedInPhi } from "./cloudPayloadPrivacy";
import { assertGatewayPrivacy, type CloudTextPosture } from "./gatewayPrivacy";
import { resolveCloudComposerConfig } from "./cloudComposerConfig";
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

export type VisionTrialPrivacy = {
  rawDicomExcluded: boolean;
  textIdentifiers: CloudTextPosture | "not_evaluated";
  pixelIdentifiers: "not_verified";
  identifiersExcluded: false;
  burnedInPhiFlags: string[];
};

function tinySyntheticPngBase64(): string {
  // 1x1 PNG
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

function privacyPosture(opts: {
  rawDicomExcluded?: boolean;
  textIdentifiers?: CloudTextPosture | "not_evaluated";
  burnedInPhiFlags?: string[];
}): VisionTrialPrivacy {
  return {
    rawDicomExcluded: opts.rawDicomExcluded ?? false,
    textIdentifiers: opts.textIdentifiers ?? "not_evaluated",
    pixelIdentifiers: "not_verified",
    // Nothing can claim identifier exclusion for pixels, so the legacy boolean
    // stays false instead of being deleted — older panels keep rendering, and
    // what they render is no longer a lie.
    identifiersExcluded: false,
    burnedInPhiFlags: opts.burnedInPhiFlags ?? [],
  };
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
  privacy: VisionTrialPrivacy;
  local: VisionTrialArmResult | null;
  deepseek: VisionTrialArmResult | null;
  sameImageCount: number;
  samePrompt: string;
}> {
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
      deepSeekConfigured: (await resolveCloudComposerConfig("deepseek")).keyConfigured,
      privacy: privacyPosture({ rawDicomExcluded: true, burnedInPhiFlags: ["raw_dicom_blocked"] }),
      local: null,
      deepseek: null,
      sameImageCount: 0,
      samePrompt: prompt,
    };
  }

  const userPrompt = `${prompt}\n\nImage count: ${images.length}. De-identified trial only.`;
  const cloudArmAllowed = opts.confirmCloudVisionTrial === true && opts.cloudVisionAllowed === true;

  // The same gate the production composer uses. The cloud arm is refused here
  // as well as inside the adapter, so this trial cannot become the back door
  // that the policy gate was built to close.
  const gate = await assertGatewayPrivacy({
    provider: "deepseek",
    systemPrompt: VISION_TRIAL_SYSTEM,
    userPrompt,
    images,
    filenames: images.map((i) => i.filename),
    cloudVisionAllowed: cloudArmAllowed,
  });

  const deepSeekCfg = await resolveCloudComposerConfig("deepseek");
  const status = deepseekConfiguredPublicStatus();
  const deepSeekConfigured = deepSeekCfg.keyConfigured || Boolean(status.configured);

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
    } else if (!gate.ok) {
      // Refused by the shared privacy gate — no request was made.
      deepseek = {
        execution: "CLOUD",
        provider: "deepseek",
        model: DEEPSEEK_VISION_MODEL,
        ok: false,
        latencyMs: 0,
        imageCount: images.length,
        proposalText: null,
        safeError: gate.safeError,
        fallbackUsed: false,
        writesClinicalReport: false,
      };
    } else if (!deepSeekConfigured) {
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
        systemPrompt: gate.systemPrompt,
        userPrompt: gate.userPrompt,
        model: DEEPSEEK_VISION_MODEL,
        temperature: 0.1,
        timeoutMs: 90_000,
        cloudVisionAllowed: true,
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
    deepSeekConfigured,
    privacy: privacyPosture({
      // Earned unconditionally from here on: assertNoRawDicomPayload already
      // ran on every image above and returned early if any failed it.
      rawDicomExcluded: true,
      textIdentifiers: gate.ok ? gate.textPosture : "not_evaluated",
      burnedInPhiFlags: gate.ok
        ? gate.burnedInPhiFlags
        : flagPossibleBurnedInPhi([userPrompt, ...images.map((i) => i.label ?? "")]),
    }),
    local,
    deepseek,
    sameImageCount: images.length,
    samePrompt: prompt,
  };
}

export { DEEPSEEK_TEXT_MODEL, DEEPSEEK_VISION_MODEL };
