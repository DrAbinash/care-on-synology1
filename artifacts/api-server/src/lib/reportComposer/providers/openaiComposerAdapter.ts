/**
 * OpenAI Report Composer adapter stub — fail closed (no network).
 */
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
} from "./types";

export class OpenAiComposerAdapter implements ComposerProviderAdapter {
  readonly name = "openai" as const;

  async getCapabilities(_model: string): Promise<ComposerProviderCapabilities> {
    return { text: true, vision: true, local: false };
  }

  async compose(request: ComposerProviderRequest): Promise<ComposerProviderResult> {
    return {
      ok: false,
      provider: "openai",
      model: request.model,
      safeError: "composer_provider_not_configured",
      latencyMs: 0,
    };
  }
}
