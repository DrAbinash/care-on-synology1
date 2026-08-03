import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildLanFailoverOptions,
  buildLanFailoverUrl,
  buildPublicErpUrl,
  currentConnectivityKind,
  getErpBasePath,
  getLastWorkingLanHost,
  isLoginOrPortalPath,
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
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
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
    (window as any).location.hostname = "172.16.1.139";
    expect(currentConnectivityKind()).toBe("lan");
  });

  it("builds LAN failover URL preserving path and query", () => {
    const url = buildLanFailoverUrl();
    expect(url).toBe("http://172.16.1.139:8888/erp/billing?x=1");
  });

  it("does not double /erp when building LAN login URL", () => {
    (window as any).location.pathname = "/erp/login";
    (window as any).location.search = "";
    expect(buildLanFailoverUrl()).toBe("http://172.16.1.139:8888/erp/login");
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

  it("treats /erp/login as a login path (no auto-redirect)", () => {
    (window as any).location.pathname = "/erp/login";
    expect(isLoginOrPortalPath()).toBe(true);
  });

  it("does not treat /erp/billing as a login path", () => {
    (window as any).location.pathname = "/erp/billing";
    expect(isLoginOrPortalPath()).toBe(false);
  });

  it("sorts LAN failover options with preferred host first", () => {
    (window as any).localStorage.getItem = () => "172.16.1.139";
    expect(getLastWorkingLanHost()).toBe("172.16.1.139");
    const options = buildLanFailoverOptions();
    expect(options[0]?.host).toBe("172.16.1.139");
  });
});
