/**
 * Regression: overnight / OCR / Local AI / verify must share one resolved
 * endpoint + chat/vision model. Embeddings and Paddle remain separate.
 */
import { describe, expect, test, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
  CANONICAL_EMBEDDING_MODEL,
} from "./canonicalLocalAi";
import { loadAiPipelineConfig, resetAiPipelineConfigCache } from "./config";
import { invalidateLocalAiRuntimeCache, resolveLocalAiRuntime } from "./runtimeConfig";
import { getOvernightVisionInferenceOptions } from "../ai/overnightVisionConfig";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../../..");

describe("canonical Local AI runtime", () => {
  beforeEach(() => {
    resetAiPipelineConfigCache();
    invalidateLocalAiRuntimeCache();
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_PRIMARY_URL;
    delete process.env.OLLAMA_URL;
    delete process.env.AI_MODEL_FAST;
    delete process.env.AI_MODEL_STANDARD;
    delete process.env.AI_MODEL_LARGE;
    delete process.env.AI_MODEL_VISION;
  });

  test("constants match approved production local AI", () => {
    expect(CANONICAL_OLLAMA_ENDPOINT).toBe("http://172.16.1.140:11434");
    expect(CANONICAL_LOCAL_CHAT_VISION_MODEL).toBe("qwen3-vl:8b");
    expect(CANONICAL_EMBEDDING_MODEL).toBe("nomic-embed-text");
  });

  test("env defaults and overnight options share canonical endpoint/model", async () => {
    const env = loadAiPipelineConfig(true);
    expect(env.ollamaBaseUrl).toBe(CANONICAL_OLLAMA_ENDPOINT);
    expect(env.modelFast).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(env.modelStandard).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(env.modelLarge).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(env.modelVision).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);

    const runtime = await resolveLocalAiRuntime(true);
    const overnight = await getOvernightVisionInferenceOptions(true);
    expect(runtime.localChatVisionModel).toBe(CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(overnight.model).toBe(runtime.localChatVisionModel);
    expect(overnight.endpointUrl).toBe(runtime.ollamaBaseUrl);
  });

  test("no active local-inference source still hardcodes gemma3:4b or 192.168.1.250 as defaults", () => {
    const files = [
      "artifacts/api-server/src/lib/aiPipeline/config.ts",
      "artifacts/api-server/src/lib/ai/overnightVisionConfig.ts",
      "artifacts/api-server/src/routes/radiologyOllama.ts",
      "lib/ai-providers/src/index.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      expect(src).not.toMatch(/model\s*[:=]\s*["']gemma3:4b["']/);
      expect(src).not.toMatch(/["']http:\/\/192\.168\.1\.250:11434["']/);
      expect(src).not.toMatch(/OLLAMA_DEFAULT_MODEL.*qwen3:14b| \|\| ["']qwen3:14b["']/);
    }
  });

  test("embeddings helper still uses nomic-embed-text (exception)", () => {
    const src = readFileSync(join(repoRoot, "artifacts/api-server/src/lib/ai/embeddings.ts"), "utf8");
    expect(src).toMatch(/nomic-embed-text/);
  });
});
