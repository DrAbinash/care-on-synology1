/**
 * Thin cloud Composer adapters — translate ComposerProviderRequest into
 * @workspace/ai-providers shared OpenAI-compatible transport.
 * Do NOT own duplicate SDK clients / fetch / usage extraction.
 *
 * These three adapters are the only way composer text reaches a cloud vendor,
 * so they are where the two things CARE was missing are now enforced:
 *  - `assertGatewayPrivacy` runs before any network call (cloud-bound composer
 *    text previously bypassed every PHI control CARE has).
 *  - credentials resolve through `ai_provider_settings` first, like the rest of
 *    CARE, instead of environment-only (see cloudComposerConfig.ts), and a
 *    provider the admin has switched OFF there is refused rather than used.
 */
import {
  openAiCompatibleChat,
  assertVisionCapable,
  estimateUsageCostUsd,
  COMPATIBLE_PROVIDER_DEFAULTS,
  type CompatibleImagePart,
} from "@workspace/ai-providers";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
  ComposerProviderName,
} from "./types";
import { modelCapabilities } from "./modelRegistry";
import { assertGatewayPrivacy, type PixelEgressProof } from "./gatewayPrivacy";
import { resolveCloudComposerConfig, type CloudComposerProvider } from "./cloudComposerConfig";
import {
  deidentifyImagesForCloudEgress,
  type PatientIdentifiers,
} from "../../ai/imageDeidentification";
import { createLocalBurnedInOcrRunner } from "../../ai/localBurnedInOcr";

type CloudId = CloudComposerProvider;

/**
 * Injectable seams for the cloud-vision egress proof, so tests can exercise the
 * wiring without a local OCR model. Production resolves these once per module
 * load; the runners themselves stay lazy (the OCR runner resolves the vision
 * model per call, and the de-identification gate only runs when pixels are
 * actually cleared to leave).
 */
type ComposerCloudVisionDeps = {
  deidentify: typeof deidentifyImagesForCloudEgress;
  buildOcrRunner: typeof createLocalBurnedInOcrRunner;
};

const defaultCloudVisionDeps: ComposerCloudVisionDeps = {
  deidentify: deidentifyImagesForCloudEgress,
  buildOcrRunner: createLocalBurnedInOcrRunner,
};

let cloudVisionDeps: ComposerCloudVisionDeps = defaultCloudVisionDeps;

/** Test-only: swap or restore the egress-proof dependencies. */
export function __setComposerCloudVisionDepsForTests(
  deps: Partial<ComposerCloudVisionDeps> | null,
): void {
  cloudVisionDeps = deps ? { ...defaultCloudVisionDeps, ...deps } : defaultCloudVisionDeps;
}

/**
 * Produce the pixel egress proof for the EXACT bytes about to be sent.
 *
 * This is the wiring `assertGatewayPrivacy` always demanded and no caller ever
 * provided: the gate refuses pixels unless a `PixelEgressProof` accompanies
 * them, and until now every composer cloud send was refused with
 * `cloud_image_not_verified` whatever the clinic had configured. The proof is
 * built here — inside the adapter, from the request's own images — rather than
 * accepted from the caller, so no future call site can forget it, forge it, or
 * verify one set of bytes and send another.
 *
 * Fail closed on every limb: no identifiers (the engine could not resolve the
 * patient), a re-encode failure, or an on-premises model that cannot read the
 * image all refuse the send. A clinic with no local vision model gets honest
 * text-only cloud AI, never a silently weaker privacy control.
 */
async function buildPixelEgressProof(
  provider: CloudId,
  images: NonNullable<ComposerProviderRequest["images"]>,
  identifiers: PatientIdentifiers | undefined,
): Promise<{ ok: true; proof: PixelEgressProof } | { ok: false; safeError: string; detail: string }> {
  if (!identifiers) {
    return {
      ok: false,
      safeError: "cloud_image_not_verifiable",
      detail:
        "The patient behind this study could not be resolved, so the images cannot be "
        + "verified free of that patient's identifiers. Nothing was sent to "
        + provider
        + ". Link the study to a patient record, or keep this draft on a local provider.",
    };
  }
  const deidentified = await cloudVisionDeps.deidentify(
    {
      images: images.map((i) => ({ base64: i.base64, mimeType: i.mimeType })),
      identifiers,
      runLocalOcr: cloudVisionDeps.buildOcrRunner(),
    },
  );
  if (!deidentified.ok) {
    return { ok: false, safeError: deidentified.safeError, detail: deidentified.detail };
  }
  return {
    ok: true,
    proof: {
      posture: "clean",
      images: deidentified.images.map((i) => ({ base64: i.base64, mimeType: i.mimeType })),
    },
  };
}

function failed(
  provider: CloudId,
  model: string,
  safeError: string,
  detail?: string,
): ComposerProviderResult {
  return {
    ok: false,
    provider,
    model,
    safeError,
    latencyMs: 0,
    execution: "CLOUD",
    ...(detail ? { detail } : {}),
  };
}

