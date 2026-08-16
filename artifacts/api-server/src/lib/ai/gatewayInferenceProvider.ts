/**
 * Gateway inference provider — Phase P2 / Gate G7 + overnight MRI hardening.
 *
 * Implements the P1 shadow-inference seam by calling the AI Gateway
 * (@workspace/ai-providers requestStructuredReport). Injects the canonical
 * overnight vision options (model / num_ctx / think / endpoint) from
 * resolveLocalAiRuntime() so Test Connection and jobs share one resolution.
 */
import { requestStructuredReport, type GatewayDeps } from "@workspace/ai-providers";
import type { ShadowInferenceProvider, ShadowInferenceInput, ShadowInferenceOutput } from "./shadowInference";
import { getOvernightVisionInferenceOptions } from "./overnightVisionConfig";

const RADIOLOGY_TASK_KEY = "radiology_draft";
const P2_PROMPT_VERSION = "radiology-draft-mri-grounded-v2";

/** Exported for unit tests — overnight MRI grounding rules. */
export function buildRadiologyDraftPrompt(input: ShadowInferenceInput): string {
  const imageCount = input.images?.length ?? 0;
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
    "",
    `Study modality: ${input.modality ?? "unknown"}. ${imageCount} representative image(s) are provided.`,
    "Return ONLY JSON conforming to the provisional-report contract: { studyContext, findings[], measurements[], impression[] }.",
    "Every abnormal finding MUST include an evidence anchor referencing one of the provided image series/SOP UIDs.",
    "Do not invent series/SOP UIDs. If unsure, omit the finding or mark it indeterminate.",
    "Distinguish OBSERVATION (findings[]) from IMPRESSION (impression[]).",
    `Available image anchors: ${JSON.stringify(input.imageAnchors.slice(0, 20))}`,
  ].join("\n");
}

function makeOvernightCall(vision: Awaited<ReturnType<typeof getOvernightVisionInferenceOptions>>): GatewayDeps["call"] {
  return async ({ provider, model, prompt, images }) => {
    const { generateAiResponse } = await import("@workspace/ai-providers");
    // Always pin Ollama overnight drafts to the canonical local chat/vision model.
    const resolvedModel =
      provider === "ollama"
        ? vision.model
        : (model || vision.model);
    const r = await generateAiResponse(provider, prompt, images, {
      model: resolvedModel,
      numCtx: vision.numCtx,
      think: vision.think,
      temperature: vision.temperature,
      maxTokens: 4096,
      endpointUrl: provider === "ollama" ? vision.endpointUrl : undefined,
    });
    return { success: r.success, text: r.text, error: r.error };
  };
}

export const gatewayInferenceProvider: ShadowInferenceProvider = {
  name: "ai-gateway-v1",
  async infer(input: ShadowInferenceInput): Promise<ShadowInferenceOutput> {
    const images = (input.images ?? []).map((i) => i.imageData);
    const vision = await getOvernightVisionInferenceOptions();
    const result = await requestStructuredReport(
      {
        taskKey: RADIOLOGY_TASK_KEY,
        studyInstanceUid: input.studyInstanceUid,
        modality: input.modality,
        prompt: buildRadiologyDraftPrompt(input),
        promptVersion: P2_PROMPT_VERSION,
        images,
        required: { vision: images.length > 0, groundedJson: true },
        // MRI overnight drafts can take several minutes on local 8B VLMs.
        timeoutMs: 10 * 60_000,
        maxAttempts: 2,
      },
      {
        call: makeOvernightCall(vision),
        selectChain: async (taskKey, required, phi) => {
          const { selectProviderChain } = await import("@workspace/ai-providers");
          const chain = await selectProviderChain(taskKey, required, phi);
          if (chain.length === 0) {
            return [{
              provider: "ollama",
              model: vision.model,
              modelDigest: null,
              isLocal: true,
              phiEligible: true,
            }];
          }
          return chain.map((c) =>
            c.provider === "ollama"
              ? { ...c, model: vision.model }
              : c,
          );
        },
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
        detail: `${result.detail}; endpoint=${vision.endpointUrl}; num_ctx=${vision.numCtx}; think=${vision.think}`,
      },
    };
  },
};
