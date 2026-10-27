/**
 * Pre-adapter policy gate for Report Composer domain facade.
 * Ollama + Local OpenAI-Compatible are LOCAL (no cloud vision gate) — BUT only
 * when their resolved URL actually points to a private/LAN address. A
 * "local_openai_compatible" provider pointed at a public URL is reclassified
 * as cloud and subject to all cloud vision / PHI controls.
 * Cloud providers require API keys (DB first, then env — resolved by the caller
 * through `resolveCloudComposerConfig`, because this gate stays synchronous).
 * Cloud vision requires explicit cloudVisionAllowed for ALL cloud vendors.
 */
import {
  isCompatibleProviderConfigured,
  classifyEffectiveLocality,
  OPERATOR_SUPPLIED_IMAGE_SOURCE,
} from "@workspace/ai-providers";
import {
  isCloudComposerProvider,
  isLocalComposerProvider,
  type ComposerProviderName,
  type ComposerProviderImage,
} from "./types";

export type ComposerProviderPolicyInput = {
  provider: ComposerProviderName;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  cloudVisionAllowed?: boolean;
  images?: ComposerProviderImage[];
  imageCount?: number;
  /** When set, Local OpenAI-Compatible is considered configured (endpoint present). */
  localEndpointConfigured?: boolean;
  /**
   * When set, cloud key presence is taken from this — the caller resolved it
   * from `ai_provider_settings` and then env. Omitted callers keep the previous
   * env-only answer, so nothing here silently loosens the gate.
   */
  cloudApiKeyConfigured?: boolean;
  /**
   * Resolved base URL for local providers. When provided, locality is derived
   * from the actual network destination, not the provider name. A "local"
   * provider with a public URL is reclassified as cloud for PHI egress.
   */
  resolvedUrl?: string | null;
  /**
   * One entry per image being sent, from `radiology_report_key_images.source_type`.
   * A short or empty list is read as unverified provenance, not as permission.
   */
  imageSourceTypes?: readonly string[];
  /**
   * Set only where a clinician confirmed THIS request after seeing THESE images.
   * The overnight admin flag does not satisfy it, and a scheduled job can never
   * produce it.
   */
  consentAttestedPerRequest?: boolean;
  /**
   * PR-A2: the caller's resolved AI security policy. Omitted means REQUIRED, so a
   * caller that does not resolve the mode keeps PR-A's behaviour by default; only
   * Development mode passes `false`, and only from `resolveAiSecurityPolicy()`.
   */
  requireAttestation?: boolean;
};

export type ComposerProviderPolicyResult =
  | { ok: true }
  | { ok: false; safeError: string };

export function assertComposerProviderPolicy(
  input: ComposerProviderPolicyInput,
): ComposerProviderPolicyResult {
  const { provider, aiMode } = input;
  const cloudVisionAllowed = input.cloudVisionAllowed === true;
  const imageCount =
    input.images !== undefined ? input.images.length : Number(input.imageCount ?? 0);

  if (provider === "ollama") {
    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    return { ok: true };
  }

  if (isLocalComposerProvider(provider)) {
    // Optional API key is intentionally allowed. Endpoint must be configured
    // (checked via localEndpointConfigured or env at call sites).
    if (input.localEndpointConfigured === false) {
      return { ok: false, safeError: "local_openai_compatible_endpoint_not_configured" };
    }

    // Endpoint-derived locality: a "local_openai_compatible" provider whose
    // resolved URL points to a public internet address is reclassified as
    // cloud for PHI egress purposes. The URL is the ground truth, not the name.
    //
    // SECURITY: A local provider reclassified as cloud is REFUSED for ALL data
    // (text AND images). Clinical text contains patient identifiers (name, DOB,
    // findings, impression) — sending it to a public endpoint is PHI egress.
    // The admin configured this provider thinking it was local; they did NOT
    // explicitly agree to cloud egress. If they want cloud AI, they must
    // configure a proper cloud provider (openai/gemini/anthropic/deepseek).
    if (input.resolvedUrl != null && input.resolvedUrl !== "") {
      const effective = classifyEffectiveLocality(provider, input.resolvedUrl);
      if (effective.locality === "cloud") {
        return { ok: false, safeError: "local_provider_url_points_to_cloud" };
      }
    }

    if (aiMode === "SELECTED_IMAGES" && imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    // Genuinely local (private/LAN URL or no URL resolved) — no cloud gate.
    return { ok: true };
  }

  // Anything else — including gemini and anthropic, which have provider
  // adapters but no composer adapter — is refused rather than assumed local.
  if (!isCloudComposerProvider(provider)) {
    return { ok: false, safeError: "composer_provider_not_configured" };
  }

  const keyConfigured =
    input.cloudApiKeyConfigured ?? isCompatibleProviderConfigured(provider);
  if (!keyConfigured) {
    return { ok: false, safeError: `${provider}_api_key_not_configured` };
  }

  if (aiMode === "SELECTED_IMAGES" || imageCount > 0) {
    if (!cloudVisionAllowed) {
      return { ok: false, safeError: "cloud_vision_not_allowed" };
    }
    if (imageCount <= 0) {
      return { ok: false, safeError: "selected_images_empty" };
    }
    // STAGE 1 PR-A — the clinic flag opens the provider; it does not clear the
    // patient. A Composer request carries key images that belong to whoever is on
    // the table, so cloud egress additionally needs a per-request attestation from
    // a clinician who saw those images — unless the clinic has chosen the
    // Development security mode, where the admin's enablement is itself the decision
    // and a single-user evaluation is not asked to attest its own testing.
    //
    // An unknown source counts as patient-derived. "We cannot say where this came
    // from" is not the same as "it is safe to send".
    const sources = input.imageSourceTypes ?? [];
    const provenanceUnknown = sources.length === 0 || sources.length !== imageCount;
    const patientDerived = sources.some((s) => s !== OPERATOR_SUPPLIED_IMAGE_SOURCE);
    if (
      input.requireAttestation !== false &&
      (patientDerived || provenanceUnknown) &&
      input.consentAttestedPerRequest !== true
    ) {
      return {
        ok: false,
        safeError: patientDerived
          ? "cloud_image_sources_not_attested"
          : "cloud_image_provenance_unverified",
      };
    }
  }

  return { ok: true };
}
