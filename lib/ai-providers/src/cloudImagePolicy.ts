/**
 * Central cloud image egress policy for @workspace/ai-providers.
 * DEFAULT = DENY for all non-local providers. Explicit trial opt-in required.
 */
export type CloudImageEgressInput = {
  provider: string;
  imageCount: number;
  /** Explicit clinic/trial flag — must be true for ANY cloud image egress. */
  cloudVisionAllowed?: boolean;
  /** Model must be vision-capable when images present. */
  modelSupportsVision?: boolean;
};

export type CloudImageEgressResult =
  | { ok: true }
  | { ok: false; errorCode: string; error: string };

export function assertCloudImageEgress(input: CloudImageEgressInput): CloudImageEgressResult {
  if (input.imageCount <= 0) return { ok: true };
  if (input.provider === "ollama") return { ok: true };

  if (input.cloudVisionAllowed !== true) {
    return {
      ok: false,
      errorCode: "PHI_IMAGE_CLOUD_BLOCKED",
      error: "Clinical images cannot be sent to cloud AI providers without explicit cloudVisionAllowed.",
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
