/**
 * SSRF egress guard — pure unit tests (P5). Proves the P5 hardening closes the
 * trailing-dot and IPv4-mapped-IPv6 bypasses that reached loopback / metadata /
 * LAN, while still permitting legitimate public and (LAN-mode) private hosts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { validateOllamaUrl, canonicalHostsForGuard } from "./ollamaUrlGuard";

afterEach(() => { delete process.env.AI_EGRESS_ALLOWLIST; });

describe("canonicalHostsForGuard", () => {
  it("strips a trailing dot and de-brackets", () => {
    expect(canonicalHostsForGuard("localhost.")).toContain("localhost");
    expect(canonicalHostsForGuard("[::1]")).toContain("::1");
  });
  it("extracts embedded IPv4 from IPv4-mapped IPv6 (dotted + hex forms)", () => {
    expect(canonicalHostsForGuard("[::ffff:7f00:1]")).toContain("127.0.0.1");
    expect(canonicalHostsForGuard("::ffff:127.0.0.1")).toContain("127.0.0.1");
    expect(canonicalHostsForGuard("::ffff:a9fe:a9fe")).toContain("169.254.169.254");
  });
});

describe("validateOllamaUrl — P5 bypasses are closed (allowLocal=false)", () => {
  const blocked = [
    "http://localhost./",               // trailing-dot loopback
    "http://127.0.0.1./",               // trailing-dot IPv4 loopback
    "http://[::ffff:127.0.0.1]/",       // IPv4-mapped IPv6 loopback
    "http://[::ffff:169.254.169.254]/", // IPv4-mapped IPv6 metadata (ALWAYS blocked)
    "http://169.254.169.254/",          // metadata
    "http://127.0.0.1/",                // loopback
    "http://192.168.1.5/",              // LAN
    "http://10.0.0.9/",                 // LAN
    "http://100.100.1.1/",              // CGNAT / tailnet
    "http://2130706433/",               // decimal 127.0.0.1 (URL parser normalises)
    "http://0x7f000001/",               // hex 127.0.0.1
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(validateOllamaUrl(url, false).ok).toBe(false);
    });
  }

  it("metadata via IPv4-mapped IPv6 is blocked EVEN in LAN mode", () => {
    expect(validateOllamaUrl("http://[::ffff:169.254.169.254]/", true).ok).toBe(false);
    expect(validateOllamaUrl("http://169.254.169.254/", true).ok).toBe(false);
  });

  it("permits a public host", () => {
    expect(validateOllamaUrl("https://ollama.example.com:11434/", false).ok).toBe(true);
  });

  it("permits LAN/loopback only when allowLocal=true", () => {
    expect(validateOllamaUrl("http://127.0.0.1:11434/", false).ok).toBe(false);
    expect(validateOllamaUrl("http://127.0.0.1:11434/", true).ok).toBe(true);
    expect(validateOllamaUrl("http://localhost.:11434/", true).ok).toBe(true);
  });

  it("an explicit allowlist is authoritative (exact host[:port])", () => {
    process.env.AI_EGRESS_ALLOWLIST = "ollama.internal:11434";
    expect(validateOllamaUrl("http://ollama.internal:11434/", false).ok).toBe(true);
    expect(validateOllamaUrl("http://evil.example.com/", false).ok).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateOllamaUrl("file:///etc/passwd", true).ok).toBe(false);
    expect(validateOllamaUrl("gopher://x/", true).ok).toBe(false);
  });
});
