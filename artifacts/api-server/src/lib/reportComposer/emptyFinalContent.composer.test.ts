/**
 * An OpenAI-wire provider that answers 200 with an empty final content must not
 * produce a draft — not from the adapter, not through the compose engine, and not
 * as an "empty_output" clinical text that could be reviewed or applied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createSpy = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createSpy } };
  },
}));

const {
  resolveComposerRuntime,
  validateOllamaUrl,
  resolveComposerProvider,
  assertComposerProviderPolicy,
  composeMock,
} = vi.hoisted(() => ({
  resolveComposerRuntime: vi.fn(),
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
  resolveComposerProvider: vi.fn(),
  assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })),
  composeMock: vi.fn(),
}));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({ resolveComposerRuntime }));
vi.mock("../ssrf/ollamaUrlGuard", () => ({ validateOllamaUrl }));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return { ...actual, resolveComposerProvider, assertComposerProviderPolicy };
});
vi.mock("./providers/localOpenAiCompatibleConfig", async () => {
  const actual = await vi.importActual<
    typeof import("./providers/localOpenAiCompatibleConfig")
  >("./providers/localOpenAiCompatibleConfig");
  return {
    ...actual,
    getLocalOpenAiApiKey: vi.fn(async () => ""),
    getLocalOpenAiDefaultModel: vi.fn(async () => "test-vision"),
    getLocalOpenAiBaseUrl: vi.fn(async (ep?: string | null) =>
      (ep ?? "").trim() || "http://127.0.0.1:8080/v1",
    ),
    loadLocalOpenAiSettings: vi.fn(async () => ({
      displayName: "Test server",
      supportsText: true,
      supportsVision: true,
      jsonMode: false,
    })),
    localOpenAiModelSupportsVision: vi.fn(async () => true),
  };
});

import { runReportComposer } from "./composeEngine";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import { validateComposerOutput } from "./validateOutput";
import { LocalOpenAiCompatibleComposerAdapter } from "./providers/localOpenAiCompatibleComposerAdapter";

function snapshot(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    studyType: "MRI Brain Plain",
    findings: "Few punctate T2/FLAIR hyperintense white matter lesions.",
    impression: "Mild chronic small-vessel ischemic changes.",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveComposerRuntime.mockResolvedValue({
    enabled: true,
    endpoint: "http://127.0.0.1:11434",
    endpointSource: "test",
    model: "test-composer",
    fallbackModel: null,
    numCtx: 4096,
    temperature: 0.1,
    timeoutMs: 30_000,
    localOnly: true,
    visionModel: "test-vision",
  });
  validateOllamaUrl.mockReturnValue({ ok: true });
  assertComposerProviderPolicy.mockReturnValue({ ok: true });
});

describe("the real local-compat adapter surfaces the transport failure", () => {
  it("returns ok:false + empty_final_content and no text when content is null", async () => {
    createSpy.mockResolvedValue({
      choices: [{ message: { content: null, reasoning_content: "long private chain of thought" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 300, total_tokens: 310 },
    });
    const adapter = new LocalOpenAiCompatibleComposerAdapter();
    const r = await adapter.compose({
      systemPrompt: "You are a radiologist.",
      userPrompt: "Draft the report.",
      model: "gemma-test",
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected the adapter to fail closed");
    expect(r.safeError).toBe("empty_final_content");
    expect("text" in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/chain of thought/i);
  });

  it("still returns the draft text unchanged when the answer is real", async () => {
    createSpy.mockResolvedValue({
      choices: [{ message: { content: '{"findings":"Normal.","impression":"Normal."}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const adapter = new LocalOpenAiCompatibleComposerAdapter();
    const r = await adapter.compose({
      systemPrompt: "You are a radiologist.",
      userPrompt: "Draft the report.",
      model: "gemma-test",
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("Normal.");
  });
});

describe("the compose engine cannot create a draft from an empty answer", () => {
  it("fails with the provider's code, no draft, and no deterministic substitution", async () => {
    composeMock.mockResolvedValue({
      ok: false,
      provider: "local_openai_compatible",
      model: "test-vision",
      safeError: "empty_final_content",
      latencyMs: 5,
    });
    resolveComposerProvider.mockReturnValue({
      name: "local_openai_compatible",
      getCapabilities: async () => ({ text: true, vision: true, structuredOutput: true, local: true }),
      compose: composeMock,
    });

    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot(),
      // Even where a deterministic fallback is permitted, a provider failure is
      // not an invitation to write text the model never wrote.
      allowDeterministicFallback: true,
      providerOverride: "local_openai_compatible",
      modelOverride: "test-vision",
    });

    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("empty_final_content");
    expect(run.draft).toBeUndefined();
    // No silent substitution: neither the deterministic template draft nor a
    // "fallback used" flag may mask a provider that answered nothing.
    expect(run.fallbackUsed).toBe(false);
    expect(run.model).not.toBe("deterministic");
    expect(run.provenance?.provider).toBe("local_openai_compatible");
    expect(run.provenance?.fallbackUsed).toBe(false);
  });
});

describe("an empty clinical payload is invalid even if it parses", () => {
  it("validateComposerOutput rejects a draft with no findings and no impression", () => {
    const v = validateComposerOutput(
      snapshot(),
      { findings: "   ", impression: "", recommendation: "" } as never,
    );
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("empty_output");
  });
});

describe("the overnight queue does not retry an empty answer forever", () => {
  it("empty_final_content is classified as terminal, like the other config errors", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./jobService.ts", import.meta.url), "utf8");
    expect(src).toContain('run.safeError === "empty_final_content"');
  });
});
