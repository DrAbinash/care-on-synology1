/**
 * DeepSeek Report Composer adapter stub — fail closed (no network).
 */
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
} from "./types";

export class DeepSeekComposerAdapter implements ComposerProviderAdapter {
  readonly name = "deepseek" as const;

  async getCapabilities(_model: string): Promise<ComposerProviderCapabilities> {
    return { text: true, vision: true, local: false };
  }

  async compose(request: ComposerProviderRequest): Promise<ComposerProviderResult> {
    return {
      ok: false,
      provider: "deepseek",
      model: request.model,
      safeError: "composer_provider_not_configured",
      latencyMs: 0,
    };
  }
}
