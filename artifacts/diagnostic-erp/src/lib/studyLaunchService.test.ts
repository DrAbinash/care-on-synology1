import { describe, it, expect, vi } from "vitest";
import {
  parseViewerNetworkConfig,
  selectViewerNetwork,
  selectStudyIdentifier,
  planStudyLaunch,
  launchRadiologyStudy,
  buildOhifUrl,
  buildWeasisUrl,
  validateBaseUrl,
  joinUrl,
  memoryRouteCache,
  DEFAULT_FALLBACK_ORDER,
  type ProbeFn,
  type NetworkEndpoint,
} from "./studyLaunchService";

// Ticket M1.2 — canonical study launch. Everything here is deterministic:
// probes, clock, cache and window are injected.

const UID = "1.2.840.113619.2.55.3.604688119.868.1731900000.1";
const ACC = "ACC-2026-0042";

const SETTINGS: Record<string, string> = {
  ohif_base_url: "http://192.168.1.10:3010",
  weasis_wado_url: "http://192.168.1.10:8042/wado",
  ohif_base_url_tailscale: "http://100.64.0.5:3010",
  wado_base_url_tailscale: "http://100.64.0.5:8042/wado",
  ohif_base_url_cloudflare: "https://ohif.tunnel.example.com/ohif",
  wado_base_url_cloudflare: "https://pacs.tunnel.example.com/wado",
  ohif_base_url_public: "https://pacs.example.com/erp/ohif",
  wado_base_url_public: "https://pacs.example.com/erp/wado",
};

/** Probe that consults a reachability map keyed by URL substring. */
function probeFor(up: Partial<Record<string, boolean>>): ProbeFn {
  return async (url) => {
    for (const [needle, ok] of Object.entries(up)) {
      if (url.includes(needle)) return ok!;
    }
    return false;
  };
}

const cfg = (extra: Record<string, string> = {}) => parseViewerNetworkConfig({ ...SETTINGS, ...extra });

// ─── Config parsing ──────────────────────────────────────────────────────────

describe("parseViewerNetworkConfig", () => {
  it("parses all four modes from existing + suffixed keys", () => {
    const c = cfg();
    expect(Object.keys(c.endpoints).sort()).toEqual(["CLOUDFLARE", "LAN", "PUBLIC", "TAILSCALE"]);
    expect(c.endpoints.LAN!.wadoBaseUrl).toBe("http://192.168.1.10:8042/wado");
    expect(c.fallbackOrder).toEqual(DEFAULT_FALLBACK_ORDER);
  });

  it("ignores unconfigured modes", () => {
    const c = parseViewerNetworkConfig({ ohif_base_url: "http://192.168.1.10:3010" });
    expect(Object.keys(c.endpoints)).toEqual(["LAN"]);
  });

  it("rejects untrusted/invalid base URLs with diagnostics", () => {
    const c = parseViewerNetworkConfig({
      ohif_base_url: "javascript:alert(1)",
      ohif_base_url_tailscale: "http://user:secret@100.64.0.5:3010",
      ohif_base_url_public: "https://ok.example.com",
    });
    expect(Object.keys(c.endpoints)).toEqual(["PUBLIC"]);
    expect(c.parseDiagnostics.join(" ")).toContain("LAN ignored");
    expect(c.parseDiagnostics.join(" ")).toContain("TAILSCALE ignored");
  });

  it("derives a PUBLIC endpoint from the legacy public_pacs_host key", () => {
    const c = parseViewerNetworkConfig({ public_pacs_host: "pacs.example.com" });
    expect(c.endpoints.PUBLIC!.viewerBaseUrl).toBe("https://pacs.example.com");
  });

  it("respects a configured fallback-order override and appends the rest", () => {
    const c = cfg({ viewer_network_fallback_order: "PUBLIC, LAN, BOGUS" });
    expect(c.fallbackOrder).toEqual(["PUBLIC", "LAN", "TAILSCALE", "CLOUDFLARE"]);
    expect(c.parseDiagnostics.join(" ")).toContain("BOGUS");
  });

  it("clamps probe timeout and cache TTL", () => {
    const c = cfg({ viewer_probe_timeout_ms: "999999", viewer_route_cache_ttl_ms: "-5" });
    expect(c.probeTimeoutMs).toBe(10_000);
    expect(c.cacheTtlMs).toBe(0);
  });
});

