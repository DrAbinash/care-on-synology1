/**
 * Gateway inference provider — Phase P2 / Gate G7.
 *
 * Implements the P1 shadow-inference seam by calling the AI Gateway
 * (@workspace/ai-providers requestStructuredReport). This is what replaces the
 * P1 stub in the registered pipeline handler — the model call, routing, and
 * resilience all live in the gateway; this file only bridges its result into the
 * pipeline's draft + provenance shape. Still SHADOW: results are stored, never shown.
 */
import { requestStructuredReport } from "@workspace/ai-providers";
import type { ShadowInferenceProvider, ShadowInferenceInput, ShadowInferenceOutput } from "./shadowInference";

// Reuses the existing routable task key (AI_TASK_CATALOG in lib/ai-providers).
const RADIOLOGY_TASK_KEY = "radiology_draft";
// Until the Prompt Registry (aiPromptLibraryVersions) is wired to per-region
// prompts in a later phase, the pipeline uses a single pinned prompt version.
const P2_PROMPT_VERSION = "radiology-draft-p2-v1";

function buildPrompt(input: ShadowInferenceInput): string {
  return [
    "You are a radiology reporting assistant producing a STRUCTURED provisional report.",
    `Study modality: ${input.modality ?? "unknown"}. ${input.images?.length ?? 0} representative images are provided.`,
    "Return ONLY JSON conforming to the provisional-report contract: { studyContext, findings[], measurements[], impression[] }.",
    "Every finding MUST include an evidence anchor referencing one of the provided image series/SOP UIDs.",
    "Do not invent series/SOP UIDs. If unsure, omit the finding.",
    `Available image anchors: ${JSON.stringify(input.imageAnchors.slice(0, 20))}`,
  ].join("\n");
}

export const gatewayInferenceProvider: ShadowInferenceProvider = {
  name: "ai-gateway-v1",
  async infer(input: ShadowInferenceInput): Promise<ShadowInferenceOutput> {
    const images = (input.images ?? []).map((i) => i.imageData);
    const result = await requestStructuredReport({
      taskKey: RADIOLOGY_TASK_KEY,
      studyInstanceUid: input.studyInstanceUid,
      modality: input.modality,
      prompt: buildPrompt(input),
      promptVersion: P2_PROMPT_VERSION,
      images,
      required: { vision: images.length > 0, groundedJson: true },
    });

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
        modelVersion: result.model ? `${result.model}` : "ai-gateway",
        modelDigest: result.modelDigest,
        provider: result.provider,
        degraded: result.degraded,
        detail: result.detail,
      },
    };
  },
};
