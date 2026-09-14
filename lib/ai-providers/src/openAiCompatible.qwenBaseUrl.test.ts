/**
 * Regression: QWEN_BASE_URL (incl. Singapore workspace MaaS) must reach the
 * shared OpenAI-compatible transport verbatim — no second /compatible-mode/v1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
let lastBaseURL: string | null = null;
let lastApiKey: string | null = null;

vi.mock("openai", () => ({
  default: class {
    constructor(opts: { apiKey: string; baseURL: string }) {
      lastBaseURL = opts.baseURL;
      lastApiKey = opts.apiKey;
    }
    chat = {
      completions: {
        create: (...args: unknown[]) => createMock(...args),
      },
    };
  },
}));

import { openAiCompatibleChat, readEnvBaseUrl, COMPATIBLE_PROVIDER_DEFAULTS } from "./openAiCompatible";

const SINGAPORE_BASE =
  "https://ws-cw7cjvg29sr59pb1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

describe("QWEN_BASE_URL → OpenAI-compatible transport", () => {
  const prev = {
    key: process.env.QWEN_API_KEY,
    base: process.env.QWEN_BASE_URL,
    dash: process.env.DASHSCOPE_API_KEY,
  };

  afterEach(() => {
    createMock.mockReset();
    lastBaseURL = null;
    lastApiKey = null;
    if (prev.key === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = prev.key;
    if (prev.base === undefined) delete process.env.QWEN_BASE_URL;
    else process.env.QWEN_BASE_URL = prev.base;
    if (prev.dash === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = prev.dash;
  });

  it("reads Singapore workspace override without appending another /compatible-mode/v1", () => {
    process.env.QWEN_BASE_URL = `${SINGAPORE_BASE}/`;
    expect(readEnvBaseUrl("qwen")).toBe(SINGAPORE_BASE);
    expect(readEnvBaseUrl("qwen")).not.toContain("compatible-mode/v1/compatible-mode");
    expect(COMPATIBLE_PROVIDER_DEFAULTS.qwen?.baseURL).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("passes QWEN_BASE_URL into the shared OpenAI client baseURL (chat path via SDK)", async () => {
    process.env.QWEN_API_KEY = "sk-test-qwen-secret";
    process.env.QWEN_BASE_URL = SINGAPORE_BASE;
    createMock.mockResolvedValue({
      choices: [{ message: { content: "CONNECTED" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const resolvedBase = readEnvBaseUrl("qwen")!;
    const r = await openAiCompatibleChat({
      provider: "qwen",
      baseURL: resolvedBase,
      apiKey: process.env.QWEN_API_KEY!,
      model: "qwen3.7-plus",
      userPrompt: "Reply with exactly the word: CONNECTED",
      jsonMode: false,
      maxTokens: 10,
    });

    expect(r.ok).toBe(true);
    expect(lastBaseURL).toBe(SINGAPORE_BASE);
    // SDK joins /chat/completions onto baseURL — we must not pre-append a second
    // /compatible-mode/v1 or truncate the workspace host.
    expect(lastBaseURL).toBe(
      "https://ws-cw7cjvg29sr59pb1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    );
    expect(lastApiKey).toBe("sk-test-qwen-secret");
    // Error scrubbing path must never echo the key in safeError on success path.
    if (r.ok) expect(JSON.stringify(r)).not.toContain("sk-test-qwen-secret");
  });

  it("accepts DASHSCOPE_API_KEY as optional alias when QWEN_API_KEY unset", async () => {
    delete process.env.QWEN_API_KEY;
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-alias";
    process.env.QWEN_BASE_URL = SINGAPORE_BASE;
    createMock.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: {},
    });

    const { readEnvApiKey } = await import("./openAiCompatible");
    expect(readEnvApiKey("qwen")).toBe("sk-dashscope-alias");
  });
});
