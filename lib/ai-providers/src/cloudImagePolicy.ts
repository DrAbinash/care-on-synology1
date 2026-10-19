/**
 * Central cloud image egress policy for @workspace/ai-providers.
 * DEFAULT = DENY for all non-local providers. Explicit trial opt-in required.
 * Local OpenAI-compatible servers are LOCAL — never gated as cloud — BUT only
 * when their resolved URL actually points to a private/LAN address. A
 * "local_openai_compatible" provider pointed at a public URL is reclassified
 * as cloud and subject to all image egress controls.
 */
import { isLocalExecutionProvider } from "./openAiCompatible";
import { classifyEffectiveLocality } from "./providerLocality";

/**
 * The `radiology_report_key_images.source_type` values that describe a real
 * patient's examination. Anything a radiologist can attach — an uploaded
 * picture, a viewport capture, a frame pulled from Orthanc — is patient-derived
 * pixels, and the clinic's Stage 1 policy is that those pixels stay inside the
 * local AI environment.
 */
export const PATIENT_DERIVED_IMAGE_SOURCES = [
  "UPLOAD",
  "PACS_SCREENSHOT",
  "VIEWPORT_CAPTURE",
  "DICOM",
] as const;

/** The label an operator uses for a phantom or synthetic image they own. */
export const OPERATOR_SUPPLIED_IMAGE_SOURCE = "OPERATOR_SUPPLIED";

export type CloudImageEgressInput = {
  provider: string;
  imageCount: number;
  /** Explicit clinic/trial flag — must be true for ANY cloud image egress. */
  cloudVisionAllowed?: boolean;
  /** Model must be vision-capable when images present. */
  modelSupportsVision?: boolean;
  /**
   * Resolved base URL for the provider. When provided, locality is derived from
   * the actual network destination, not the provider name. A "local" provider
   * with a public URL is reclassified as cloud.
   */
  resolvedUrl?: string | null;
  /**
   * Where each image came from, per `source_type`. Omitting it is treated as
   * patient-derived: an image send that cannot say whose pixels they are does
   * not get the benefit of the doubt.
   */
  imageSourceTypes?: readonly string[];
  /**
   * A person chose THIS request. The admin settings flag says cloud vision is
   * permitted for the clinic; it cannot say that this patient's images were put
   * in front of this provider deliberately, so it is necessary and not
   * sufficient. Only an interactive caller holding an explicit confirmation can
   * attest it — an unattended scheduled job or a self-test cannot.
   */
  consentAttestedPerRequest?: boolean;
};

export type CloudImageEgressResult =
  | { ok: true }
  | { ok: false; errorCode: string; error: string };

export function assertCloudImageEgress(input: CloudImageEgressInput): CloudImageEgressResult {
  if (input.imageCount <= 0) return { ok: true };

  // Endpoint-derived locality: when a resolved URL is available, classify based
  // on the actual destination. Otherwise fall back to name-based classification.
  // The fallback is only ever reached by providers whose adapter pins the
  // connection to a private IP before it is written (`hardenedLocalRequest`),
  // so a public destination cannot slip through it — see the note in
  // `resolvedUrl` above and the transport test in PR-A.
  const isLocal = input.resolvedUrl != null
    ? classifyEffectiveLocality(input.provider, input.resolvedUrl).locality === "local"
    : isLocalExecutionProvider(input.provider);

  if (isLocal) return { ok: true };

  if (input.cloudVisionAllowed !== true) {
    return {
      ok: false,
      errorCode: "PHI_IMAGE_CLOUD_BLOCKED",
      error: "Clinical images cannot be sent to cloud AI providers without explicit cloudVisionAllowed.",
    };
  }

  // Provenance rule: the admin flag opens the provider, not the patient.
  // Unattended image sends (night shadow, pipeline self-test) and any send that
  // cannot name its image source are refused for cloud even with the flag on.
  const sources = input.imageSourceTypes ?? [];
  const provenanceUnknown = sources.length === 0 || sources.length !== input.imageCount;
  const patientDerived = sources.some(
    (s) => s !== OPERATOR_SUPPLIED_IMAGE_SOURCE,
  );
  if ((patientDerived || provenanceUnknown) && input.consentAttestedPerRequest !== true) {
    return {
      ok: false,
      errorCode: "PHI_IMAGE_CLOUD_UNATTESTED",
      error:
        patientDerived
          ? `Patient-derived images (${sources.join(", ") || "unknown source"}) may not be sent to ${input.provider}. Stage 1 image interpretation is local-only; cloud vision requires a per-request attestation from the clinician who chose this request.`
          : `Image count (${sources.length} named) does not match the ${input.imageCount} images being sent, so provenance is unverified and cloud egress is refused.`,
    };
  }

  if (input.modelSupportsVision === false) {
    return {
      ok: false,
      errorCode: "MODEL_NOT_VISION_CAPABLE",
      error: "Selected cloud model does not support vision.",
    };
  }
  return { ok: true };
}

