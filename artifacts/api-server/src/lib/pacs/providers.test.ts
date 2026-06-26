import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPacsProvider, isBlockedHost, resolveAndCheckHost, tcpProbe } from "./providers.js";

vi.mock("./pacsConfig.js", () => {
  return {
    getRadiologyConfig: async () => {
      const defaultHost = process.env.ORTHANC_URL ? new URL(process.env.ORTHANC_URL).hostname : "192.168.1.137";
      return {
        orthanc: {
          dicomWebUrl: process.env.ORTHANC_URL ? `${process.env.ORTHANC_URL}/dicom-web` : "",
          wadoUrl: process.env.ORTHANC_URL ? `${process.env.ORTHANC_URL}/wado` : "",
        },
        conquest: {
          wadoUrl: process.env.CONQUEST_URL || "",
        },
        default_viewer: process.env.PACS_PROVIDER || "",
      };
    }
  };
});

// ---------------------------------------------------------------------------
// getPacsProvider — provider detection
// ---------------------------------------------------------------------------

describe("getPacsProvider", () => {
  const envBackup = {
    PACS_PROVIDER: process.env.PACS_PROVIDER,
    ORTHANC_URL: process.env.ORTHANC_URL,
    ORTHANC_USERNAME: process.env.ORTHANC_USERNAME,
    ORTHANC_PASSWORD: process.env.ORTHANC_PASSWORD,
    CONQUEST_URL: process.env.CONQUEST_URL,
  };

  beforeEach(() => {
    delete process.env.PACS_PROVIDER;
    delete process.env.ORTHANC_URL;
    delete process.env.ORTHANC_USERNAME;
    delete process.env.ORTHANC_PASSWORD;
    delete process.env.CONQUEST_URL;
  });

  afterEach(() => {
    if (envBackup.PACS_PROVIDER !== undefined) process.env.PACS_PROVIDER = envBackup.PACS_PROVIDER;
    else delete process.env.PACS_PROVIDER;
    if (envBackup.ORTHANC_URL !== undefined) process.env.ORTHANC_URL = envBackup.ORTHANC_URL;
    else delete process.env.ORTHANC_URL;
    if (envBackup.ORTHANC_USERNAME !== undefined) process.env.ORTHANC_USERNAME = envBackup.ORTHANC_USERNAME;
    else delete process.env.ORTHANC_USERNAME;
    if (envBackup.ORTHANC_PASSWORD !== undefined) process.env.ORTHANC_PASSWORD = envBackup.ORTHANC_PASSWORD;
    else delete process.env.ORTHANC_PASSWORD;
    if (envBackup.CONQUEST_URL !== undefined) process.env.CONQUEST_URL = envBackup.CONQUEST_URL;
    else delete process.env.CONQUEST_URL;
  });

  it("returns NoneProvider when no env vars are set", async () => {
    const p = await getPacsProvider();
    expect(p.type).toBe("none");
    expect(p.baseUrl).toBeNull();
    expect(p.displayName).toBe("Not configured");
  });

  it("returns OrthancProvider when ORTHANC_URL is set (auto-detect)", async () => {
    process.env.ORTHANC_URL = "http://orthanc.local:8042";
    const p = await getPacsProvider();
    expect(p.type).toBe("orthanc");
    expect(p.baseUrl).toBe("http://orthanc.local:8042");
    expect(p.displayName).toBe("Orthanc");
  });

  it("strips trailing slash from ORTHANC_URL", async () => {
    process.env.ORTHANC_URL = "http://orthanc.local:8042/";
    const p = await getPacsProvider();
    expect(p.baseUrl).toBe("http://orthanc.local:8042");
  });

  it("returns ConquestProvider when CONQUEST_URL is set (auto-detect)", async () => {
    process.env.CONQUEST_URL = "http://conquest.local:5678";
    const p = await getPacsProvider();
    expect(p.type).toBe("conquest");
    expect(p.baseUrl).toBe("http://conquest.local:5678");
    expect(p.displayName).toBe("Conquest");
  });

  it("strips trailing slash from CONQUEST_URL", async () => {
    process.env.CONQUEST_URL = "http://conquest.local:5678/";
    const p = await getPacsProvider();
    expect(p.baseUrl).toBe("http://conquest.local:5678");
  });

  it("PACS_PROVIDER=orthanc explicit selection picks Orthanc even when only CONQUEST_URL is set", async () => {
    process.env.PACS_PROVIDER = "orthanc";
    process.env.CONQUEST_URL = "http://conquest.local:5678";
    const p = await getPacsProvider();
    expect(p.type).toBe("orthanc");
  });

  it("PACS_PROVIDER=conquest explicit selection picks Conquest even when only ORTHANC_URL is set", async () => {
    process.env.PACS_PROVIDER = "conquest";
    process.env.ORTHANC_URL = "http://orthanc.local:8042";
    const p = await getPacsProvider();
    expect(p.type).toBe("conquest");
  });

  it("Orthanc wins over Conquest when both URLs are set and no explicit PACS_PROVIDER", async () => {
    process.env.ORTHANC_URL = "http://orthanc.local:8042";
    process.env.CONQUEST_URL = "http://conquest.local:5678";
    const p = await getPacsProvider();
    expect(p.type).toBe("orthanc");
  });
});

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

