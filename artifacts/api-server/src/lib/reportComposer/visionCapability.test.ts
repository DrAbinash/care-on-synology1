import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetVisionCapabilityCacheForTests,
  assertVisionCapableModel,
} from "./visionCapability";

afterEach(() => {
  __resetVisionCapabilityCacheForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("assertVisionCapableModel", () => {
  it("positively classifies qwen3-vl:8b via known name when /api/show is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "qwen3-vl:8b" }] }),
          };
        }
        if (url.includes("/api/show")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3-vl:8b",
    });
    expect(r).toEqual({ ok: true, model: "qwen3-vl:8b", source: "known_name" });
  });

  it("accepts when /api/show confirms vision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "custom-vision:latest" }] }),
          };
        }
        if (url.includes("/api/show")) {
          return {
            ok: true,
            json: async () => ({ capabilities: ["completion", "vision"] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "custom-vision:latest",
    });
    expect(r).toEqual({ ok: true, model: "custom-vision:latest", source: "api_show" });
  });

  it("rejects known text-only model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "qwen2.5:14b-instruct" }] }),
          };
        }
        if (url.includes("/api/show")) {
          return {
            ok: true,
            json: async () => ({ capabilities: ["completion"] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:14b-instruct",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("vision_model_required");
  });

  it("rejects unknown model classification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "mystery-model:latest" }] }),
          };
        }
        if (url.includes("/api/show")) {
          return {
            ok: true,
            json: async () => ({ capabilities: ["completion"] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    // show says false (no vision) → vision_model_required; if show null → unverified
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "mystery-model:latest",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["vision_model_required", "vision_capability_unverified"]).toContain(r.safeError);
    }
  });

  it("rejects configured model absent from Ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "other:latest" }] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3-vl:8b",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("vision_model_required");
  });

  it("fails closed on probe timeout for unknown models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "mystery-model:latest" }] }),
          };
        }
        if (url.includes("/api/show")) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "mystery-model:latest",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("vision_capability_unverified");
  });

  it("rejects unknown when /api/show returns no capabilities array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({ models: [{ name: "mystery-model:latest" }] }),
          };
        }
        if (url.includes("/api/show")) {
          return { ok: true, json: async () => ({}) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "mystery-model:latest",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("vision_capability_unverified");
  });
});
