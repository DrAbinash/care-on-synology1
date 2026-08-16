import { describe, it, expect, beforeEach } from "vitest";
import { resetAiPipelineConfigCache } from "../aiPipeline/config";
import { invalidateLocalAiRuntimeCache } from "../aiPipeline/runtimeConfig";
import { getOvernightVisionInferenceOptions } from "./overnightVisionConfig";
import {
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
} from "../aiPipeline/canonicalLocalAi";

describe("overnight vision config (canonical registry)", () => {
  beforeEach(() => {
    resetAiPipelineConfigCache();
    invalidateLocalAiRuntimeCache();
    delete process.env.AI_MODEL_VISION;
    delete process.env.AI_MODEL_STANDARD;
    delete process.env.AI_MODEL_FAST;
    delete process.env.AI_MODEL_LARGE;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_PRIMARY_URL;
    delete process.env.OLLAMA_NUM_CTX;
    delete process.env.OLLAMA_THINK;
    delete process.env.AI_CONCURRENCY;
    delete process.env.AI_TEMPERATURE_DRAFT;
  });

  it("defaults to canonical endpoint + qwen3-vl:8b via resolveLocalAiRuntime", async () => {
    const v = await getOvernightVisionInferenceOptions(true);
    expect(v.model).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(v.endpointUrl).toBe(CANONICAL_OLLAMA_ENDPOINT);
    expect(v.numCtx).toBe(16384);
    expect(v.think).toBe(false);
    expect(v.concurrency).toBe(1);
    expect(v.runtime.localChatVisionModel).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
  });
});
