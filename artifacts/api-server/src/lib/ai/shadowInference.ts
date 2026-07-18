/**
 * Shadow inference seam — RESERVED for the AI Gateway (Phase P2 / Gate G7).
 *
 * In P1 there is NO model call and NO gateway. This interface is the single seam
 * the AI Gateway will plug into; the P1 stub produces a well-formed but empty
 * structured draft so the pipeline runs end-to-end in shadow. Nothing else in
 * the pipeline changes when the real provider replaces the stub.
 */
import type { ImageAnchor } from "./studyImageSelection";
import type { EvidenceAnchor } from "./evidence";

/** The structured provisional report a shadow inference yields (JSON-first). */
export interface ShadowStructuredDraft {
  studyContext: { studyInstanceUid: string; modality?: string; imageCount: number };
  findings: Array<{ key: string; text: string; evidence: EvidenceAnchor[] }>;
  measurements: Array<{ id: string; value: number; unit: string }>;
  impression: string[];
}

export interface ShadowInferenceInput {
  studyInstanceUid: string;
  modality?: string;
  imageAnchors: ImageAnchor[];
}

export interface ShadowInferenceProvider {
  readonly name: string;
  infer(input: ShadowInferenceInput): Promise<ShadowStructuredDraft>;
}

/**
 * P1 stub — NO model is called. Emits an empty, well-formed draft so the
 * pipeline completes and stores a manifest + (evidence-ready) draft in shadow.
 * Findings arrive only once the AI Gateway replaces this in P2.
 */
export const shadowStubProvider: ShadowInferenceProvider = {
  name: "shadow-stub-v0",
  async infer(input) {
    return {
      studyContext: {
        studyInstanceUid: input.studyInstanceUid,
        modality: input.modality,
        imageCount: input.imageAnchors.length,
      },
      findings: [], // findings require the AI Gateway (P2) — none produced in shadow P1
      measurements: [],
      impression: [],
    };
  },
};
