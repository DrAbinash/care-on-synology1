import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * load-defaults must seed the HTTPS clinic OHIF hostname — never plain HTTP
 * LAN IP:port — so "Load Clinic Viewer Defaults" cannot undo PR #697.
 */

describe("DEFAULT_VIEWER_SETTINGS / OHIF browser base", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("seeds ohif_base_url as https://ohif.caredeoghar.com by default", async () => {
    vi.stubEnv("OHIF_PUBLIC_BASE_URL", "");
    vi.stubEnv("OHIF_BROWSER_BASE_URL", "");
    vi.stubEnv("OHIF_URL", "");
    const { DEFAULT_VIEWER_SETTINGS, DEFAULT_OHIF_BROWSER_BASE_URL } =
      await import("./networkDefaults");
    expect(DEFAULT_OHIF_BROWSER_BASE_URL).toBe("https://ohif.caredeoghar.com");
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).toBe(
      "https://ohif.caredeoghar.com",
    );
  });

  it("never seeds http://172.16.1.139:3010 (or other HTTP LAN OHIF) as ohif_base_url", async () => {
    vi.stubEnv("OHIF_URL", "http://172.16.1.139:3010");
    vi.stubEnv("OHIF_PUBLIC_BASE_URL", "");
    vi.stubEnv("OHIF_BROWSER_BASE_URL", "");
    const { DEFAULT_VIEWER_SETTINGS, DEFAULT_OHIF_BASE_URL } =
      await import("./networkDefaults");
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).toBe(
      "https://ohif.caredeoghar.com",
    );
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).not.toMatch(/^http:\/\//i);
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).not.toContain("172.16.1.139");
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).not.toContain(":3010");
    // Legacy LAN HTTP builder remains available for OHIF-nginx /dicom-web only.
    expect(DEFAULT_OHIF_BASE_URL).toMatch(/^http:\/\//);
    expect(DEFAULT_VIEWER_SETTINGS.dicom_web_base_url).toBe(
      `${DEFAULT_OHIF_BASE_URL}/dicom-web`,
    );
  });

  it("honours OHIF_PUBLIC_BASE_URL when set", async () => {
    vi.stubEnv("OHIF_PUBLIC_BASE_URL", "https://ohif.example.clinic/");
    vi.stubEnv("OHIF_BROWSER_BASE_URL", "https://ignored.example/");
    const { DEFAULT_VIEWER_SETTINGS } = await import("./networkDefaults");
    expect(DEFAULT_VIEWER_SETTINGS.ohif_base_url).toBe(
      "https://ohif.example.clinic",
    );
  });

  it("accepts HTTPS OHIF_URL but ignores plain-HTTP OHIF_URL", async () => {
    vi.stubEnv("OHIF_PUBLIC_BASE_URL", "");
    vi.stubEnv("OHIF_BROWSER_BASE_URL", "");
    vi.stubEnv("OHIF_URL", "https://ohif.from-env.example");
    const modHttps = await import("./networkDefaults");
    expect(modHttps.DEFAULT_VIEWER_SETTINGS.ohif_base_url).toBe(
      "https://ohif.from-env.example",
    );

    vi.resetModules();
    vi.stubEnv("OHIF_URL", "http://192.168.1.137:3010");
    const modHttp = await import("./networkDefaults");
    expect(modHttp.DEFAULT_VIEWER_SETTINGS.ohif_base_url).toBe(
      "https://ohif.caredeoghar.com",
    );
  });

  it("preserves non-OHIF viewer default keys (Weasis / PACS AE / mode)", async () => {
    const { DEFAULT_VIEWER_SETTINGS } = await import("./networkDefaults");
    expect(DEFAULT_VIEWER_SETTINGS.viewer_mode).toBe("BOTH");
    expect(DEFAULT_VIEWER_SETTINGS.default_viewer).toBe("WEASIS");
    expect(DEFAULT_VIEWER_SETTINGS.ohif_enabled).toBe("true");
    expect(DEFAULT_VIEWER_SETTINGS.weasis_enabled).toBe("true");
    expect(DEFAULT_VIEWER_SETTINGS.pacs_ae_title).toBe("ORTHANC2");
    expect(DEFAULT_VIEWER_SETTINGS.wado_uri_base_url).toMatch(/\/wado$/);
    expect(DEFAULT_VIEWER_SETTINGS.weasis_manifest_url_template).toContain(
      "weasis://",
    );
  });
});
