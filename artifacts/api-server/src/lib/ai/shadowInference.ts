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
  /**
   * Why the draft has no content, named. Deliberately separate from
   * `resourceFailureCode`, which drives model unload, image-count recovery and
   * the overnight pause streak: this field only informs the radiologist, so a
   * name can never change what the runner does with the job.
   */
  failureCode?: string | null;
  failureDetail?: string | null;
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
  /**
   * A named human authorised THESE pixels to leave the clinic on THIS request.
   *
   * Required for any cloud image arm, and unsettable by an unattended caller:
   * the scheduled shadow tick and the admin pipeline self-test both run with no
   * clinician in the loop, so they cannot fill it and are local-only. The
   * overnight admin flag says cloud vision is permitted for the clinic; it cannot
   * say this patient's images were put in front of that provider deliberately,
   * which is why Stage 1 does not treat it as sufficient (PR-A).
   */
  imageConsent?: { attestedBy: string; attestedAt: string } | null;
  /**
   * Which durable job asked for this inference (`ai_shadow_job:4182`,
   * `self_test:<iso>`), so the image-send audit row can be tied back to the work
   * that produced it instead of to an unattributable provider call.
   */
  jobReference?: string | null;
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
