import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── An OpenAI-compatible server can answer 200 with no final answer ─────────
// Measured 2026-10-05 with Gemma-4 12B QAT under LM Studio: reasoning went to
// `reasoning_content` (~88 % of the output) while `choices[0].message.content`
// stayed null/empty until max_tokens reached ~420. CARE reads only `content` and
// the Composer sends no max_tokens, so the only safe reading of that response is
// "the provider failed". Chain-of-thought is never a radiology answer.

const createSpy = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createSpy } };
  },
}));
vi.mock("@workspace/db", () => ({ db: {}, aiProviderSettingsTable: {}, aiModelRoutesTable: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

import { openAiCompatibleChat } from "./openAiCompatible";
import { createAiProvider } from "./index";

const REQ = {
  provider: "local_openai_compatible",
  baseURL: "http://127.0.0.1:8080/v1",
  apiKey: "",
  model: "gemma-test",
  userPrompt: "Draft the findings.",
  allowEmptyApiKey: true,
  jsonMode: false,
};

function completion(message: unknown, extra: Record<string, unknown> = {}) {
  return { choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }, ...extra };
}

beforeEach(() => {
  createSpy.mockReset();
});

describe("empty final content fails closed", () => {
  it("1. a normal non-empty answer still succeeds", async () => {
    createSpy.mockResolvedValue(
      completion({ content: "No acute intracranial abnormality." }),
    );
    const r = await openAiCompatibleChat(REQ);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("No acute intracranial abnormality.");
  });

  it("2. content: null is a provider failure, not an empty draft", async () => {
    createSpy.mockResolvedValue(completion({ content: null }));
    const r = await openAiCompatibleChat(REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("empty_final_content");
    expect("text" in r).toBe(false);
  });

  it("3. empty and whitespace-only content both fail", async () => {
    for (const content of ["", "   ", "\n\n  \t "]) {
      createSpy.mockResolvedValue(completion({ content }));
      const r = await openAiCompatibleChat(REQ);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("empty_final_content");
    }
  });

  it("4. reasoning_content with empty content still fails, and reasoning is never returned", async () => {
    createSpy.mockResolvedValue(
      completion({
        content: "",
        reasoning_content:
          "Let me think: the patient has white matter lesions, perhaps I should mention demyelination...",
      }),
    );
    const r = await openAiCompatibleChat(REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("empty_final_content");
    // Nothing resembling the chain of thought escapes the transport.
    expect(JSON.stringify(r)).not.toMatch(/Let me think|demyelination|reasoning/i);
  });

  it("a missing message or a non-string content cannot masquerade as an answer", async () => {
    const cases = [
      completion({}),
      completion(undefined),
      completion({ content: undefined }),
      completion({ content: { findings: "object, not a string" } }),
      completion({ content: ["Not", "a", "string"] }),
      { choices: [], usage: null },
      { usage: null },
    ];
    for (const body of cases) {
      createSpy.mockResolvedValue(body);
      const r = await openAiCompatibleChat(REQ);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("empty_final_content");
    }
  });

  it("keeps token accounting for the failed call", async () => {
    createSpy.mockResolvedValue(completion({ content: "" }));
    const r = await openAiCompatibleChat(REQ);
    if (!r.ok) expect(r.usage).toMatchObject({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });
});

describe("every OpenAI-wire provider behaves the same way", () => {
  const providers: Array<[string, string, string]> = [
    ["deepseek", "sk-test-deepseek", "https://api.deepseek.com"],
    ["qwen", "sk-test-qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ["openai", "sk-test-openai", "https://api.openai.com/v1"],
    ["local_openai_compatible", "", "http://127.0.0.1:8080/v1"],
  ];

  it.each(providers)("%s: empty content is success:false with the safe code", async (name, key, base) => {
    const p = await createAiProvider(name, key || undefined, base);
    expect(p).not.toBeNull();
    createSpy.mockResolvedValue(completion({ content: null }));
    const r = await p!.query({ prompt: "Draft findings", images: [], model: "test-model" });
    expect(r.success).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toBe("empty_final_content");
  });

  it.each(providers)("%s: a real answer still succeeds unchanged", async (name, key, base) => {
    const p = await createAiProvider(name, key || undefined, base);
    createSpy.mockResolvedValue(
      completion({ content: '{"findings":"Normal study.","impression":"Normal."}' }),
    );
    const r = await p!.query({ prompt: "Draft findings", images: [], model: "test-model" });
    expect(r.success).toBe(true);
    expect(r.text).toContain("Normal study.");
  });
});

describe("no chain-of-thought path exists anywhere", () => {
  it("neither the transport nor the composer providers read reasoning_content", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const root = (() => {
      let dir = __dirname;
      for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
        const parent = resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
      }
      throw new Error("pnpm-workspace.yaml not found");
    })();

    const files = [
      "lib/ai-providers/src/openAiCompatible.ts",
      "lib/ai-providers/src/openAiCompatibleProvider.ts",
      "lib/ai-providers/src/index.ts",
      "artifacts/api-server/src/lib/reportComposer/providers/localOpenAiCompatibleComposerAdapter.ts",
      "artifacts/api-server/src/lib/reportComposer/providers/compatibleComposerAdapters.ts",
      "artifacts/api-server/src/lib/reportComposer/composeEngine.ts",
    ];
    const code = (f: string) =>
      readFileSync(join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    const hits = files
      .filter((f) => /reasoning_content|reasoningContent/.test(code(f)))
      .map((f) => f);
    expect(hits).toEqual([]);
  });
});
