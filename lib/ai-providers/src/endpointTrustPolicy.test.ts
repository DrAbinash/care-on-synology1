/**
 * Endpoint trust policy tests — PROMPT 8.
 *
 * These tests prove that "configured ≠ approved for PHI":
 *
 *   1. Cloud providers are always UNTRUSTED regardless of URL
 *   2. Local providers with private URLs are LOCAL_TRUSTED
 *   3. Local providers with public URLs are UNTRUSTED (reclassified as cloud)
 *   4. Local providers with no URL are UNTRUSTED (not configured)
 *   5. Cloud metadata endpoints are UNTRUSTED
 *   6. The trust decision is derived from locality + reachability
 */
import { describe, expect, it } from "vitest";
import {
  classifyEndpointTrust,
  isEndpointTrustedForPhi,
} from "./endpointTrustPolicy";

// ─── Cloud providers: always UNTRUSTED ────────────────────────────────────────

describe("classifyEndpointTrust — cloud providers", () => {
  it("openai with official URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("openai", "https://api.openai.com/v1");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("deepseek with official URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("deepseek", "https://api.deepseek.com");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("qwen with official URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("gemini with official URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("gemini", "https://generativelanguage.googleapis.com");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("anthropic with official URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("anthropic", "https://api.anthropic.com");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("openai pointed at localhost is still UNTRUSTED (cloud by registry)", () => {
    const result = classifyEndpointTrust("openai", "http://localhost:8080/v1");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });
});

// ─── Local providers with private URLs: LOCAL_TRUSTED ─────────────────────────

describe("classifyEndpointTrust — local providers with private URLs", () => {
  it("ollama on localhost is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://localhost:11434");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
    expect(result.validatedHost).toBe("localhost");
  });

  it("ollama on 127.0.0.1 is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://127.0.0.1:11434");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
  });

  it("ollama on LAN IP is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://192.168.1.100:11434");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
    expect(result.validatedHost).toBe("192.168.1.100");
  });

  it("local_openai_compatible on LAN IP is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("local_openai_compatible", "http://10.0.0.50:8080/v1");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
  });

  it("ollama on CGNAT range is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://100.64.0.1:11434");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
  });

  it("ollama on IPv6 loopback is LOCAL_TRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://[::1]:11434");
    expect(result.trust).toBe("LOCAL_TRUSTED");
    expect(result.locality).toBe("local");
  });
});

// ─── Local providers with public URLs: UNTRUSTED ──────────────────────────────

describe("classifyEndpointTrust — local providers with public URLs", () => {
  it("local_openai_compatible with public URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("local_openai_compatible", "https://api.openai.com/v1");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
    expect(result.reason).toContain("public internet");
  });

  it("ollama with public URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("ollama", "http://example.com:11434");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });

  it("local_openai_compatible with cloud metadata URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("local_openai_compatible", "http://169.254.169.254/v1");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });
});

// ─── Local providers with no URL: UNTRUSTED ───────────────────────────────────

describe("classifyEndpointTrust — local providers with no URL", () => {
  it("ollama with null URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("ollama", null);
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("local");
    expect(result.reason).toContain("not configured");
  });

  it("local_openai_compatible with empty URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("local_openai_compatible", "");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("local");
  });

  it("local_openai_compatible with whitespace URL is UNTRUSTED", () => {
    const result = classifyEndpointTrust("local_openai_compatible", "   ");
    expect(result.trust).toBe("UNTRUSTED");
  });
});

// ─── isEndpointTrustedForPhi convenience ──────────────────────────────────────

describe("isEndpointTrustedForPhi", () => {
  it("returns true for ollama on localhost", () => {
    expect(isEndpointTrustedForPhi("ollama", "http://localhost:11434")).toBe(true);
  });

  it("returns true for local_openai_compatible on LAN", () => {
    expect(isEndpointTrustedForPhi("local_openai_compatible", "http://192.168.1.50:8080/v1")).toBe(true);
  });

  it("returns false for openai (cloud)", () => {
    expect(isEndpointTrustedForPhi("openai", "https://api.openai.com/v1")).toBe(false);
  });

  it("returns false for local_openai_compatible with public URL", () => {
    expect(isEndpointTrustedForPhi("local_openai_compatible", "https://api.openai.com/v1")).toBe(false);
  });

  it("returns false for ollama with no URL", () => {
    expect(isEndpointTrustedForPhi("ollama", null)).toBe(false);
  });

  it("returns false for cloud metadata endpoint", () => {
    expect(isEndpointTrustedForPhi("ollama", "http://169.254.169.254/")).toBe(false);
  });
});

// ─── Trust classification structure ───────────────────────────────────────────

describe("classifyEndpointTrust — classification structure", () => {
  it("includes validatedHost for valid URLs", () => {
    const result = classifyEndpointTrust("ollama", "http://192.168.1.100:11434");
    expect(result.validatedHost).toBe("192.168.1.100");
  });

  it("includes null validatedHost for null URL", () => {
    const result = classifyEndpointTrust("ollama", null);
    expect(result.validatedHost).toBeNull();
  });

  it("includes non-empty reason for every classification", () => {
    const cases: Array<[string, string | null]> = [
      ["openai", "https://api.openai.com/v1"],
      ["ollama", "http://localhost:11434"],
      ["ollama", null],
      ["local_openai_compatible", "https://api.openai.com/v1"],
    ];
    for (const [provider, url] of cases) {
      const result = classifyEndpointTrust(provider, url);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("includes invalid URL as cloud (fail closed)", () => {
    const result = classifyEndpointTrust("ollama", "not-a-url");
    expect(result.trust).toBe("UNTRUSTED");
    expect(result.locality).toBe("cloud");
  });
});
