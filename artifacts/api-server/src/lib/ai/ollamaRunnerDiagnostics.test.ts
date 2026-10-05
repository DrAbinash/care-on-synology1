import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchOllamaPs, formatPsSummary } from "./ollamaRunnerDiagnostics";

// The clinic runs TWO RTX 3050s (8 GB + 6 GB). Ollama 0.35.0's GET /api/ps has
// no per-accumulator field, so a single VRAM number silently implied "one card"
// and hid which runner sat where. These tests pin the reporting to what the
// server actually tells us: per-runner always, per-device only if reported.

const fetchMock = vi.fn();

function res(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOllamaPs", () => {
  it("keeps every runner's own VRAM and context, so two cards stay separable", async () => {
    fetchMock.mockResolvedValue(
      res({
        models: [
          { name: "qwen3-vl:8b", size: 6e9, size_vram: 5.2e9, context_length: 16384, expires_at: "2026-10-05T12:00:00Z", done: true },
          { name: "qwen3-vl:8b", size: 6e9, size_vram: 4.8e9, options: { num_ctx: 8192 }, expires_at: "2026-10-05T12:01:00Z", done: false },
        ],
      }),
    );
    const ps = await fetchOllamaPs("http://172.16.1.140:11434");
    expect(ps.ok).toBe(true);
    expect(ps.runnerCount).toBe(2);
    expect(ps.runners.map((r) => r.sizeVramBytes)).toEqual([5.2e9, 4.8e9]);
    expect(ps.runners.map((r) => r.contextLength)).toEqual([16384, 8192]);
    expect(ps.totalSizeVramBytes).toBeCloseTo(1e10, -6);
  });

  it("records no device when the server reports none, instead of guessing", async () => {
    fetchMock.mockResolvedValue(res({ models: [{ name: "gemma3:4b", size_vram: 3e6 }] }));
    const ps = await fetchOllamaPs("http://172.16.1.140:11434");
    expect(ps.runners[0].device).toBeNull();
  });

  it("carries a device label through when a server does report one", async () => {
    fetchMock.mockResolvedValue(
      res({
        models: [
          { name: "qwen3-vl:8b", size_vram: 5e9, device: "CUDA 0" },
          { name: "qwen3-vl:8b", size_vram: 4e9, device: "CUDA 1" },
        ],
      }),
    );
    const ps = await fetchOllamaPs("http://172.16.1.140:11434");
    expect(ps.runners.map((r) => r.device)).toEqual(["CUDA 0", "CUDA 1"]);
  });

  it("joins a devices[] list rather than dropping it", async () => {
    fetchMock.mockResolvedValue(res({ models: [{ name: "qwen3:30b", size_vram: 9e9, devices: ["CUDA 0", "CUDA 1"] }] }));
    const ps = await fetchOllamaPs("http://172.16.1.140:11434");
    expect(ps.runners[0].device).toBe("CUDA 0+CUDA 1");
  });

  it("is PHI-free in the summary", async () => {
    fetchMock.mockResolvedValue(
      res({ models: [{ name: "qwen3-vl:8b", size_vram: 5e9, context_length: 4096 }] }),
    );
    const ps = await fetchOllamaPs("http://172.16.1.140:11434");
    const s = formatPsSummary(ps);
    expect(s).not.toMatch(/patient|FINDINGS|base64|MRN|accession/i);
  });
});

describe("formatPsSummary — the aggregate admits what it is", () => {
  const base = {
    capturedAt: new Date().toISOString(),
    ok: true as const,
    httpStatus: 200,
    expiresAt: null,
    done: null,
    sizeBytes: null,
  };

  it("labels a multi-runner total as a sum and says the per-GPU split is absent", () => {
    const s = formatPsSummary({
      ...base,
      runnerCount: 2,
      totalSizeVramBytes: 11e9,
      runners: [
        { ...base, model: "qwen3-vl:8b", sizeVramBytes: 5e9, contextLength: 4096, device: null },
        { ...base, model: "qwen3-vl:8b", sizeVramBytes: 6e9, contextLength: 8192, device: null },
      ],
    } as never);
    expect(s).toContain("sumVramAcrossRunners=10490MiB");
    expect(s).not.toMatch(/totalVram=/);
    expect(s).toContain("no per-GPU split");
    // Both slots remain individually readable.
    expect(s).toContain("ctx=4096");
    expect(s).toContain("ctx=8192");
  });

  it("prints the device per runner when known, and then drops the caveat", () => {
    const s = formatPsSummary({
      ...base,
      runnerCount: 2,
      totalSizeVramBytes: 9e9,
      runners: [
        { ...base, model: "qwen3-vl:8b", sizeVramBytes: 5e9, contextLength: 4096, device: "CUDA 0" },
        { ...base, model: "qwen3:30b", sizeVramBytes: 4e9, contextLength: 8192, device: "CUDA 1" },
      ],
    } as never);
    expect(s).toContain("qwen3-vl:8b[4768MiB,ctx=4096@CUDA 0]");
    expect(s).toContain("qwen3:30b[3815MiB,ctx=8192@CUDA 1]");
    expect(s).not.toContain("no per-GPU split");
  });

  it("adds nothing misleading for a single runner", () => {
    const s = formatPsSummary({
      ...base,
      runnerCount: 1,
      totalSizeVramBytes: 5e9,
      runners: [{ ...base, model: "gemma3:4b", sizeVramBytes: 5e9, contextLength: 4096, device: null }],
    } as never);
    expect(s).toContain("ps=1");
    expect(s).not.toContain("per-GPU");
  });
});
