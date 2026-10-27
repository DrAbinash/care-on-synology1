/**
 * Provider locality classification — endpoint-derived, not name-based.
 *
 * SECURITY INVARIANT: Provider locality is derived from the effective validated
 * network destination. Never classify a provider as local solely because its
 * registry key or adapter name contains "local". The URL is the ground truth.
 *
 * These tests pin the classifier that backs every PHI egress gate. A regression
 * here means clinical text or images can leave the clinic unchecked.
 */
import { describe, it, expect } from "vitest";
import {
  classifyEffectiveLocality,
  isEffectivelyLocal,
  isHostPrivateOrLan,
  isHostCloudMetadata,
  canonicalHostsForLocality,
} from "./providerLocality";

// ─── canonicalHostsForLocality ──────────────────────────────────────────────

describe("canonicalHostsForLocality", () => {
  it("returns the raw host, de-bracketed, and trailing-dot-stripped forms", () => {
    const hosts = canonicalHostsForLocality("localhost.");
    expect(hosts).toContain("localhost.");
    expect(hosts).toContain("localhost");
  });

  it("de-brackets IPv6 addresses", () => {
    const hosts = canonicalHostsForLocality("[::1]");
    expect(hosts).toContain("::1");
  });

  it("extracts the embedded IPv4 from IPv4-mapped IPv6", () => {
    const hosts = canonicalHostsForLocality("::ffff:127.0.0.1");
    expect(hosts).toContain("127.0.0.1");
  });

  it("extracts the embedded IPv4 from hex-form IPv4-mapped IPv6", () => {
    // ::ffff:7f00:1 -> 127.0.0.1
    const hosts = canonicalHostsForLocality("::ffff:7f00:1");
    expect(hosts).toContain("127.0.0.1");
  });
});

// ─── isHostPrivateOrLan ─────────────────────────────────────────────────────

describe("isHostPrivateOrLan", () => {
  it("matches localhost", () => {
    expect(isHostPrivateOrLan("localhost")).toBe(true);
  });

  it("matches 127.0.0.1", () => {
    expect(isHostPrivateOrLan("127.0.0.1")).toBe(true);
  });

  it("matches any 127.x.x.x", () => {
    expect(isHostPrivateOrLan("127.0.0.2")).toBe(true);
    expect(isHostPrivateOrLan("127.255.255.255")).toBe(true);
  });

  it("matches 10.x.x.x (Class A private)", () => {
    expect(isHostPrivateOrLan("10.0.0.1")).toBe(true);
    expect(isHostPrivateOrLan("10.255.255.255")).toBe(true);
  });

  it("matches 172.16-31.x.x (Class B private)", () => {
    expect(isHostPrivateOrLan("172.16.0.1")).toBe(true);
    expect(isHostPrivateOrLan("172.31.255.255")).toBe(true);
    expect(isHostPrivateOrLan("172.20.10.5")).toBe(true);
  });

  it("does NOT match 172.15.x.x or 172.32.x.x (outside private range)", () => {
    expect(isHostPrivateOrLan("172.15.255.255")).toBe(false);
    expect(isHostPrivateOrLan("172.32.0.1")).toBe(false);
  });

  it("matches 192.168.x.x", () => {
    expect(isHostPrivateOrLan("192.168.1.1")).toBe(true);
    expect(isHostPrivateOrLan("192.168.0.100")).toBe(true);
  });

  it("matches 169.254.x.x (link-local)", () => {
    expect(isHostPrivateOrLan("169.254.1.1")).toBe(true);
  });

  it("matches CGNAT range 100.64-127.x.x", () => {
    expect(isHostPrivateOrLan("100.64.0.1")).toBe(true);
    expect(isHostPrivateOrLan("100.127.255.255")).toBe(true);
    expect(isHostPrivateOrLan("100.100.50.25")).toBe(true);
  });

  it("does NOT match 100.63.x.x or 100.128.x.x (outside CGNAT)", () => {
    expect(isHostPrivateOrLan("100.63.255.255")).toBe(false);
    expect(isHostPrivateOrLan("100.128.0.1")).toBe(false);
  });

  it("matches IPv6 loopback ::1", () => {
    expect(isHostPrivateOrLan("::1")).toBe(true);
  });

  it("matches IPv6 link-local fe80::", () => {
    expect(isHostPrivateOrLan("fe80::1")).toBe(true);
  });

  it("matches IPv6 unique-local fc00::/7", () => {
    expect(isHostPrivateOrLan("fc00::1")).toBe(true);
    expect(isHostPrivateOrLan("fd00::1")).toBe(true);
  });

  it("does NOT match public DNS (8.8.8.8)", () => {
    expect(isHostPrivateOrLan("8.8.8.8")).toBe(false);
  });

  it("does NOT match public hosts (api.openai.com)", () => {
    expect(isHostPrivateOrLan("api.openai.com")).toBe(false);
  });

  it("matches trailing-dot localhost.", () => {
    expect(isHostPrivateOrLan("localhost.")).toBe(true);
  });

  it("matches IPv4-mapped IPv6 for loopback", () => {
    expect(isHostPrivateOrLan("::ffff:127.0.0.1")).toBe(true);
  });
});

// ─── isHostCloudMetadata ────────────────────────────────────────────────────

describe("isHostCloudMetadata", () => {
  it("matches 169.254.169.254 (AWS/GCP/Azure metadata)", () => {
    expect(isHostCloudMetadata("169.254.169.254")).toBe(true);
  });

  it("matches metadata.google.internal", () => {
    expect(isHostCloudMetadata("metadata.google.internal")).toBe(true);
  });

  it("matches metadata.internal", () => {
    expect(isHostCloudMetadata("metadata.internal")).toBe(true);
  });

  it("does NOT match regular 169.254.x.x (link-local but not metadata)", () => {
    expect(isHostCloudMetadata("169.254.1.1")).toBe(false);
  });

  it("does NOT match public hosts", () => {
    expect(isHostCloudMetadata("api.openai.com")).toBe(false);
  });
});

