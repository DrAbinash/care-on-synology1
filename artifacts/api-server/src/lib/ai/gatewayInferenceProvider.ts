/**
 * Gateway inference provider — Phase P2 / Gate G7 + overnight MRI hardening.
 *
 * Implements the P1 shadow-inference seam by calling the AI Gateway
 * (@workspace/ai-providers requestStructuredReport). Injects the canonical
 * overnight vision options (model / num_ctx / think / endpoint) from
 * resolveLocalAiRuntime() + overnight ops so Test Connection / overnight /
 * Production Auto Policy share one resolution.
 *
 * Resource failures (GPU OOM / context budget) are surfaced on provenance —
 * they must NOT become EMPTY/READY via degraded empty drafts.
 */
import { requestStructuredReport, type GatewayDeps } from "@workspace/ai-providers";
import type { ShadowInferenceProvider, ShadowInferenceInput, ShadowInferenceOutput } from "./shadowInference";
import { getOvernightVisionInferenceOptions } from "./overnightVisionConfig";
import { classifyOvernightProviderFailure } from "./productionVisionPolicy";

const RADIOLOGY_TASK_KEY = "radiology_draft";
const P2_PROMPT_VERSION = "radiology-draft-mri-grounded-v2";

/** Exported for unit tests — overnight MRI grounding rules. */
export function buildRadiologyDraftPrompt(input: ShadowInferenceInput & { safeMode?: boolean }): string {
  const imageCount = input.images?.length ?? 0;
  const safeNote = input.safeMode
    ? [
        "",
        "SAFE MODE: Only ONE representative image is supplied.",
        "State clearly that this is a LIMITED REVIEW and does not represent review of the complete MRI examination.",
      ].join("\n")
    : "";
  return [
    "You are a radiology reporting assistant producing a STRUCTURED PROVISIONAL AI DRAFT only.",
    "This is NEVER a final report. A radiologist must review/edit/finalize separately.",
    "",
    "HARD GROUNDING RULES:",
    "1. Use ONLY the supplied study images and any clinical/history text included in this prompt.",
    "2. Do NOT invent patient demographics (age, sex), Study IDs, physician names, institution names, report numbers, or acquisition dates for the report body — even if OCR-like text appears in images.",
    "3. Do NOT invent measurements. If a measurement is not clearly readable on the supplied images, omit it or mark indeterminate.",
    "4. Do NOT claim contrast enhancement unless a supplied series/anchor is explicitly identified as post-contrast. Bright T1 alone is NOT proof of contrast.",
    "5. Do NOT state diffusion restriction unless both DWI and ADC evidence is available among the supplied images/anchors (or an evidence policy explicitly supports it). DWI hyperintensity alone without ADC → indeterminate, not definite restriction.",
    "6. Do NOT invent sequence names solely from appearance if metadata/anchors do not identify them.",
    "7. Do NOT manufacture normal findings for anatomy not adequately demonstrated on the supplied images.",
    "8. Limited screenshots/key images → wording appropriate to a LIMITED REVIEW (state limitations).",
    "9. Unsupported certainty → use 'indeterminate/not assessable on supplied images' rather than fabricating detail.",
    "10. Do NOT add generic recommendations (CSF analysis, oncology referral, neuropsychology, etc.) unless an explicit clinical rule or radiologist input in the prompt requires it.",
    "11. Do NOT claim institutional standards (AIIMS/Apollo/etc.).",
    "12. Do NOT expose chain-of-thought or reasoning. Output JSON only.",
    safeNote,
    "",
    `Study modality: ${input.modality ?? "unknown"}. ${imageCount} representative image(s) are provided.`,
    "Return ONLY JSON conforming to the provisional-report contract: { studyContext, findings[], measurements[], impression[] }.",
    "Every abnormal finding MUST include an evidence anchor referencing one of the provided image series/SOP UIDs.",
    "Do not invent series/SOP UIDs. If unsure, omit the finding or mark it indeterminate.",
    "Distinguish OBSERVATION (findings[]) from IMPRESSION (impression[]).",
    "If the supplied images show no significant abnormality (or only a limited review is possible), still return a non-empty impression[] with a concise reviewable statement such as 'No significant abnormality identified on the supplied images — radiologist review required.' Do NOT invent anatomy-specific normal findings for sequences that were not demonstrated.",
    `Available image anchors: ${JSON.stringify(input.imageAnchors.slice(0, 20))}`,
  ].filter(Boolean).join("\n");
}

function makeOvernightCall(vision: Awaited<ReturnType<typeof getOvernightVisionInferenceOptions>>): GatewayDeps["call"] {
  return async ({ provider, model, prompt, images }) => {
    const { generateAiResponse } = await import("@workspace/ai-providers");
    const resolvedModel =
      provider === "ollama"
        ? vision.model
        : (model || vision.model);
    const r = await generateAiResponse(provider, prompt, images, {
      model: resolvedModel,
      numCtx: vision.numCtx,
      think: vision.think,
      temperature: vision.temperature,
      maxTokens: vision.policy.maxTokens,
      endpointUrl: provider === "ollama" ? vision.endpointUrl : undefined,
      timeoutMs: vision.policy.timeoutMs,
    });
    return {
      success: r.success,
      text: r.text,
      error: r.error,
      // Extra fields ignored by GatewayDeps typing but useful if call is customized.
      diagnostics: r.diagnostics,
    } as { success: boolean; text: string; error?: string };
  };
}

