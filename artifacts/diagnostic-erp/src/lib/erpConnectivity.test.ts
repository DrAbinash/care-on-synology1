import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildLanFailoverUrl,
  buildPublicErpUrl,
  currentConnectivityKind,
  getErpBasePath,
} from "./erpConnectivity";

describe("erpConnectivity URL helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        hostname: "caredeoghar.com",
        pathname: "/erp/billing",
        search: "?x=1",
        hash: "",
        origin: "https://caredeoghar.com",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects public ERP hostname", () => {
    expect(currentConnectivityKind()).toBe("public");
  });

  it("detects LAN hostname", () => {
    (window as any).location.hostname = "192.168.1.139";
    expect(currentConnectivityKind()).toBe("lan");
  });

  it("builds LAN failover URL preserving path and query", () => {
    const url = buildLanFailoverUrl();
    expect(url).toMatch(/^http:\/\/192\.168\.\d+\.\d+:8888\/erp\/billing\?x=1$/);
  });

  it("builds public ERP URL", () => {
    const url = buildPublicErpUrl();
    expect(url).toBe("https://caredeoghar.com/erp/billing?x=1");
  });

  it("normalizes ERP base path", () => {
    const base = getErpBasePath();
    expect(base.startsWith("/")).toBe(true);
    expect(base.endsWith("/")).toBe(true);
  });
});
