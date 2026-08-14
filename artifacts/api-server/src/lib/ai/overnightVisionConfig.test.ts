import { describe, it, expect, beforeEach } from "vitest";
import { resetAiPipelineConfigCache } from "../aiPipeline/config";
import { getOvernightVisionInferenceOptions } from "./overnightVisionConfig";

describe("overnight vision config (canonical registry)", () => {
  beforeEach(() => {
    resetAiPipelineConfigCache();
    delete process.env.AI_MODEL_VISION;
    delete process.env.OLLAMA_NUM_CTX;
    delete process.env.OLLAMA_THINK;
    delete process.env.AI_CONCURRENCY;
    delete process.env.AI_TEMPERATURE_DRAFT;
  });

  it("defaults to qwen3-vl:8b, num_ctx 16384, think false, concurrency 1", () => {
    const v = getOvernightVisionInferenceOptions();
    expect(v.model).toBe("qwen3-vl:8b");
    expect(v.numCtx).toBe(16384);
    expect(v.think).toBe(false);
    expect(v.concurrency).toBe(1);
  });
});