describe("validateBaseUrl / joinUrl", () => {
  it("accepts http/https, rejects credentials and other schemes", () => {
    expect(validateBaseUrl("https://a.example.com/x").ok).toBe(true);
    expect(validateBaseUrl("http://192.168.1.1:3010").ok).toBe(true);
    expect(validateBaseUrl("weasis://launch").ok).toBe(false);
    expect(validateBaseUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateBaseUrl("http://u:p@h/").reason).toBe("credentials_in_url");
    expect(validateBaseUrl("not a url").ok).toBe(false);
    expect(validateBaseUrl("").ok).toBe(false);
  });

  it("joins base + path preserving subpaths and collapsing slashes", () => {
    expect(joinUrl("https://x.example.com/erp/", "/system")).toBe("https://x.example.com/erp/system");
    expect(joinUrl("https://x.example.com/erp", "")).toBe("https://x.example.com/erp");
  });
});

// ─── Network selection ───────────────────────────────────────────────────────

describe("selectViewerNetwork — AUTO", () => {
  it("selects LAN when LAN is healthy", async () => {
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe: probeFor({ "192.168.1.10": true }) });
    expect(s.selectedMode).toBe("LAN");
    expect(s.selectedBaseUrl).toBe("http://192.168.1.10:3010");
    expect(s.cacheUsed).toBe(false);
    expect(s.reachabilityResults).toHaveLength(1);
  });

  it("falls back to Tailscale when LAN is down", async () => {
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe: probeFor({ "100.64.0.5": true }) });
    expect(s.selectedMode).toBe("TAILSCALE");
    expect(s.reachabilityResults.map((r) => r.mode)).toEqual(["LAN", "TAILSCALE"]);
  });

  it("falls back to Cloudflare when LAN and Tailscale are down", async () => {
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe: probeFor({ "ohif.tunnel.example.com": true }) });
    expect(s.selectedMode).toBe("CLOUDFLARE");
    expect(s.reachabilityResults.map((r) => r.mode)).toEqual(["LAN", "TAILSCALE", "CLOUDFLARE"]);
  });

  it("falls back to Public as the last resort", async () => {
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe: probeFor({ "pacs.example.com/erp": true }) });
    expect(s.selectedMode).toBe("PUBLIC");
    expect(s.reachabilityResults).toHaveLength(4);
  });

  it("reports every fallback when nothing is reachable", async () => {
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe: probeFor({}) });
    expect(s.selectedMode).toBeNull();
    expect(s.reachabilityResults).toHaveLength(4);
    expect(s.reason).toContain("no configured network path is reachable");
    expect(s.diagnostics.join(" ")).toContain("trying next configured path");
  });

  it("respects the configured fallback-order override", async () => {
    const c = cfg({ viewer_network_fallback_order: "PUBLIC,LAN" });
    const s = await selectViewerNetwork(c, {
      requestedMode: "AUTO",
      probe: probeFor({ "pacs.example.com/erp": true, "192.168.1.10": true }),
    });
    expect(s.selectedMode).toBe("PUBLIC"); // PUBLIC first per override
    expect(s.reachabilityResults).toHaveLength(1);
  });

  it("passes the configured timeout to the probe", async () => {
    const probe = vi.fn(async () => true);
    await selectViewerNetwork(cfg({ viewer_probe_timeout_ms: "700" }), { requestedMode: "AUTO", probe });
    expect(probe).toHaveBeenCalledWith(expect.any(String), 700);
  });

  it("skips http endpoints deterministically on an https page (mixed content)", async () => {
    const s = await selectViewerNetwork(cfg(), {
      requestedMode: "AUTO",
      probe: probeFor({ "ohif.tunnel.example.com": true }),
      pageIsHttps: true,
    });
    // LAN + Tailscale are http → skipped as mixed content, no probe wasted.
    expect(s.selectedMode).toBe("CLOUDFLARE");
    expect(s.reachabilityResults.find((r) => r.mode === "LAN")!.error).toBe("mixed_content_blocked");
    expect(s.reachabilityResults.find((r) => r.mode === "TAILSCALE")!.error).toBe("mixed_content_blocked");
  });

  it("explains an all-http config on an https page", async () => {
    const c = parseViewerNetworkConfig({ ohif_base_url: "http://192.168.1.10:3010" });
    const s = await selectViewerNetwork(c, { requestedMode: "AUTO", probe: probeFor({}), pageIsHttps: true });
    expect(s.selectedMode).toBeNull();
    expect(s.reason).toContain("mixed content");
  });

  it("returns a clear result when nothing is configured", async () => {
    const s = await selectViewerNetwork(parseViewerNetworkConfig({}), { requestedMode: "AUTO", probe: probeFor({}) });
    expect(s.selectedMode).toBeNull();
    expect(s.reason).toContain("no network mode is configured");
  });
});

