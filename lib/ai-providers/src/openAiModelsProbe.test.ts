import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// The SDK is stubbed so a chat completion is observable and never real.
const openaiCreate = vi.fn(async (_args: { model: string }) => ({
  choices: [{ message: { content: "CONNECTED" } }],
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

// index.ts imports these at module load; stub so the module loads without a DB.
vi.mock("@workspace/db", () => ({ db: {}, aiProviderSettingsTable: {}, aiModelRoutesTable: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

import {
  probeOpenAiCompatibleModels,
  isLocalOpenAiCompatibleProvider,
} from "./openAiCompatible";
import { createAiProvider } from "./index";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  openaiCreate.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeOpenAiCompatibleModels — GET <baseURL>/models", () => {
  it("reads the OpenAI data[] shape and reports served ids", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "bonsai" }, { id: "qwen3-vl:8b" }] }));
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1");
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual(["bonsai", "qwen3-vl:8b"]);
    expect(r.httpStatus).toBe(200);
    expect(r.error).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v1/models");
  });

  it("also reads a models[]/name server (llama.cpp-style)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: "ggml-model" }] }));
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1/");
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual(["ggml-model"]);
    // Trailing slash must not become //models
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v1/models");
  });

  it("sends NO Authorization header when no key is configured (empty key is valid locally)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1", { apiKey: "" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.signal).toBeTruthy();
  });

  it("sends the saved key as a bearer token when there is one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1", { apiKey: "sekret-key" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sekret-key");
  });

  it("bounds the call with a timeout signal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1", { timeoutMs: 1234 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats 401/403 as reachable-but-gated, not as a dead server", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1");
    expect(r.reachable).toBe(false);
    expect(r.httpStatus).toBe(401);
    expect(r.error).toBe("auth_required (HTTP 401)");
  });

  it("reports a 5xx as an HTTP failure with the status preserved", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1");
    expect(r.reachable).toBe(false);
    expect(r.httpStatus).toBe(503);
    expect(r.error).toBe("HTTP 503");
  });

  it("never throws on a transport failure and never echoes the key", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed connecting to sekret-key-host"));
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1", { apiKey: "sekret-key" });
    expect(r.reachable).toBe(false);
    expect(r.httpStatus).toBeNull();
    expect(r.error).not.toContain("sekret-key");
    expect(r.error!.length).toBeLessThanOrEqual(160);
  });

  it("names a timeout instead of leaving the operator guessing", async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1", { timeoutMs: 2500 });
    expect(r.reachable).toBe(false);
    expect(r.error).toBe("timed_out_after_2500ms");
  });

  it("returns a safe result when the body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    const r = await probeOpenAiCompatibleModels("http://127.0.0.1:8080/v1");
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual([]);
  });

  it("does not touch the network when no endpoint is configured", async () => {
    const r = await probeOpenAiCompatibleModels("   ");
    expect(r).toMatchObject({ reachable: false, httpStatus: null, error: "endpoint_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is only for the OpenAI-wire local provider — Ollama keeps its own probe", () => {
    expect(isLocalOpenAiCompatibleProvider("local_openai_compatible")).toBe(true);
    expect(isLocalOpenAiCompatibleProvider("ollama")).toBe(false);
  });
});

describe("local OpenAI-compatible 'Test connection' is provider-aware", () => {
  const LOCAL_BASE = "http://127.0.0.1:8080/v1";

  it("short-circuits with the /models verdict when the server is down", async () => {
    // No server on port 8080 — hardenedLocalRequest will get connection refused.
    const p = await createAiProvider("local_openai_compatible", "", LOCAL_BASE);
    const r = await p!.testConnection("bonsai");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("/models");
    // No 30-second chat attempt behind a server that never answered.
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns the served model list so Settings can show what the box actually has", async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.endsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "bonsai" }, { id: "other" }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    try {
      const p = await createAiProvider("local_openai_compatible", "", `http://127.0.0.1:${port}/v1`);
      const r = await p!.testConnection("bonsai");
      expect(r.ok).toBe(true);
      expect(r.availableModels).toEqual(["bonsai", "other"]);
      expect(openaiCreate).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it("says so when the requested model is not the one served", async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.endsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "something-else" }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    try {
      const p = await createAiProvider("local_openai_compatible", "", `http://127.0.0.1:${port}/v1`);
      const r = await p!.testConnection("bonsai");
      expect(r.ok).toBe(true);
      expect(r.message).toContain('"bonsai" is not one of them');
    } finally {
      server.close();
    }
  });

  it("still trusts the chat completion when /models is unimplemented (404)", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    try {
      const p = await createAiProvider("local_openai_compatible", "", `http://127.0.0.1:${port}/v1`);
      const r = await p!.testConnection("bonsai");
      expect(openaiCreate).toHaveBeenCalledTimes(1);
      expect(r.ok).toBe(true);
      expect(r.message).toContain("GET /models: HTTP 404");
    } finally {
      server.close();
    }
  });

  it("does not probe /models for a cloud OpenAI-compatible vendor (no extra egress)", async () => {
    const p = await createAiProvider("deepseek", "sk-cloud-key", "https://api.deepseek.com");
    const r = await p!.testConnection("deepseek-v4-pro");
    expect(r.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("leaves the Ollama probe on /api/tags, untouched", async () => {
    // Both /api/tags and /api/chat now go through hardenedLocalRequest (node:http),
    // so we need a real HTTP server that handles both endpoints.
    const server = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/tags")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen3-vl:8b" }] }));
      } else if (req.url?.endsWith("/api/chat")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { content: "CONNECTED" } }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      const p = await createAiProvider("ollama", undefined, `http://127.0.0.1:${port}`);
      const r = await p!.testConnection("qwen3-vl:8b");
      expect(r.ok).toBe(true);
      expect(r.availableModels).toEqual(["qwen3-vl:8b"]);
    } finally {
      server.close();
    }
  });
});
