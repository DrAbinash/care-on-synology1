/**
 * Ollama Report Composer adapter — preserves native /api/chat + images[] shape.
 * Local domain facade; network stays Ollama-native (not OpenAI-compatible).
 */
import { validateOllamaUrl } from "../../ssrf/ollamaUrlGuard";
import { parseOllamaContextExceeded } from "../../ai/contextBudget";
import { hardenedLocalRequest } from "@workspace/ai-providers";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
  ComposerProviderUsage,
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
        // Carried through to the workspace so the radiologist sees which switch
        // to move rather than a bare error code.
        detail: guard.reason,
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

      // SECURITY: Bind to validated IP and reject redirects for Ollama chat (PHI egress).
      const { response: res } = await hardenedLocalRequest(
        `${endpoint.replace(/\/$/, "")}/api/chat`,
        {
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
              // Without an explicit ceiling Ollama caps the answer at its own
              // default and a long report comes back as half a JSON object.
              ...(request.maxTokens != null ? { num_predict: request.maxTokens } : {}),
            },
            messages: [{ role: "system", content: request.systemPrompt }, userMessage],
          }),
        },
      );

      if (!res.ok) {
        // Ollama answers a too-large request with an explicit
        // exceed_context_size_error. Naming it is the difference between the
        // radiologist seeing "select fewer images" and seeing "ollama_http_400".
        const body = await res.text().catch(() => "");
        const exceeded = parseOllamaContextExceeded(body);
        if (exceeded) {
          return {
            ok: false,
            provider: "ollama",
            model,
            safeError: "composer_context_budget_exceeded",
            detail:
              `The request needs ~${exceeded.requestTokens ?? "more"} tokens but this model context holds `
              + `${exceeded.availableContext ?? "fewer"}. Select fewer key images or shorten the report text; `
              + `if it persists, the vision model's own context is the limit.`,
            latencyMs: Date.now() - started,
            execution,
          };
        }
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
        done_reason?: string;
        eval_count?: number;
        prompt_eval_count?: number;
      };
      const text = json.message?.content ?? json.response ?? "";
      const usage: ComposerProviderUsage = {
        promptTokens: json.prompt_eval_count ?? null,
        completionTokens: json.eval_count ?? null,
        totalTokens:
          json.prompt_eval_count != null && json.eval_count != null
            ? json.prompt_eval_count + json.eval_count
            : null,
        // On-prem inference is not metered; CARE does not invent a cost.
        approximateCostUsd: null,
      };
      if (!text.trim()) {
        return {
          ok: false,
          provider: "ollama",
          model,
          safeError: "empty_model_response",
          latencyMs: Date.now() - started,
          execution,
          usage,
        };
      }
      // A model that stops because it ran out of output room returns valid-looking
      // text that is simply incomplete. Left unsaid, the composer's JSON parser
      // reports `malformed_json` and the radiologist is told the model answered
      // in prose — which is a different fault with a different fix.
      // Refused rather than parsed on a best-effort basis: an answer that stopped
      // at the ceiling may have lost the last paragraph of findings, and a
      // one-off retry is a cheaper mistake than a silently shortened report.
      if (json.done_reason === "length") {
        return {
          ok: false,
          provider: "ollama",
          model,
          safeError: "composer_output_truncated",
          detail:
            `The model reached its output limit part-way through (${json.eval_count ?? "an unknown number"} `
            + `tokens), so nothing was written to your report. Shorten the request — compose one section at a `
            + `time — or route this study to a provider with a larger output limit.`,
          latencyMs: Date.now() - started,
          execution,
          usage,
        };
      }
      return {
        ok: true,
        text,
        provider: "ollama",
        model,
        latencyMs: Date.now() - started,
        execution,
        usage,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ollama_error";
      const exceeded = parseOllamaContextExceeded(msg);
      if (exceeded) {
        return {
          ok: false,
          provider: "ollama",
          model,
          safeError: "composer_context_budget_exceeded",
          detail: "Ollama rejected the request as larger than its context window.",
          latencyMs: Date.now() - started,
          execution,
        };
      }
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