describe("selectViewerNetwork — cache", () => {
  it("reuses a fresh successful route without probing", async () => {
    const cache = memoryRouteCache();
    let t = 1_000_000;
    const now = () => t;
    const probe = vi.fn(probeFor({ "192.168.1.10": true }));
    const first = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe, cache, now });
    expect(first.selectedMode).toBe("LAN");
    expect(probe).toHaveBeenCalledTimes(1);

    t += 5_000; // within the 15s TTL
    const second = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe, cache, now });
    expect(second.cacheUsed).toBe(true);
    expect(second.selectedMode).toBe("LAN");
    expect(probe).toHaveBeenCalledTimes(1); // no new probe
  });

  it("expires the cache after the TTL", async () => {
    const cache = memoryRouteCache();
    let t = 1_000_000;
    const now = () => t;
    const probe = vi.fn(probeFor({ "192.168.1.10": true }));
    await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe, cache, now });
    t += 20_000; // beyond 15s TTL
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe, cache, now });
    expect(s.cacheUsed).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after a probe failure (never trusts stale success)", async () => {
    const cache = memoryRouteCache();
    cache.set({ mode: "LAN", baseUrl: "http://192.168.1.10:3010", at: Date.now() });
    const s = await selectViewerNetwork(cfg(), { requestedMode: "LAN", probe: probeFor({}) });
    expect(s.selectedMode).toBeNull();
    // forced failure path invalidates the shared cache
    const s2 = await selectViewerNetwork(cfg(), { requestedMode: "LAN", probe: probeFor({}), cache });
    expect(s2.selectedMode).toBeNull();
    expect(cache.get()).toBeNull();
  });

  it("ignores a cached route whose base URL no longer matches settings", async () => {
    const cache = memoryRouteCache();
    cache.set({ mode: "LAN", baseUrl: "http://old-host:3010", at: Date.now() });
    const probe = vi.fn(probeFor({ "192.168.1.10": true }));
    const s = await selectViewerNetwork(cfg(), { requestedMode: "AUTO", probe, cache });
    expect(s.cacheUsed).toBe(false);
    expect(probe).toHaveBeenCalled();
  });
});

describe("selectViewerNetwork — forced modes", () => {
  it.each(["LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"] as const)("forced %s probes only that mode", async (mode) => {
    const probe = vi.fn(async () => true);
    const s = await selectViewerNetwork(cfg(), { requestedMode: mode, probe });
    expect(s.selectedMode).toBe(mode);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(s.reason).toContain(`forced ${mode}`);
  });

  it("a forced-mode failure NEVER silently switches modes", async () => {
    const s = await selectViewerNetwork(cfg(), {
      requestedMode: "LAN",
      probe: probeFor({ "100.64.0.5": true }), // Tailscale healthy but must not be used
    });
    expect(s.selectedMode).toBeNull();
    expect(s.reason).toContain("LAN endpoint is unreachable");
    expect(s.diagnostics.join(" ")).toContain("NOT falling back");
  });

  it("explicit retry-with-fallback = AUTO with the failed mode skipped", async () => {
    const s = await selectViewerNetwork(cfg(), {
      requestedMode: "AUTO",
      probe: probeFor({ "100.64.0.5": true }),
      skipModes: ["LAN"],
    });
    expect(s.selectedMode).toBe("TAILSCALE");
    expect(s.reachabilityResults.map((r) => r.mode)).toEqual(["TAILSCALE"]);
  });

  it("a forced unconfigured mode reports NOT CONFIGURED", async () => {
    const c = parseViewerNetworkConfig({ ohif_base_url: "http://192.168.1.10:3010" });
    const s = await selectViewerNetwork(c, { requestedMode: "CLOUDFLARE", probe: probeFor({}) });
    expect(s.selectedMode).toBeNull();
    expect(s.reason).toContain("not configured");
  });
});

