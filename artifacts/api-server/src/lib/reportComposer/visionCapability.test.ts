import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyOllamaModelVisionByName } from "@workspace/ai-providers";
import {
  __resetVisionCapabilityCacheForTests,
  assertVisionCapableModel,
} from "./visionCapability";

// Production code uses hardenedLocalRequest (DNS-pinned transport) instead of
// bare fetch. Delegate to global.fetch so existing mocks work.
vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    probeOllamaReachable: async (url: string, timeoutMs?: number) => {
      // Delegate to the real implementation but through fetch mock
      const tagsUrl = `${url.replace(/\/$/, "")}/api/tags`;
      try {
        const resp = await globalThis.fetch(tagsUrl);
        if (!resp.ok) return { reachable: false, error: `Ollama server returned ${resp.status}` };
        const data = (await resp.json()) as { models?: Array<{ name: string }> };
        return { reachable: true, models: data.models?.map((m) => m.name) ?? [] };
      } catch (err) {
        return { reachable: false, error: String(err) };
      }
    },
    probeOllamaModelVision: async (url: string, model: string, timeoutMs?: number) => {
      const showUrl = `${url.replace(/\/$/, "")}/api/show`;
      try {
        const resp = await globalThis.fetch(showUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
        if (!resp.ok) return null;
        const data = (await resp.json()) as { capabilities?: string[] };
        return data.capabilities?.includes("vision") ?? null;
      } catch {
        return null;
      }
    },
  };
});

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

  // ── MedGemma 1.5: the model this gate used to refuse ───────────────────────
  // Before `/medgemma/i` existed in the name list, a configured MedGemma tag
  // classified as "unknown", so on any server where /api/show was slow or silent
  // the Composer answered `vision_capability_unverified` and refused to draft
  // from the images — a false negative about a model that genuinely reads CT and
  // MRI. These three cases are the difference between "unrecognised" and
  // "recognised but unproven": the second one is the fix.

  it("accepts a pulled medgemma1.5:4b on the server's own capability report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "medgemma1.5:4b" }] }) };
        }
        if (url.includes("/api/show")) {
          return { ok: true, json: async () => ({ capabilities: ["completion", "vision"] }) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "medgemma1.5:4b",
    });
    expect(r).toEqual({ ok: true, model: "medgemma1.5:4b", source: "api_show" });
  });

  it("still accepts it when /api/show gives no answer, which is what the name list is for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "medgemma1.5:4b" }] }) };
        }
        if (url.includes("/api/show")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "medgemma1.5:4b",
    });
    expect(r).toEqual({ ok: true, model: "medgemma1.5:4b", source: "known_name" });
  });

  it("refuses a medgemma that is not installed and never pulls it to find out", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        asked.push(url);
        if (url.includes("/api/tags")) {
          // The clinic's PC as it stands today: gemma3 and qwen3-vl, no MedGemma.
          return {
            ok: true,
            json: async () => ({ models: [{ name: "gemma3:12b" }, { name: "qwen3-vl:8b" }] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "medgemma1.5:4b",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("vision_model_required");
      // The operator has to decide to download it; CARE names the gap instead.
      expect(r.detail).toContain("medgemma1.5:4b");
      expect(r.detail).toContain("not present");
    }
    // Reading-only proof: nothing in this path asks Ollama to fetch weights.
    expect(asked.some((u) => u.includes("/api/pull"))).toBe(false);
    expect(asked.some((u) => u.includes("/api/generate") || u.includes("/api/chat"))).toBe(false);
  });

  // ── The name table must not overrule the server ────────────────────────────
  // Measured on this machine on 2026-10-20: `POST /api/show {"model":"gemma4:latest"}`
  // answers `capabilities: ["completion","vision","audio","tools","thinking"]`, while
  // CARE's `OLLAMA_TEXT_ONLY_NAME_PATTERNS` contains `/^gemma(?!3)/i`, which matches
  // `gemma4`. This gate read the name FIRST and returned `vision_model_required`
  // without ever asking the server, so Selected-images drafting refused a model the
  // clinic's own Ollama says can see — the exact inversion of this file's own rule
  // ("Prefer Ollama /api/show; fall back to name only for explicitly known vision
  // models") and of `classifyOllamaModelCapability`, where the name table only ever
  // withholds confidence.

  it("admits a model the server reports as vision even when the name table calls it text-only", async () => {
    // The contradiction itself, pinned: if the name list is ever corrected, this
    // case stops being the regression it models and must be moved, not deleted.
    expect(classifyOllamaModelVisionByName("gemma4:latest")).toBe("text-only");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "gemma4:latest" }] }) };
        }
        if (url.includes("/api/show")) {
          return {
            ok: true,
            json: async () => ({ capabilities: ["completion", "vision", "audio", "tools", "thinking"] }),
          };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "gemma4:latest",
    });
    expect(r).toEqual({ ok: true, model: "gemma4:latest", source: "api_show" });
  });

  it("still refuses a text-only name when the server says nothing, because a name decides nothing positively", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "gemma4:latest" }] }) };
        }
        if (url.includes("/api/show")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "gemma4:latest",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("vision_model_required");
  });

  it("still refuses when the server denies vision, whatever the name looks like", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "qwen3-vl:8b" }] }) };
        }
        if (url.includes("/api/show")) {
          return { ok: true, json: async () => ({ capabilities: ["completion"] }) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const r = await assertVisionCapableModel({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3-vl:8b",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("vision_model_required");
      expect(r.detail).toContain("/api/show");
    }
  });
});
