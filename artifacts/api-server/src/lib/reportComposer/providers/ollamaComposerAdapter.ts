/**
 * Ollama Report Composer adapter — preserves native /api/chat + images[] shape.
 * Local domain facade; network stays Ollama-native (not OpenAI-compatible).
 */
import { validateOllamaUrl } from "../../ssrf/ollamaUrlGuard";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
} from "./types";
import { modelCapabilities } from "./modelRegistry";

export class OllamaComposerAdapter implements ComposerProviderAdapter {
  readonly name = "ollama" as const;

  async getCapabilities(model: string): Promise<ComposerProviderCapabilities> {
    return modelCapabilities("ollama", model);
  }

  async compose(request: ComposerProviderRequest): Promise<ComposerProviderResult> {
    const started = Date.now();
    const model = (request.model || "").trim();
    const execution = "LOCAL" as const;
    if (!model) {
      return {
        ok: false,
        provider: "ollama",
        model,
        safeError: "composer_model_not_configured",
        latencyMs: Date.now() - started,
        execution,
      };
    }

    const endpoint = (request.endpoint || "").trim();
    const guard = validateOllamaUrl(endpoint, request.localOnly === true);
    if (!guard.ok) {
      return {
        ok: false,
        provider: "ollama",
        model,
        safeError: "composer_endpoint_blocked",
        latencyMs: Date.now() - started,
        execution,
      };
    }

    try {
      const userMessage: Record<string, unknown> = {
        role: "user",
        content: request.userPrompt,
      };
      if (request.images && request.images.length > 0) {
        userMessage.images = request.images.map((img) => img.base64);
      }

      const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(request.timeoutMs),
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          think: false,
          options: {
            temperature: request.temperature,
            num_ctx: request.numCtx ?? 4096,
          },
          messages: [{ role: "system", content: request.systemPrompt }, userMessage],
        }),
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: "ollama",
          model,
          safeError: `ollama_http_${res.status}`,
          latencyMs: Date.now() - started,
          execution,
        };
      }

      const json = (await res.json()) as {
        message?: { content?: string };
        response?: string;
      };
      const text = json.message?.content ?? json.response ?? "";
      if (!text.trim()) {
        return {
          ok: false,
          provider: "ollama",
          model,
          safeError: "empty_model_response",
          latencyMs: Date.now() - started,
          execution,
        };
      }
      return {
        ok: true,
        text,
        provider: "ollama",
        model,
        latencyMs: Date.now() - started,
        execution,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ollama_error";
      const safeError = /abort|timeout/i.test(msg) ? "ollama_timeout" : "ollama_unreachable";
      return {
        ok: false,
        provider: "ollama",
        model,
        safeError,
        latencyMs: Date.now() - started,
        execution,
      };
    }
  }
}
