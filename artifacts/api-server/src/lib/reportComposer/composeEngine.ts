/**
 * Report composition engine — text-only by default; SELECTED_IMAGES mode
 * attaches radiologist-selected frozen key images to a vision-capable
 * local Ollama model via the canonical provider payload shape.
 *
 * Never fetches Orthanc middle slices. Never stores base64 in snapshots.
 */
import { resolveComposerRuntime } from "../voiceReportComposer/runtimeConfig";
import { validateOllamaUrl } from "../ssrf/ollamaUrlGuard";
import {
  ComposerInputSnapshot,
  ComposerDraftOutput,
  ComposerEvidenceProvenance,
  parseComposerDraftJson,
} from "./types";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { buildCareSystemPrompt, CARE_PERSONA_VERSION } from "./persona";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { resolveSelectedKeyImagesForCompose } from "./resolveSelectedKeyImages";
import { assertVisionCapableModel } from "./visionCapability";
import { planComposerVisionContext } from "./composerContextBudget";
import type { KeyImageOwnershipContext } from "./keyImageOwnership";
import {
  resolveComposerProvider,
  assertComposerProviderPolicy,
  defaultModelFor,
  assertModelSupportsCapability,
  parseComposerProviderName,
  resolveCloudComposerConfig,
  asCloudComposerProvider,
  type ComposerProviderName,
} from "./providers";
import {
  getLocalOpenAiBaseUrl,
  getLocalOpenAiDefaultModel,
} from "./providers/localOpenAiCompatibleConfig";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { resolveTaskRoute } from "@workspace/ai-providers";

export type ComposeRunResult = {
  ok: boolean;
  draft?: ComposerDraftOutput;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  rawLength?: number;
  provenance?: ComposerEvidenceProvenance;
};

/** @deprecated Use buildCareSystemPrompt(kind, snapshot). */
function buildSystemPrompt(kind: AiComposeJobKind): string {
  return buildCareSystemPrompt(kind, {} as ComposerInputSnapshot);
}
void buildSystemPrompt;

export function buildUserPrompt(kind: AiComposeJobKind, snapshot: ComposerInputSnapshot): string {
  if (
    kind === "SELECTION_EDIT" ||
    kind === "REPHRASE" ||
    kind === "SHORTEN" ||
    kind === "EXPAND" ||
    kind === "TRANSLATE" ||
    kind === "SECTION_EDIT"
  ) {
    return JSON.stringify(
      {
        jobKind: kind,
        instruction: snapshot.instruction ?? kind,
        targetLanguage: snapshot.targetLanguage,
        selectionField: snapshot.selectionField,
        selectionText: snapshot.selectionText,
        groundingFindings: (snapshot.findings ?? "").slice(0, 1200),
        groundingImpression: (snapshot.impression ?? "").slice(0, 600),
        observations: (snapshot.observations ?? []).slice(0, 12),
      },
      null,
      0,
    );
  }

  const draftCtx = buildRadiologistDraftContext(snapshot);
  let prompt = renderRadiologistDraftContextPrompt(draftCtx, kind);

  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    const caps = (snapshot.selectedKeyImages ?? [])
      .map((img, i) => {
        const bits = [
          `#${i + 1}`,
          `keyImageId=${img.keyImageId}`,
          img.observationId ? `linkedObservation=${img.observationId}` : null,
          img.seriesDescription ? `series=${img.seriesDescription}` : null,
          img.caption ? `caption=${img.caption}` : null,
        ].filter(Boolean);
        return `- ${bits.join(" | ")}`;
      })
      .join("\n");
    prompt +=
      `\n\nSELECTED KEY IMAGE METADATA (supporting evidence only; observations remain authoritative):\n` +
      (caps || "- (none)") +
      `\nDo NOT claim complete MRI review. Absence on these frames is not proof of normality.`;
  }

  return prompt;
}


