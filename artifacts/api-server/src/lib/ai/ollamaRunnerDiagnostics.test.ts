import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// Mock @workspace/ai-providers to avoid the @workspace/db import chain
// (which requires DATABASE_URL). The test uses a real HTTP server on 127.0.0.1,
// so we delegate hardenedLocalRequest to globalThis.fetch.
vi.mock("@workspace/ai-providers", () => ({
  hardenedLocalRequest: async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
  },
}));

import { fetchOllamaPs, formatPsSummary } from "./ollamaRunnerDiagnostics";

// The clinic runs TWO RTX 3050s (8 GB + 6 GB). Ollama 0.35.0's GET /api/ps has
// no per-accumulator field, so a single VRAM number silently implied "one card"
// and hid which runner sat where. These tests pin the reporting to what the
// server actually tells us: per-runner always, per-device only if reported.

let server: http.Server;
let port: number;

beforeEach(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
});

describe("fetchOllamaPs", () => {
  it("keeps every runner's own VRAM and context, so two cards stay separable", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url?.endsWith("/api/ps")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: [
            { name: "qwen3-vl:8b", size: 6e9, size_vram: 5.2e9, context_length: 16384, expires_at: "2026-10-05T12:00:00Z", done: true },
            { name: "qwen3-vl:8b", size: 6e9, size_vram: 4.8e9, options: { num_ctx: 8192 }, expires_at: "2026-10-05T12:01:00Z", done: false },
          ],
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const ps = await fetchOllamaPs(`http://127.0.0.1:${port}`);
    expect(ps.ok).toBe(true);
    expect(ps.runnerCount).toBe(2);
    expect(ps.runners.map((r) => r.sizeVramBytes)).toEqual([5.2e9, 4.8e9]);
    expect(ps.runners.map((r) => r.contextLength)).toEqual([16384, 8192]);
    expect(ps.totalSizeVramBytes).toBeCloseTo(1e10, -6);
  });

  it("records no device when the server reports none, instead of guessing", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url?.endsWith("/api/ps")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "gemma3:4b", size_vram: 3e6 }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const ps = await fetchOllamaPs(`http://127.0.0.1:${port}`);
    expect(ps.runners[0].device).toBeNull();
  });

  it("carries a device label through when a server does report one", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url?.endsWith("/api/ps")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: [
            { name: "qwen3-vl:8b", size_vram: 5e9, device: "CUDA 0" },
            { name: "qwen3-vl:8b", size_vram: 4e9, device: "CUDA 1" },
          ],
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const ps = await fetchOllamaPs(`http://127.0.0.1:${port}`);
    expect(ps.runners.map((r) => r.device)).toEqual(["CUDA 0", "CUDA 1"]);
  });

  it("joins a devices[] list rather than dropping it", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url?.endsWith("/api/ps")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen3:30b", size_vram: 9e9, devices: ["CUDA 0", "CUDA 1"] }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const ps = await fetchOllamaPs(`http://127.0.0.1:${port}`);
    expect(ps.runners[0].device).toBe("CUDA 0+CUDA 1");
  });

  it("is PHI-free in the summary", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url?.endsWith("/api/ps")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen3-vl:8b", size_vram: 5e9, context_length: 4096 }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const ps = await fetchOllamaPs(`http://127.0.0.1:${port}`);
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