export const gatewayInferenceProvider: ShadowInferenceProvider = {
  name: "ai-gateway-v1",
  async infer(input: ShadowInferenceInput): Promise<ShadowInferenceOutput> {
    const images = (input.images ?? []).map((i) => i.imageData);
    const vision = await getOvernightVisionInferenceOptions();
    let lastError: string | undefined;
    let lastDiag: {
      errorCode?: string | null;
      httpStatus?: number | null;
      elapsedMs?: number | null;
      responseLength?: number | null;
    } | null = null;

    // Direct call so we can classify GPU/context failures before gateway degrades to empty.
    const { generateAiResponse } = await import("@workspace/ai-providers");
    const prompt = buildRadiologyDraftPrompt({ ...input, safeMode: vision.policy.safeMode });
    const direct = await generateAiResponse("ollama", prompt, images, {
      model: vision.model,
      numCtx: vision.numCtx,
      think: vision.think,
      temperature: vision.temperature,
      maxTokens: vision.policy.maxTokens,
      endpointUrl: vision.endpointUrl,
      timeoutMs: vision.policy.timeoutMs,
    });
    lastError = direct.error;
    lastDiag = direct.diagnostics
      ? {
          errorCode: direct.diagnostics.errorCode,
          httpStatus: direct.diagnostics.httpStatus,
          elapsedMs: direct.diagnostics.elapsedMs,
          responseLength: direct.diagnostics.responseLength,
        }
      : null;

    if (!direct.success) {
      const fail = classifyOvernightProviderFailure({
        success: false,
        httpStatus: lastDiag?.httpStatus,
        errorCode: lastDiag?.errorCode,
        errorMessage: lastError,
        responseLength: lastDiag?.responseLength,
      });
      // Do not re-POST identical failing payloads through the gateway retry loop.
      return {
        draft: {
          studyContext: {
            studyInstanceUid: input.studyInstanceUid,
            modality: input.modality,
            imageCount: images.length,
          },
          findings: [],
          measurements: [],
          impression: [],
        },
        provenance: {
          modelVersion: vision.model,
          modelDigest: null,
          provider: "ollama",
          degraded: true,
          detail: fail.detail,
          resourceFailureCode:
            fail.code === "GPU_OUT_OF_MEMORY" || fail.code === "CONTEXT_BUDGET_EXCEEDED"
              ? fail.code
              : fail.code === "PROVIDER_TIMEOUT"
                ? "PROVIDER_TIMEOUT"
                : fail.code === "PROVIDER_HTTP_ERROR"
                  ? "PROVIDER_HTTP_ERROR"
                  : null,
          httpStatus: lastDiag?.httpStatus ?? null,
          elapsedMs: lastDiag?.elapsedMs ?? null,
          requestedImages: images.length,
          selectedImages: images.length,
          numCtx: vision.numCtx,
          recoveredOnce: false,
        },
      };
    }

    // Successful provider text → validate via gateway contract (no second Ollama hit).
    const result = await requestStructuredReport(
      {
        taskKey: RADIOLOGY_TASK_KEY,
        studyInstanceUid: input.studyInstanceUid,
        modality: input.modality,
        prompt,
        promptVersion: P2_PROMPT_VERSION,
        images,
        required: { vision: images.length > 0, structuredJson: true },
        timeoutMs: vision.policy.timeoutMs,
        maxAttempts: 1,
      },
      {
        call: async () => ({ success: true, text: direct.text }),
        selectChain: async () => [
          {
            provider: "ollama",
            model: vision.model,
            modelDigest: null,
            isLocal: true,
            phiEligible: true,
          },
        ],
      },
    );

    return {
      draft: {
        studyContext: result.report.studyContext,
        findings: result.report.findings.map((f) => ({
          key: f.key,
          text: f.text,
          laterality: f.laterality,
          negated: f.negated,
          evidence: f.evidence,
        })),
        measurements: result.report.measurements,
        impression: result.report.impression,
      },
      provenance: {
        modelVersion: result.model ? `${result.model}` : vision.model,
        modelDigest: result.modelDigest,
        provider: result.provider,
        degraded: result.degraded,
        detail: `${result.detail}; endpoint=${vision.endpointUrl}; num_ctx=${vision.numCtx}; think=${vision.think}; safeMode=${vision.policy.safeMode}`,
        resourceFailureCode: null,
        httpStatus: lastDiag?.httpStatus ?? (direct.success ? 200 : null),
        elapsedMs: lastDiag?.elapsedMs ?? null,
        requestedImages: images.length,
        selectedImages: images.length,
        numCtx: vision.numCtx,
        recoveredOnce: false,
      },
    };
  },
};
