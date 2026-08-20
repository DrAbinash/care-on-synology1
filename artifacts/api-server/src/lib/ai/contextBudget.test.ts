import { describe, it, expect } from "vitest";
import {
  classifyContextBudgetCheck,
  estimateVisionPromptTokens,
  maxImagesForContextBudget,
  parseOllamaContextExceeded,
  resolveInteractiveDraftNumCtx,
  PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX,
} from "./contextBudget";
import { deriveSelfTestFinal } from "./aiPipelineSelfTestLogic";
import { buildOllamaChatPayload } from "@workspace/ai-providers";

describe("contextBudget", () => {
  it("proves buildOllamaChatPayload omits num_ctx when not provided (root cause)", () => {
    const body = buildOllamaChatPayload({
      model: "qwen3-vl:8b",
      prompt: "x",
      images: ["aaaa"],
    });
    expect(body.options).toBeUndefined();
  });

  it("proves buildOllamaChatPayload sends options.num_ctx when provided", () => {
    const body = buildOllamaChatPayload({
      model: "qwen3-vl:8b",
      prompt: "x",
      images: ["aaaa"],
      numCtx: 8192,
    });
    expect((body.options as { num_ctx: number }).num_ctx).toBe(8192);
  });

  it("parses live Ollama exceed_context_size_error", () => {
    const err =
      'Ollama /api/chat 400: {"error":"{\\"error\\":{\\"code\\":400,\\"message\\":\\"request (6453 tokens) exceeds the available context size (4096 tokens), try increasing it\\",\\"type\\":\\"exceed_context_size_error\\"}}"}';
    const parsed = parseOllamaContextExceeded(err);
    expect(parsed?.code).toBe("CONTEXT_BUDGET_EXCEEDED");
    expect(parsed?.requestTokens).toBe(6453);
    expect(parsed?.availableContext).toBe(4096);
  });

  it("prefers 8192 for multi-image over configured 16384", () => {
    const r = resolveInteractiveDraftNumCtx({
      configuredNumCtx: 16384,
      imageCount: 6,
    });
    expect(r.requestedNumCtx).toBe(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    expect(r.configuredNumCtx).toBe(16384);
  });

  it("honors OLLAMA_DRAFT_NUM_CTX override", () => {
    const r = resolveInteractiveDraftNumCtx({
      configuredNumCtx: 16384,
      imageCount: 6,
      draftNumCtxOverride: 12288,
    });
    expect(r.requestedNumCtx).toBe(12288);
  });

  it("caps overnight images by context budget (20 would overshoot)", () => {
    const at16k = maxImagesForContextBudget({ numCtx: 16384, hardCap: 20 });
    expect(at16k.maxImages).toBeLessThan(20);
    expect(at16k.maxImages).toBeGreaterThanOrEqual(6);
    const est20 = estimateVisionPromptTokens({ imageCount: 20 });
    expect(est20).toBeGreaterThan(16384);
  });

  it("classifyContextBudgetCheck flags NUM_CTX_NOT_SENT", () => {
    const c = classifyContextBudgetCheck({
      configuredNumCtx: 16384,
      requestedNumCtx: null,
      availableContext: 4096,
      requestTokens: 6453,
    });
    expect(c.ok).toBe(false);
    expect(c.code).toBe("NUM_CTX_NOT_SENT");
  });

  it("deriveSelfTestFinal surfaces CONTEXT_BUDGET_EXCEEDED", () => {
    const r = deriveSelfTestFinal({
      noMri: false,
      directGeneratePass: true,
      directChatPass: true,
      providerOnly1Pass: true,
      providerOnly6Pass: false,
      fullCare1Pass: true,
      fullCare6Pass: false,
      contextProbe8192Pass: true,
      contextProbe16384Pass: true,
      contextBudgetExceeded: true,
    });
    expect(r.final).toBe("PARTIAL");
    expect(r.summary).toMatch(/CONTEXT_BUDGET_EXCEEDED/);
    expect(r.summary).toMatch(/8192/);
  });
});