export { deterministicComposeFromSnapshot } from "./deterministicCompose";

function effectiveAiMode(
  kind: AiComposeJobKind,
  snapshot: ComposerInputSnapshot,
): "TEXT_ONLY" | "SELECTED_IMAGES" {
  // Impression + micro-edits remain text-only even if snapshot carries images.
  if (kind !== "FULL_REPORT") return "TEXT_ONLY";
  return snapshot.aiMode === "SELECTED_IMAGES" ? "SELECTED_IMAGES" : "TEXT_ONLY";
}

export async function runReportComposer(opts: {
  kind: AiComposeJobKind;
  snapshot: ComposerInputSnapshot;
  allowDeterministicFallback?: boolean;
  /** Authoritative ownership context for SELECTED_IMAGES (resolved server-side). */
  ownership?: KeyImageOwnershipContext | null;
  /** Optional provider override (test lab / workspace session). */
  providerOverride?: ComposerProviderName | null;
  /** Explicit opt-in to send images to cloud vision. */
  cloudVisionAllowed?: boolean;
  /** Optional model override (test lab / workspace session / task route). */
  modelOverride?: string | null;
}): Promise<ComposeRunResult> {
  const started = Date.now();
  const aiMode = effectiveAiMode(opts.kind, opts.snapshot);
  const baseProvenance: ComposerEvidenceProvenance = {
    aiMode,
    personaVersion: CARE_PERSONA_VERSION,
    selectedKeyImageIds: (opts.snapshot.selectedKeyImages ?? []).map((r) => r.keyImageId),
    imagesLoaded: 0,
    linkedObservationIds: [],
    degradedReason: null,
  };

  const runtime = await resolveComposerRuntime(true);

  // Provider resolution (session snapshot → explicit opts → task route → ollama):
  // Settings / Model Routing remain the clinic default source of truth.
  // snapshot.sessionProvider / sessionModel are draft-scoped only.
  const sessionProvider = parseComposerProviderName(
    opts.snapshot.sessionProvider ?? opts.providerOverride ?? null,
  );
  const hasExplicitProvider =
    Boolean(opts.providerOverride) || Boolean(opts.snapshot.sessionProvider?.trim());

  let providerName: ComposerProviderName = "ollama";
  let routeModel: string | null = null;
  if (hasExplicitProvider) {
    providerName = sessionProvider;
  } else {
    const taskKey = aiMode === "SELECTED_IMAGES" ? "selected_image_vision" : "report_composer";
    try {
      const route = await resolveTaskRoute(taskKey);
      if (route?.provider) {
        providerName = parseComposerProviderName(route.provider);
        routeModel = (route.model ?? "").trim() || null;
      }
    } catch {
      providerName = "ollama";
    }
  }

  const isCloud =
    providerName === "deepseek" || providerName === "qwen" || providerName === "openai";
  const isLocalOpenAi = providerName === "local_openai_compatible";
  const isOllama = providerName === "ollama";

  // Ollama path still requires Local AI composer runtime. Other providers do not.
  if (isOllama && (!runtime.enabled || !runtime.model)) {
    if (aiMode === "SELECTED_IMAGES") {
      return {
        ok: false,
        safeError: "composer_model_not_configured",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          degradedReason: "Selected-image drafting requires a configured local model.",
        },
      };
    }
    if (opts.allowDeterministicFallback !== false) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          personaVersion: null,
          provider: "deterministic",
          fallbackUsed: true,
        },
      };
    }
    return {
      ok: false,
      safeError: "composer_model_not_configured",
      latencyMs: Date.now() - started,
      provenance: baseProvenance,
    };
  }

  const localEndpoint = isLocalOpenAi ? await getLocalOpenAiBaseUrl(null) : null;
  const providerAdapter = resolveComposerProvider(providerName);
  const cloudVisionAllowed = opts.cloudVisionAllowed === true && isCloud;
  // Key presence is resolved the same way the send itself resolves it
  // (ai_provider_settings first, then env), so the gate can no longer say
  // "not configured" about a provider the admin genuinely configured.
  const cloudProviderKey = asCloudComposerProvider(providerName);
  const cloudCfg = cloudProviderKey
    ? await resolveCloudComposerConfig(cloudProviderKey)
    : null;
  const policy = assertComposerProviderPolicy({
    provider: providerName,
    aiMode,
    cloudVisionAllowed,
    imageCount: (opts.snapshot.selectedKeyImages ?? []).length,
    images: undefined,
    localEndpointConfigured: isLocalOpenAi ? Boolean(localEndpoint?.trim()) : undefined,
    cloudApiKeyConfigured: cloudCfg?.keyConfigured,
    resolvedUrl: isLocalOpenAi ? localEndpoint ?? null : undefined,
  });
  if (!policy.ok) {
    return {
      ok: false,
      safeError: policy.safeError,
      latencyMs: Date.now() - started,
      provenance: {
        ...baseProvenance,
        provider: providerName,
        fallbackUsed: false,
        degradedReason: policy.safeError,
      },
    };
  }

  if (isOllama) {
    const guard = validateOllamaUrl(runtime.endpoint, runtime.localOnly);
    if (!guard.ok) {
      return {
        ok: false,
        safeError: "composer_endpoint_blocked",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          provider: providerName,
          fallbackUsed: false,
        },
      };
    }
  }

  const sessionModel =
    (opts.modelOverride ?? "").trim() ||
    (opts.snapshot.sessionModel ?? "").trim() ||
    "";
  const localDefaultModel = isLocalOpenAi ? await getLocalOpenAiDefaultModel() : null;
  const textModel =
    sessionModel ||
    routeModel ||
    (isCloud
      ? defaultModelFor(providerName, "text") || runtime.model
      : isLocalOpenAi
        ? localDefaultModel || defaultModelFor(providerName, "text") || "bonsai"
        : runtime.model);

  let provenance: ComposerEvidenceProvenance = {
    ...baseProvenance,
    model: textModel,
    provider: providerName,
    fallbackUsed: false,
  };

  if (aiMode === "SELECTED_IMAGES") {
    const ownership = opts.ownership ?? null;
    if (!ownership || (ownership.draftId == null && ownership.studyId == null)) {
      return {
        ok: false,
        safeError: "selected_images_ownership_unverified",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: runtime.model,
          degradedReason: "Cannot verify key-image ownership without an authoritative draft or study.",
        },
      };
    }

    const resolved = await resolveSelectedKeyImagesForCompose({
      snapshot: opts.snapshot,
      ownership,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        safeError: resolved.safeError,
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: runtime.model,
          degradedReason: resolved.detail ?? resolved.safeError,
        },
      };
    }

    // Prefer configured vision model; cloud/local-openai use registry + settings.
    let visionModel =
      isCloud || isLocalOpenAi
        ? (sessionModel ||
            routeModel ||
            defaultModelFor(providerName, "vision") ||
            textModel)
        : (runtime.visionModel || "").trim() || runtime.model;

    if (isOllama) {
      let visionOk = await assertVisionCapableModel({
        endpoint: runtime.endpoint,
        model: visionModel,
      });
      if (!visionOk.ok && visionModel !== runtime.model && runtime.model) {
        const alt = await assertVisionCapableModel({
          endpoint: runtime.endpoint,
          model: runtime.model,
        });
        if (alt.ok) {
          visionModel = runtime.model;
          visionOk = alt;
        }
      }
      if (!visionOk.ok) {
        return {
          ok: false,
          safeError: visionOk.safeError,
          latencyMs: Date.now() - started,
          provenance: {
            ...baseProvenance,
            model: visionModel,
            provider: providerName,
            degradedReason: visionOk.detail,
          },
        };
      }
    } else if (isCloud) {
      const visCap = assertModelSupportsCapability(providerName, visionModel, "vision");
      if (!visCap.ok) {
        return {
          ok: false,
          safeError: visCap.safeError,
          latencyMs: Date.now() - started,
          provenance: {
            ...baseProvenance,
            model: visionModel,
            provider: providerName,
            degradedReason: "Cloud vision requires a vision-capable registered model",
          },
        };
      }
    }
    // local_openai_compatible: adapter enforces Settings.supportsVision fail-closed.

    // Floor guard: a context window below the clinic minimum cannot hold even a
    // single image plus the clinical truth, so fail with an actionable error.
    const MIN_VISION_NUM_CTX = 2048;
    if (isOllama && runtime.numCtx < MIN_VISION_NUM_CTX) {
      return {
        ok: false,
        safeError: "composer_num_ctx_insufficient",
        latencyMs: Date.now() - started,
        provenance: {
          ...baseProvenance,
          model: visionModel,
          provider: providerName,
          degradedReason: `Composer num_ctx (${runtime.numCtx}) is below the minimum required for selected-image drafting (${MIN_VISION_NUM_CTX}). Increase ollama_composer_num_ctx in clinic settings.`,
        },
      };
    }

    provenance = {
      ...baseProvenance,
      model: visionModel,
      provider: providerName,
      fallbackUsed: false,
      imagesLoaded: resolved.images.length,
      linkedObservationIds: resolved.linkedObservationIds,
      selectedKeyImageIds: resolved.selectedKeyImageIds,
    };

    const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
    const user = buildUserPrompt(opts.kind, opts.snapshot);

    // Images cost context on top of the clinical truth. Size num_ctx for THIS
    // request from CARE's existing empirical estimator rather than trusting the
    // admin default (4096), which cannot hold 4 key images. Bounded by the
    // ceiling the composer clamp already enforces, never lowered below the
    // configured value, and a request that cannot fit even then FAILS instead of
    // letting Ollama truncate the radiologist's own observations.
    let composeNumCtx = runtime.numCtx;
    if (isOllama) {
      const plan = planComposerVisionContext({
        imageCount: resolved.images.length,
        systemPrompt: system,
        userPrompt: user,
        configuredNumCtx: runtime.numCtx,
      });
      if (!plan.fits) {
        return {
          ok: false,
          safeError: "composer_context_budget_exceeded",
          latencyMs: Date.now() - started,
          model: visionModel,
          provenance: {
            ...provenance,
            degradedReason: plan.reason,
          },
        };
      }
      composeNumCtx = plan.numCtx;
    }

    const primary = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: visionModel,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
      numCtx: composeNumCtx,
      endpoint: isLocalOpenAi ? (localEndpoint ?? undefined) : runtime.endpoint,
      localOnly: runtime.localOnly,
      // Re-checked inside the cloud transport, so opening cloud vision would
      // need two deliberate changes rather than one. Passes through only what
      // the policy above already required — production jobs never set it.
      cloudVisionAllowed,
      // Preserve each resolved image's actual MIME (jpeg/png/webp) — do not coerce to JPEG.
      images: resolved.images.map((img) => ({
        mimeType: img.mimeType,
        base64: img.base64,
      })),
    });

    if (!primary.ok) {
      const detail = primary.detail ?? primary.safeError ?? "compose_failed";
      return {
        ok: false,
        safeError: primary.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: visionModel,
        provenance: {
          ...provenance,
          degradedReason: detail,
        },
      };
    }

    const draft = parseComposerDraftJson(primary.text ?? "");
    if (!draft) {
      return {
        ok: false,
        safeError: "malformed_json",
        latencyMs: Date.now() - started,
        model: visionModel,
        rawLength: primary.text?.length ?? 0,
        provenance,
      };
    }

    return {
      ok: true,
      draft,
      model: visionModel,
      fallbackUsed: false,
      latencyMs: Date.now() - started,
      rawLength: primary.text?.length ?? 0,
      provenance,
    };
  }

  // ── TEXT_ONLY path (existing behaviour) ──────────────────────────────
  const system = buildCareSystemPrompt(opts.kind, opts.snapshot);
  const user = buildUserPrompt(opts.kind, opts.snapshot);
  const primary = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: textModel,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
      numCtx: runtime.numCtx,
      endpoint: isLocalOpenAi ? (localEndpoint ?? undefined) : runtime.endpoint,
      localOnly: runtime.localOnly,
    });

  let text = primary.ok ? primary.text : undefined;
  let model = textModel;
  let fallbackUsed = false;
  if (!primary.ok && isOllama && runtime.fallbackModel) {
    const fb = await providerAdapter.compose({
      systemPrompt: system,
      userPrompt: user,
      model: runtime.fallbackModel,
      temperature: runtime.temperature,
      timeoutMs: runtime.timeoutMs,
      numCtx: runtime.numCtx,
      endpoint: runtime.endpoint,
      localOnly: runtime.localOnly,
    });
    if (fb.ok) {
      text = fb.text;
      model = runtime.fallbackModel;
      fallbackUsed = true;
    } else {
      return {
        ok: false,
        safeError: primary.safeError ?? fb.safeError ?? "compose_failed",
        latencyMs: Date.now() - started,
        model: runtime.model,
        fallbackUsed: true,
        provenance: { ...baseProvenance, model: runtime.model, provider: providerName, fallbackUsed: true },
      };
    }
  } else if (!primary.ok) {
    if (opts.allowDeterministicFallback !== false && isOllama) {
      const draft = deterministicComposeFromSnapshot(opts.snapshot, opts.kind);
      return {
        ok: true,
        draft,
        model: "deterministic",
        fallbackUsed: true,
        latencyMs: Date.now() - started,
        safeError: primary.safeError,
        provenance: {
          ...baseProvenance,
          model: "deterministic",
          provider: "deterministic",
          fallbackUsed: true,
          personaVersion: null,
        },
      };
    }
    return {
      ok: false,
      safeError: primary.safeError ?? "compose_failed",
      latencyMs: Date.now() - started,
      model: textModel,
      fallbackUsed: false,
      provenance: { ...baseProvenance, model: textModel, provider: providerName, fallbackUsed: false },
    };
  }

  const draft = parseComposerDraftJson(text ?? "");
  if (!draft) {
    return {
      ok: false,
      safeError: "malformed_json",
      latencyMs: Date.now() - started,
      model,
      fallbackUsed,
      rawLength: text?.length ?? 0,
      provenance: { ...baseProvenance, model, provider: providerName, fallbackUsed },
    };
  }

  if (opts.kind !== "FULL_REPORT" && opts.kind !== "IMPRESSION" && opts.snapshot.selectionText) {
    if (opts.snapshot.selectionField === "FINDINGS") {
      draft.findings = draft.findings || opts.snapshot.selectionText;
      draft.impression = opts.snapshot.impression;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "IMPRESSION") {
      draft.impression = draft.impression || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.recommendation = opts.snapshot.recommendation;
    } else if (opts.snapshot.selectionField === "RECOMMENDATION") {
      draft.recommendation = draft.recommendation || opts.snapshot.selectionText;
      draft.findings = opts.snapshot.findings;
      draft.impression = opts.snapshot.impression;
    }
  }
  if (opts.kind === "IMPRESSION") {
    draft.findings = opts.snapshot.findings;
    if (!draft.recommendation) draft.recommendation = opts.snapshot.recommendation;
  }

  return {
    ok: true,
    draft,
    model,
    fallbackUsed,
    latencyMs: Date.now() - started,
    rawLength: text?.length ?? 0,
    provenance: { ...baseProvenance, model, provider: providerName, fallbackUsed },
  };
}