// ─── Study identity ──────────────────────────────────────────────────────────

describe("study identity", () => {
  it("StudyInstanceUID is always primary", () => {
    const id = selectStudyIdentifier({ studyInstanceUID: UID, accessionNumber: ACC });
    expect(id).toEqual({ ok: true, type: "STUDY_INSTANCE_UID", value: UID });
  });

  it("accession number is fallback only", () => {
    const id = selectStudyIdentifier({ studyInstanceUID: "  ", accessionNumber: ACC });
    expect(id).toEqual({ ok: true, type: "ACCESSION_NUMBER", value: ACC });
  });

  it("no identifiers → not launchable (patient names are not even an input)", () => {
    expect(selectStudyIdentifier({ studyInstanceUID: null, accessionNumber: "" }).ok).toBe(false);
  });

  it("planStudyLaunch never puts a patient name in the URL", async () => {
    const plan = await planStudyLaunch(
      {
        studyInstanceUID: UID,
        accessionNumber: ACC,
        patientId: 12,
        worklistId: 55,
        viewer: "OHIF",
        requestedMode: "LAN",
        ...( { patientName: "Asha P" } as object),
      } as never,
      SETTINGS,
      { probe: probeFor({ "192.168.1.10": true }) },
    );
    expect(plan.success).toBe(true);
    expect(plan.finalLaunchUrl).not.toContain("Asha");
    expect(plan.identifierType).toBe("STUDY_INSTANCE_UID");
  });

  it("accession fallback requires a template that can consume it", async () => {
    const plan = await planStudyLaunch(
      { studyInstanceUID: null, accessionNumber: ACC, viewer: "OHIF", requestedMode: "LAN" },
      SETTINGS, // default template only supports {studyInstanceUID}
      { probe: probeFor({ "192.168.1.10": true }) },
    );
    expect(plan.success).toBe(false);
    expect(plan.errorCode).toBe("MISSING_STUDY_IDENTIFIER");
  });

  it("accession fallback works when the template supports {accessionNumber}", async () => {
    const plan = await planStudyLaunch(
      { studyInstanceUID: null, accessionNumber: ACC, viewer: "OHIF", requestedMode: "LAN" },
      { ...SETTINGS, ohif_study_url_template: "{OHIF_BASE_URL}/viewer?AccessionNumber={accessionNumber}" },
      { probe: probeFor({ "192.168.1.10": true }) },
    );
    expect(plan.success).toBe(true);
    expect(plan.identifierType).toBe("ACCESSION_NUMBER");
    expect(plan.finalLaunchUrl).toContain(`AccessionNumber=${encodeURIComponent(ACC)}`);
    expect(plan.diagnostics.join(" ")).toContain("accession-number fallback");
  });
});

// ─── URL construction ────────────────────────────────────────────────────────

const endpointOf = (mode: "LAN" | "TAILSCALE" | "CLOUDFLARE" | "PUBLIC"): NetworkEndpoint =>
  parseViewerNetworkConfig(SETTINGS).endpoints[mode]!;

