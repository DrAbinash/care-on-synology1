/**
 * Composer transport hardening — two contracts the cloud lanes inherit from
 * the Ollama lane (PR #1131):
 *
 * 1. NO silent SDK retries. The OpenAI SDK defaults to maxRetries: 2 — a
 *    failing call holds a composer job for ~3x the configured budget (each
 *    retry is a full timeout window) and no layer above can see or cancel
 *    the retries. The transport must pin maxRetries: 0; a retry, when wanted,
 *    is the engine's fallback-ladder decision, never the SDK's.
 *
 * 2. PHI-safe failure codes ONLY. The old catch embedded up to 80 chars of
 *    vendor error text into safeError, which jobService persists
 *    (ai_report_compose_jobs.safeError) and the UI shows. An endpoint's error
 *    body can echo request content — clinical text. Only reason codes
 *    (http_XXX / model_not_found / timeout / network) may leave the transport,
 *    the same contract ComposerProviderError established for the Ollama lane.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const constructorOpts: Array<Record<string, unknown>> = [];

vi.mock("openai", () => ({
  default: class {
    constructor(opts: Record<string, unknown>) {
      constructorOpts.push(opts);
    }
    chat = {
      completions: {
        create: (...args: unknown[]) => createMock(...args),
      },
    };
  },
}));

import { openAiCompatibleChat } from "./openAiCompatible";

const REQ = {
  provider: "qwen",
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  apiKey: "sk-test-secret",
  model: "qwen3.7-plus",
  userPrompt: "Disc desiccation at L3-4 with moderate narrowing.",
  timeoutMs: 45_000,
} as const;

afterEach(() => {
  createMock.mockReset();
  constructorOpts.length = 0;
});

describe("openAiCompatibleChat — no silent SDK retries", () => {
  it("pins maxRetries: 0 — the SDK default of 2 would hold a failing call ~3x the budget", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(true);
    expect(constructorOpts).toHaveLength(1);
    expect(constructorOpts[0]?.maxRetries).toBe(0);
    expect(constructorOpts[0]?.timeout).toBe(45_000);
  });
});

describe("openAiCompatibleChat — PHI-safe failure codes", () => {
  it("classifies an HTTP failure by status and echoes none of the vendor's message", async () => {
    createMock.mockRejectedValue(
      Object.assign(
        new Error(
          "429 Too Many Requests: quota exceeded — your prompt 'Disc desiccation at L3-4' was rejected",
        ),
        { status: 429 },
      ),
    );

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("qwen_request_failed:http_429");
  });

  it("names a missing model, not a generic failure, on 404", async () => {
    createMock.mockRejectedValue(Object.assign(new Error("Model not found"), { status: 404 }));

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("qwen_request_failed:model_not_found");
  });

  it("names a timeout when the SDK gives up inside the budget", async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }),
    );

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("qwen_request_failed:timeout");
  });

  it("names a network failure when no status and no timeout shape is available", async () => {
    createMock.mockRejectedValue(new Error("fetch failed"));

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("qwen_request_failed:network");
  });

  it("puts no prompt text, model answer or API key in any failure surface", async () => {
    createMock.mockRejectedValue(
      Object.assign(
        new Error("Invalid request: Disc desiccation at L3-4 — key sk-test-secret rejected"),
        { status: 400 },
      ),
    );

    const r = await openAiCompatibleChat({ ...REQ });

    expect(r.ok).toBe(false);
    const hay = JSON.stringify(r);
    expect(hay).not.toContain("Disc desiccation");
    expect(hay).not.toContain("sk-test-secret");
  });
});
