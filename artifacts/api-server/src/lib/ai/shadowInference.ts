/**
 * Shadow inference seam — Phase P1 seam, now filled by the AI Gateway (P2 / G7).
 *
 * The single seam the AI Gateway plugs into. In P1 this was a stub with no model;
 * in P2 `gatewayInferenceProvider` implements it over `requestStructuredReport`.
 * The stub remains for tests and as an explicit deterministic fallback. The
 * return now carries INFERENCE PROVENANCE (model version/digest, degraded) so the
 * Processing Manifest can record exactly what produced the draft.
 */
import type { ImageAnchor, SelectedImage } from "./studyImageSelection";
import type { EvidenceAnchor } from "./evidence";

/** The structured provisional report a shadow inference yields (JSON-first). */
export interface ShadowStructuredDraft {
  studyContext: { studyInstanceUid: string; modality?: string; imageCount: number };
  findings: Array<{ key: string; text: string; laterality?: "left" | "right" | "bilateral" | "none"; negated?: boolean; evidence: EvidenceAnchor[] }>;
  measurements: Array<{ id: string; value: number; unit: string }>;
  impression: string[];
}

export interface InferenceProvenance {
  modelVersion: string;
  modelDigest?: string | null;
  provider?: string | null;
  degraded: boolean;
  detail?: string;
  /** When set, overnight must NOT treat this as EMPTY/READY — job fails permanently. */
  resourceFailureCode?: "GPU_OUT_OF_MEMORY" | "CONTEXT_BUDGET_EXCEEDED" | "PROVIDER_TIMEOUT" | "PROVIDER_HTTP_ERROR" | null;
  httpStatus?: number | null;
  elapsedMs?: number | null;
  requestedImages?: number | null;
  selectedImages?: number | null;
  numCtx?: number | null;
  recoveredOnce?: boolean;
}

export interface ShadowInferenceOutput {
  draft: ShadowStructuredDraft;
  provenance: InferenceProvenance;
}

export interface ShadowInferenceInput {
  studyInstanceUid: string;
  modality?: string;
  imageAnchors: ImageAnchor[];
  /** Rendered images (base64) for vision inference — PHI. Absent in the stub. */
  images?: SelectedImage[];
}

export interface ShadowInferenceProvider {
  readonly name: string;
  infer(input: ShadowInferenceInput): Promise<ShadowInferenceOutput>;
}

/**
 * Deterministic stub — NO model is called. Emits an empty, well-formed draft.
 * Used by tests and as the explicit fallback when no gateway/provider is
 * configured. Marked `degraded: false` because it is a deliberate (not failed)
 * empty result.
 */
export const shadowStubProvider: ShadowInferenceProvider = {
  name: "shadow-stub-v0",
  async infer(input) {
    return {
      draft: {
        studyContext: { studyInstanceUid: input.studyInstanceUid, modality: input.modality, imageCount: input.imageAnchors.length },
        findings: [],
        measurements: [],
        impression: [],
      },
      provenance: { modelVersion: "shadow-stub-v0", degraded: false, detail: "stub — no model called" },
    };
  },
};