describe("OHIF URL construction", () => {
  it.each([
    ["LAN", "http://192.168.1.10:3010/viewer?StudyInstanceUIDs="],
    ["TAILSCALE", "http://100.64.0.5:3010/viewer?StudyInstanceUIDs="],
    ["CLOUDFLARE", "https://ohif.tunnel.example.com/ohif/viewer?StudyInstanceUIDs="],
    ["PUBLIC", "https://pacs.example.com/erp/ohif/viewer?StudyInstanceUIDs="],
  ] as const)("%s base URL is used verbatim incl. reverse-proxy subpath", (mode, prefix) => {
    const built = buildOhifUrl(endpointOf(mode), undefined, { type: "STUDY_INSTANCE_UID", value: UID });
    expect(built).toEqual({ ok: true, url: `${prefix}${encodeURIComponent(UID)}` });
  });

  it("normalizes duplicate slashes without touching the scheme", () => {
    const ep = { ...endpointOf("PUBLIC"), viewerBaseUrl: "https://pacs.example.com/erp/ohif/" };
    const built = buildOhifUrl(ep, "{OHIF_BASE_URL}//viewer?StudyInstanceUIDs={studyInstanceUID}", {
      type: "STUDY_INSTANCE_UID",
      value: UID,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.url).toContain("https://pacs.example.com/erp/ohif/viewer");
      expect(built.url).not.toMatch(/[^:]\/\/viewer/);
    }
  });

  it("URL-encodes the identifier", () => {
    const built = buildOhifUrl(endpointOf("LAN"), undefined, { type: "STUDY_INSTANCE_UID", value: "1.2.3&x=y" });
    expect(built.ok && built.url.includes(encodeURIComponent("1.2.3&x=y"))).toBe(true);
  });
});

describe("Weasis URL construction", () => {
  it.each(["LAN", "TAILSCALE", "CLOUDFLARE", "PUBLIC"] as const)("uses the %s-mode WADO endpoint", (mode) => {
    const built = buildWeasisUrl(endpointOf(mode), undefined, { type: "STUDY_INSTANCE_UID", value: UID });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.url.startsWith("weasis://$dicom:get")).toBe(true);
      expect(built.url).toContain(endpointOf(mode).wadoBaseUrl!);
      expect(built.url).toContain(`studyUID=${UID}`);
    }
  });

  it("substitutes the per-mode WADO URL into a configured manifest template", () => {
    const built = buildWeasisUrl(
      endpointOf("TAILSCALE"),
      'weasis://$dicom:get -w "{WADO_URL}?requestType=WADO&studyUID={studyInstanceUID}"',
      { type: "STUDY_INSTANCE_UID", value: UID },
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.url).toContain("http://100.64.0.5:8042/wado?requestType=WADO");
  });

  it("fails clearly when the mode has no WADO endpoint", () => {
    const ep: NetworkEndpoint = { mode: "CLOUDFLARE", viewerBaseUrl: "https://x.example.com", wadoBaseUrl: null, probeUrl: null };
    const built = buildWeasisUrl(ep, undefined, { type: "STUDY_INSTANCE_UID", value: UID });
    expect(built.ok).toBe(false);
  });
});

// ─── Launch (side-effect layer) ──────────────────────────────────────────────

function fakeWindow() {
  const w = { location: { href: "" }, closed: false, close: vi.fn() };
  return w as unknown as Window & { location: { href: string }; close: ReturnType<typeof vi.fn> };
}