describe("getPacsProvider capabilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PACS_PROVIDER;
    delete process.env.ORTHANC_URL;
    delete process.env.CONQUEST_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Orthanc advertises all capabilities", async () => {
    process.env.ORTHANC_URL = "http://orthanc.local:8042";
    const p = await getPacsProvider();
    expect(p.capabilities.studyArchive).toBe(true);
    expect(p.capabilities.teleradiologyShare).toBe(true);
    expect(p.capabilities.mwlPush).toBe(true);
    expect(p.capabilities.instanceMetadata).toBe(true);
  });

  it("Conquest advertises limited capabilities", async () => {
    process.env.CONQUEST_URL = "http://conquest.local:5678";
    const p = await getPacsProvider();
    expect(p.capabilities.studyArchive).toBe(false);
    expect(p.capabilities.teleradiologyShare).toBe(false);
    expect(p.capabilities.mwlPush).toBe(false);
    expect(p.capabilities.instanceMetadata).toBe(true);
  });

  it("NoneProvider has no capabilities", async () => {
    const p = await getPacsProvider();
    expect(p.capabilities.studyArchive).toBe(false);
    expect(p.capabilities.teleradiologyShare).toBe(false);
    expect(p.capabilities.mwlPush).toBe(false);
    expect(p.capabilities.instanceMetadata).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider health() when baseUrl is missing
// ---------------------------------------------------------------------------

describe("provider health() with no URL", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PACS_PROVIDER;
    delete process.env.ORTHANC_URL;
    delete process.env.CONQUEST_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("NoneProvider health returns ok=false", async () => {
    const p = await getPacsProvider();
    const h = await p.health();
    expect(h.ok).toBe(false);
  });

  it("OrthancProvider health returns ok=false when URL is missing", async () => {
    process.env.PACS_PROVIDER = "orthanc";
    const p = await getPacsProvider();
    const h = await p.health();
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/ORTHANC_URL/);
  });

  it("ConquestProvider health returns ok=false when URL is missing", async () => {
    process.env.PACS_PROVIDER = "conquest";
    const p = await getPacsProvider();
    const h = await p.health();
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/CONQUEST_URL/);
  });
});

// ---------------------------------------------------------------------------
// isBlockedHost — SSRF guard
// ---------------------------------------------------------------------------

