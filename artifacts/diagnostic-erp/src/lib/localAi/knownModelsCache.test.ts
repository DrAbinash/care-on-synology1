import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KNOWN_MODELS_CACHE_KEY,
  cacheAgeLabel,
  isKnownModelsCacheFresh,
  mergeDiscoveredModels,
  normalizeEndpointKey,
  readKnownModelsCache,
  writeKnownModelsCache,
} from "./knownModelsCache";

describe("knownModelsCache", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes endpoint keys", () => {
    expect(normalizeEndpointKey("http://172.16.1.140:11434/")).toBe("http://172.16.1.140:11434");
  });

  it("treats cache as fresh within 4h and stale after", () => {
    const now = 1_000_000;
    expect(isKnownModelsCacheFresh({ endpoint: "http://x", models: ["a"], fetchedAt: now - 1000 }, now)).toBe(true);
    expect(
      isKnownModelsCacheFresh({ endpoint: "http://x", models: ["a"], fetchedAt: now - 5 * 60 * 60 * 1000 }, now),
    ).toBe(false);
  });

  it("round-trips cache by endpoint", () => {
    writeKnownModelsCache({
      endpoint: "http://172.16.1.140:11434/",
      models: ["qwen3-vl:8b", "gemma3:12b"],
      fetchedAt: 42,
      preserved: ["cloud/deepseek"],
    });
    const hit = readKnownModelsCache("http://172.16.1.140:11434");
    expect(hit?.models).toEqual(["qwen3-vl:8b", "gemma3:12b"]);
    expect(hit?.preserved).toEqual(["cloud/deepseek"]);
    expect(readKnownModelsCache("http://other:11434")).toBeNull();
    expect(store.has(KNOWN_MODELS_CACHE_KEY)).toBe(true);
  });

  it("preserves configured tags when merging discovery", () => {
    expect(
      mergeDiscoveredModels(["qwen3-vl:8b", "gemma3:12b"], ["gemma3:12b", "cloud/deepseek-v4.1", ""]),
    ).toEqual(["cloud/deepseek-v4.1", "gemma3:12b", "qwen3-vl:8b"]);
  });

  it("formats cache age", () => {
    expect(cacheAgeLabel(0, 30_000)).toBe("just now");
    expect(cacheAgeLabel(0, 10 * 60_000)).toBe("10m ago");
    expect(cacheAgeLabel(0, 3 * 60 * 60_000)).toBe("3h ago");
  });
});