describe("launchRadiologyStudy", () => {
  const input = { studyInstanceUID: UID, patientId: 12, worklistId: 55, viewer: "OHIF" as const, requestedMode: "AUTO" as const };

  it("navigates the pre-opened window on success and records the route", async () => {
    const w = fakeWindow();
    const recordSuccess = vi.fn();
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({ "192.168.1.10": true }),
      cache: memoryRouteCache(),
      openTarget: w,
      recordSuccess,
    });
    expect(r.success).toBe(true);
    expect(r.selectedNetworkMode).toBe("LAN");
    expect(w.location.href).toBe(r.finalLaunchUrl);
    expect(recordSuccess).toHaveBeenCalledWith("LAN", "OHIF", r.finalLaunchUrl, expect.any(Number));
  });

  it("POPUP_BLOCKED when the click-time window.open returned null", async () => {
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({ "192.168.1.10": true }),
      cache: memoryRouteCache(),
      openTarget: null,
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("POPUP_BLOCKED");
    expect(r.finalLaunchUrl).toBeTruthy(); // URL preserved so the user can retry/copy
  });

  it("a stale study selection can NEVER launch the newly selected patient", async () => {
    const w = fakeWindow();
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({ "192.168.1.10": true }),
      cache: memoryRouteCache(),
      openTarget: w,
      isStale: () => true, // study changed while probing
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("STALE_STUDY_CONTEXT");
    expect(w.close).toHaveBeenCalled();
    expect(w.location.href).toBe(""); // never navigated
  });

  it("invalidates the route cache when the launch plan fails", async () => {
    const cache = memoryRouteCache();
    cache.set({ mode: "LAN", baseUrl: "http://192.168.1.10:3010", at: Date.now() });
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({}),
      cache,
      openTarget: fakeWindow(),
      now: () => Date.now() + 60_000, // cache stale so probing happens and fails
    });
    expect(r.success).toBe(false);
    expect(cache.get()).toBeNull();
  });

  it("VIEWER_NOT_CONFIGURED when the chosen viewer is disabled", async () => {
    const r = await launchRadiologyStudy(input, { ...SETTINGS, ohif_enabled: "false" }, {
      probe: probeFor({ "192.168.1.10": true }),
      cache: memoryRouteCache(),
      openTarget: fakeWindow(),
    });
    expect(r.errorCode).toBe("VIEWER_NOT_CONFIGURED");
  });

  it("NETWORK_MODE_NOT_CONFIGURED for a forced unconfigured mode", async () => {
    const r = await launchRadiologyStudy({ ...input, requestedMode: "CLOUDFLARE" }, {
      ohif_base_url: "http://192.168.1.10:3010",
    }, { probe: probeFor({}), cache: memoryRouteCache(), openTarget: fakeWindow() });
    expect(r.errorCode).toBe("NETWORK_MODE_NOT_CONFIGURED");
  });

  it("NO_REACHABLE_NETWORK carries the complete fallback history", async () => {
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({}),
      cache: memoryRouteCache(),
      openTarget: fakeWindow(),
    });
    expect(r.errorCode).toBe("NO_REACHABLE_NETWORK");
    expect(r.fallbackHistory).toHaveLength(4);
    expect(r.fallbackHistory[0]).toContain("LAN");
  });

  it("MIXED_CONTENT_BLOCKED when the https page can only reach http endpoints", async () => {
    const r = await launchRadiologyStudy(input, {
      ohif_base_url: "http://192.168.1.10:3010",
      ohif_base_url_tailscale: "http://100.64.0.5:3010",
    }, {
      probe: probeFor({ "192.168.1.10": true, "100.64.0.5": true }),
      cache: memoryRouteCache(),
      openTarget: fakeWindow(),
      pageIsHttps: true,
    });
    expect(r.errorCode).toBe("MIXED_CONTENT_BLOCKED");
  });

  it("weasis launches use the selected mode's WADO endpoint", async () => {
    const w = fakeWindow();
    const r = await launchRadiologyStudy({ ...input, viewer: "WEASIS", requestedMode: "TAILSCALE" }, SETTINGS, {
      probe: probeFor({ "100.64.0.5": true }),
      cache: memoryRouteCache(),
      openTarget: w,
    });
    expect(r.success).toBe(true);
    expect(w.location.href).toContain("weasis://");
    expect(w.location.href).toContain("100.64.0.5:8042/wado");
  });

  it("no credentials ever appear in a launch URL", async () => {
    const r = await launchRadiologyStudy(input, SETTINGS, {
      probe: probeFor({ "pacs.example.com/erp": true }),
      cache: memoryRouteCache(),
      openTarget: fakeWindow(),
      skipModes: ["LAN", "TAILSCALE", "CLOUDFLARE"],
    });
    expect(r.success).toBe(true);
    expect(r.finalLaunchUrl).not.toMatch(/\/\/[^/]*:[^/]*@/);
  });
});