async function composeViaSharedTransport(
  provider: CloudId,
  request: ComposerProviderRequest,
): Promise<ComposerProviderResult> {
  const model =
    (request.model || "").trim() || COMPATIBLE_PROVIDER_DEFAULTS[provider]?.defaultModel || "";
  const imageCount = request.images?.length ?? 0;
  const execution = "CLOUD" as const;

  if (imageCount > 0) {
    const vis = assertVisionCapable(provider, model);
    if (!vis.ok) {
      return {
        ok: false,
        provider,
        model,
        safeError: vis.safeError,
        latencyMs: 0,
        execution,
      };
    }
  }

  // ─── Which provider may be used at all ─────────────────────────────────────
  // Resolved before the privacy gate on purpose: PHI detection and image
  // verification are the expensive steps, and neither should run for a provider
  // the admin has switched off. Nothing here dials out — this is one settings
  // read — so no clinical text is exposed by ordering it first.
  const cfg = await resolveCloudComposerConfig(provider);
  if (!cfg.apiKey) {
    return failed(
      provider,
      model,
      `${provider}_api_key_not_configured`,
      "No API key found for this provider in AI Provider Settings or the environment.",
    );
  }
  if (!cfg.baseURL) {
    return failed(
      provider,
      model,
      `${provider}_endpoint_not_configured`,
      `No endpoint configured for ${provider}.`,
    );
  }
  // `enabled === false` is a stored row that says OFF. The rest of CARE already
  // refuses on it (`resolveInteractiveTarget`, `/generate`); the composer read
  // only the key and ignored the switch, so the same settings screen produced a
  // working draft here and a "provider is disabled" error there.
  // `null` (no row) is not a statement about enablement and stays allowed, so a
  // clinic that configured its key through the environment is not switched off
  // by a check that was never shown to it.
  if (cfg.enabled === false) {
    return failed(
      provider,
      model,
      `${provider}_provider_disabled`,
      `${provider} is switched OFF in AI Provider Settings. Enable it there, or select a provider that is on.`,
    );
  }

  // ─── Privacy gate: runs before the request exists on the wire ───────────────
  // The gate may redact identifier VALUES (never clinical content) and returns
  // the exact text that is allowed to leave. Anything it refuses is refused
  // here, not silently sent.
  //
  // ─── Pixel proof: produced HERE, for THESE bytes ──────────────────────────
  // An opt-in and a MIME check are permissions, not inspections. The gate
  // demands the record of an inspection (`PixelEgressProof`), and the proof is
  // built immediately above it so the bytes verified are the bytes sent. Only
  // built when the flag says pixels may leave at all — a request without
  // `cloudVisionAllowed` is refused by the gate below without spending an
  // on-premises OCR pass on images that are going nowhere.
  let pixelProof: PixelEgressProof | null = null;
  if (imageCount > 0 && request.cloudVisionAllowed === true) {
    const proofResult = await buildPixelEgressProof(provider, request.images ?? [], request.patientIdentifiers);
    if (!proofResult.ok) {
      return failed(provider, model, proofResult.safeError, proofResult.detail);
    }
    pixelProof = proofResult.proof;
  }

  const privacy = await assertGatewayPrivacy({
    provider,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    images: request.images,
    cloudVisionAllowed: request.cloudVisionAllowed === true,
    pixelProof,
  });
  if (!privacy.ok) {
    return failed(provider, model, privacy.safeError, privacy.detail);
  }

  // The gate returns the exact bytes that cleared verification — a re-encoded,
  // metadata-stripped set, not the ones it was shown. Taking them from
  // `request.images` instead would inspect one image and send another, the same
  // way sending `request.userPrompt` rather than `privacy.userPrompt` would
  // un-redact text the gate had just scrubbed.
  const images: CompatibleImagePart[] | undefined = privacy.images.map((i) => ({
    mimeType: i.mimeType,
    base64: i.base64,
  }));

  const r = await openAiCompatibleChat({
    provider,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model,
    systemPrompt: privacy.systemPrompt,
    userPrompt: privacy.userPrompt,
    images,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs,
    // "Output limits are configured": without this the vendor's own default
    // caps a long report mid-sentence and the JSON arrives unparseable.
    ...(request.maxTokens != null ? { maxTokens: request.maxTokens } : {}),
    jsonMode: request.jsonMode !== false,
    // Qwen3 and GLM both default to a reasoning pass that slows the draft and
    // can break JSON parsing; the composer wants the direct answer.
    extraBody:
      provider === "qwen"
        ? { enable_thinking: false }
        : provider === "zai"
          ? { thinking: { type: "disabled" } }
          : undefined,
  });

  const usage = {
    promptTokens: r.usage.promptTokens,
    completionTokens: r.usage.completionTokens,
    totalTokens: r.usage.totalTokens,
    approximateCostUsd: estimateUsageCostUsd({
      provider,
      model: r.model,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
    }),
  };

  if (!r.ok) {
    return {
      ok: false,
      provider,
      model: r.model,
      safeError: r.safeError,
      latencyMs: r.latencyMs,
      execution,
      usage,
    };
  }
  return {
    ok: true,
    text: r.text,
    provider,
    model: r.model,
    latencyMs: r.latencyMs,
    execution,
    usage,
    // The posture the gate established for the pixels that left; the engine
    // records it in the job's provenance so "were these images checked?" is
    // answerable from the row.
    ...(imageCount > 0 && pixelProof ? { pixelPosture: "verified_clean" as const } : {}),
  };
}

function caps(provider: ComposerProviderName, model: string): ComposerProviderCapabilities {
  return modelCapabilities(provider, model);
}

export class QwenComposerAdapter implements ComposerProviderAdapter {
  readonly name = "qwen" as const;
  async getCapabilities(model: string) {
    return caps("qwen", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("qwen", request);
  }
}

export class DeepSeekComposerAdapter implements ComposerProviderAdapter {
  readonly name = "deepseek" as const;
  async getCapabilities(model: string) {
    return caps("deepseek", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("deepseek", request);
  }
}

export class OpenAiComposerAdapter implements ComposerProviderAdapter {
  readonly name = "openai" as const;
  async getCapabilities(model: string) {
    return caps("openai", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("openai", request);
  }
}

export class ZaiComposerAdapter implements ComposerProviderAdapter {
  readonly name = "zai" as const;
  async getCapabilities(model: string) {
    return caps("zai", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("zai", request);
  }
}
