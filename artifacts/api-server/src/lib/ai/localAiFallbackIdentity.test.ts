import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyOllamaFallbackIdentity } from "./localAiFallbackIdentity";

// CARE failover (routes/radiologyOllama.ts) tries ollamaFallbackUrl when the
// primary times out. These tests pin down what that actually buys — an
// alternate address for ONE runtime is not redundancy, and the diagnostic must
// say so instead of implying a second server.

const PRIMARY = "http://192.168.1.250:11434";
const FALLBACK = "http://172.16.1.140:11434";

const mockHardenedLocalRequest = vi.fn();

vi.mock("@workspace/ai-providers", () => ({
  hardenedLocalRequest: (url: string, opts: unknown) => mockHardenedLocalRequest(url, opts),
}));

function res(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** One Ollama: same models, same digests, same build. */
function serveIdenticalRuntime() {
  mockHardenedLocalRequest.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/version")) return { response: res({ version: "0.35.0" }) };
    if (url.endsWith("/api/tags")) {
      return {
        response: res({
          models: [
            { name: "qwen3-vl:8b", digest: "sha256:3216286ea8c5" },
            { name: "gemma3:4b", digest: "sha256:3eb7fa8be850" },
          ],
        }),
      };
    }
    return { response: res({}, 404) };
  });
}

beforeEach(() => {
  mockHardenedLocalRequest.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyOllamaFallbackIdentity", () => {
  it("says plainly when there is no fallback at all", async () => {
    const v = await verifyOllamaFallbackIdentity({ primaryUrl: PRIMARY, fallbackUrl: null, localOnly: true });
    expect(v.kind).toBe("not_configured");
    expect(v.independent).toBe(false);
    expect(mockHardenedLocalRequest).not.toHaveBeenCalled();
  });

  it("catches a fallback that is the same address with a different trailing slash", async () => {
    const v = await verifyOllamaFallbackIdentity({
      primaryUrl: PRIMARY,
      fallbackUrl: `${PRIMARY}/`,
      localOnly: true,
    });
    expect(v.kind).toBe("same_address");
    expect(v.independent).toBe(false);
    expect(mockHardenedLocalRequest).not.toHaveBeenCalled();
  });

  it("proves two LAN addresses are ONE runtime when models and digests match", async () => {
    serveIdenticalRuntime();
    const v = await verifyOllamaFallbackIdentity({ primaryUrl: PRIMARY, fallbackUrl: FALLBACK, localOnly: true });
    expect(v.kind).toBe("same_runtime");
    expect(v.independent).toBe(false);
    expect(v.meaning).toContain("two network paths");
    expect(v.primary?.modelCount).toBe(2);
    expect(v.primary?.modelsFingerprint).toBe(v.fallback?.modelsFingerprint);
    expect(v.primary?.version).toBe("0.35.0");
  });

  it("calls it genuine redundancy only when the served sets differ", async () => {
    mockHardenedLocalRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/version")) return { response: res({ version: url.includes("172.16") ? "0.34.2" : "0.35.0" }) };
      if (url.endsWith("/api/tags")) {
        const models = url.includes("172.16")
          ? [{ name: "other-model", digest: "sha256:eeee" }]
          : [{ name: "qwen3-vl:8b", digest: "sha256:3216286ea8c5" }];
        return { response: res({ models }) };
      }
      return { response: res({}, 404) };
    });
    const v = await verifyOllamaFallbackIdentity({ primaryUrl: PRIMARY, fallbackUrl: FALLBACK, localOnly: true });
    expect(v.kind).toBe("separate_runtime");
    expect(v.independent).toBe(true);
  });

  it("is inconclusive rather than optimistic when the fallback is down", async () => {
    mockHardenedLocalRequest.mockImplementation(async (url: string) => {
      if (url.includes("172.16")) throw new TypeError("fetch failed");
      return url.endsWith("/api/version") ? { response: res({ version: "0.35.0" }) } : { response: res({ models: [] }) };
    });
    const v = await verifyOllamaFallbackIdentity({ primaryUrl: PRIMARY, fallbackUrl: FALLBACK, localOnly: true });
    expect(v.kind).toBe("unverified");
    expect(v.independent).toBe(false);
    expect(v.fallback?.reachable).toBe(false);
  });

  it("withholds a verdict when a server gives names but no digests", async () => {
    mockHardenedLocalRequest.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/version")) return { response: res({ version: "0.35.0" }) };
      return { response: res({ models: [{ name: "qwen3-vl:8b" }] }) };
    });
    const v = await verifyOllamaFallbackIdentity({ primaryUrl: PRIMARY, fallbackUrl: FALLBACK, localOnly: true });
    expect(v.kind).toBe("unverified");
    expect(v.meaning).toContain("digests");
  });

  it("never fetches an address the SSRF guard rejects", async () => {
    const v = await verifyOllamaFallbackIdentity({
      primaryUrl: PRIMARY,
      fallbackUrl: "http://169.254.169.254:11434",
      localOnly: true,
    });
    expect(v.kind).toBe("unverified");
    expect(v.independent).toBe(false);
    expect(mockHardenedLocalRequest).not.toHaveBeenCalled();
  });

  it("refuses a public target unless the clinic allows it, so this probe cannot pivot", async () => {
    const v = await verifyOllamaFallbackIdentity({
      primaryUrl: "http://example.com:11434",
      fallbackUrl: FALLBACK,
      localOnly: false,
    });
    expect(v.kind).toBe("unverified");
    expect(mockHardenedLocalRequest).not.toHaveBeenCalled();
  });
});
