/**
 * Bounded Report Composer provider adapter types.
 * DeepSeek/OpenAI are fail-closed stubs until a later PR enables them.
 */
export type ComposerProviderName = "ollama" | "deepseek" | "openai";

export type ComposerProviderCapabilities = {
  text: boolean;
  vision: boolean;
  local: boolean;
};

export type ComposerProviderImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Raw base64 without data: prefix — process memory only. */
  base64: string;
};

export type ComposerProviderRequest = {
  systemPrompt: string;
  userPrompt: string;
  images?: ComposerProviderImage[];
  model: string;
  temperature: number;
  timeoutMs: number;
  numCtx?: number;
  endpoint?: string;
  localOnly?: boolean;
};

export type ComposerProviderResult =
  | {
      ok: true;
      text: string;
      provider: ComposerProviderName;
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      provider: ComposerProviderName;
      model: string;
      safeError: string;
      latencyMs: number;
    };

export interface ComposerProviderAdapter {
  readonly name: ComposerProviderName;
  getCapabilities(model: string): Promise<ComposerProviderCapabilities>;
  compose(request: ComposerProviderRequest): Promise<ComposerProviderResult>;
}