// ─── classifyEffectiveLocality ──────────────────────────────────────────────

describe("classifyEffectiveLocality", () => {
  // Cloud-named providers are ALWAYS cloud, regardless of URL.
  describe("cloud-named providers", () => {
    for (const provider of ["openai", "deepseek", "qwen", "gemini", "anthropic"]) {
      it(`${provider} with localhost URL is still classified as cloud`, () => {
        const r = classifyEffectiveLocality(provider, "http://localhost:8080");
        expect(r.locality).toBe("cloud");
      });

      it(`${provider} with null URL is still classified as cloud`, () => {
        const r = classifyEffectiveLocality(provider, null);
        expect(r.locality).toBe("cloud");
      });

      it(`${provider} with public URL is classified as cloud`, () => {
        const r = classifyEffectiveLocality(provider, "https://api.openai.com/v1");
        expect(r.locality).toBe("cloud");
      });
    }
  });

  // Local-named providers: the URL is the ground truth.
  describe("local_openai_compatible — genuinely local URLs", () => {
    it("localhost -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://localhost:8080");
      expect(r.locality).toBe("local");
      expect(r.validatedHost).toBe("localhost");
    });

    it("127.0.0.1 -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://127.0.0.1:1234");
      expect(r.locality).toBe("local");
    });

    it("10.x LAN address -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://10.0.1.50:8080");
      expect(r.locality).toBe("local");
    });

    it("192.168.x address -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://192.168.1.100:8080");
      expect(r.locality).toBe("local");
    });

    it("172.16.x address -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://172.16.0.5:8080");
      expect(r.locality).toBe("local");
    });

    it("CGNAT (Tailscale) address -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://100.100.50.25:8080");
      expect(r.locality).toBe("local");
    });

    it("IPv6 loopback -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://[::1]:8080");
      expect(r.locality).toBe("local");
    });

    it("IPv4-mapped IPv6 loopback -> local", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://[::ffff:127.0.0.1]:8080");
      expect(r.locality).toBe("local");
    });
  });

  describe("local_openai_compatible — public URLs (reclassified as cloud)", () => {
    it("api.openai.com -> cloud", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "https://api.openai.com/v1");
      expect(r.locality).toBe("cloud");
      expect(r.validatedHost).toBe("api.openai.com");
      expect(r.reason).toContain("public internet");
    });

    it("api.deepseek.com -> cloud", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "https://api.deepseek.com");
      expect(r.locality).toBe("cloud");
    });

    it("dashscope.aliyuncs.com (Qwen) -> cloud", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "https://dashscope.aliyuncs.com");
      expect(r.locality).toBe("cloud");
    });

    it("8.8.8.8 (public IP) -> cloud", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://8.8.8.8:8080");
      expect(r.locality).toBe("cloud");
    });

    it("external-ai-provider.example -> cloud", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "https://external-ai-provider.example");
      expect(r.locality).toBe("cloud");
    });
  });

  describe("local_openai_compatible — cloud metadata endpoints", () => {
    it("169.254.169.254 -> cloud (never local)", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://169.254.169.254/latest/meta-data");
      expect(r.locality).toBe("cloud");
      expect(r.reason).toContain("metadata");
    });

    it("metadata.google.internal -> cloud (never local)", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "http://metadata.google.internal");
      expect(r.locality).toBe("cloud");
    });
  });

  describe("local_openai_compatible — edge cases", () => {
    it("null URL -> local (not configured; adapter will refuse)", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", null);
      expect(r.locality).toBe("local");
      expect(r.validatedHost).toBeNull();
    });

    it("empty string URL -> local (not configured)", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "");
      expect(r.locality).toBe("local");
    });

    it("invalid URL -> cloud (fail closed)", () => {
      const r = classifyEffectiveLocality("local_openai_compatible", "not-a-url");
      expect(r.locality).toBe("cloud");
      expect(r.reason).toContain("Invalid URL");
    });

    it("ftp:// protocol -> cloud (fail closed — parsed but not http/https)", () => {
      // URL parser accepts ftp://, but the hostname is public
      const r = classifyEffectiveLocality("local_openai_compatible", "ftp://files.example.com");
      expect(r.locality).toBe("cloud");
    });
  });

  // Ollama: same rules apply.
  describe("ollama", () => {
    it("localhost -> local", () => {
      const r = classifyEffectiveLocality("ollama", "http://localhost:11434");
      expect(r.locality).toBe("local");
    });

    it("public URL -> cloud", () => {
      const r = classifyEffectiveLocality("ollama", "https://ollama.example.com");
      expect(r.locality).toBe("cloud");
    });

    it("null URL -> local", () => {
      const r = classifyEffectiveLocality("ollama", null);
      expect(r.locality).toBe("local");
    });
  });
});

// ─── isEffectivelyLocal ─────────────────────────────────────────────────────

describe("isEffectivelyLocal", () => {
  it("returns true for local_openai_compatible + localhost", () => {
    expect(isEffectivelyLocal("local_openai_compatible", "http://localhost:8080")).toBe(true);
  });

  it("returns false for local_openai_compatible + public URL", () => {
    expect(isEffectivelyLocal("local_openai_compatible", "https://api.openai.com")).toBe(false);
  });

  it("returns false for openai + any URL", () => {
    expect(isEffectivelyLocal("openai", "http://localhost:8080")).toBe(false);
  });

  it("returns true for ollama + LAN address", () => {
    expect(isEffectivelyLocal("ollama", "http://192.168.1.50:11434")).toBe(true);
  });
});