describe("isBlockedHost", () => {
  it("blocks localhost", () => {
    expect(isBlockedHost("localhost")).not.toBeNull();
  });

  it("blocks 127.0.0.1 (loopback)", () => {
    expect(isBlockedHost("127.0.0.1")).not.toBeNull();
  });

  it("blocks 127.255.255.255 (loopback range)", () => {
    expect(isBlockedHost("127.255.255.255")).not.toBeNull();
  });

  it("blocks 10.x.x.x (private class A)", () => {
    expect(isBlockedHost("10.0.0.1")).not.toBeNull();
    expect(isBlockedHost("10.200.100.50")).not.toBeNull();
  });

  it("blocks 172.16.x.x – 172.31.x.x (private class B)", () => {
    expect(isBlockedHost("172.16.0.1")).not.toBeNull();
    expect(isBlockedHost("172.31.255.255")).not.toBeNull();
  });

  it("does NOT block 172.15.x.x (just outside private class B)", () => {
    expect(isBlockedHost("172.15.0.1")).toBeNull();
  });

  it("does NOT block 172.32.x.x (just outside private class B)", () => {
    expect(isBlockedHost("172.32.0.1")).toBeNull();
  });

  it("blocks 192.168.x.x (private class C)", () => {
    expect(isBlockedHost("192.168.1.1")).not.toBeNull();
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(isBlockedHost("169.254.1.1")).not.toBeNull();
  });

  it("blocks 169.254.169.254 (cloud metadata)", () => {
    expect(isBlockedHost("169.254.169.254")).not.toBeNull();
  });

  it("blocks 100.100.100.200 (Alibaba cloud metadata literal)", () => {
    expect(isBlockedHost("100.100.100.200")).not.toBeNull();
  });

  it("blocks CGNAT range 100.64.x.x – 100.127.x.x", () => {
    expect(isBlockedHost("100.64.0.1")).not.toBeNull();
    expect(isBlockedHost("100.127.255.255")).not.toBeNull();
  });

  it("blocks 0.0.0.0", () => {
    expect(isBlockedHost("0.0.0.0")).not.toBeNull();
  });

  it("blocks ::1 (IPv6 loopback)", () => {
    expect(isBlockedHost("::1")).not.toBeNull();
  });

  it("blocks fe80:: (IPv6 link-local)", () => {
    expect(isBlockedHost("fe80::1")).not.toBeNull();
  });

  it("blocks fc00::/7 ULA addresses", () => {
    expect(isBlockedHost("fc00::1")).not.toBeNull();
    expect(isBlockedHost("fd00::1")).not.toBeNull();
  });

  it("blocks IPv4-mapped IPv6 address ::ffff:127.0.0.1", () => {
    expect(isBlockedHost("::ffff:127.0.0.1")).not.toBeNull();
  });

  it("blocks IPv4-mapped IPv6 address ::ffff:192.168.1.1", () => {
    expect(isBlockedHost("::ffff:192.168.1.1")).not.toBeNull();
  });

  it("allows a public IP address", () => {
    expect(isBlockedHost("8.8.8.8")).toBeNull();
  });

  it("allows a public hostname", () => {
    expect(isBlockedHost("dicom.example.com")).toBeNull();
  });

  it("returns an error for empty string", () => {
    expect(isBlockedHost("")).not.toBeNull();
  });

  it("trims whitespace before checking", () => {
    expect(isBlockedHost("  localhost  ")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveAndCheckHost — rejects blocked literal hosts without DNS
// ---------------------------------------------------------------------------

describe("resolveAndCheckHost", () => {
  it("rejects localhost immediately (no DNS needed)", async () => {
    const result = await resolveAndCheckHost("localhost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("rejects 127.0.0.1 immediately (no DNS needed)", async () => {
    const result = await resolveAndCheckHost("127.0.0.1");
    expect(result.ok).toBe(false);
  });

  it("rejects 10.0.0.1 immediately (no DNS needed)", async () => {
    const result = await resolveAndCheckHost("10.0.0.1");
    expect(result.ok).toBe(false);
  });

  it("returns an error for an unresolvable hostname", async () => {
    const result = await resolveAndCheckHost("this-hostname-does-not-exist-xyz.invalid");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tcpProbe — input validation
// ---------------------------------------------------------------------------

describe("tcpProbe input validation", () => {
  it("rejects port 0", async () => {
    const result = await tcpProbe("8.8.8.8", 0);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid port/);
  });

  it("rejects port 65536", async () => {
    const result = await tcpProbe("8.8.8.8", 65536);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid port/);
  });

  it("rejects negative port", async () => {
    const result = await tcpProbe("8.8.8.8", -1);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid port/);
  });

  it("rejects fractional port", async () => {
    const result = await tcpProbe("8.8.8.8", 80.5);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid port/);
  });

  it("rejects blocked host (SSRF guard)", async () => {
    const result = await tcpProbe("localhost", 104);
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBe(0);
  });

  it("rejects private IP host (SSRF guard)", async () => {
    const result = await tcpProbe("10.0.0.1", 104);
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBe(0);
  });
});
