import { describe, it, expect } from "vitest";
import { probeHttp, readModeEndpoints, type DiagnosticsIO } from "./radiologyDeploymentDiagnostics";

// Ticket M1.3 — the IO-boundary pieces of the canonical diagnostics service,
// driven entirely by an injected fetch so network failure modes (timeouts,
// redirect loops, dead Cloudflare tunnels…) are reproducible in-process.
// (Database-backed sections are proven by the PG + browser verification run.)

function fakeResponse(status: number, opts: { location?: string; json?: unknown; acao?: string } = {}): Response {
  const headers = new Headers();
  if (opts.location) headers.set("location", opts.location);
  if (opts.acao) headers.set("access-control-allow-origin", opts.acao);
  return {
    status,
    headers,
    json: async () => opts.json,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function ioWith(fetchImpl: (url: string) => Promise<Response> | Response): DiagnosticsIO {
  let t = 0;
  return {
    fetch: (async (input: string | URL) => fetchImpl(String(input))) as unknown as typeof fetch,
    tlsInspect: async () => ({ ok: false, error: "not used" }),
    dnsLookup: async () => ({ addresses: [] }),
    now: () => (t += 5),
  };
}

describe("probeHttp", () => {
  it("returns status, latency and parsed JSON on success", async () => {
    const io = ioWith(() => fakeResponse(200, { json: { Version: "1.12.4" }, acao: "*" }));
    const r = await probeHttp(io, "http://orthanc:8042/system", { parseJson: true });
    expect(r.reachable).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.bodyJson).toEqual({ Version: "1.12.4" });
    expect(r.allowOrigin).toBe("*");
    expect(r.latencyMs).toBeGreaterThan(0);
    expect(r.redirectLoop).toBe(false);
  });

  it("surfaces transport failures as unreachable with the error preserved", async () => {
    const io = ioWith(() => {
      throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
    });
    const r = await probeHttp(io, "http://10.9.9.9:1/dead");
    expect(r.reachable).toBe(false);
    expect(r.error).toBe("fetch failed");
  });

  it("maps AbortSignal timeouts to a readable message", async () => {
    const io = ioWith(() => {
      throw Object.assign(new Error("This operation was aborted"), { name: "TimeoutError" });
    });
    const r = await probeHttp(io, "http://slow.example/", { timeoutMs: 1234 });
    expect(r.reachable).toBe(false);
    expect(r.error).toBe("timeout after 1234ms");
  });

  it("follows redirects manually and records the chain", async () => {
    const io = ioWith((url) =>
      url.endsWith("/a") ? fakeResponse(301, { location: "/b" })
      : url.endsWith("/b") ? fakeResponse(302, { location: "/c" })
      : fakeResponse(200, {}),
    );
    const r = await probeHttp(io, "http://x.example/a");
    expect(r.httpStatus).toBe(200);
    expect(r.chain).toEqual(["http://x.example/a", "http://x.example/b", "http://x.example/c"]);
    expect(r.redirectLoop).toBe(false);
  });

  it("detects redirect LOOPS instead of spinning (the http↔https proxy fight)", async () => {
    const io = ioWith((url) =>
      url.startsWith("https://") ? fakeResponse(301, { location: "http://x.example/" }) : fakeResponse(301, { location: "https://x.example/" }),
    );
    const r = await probeHttp(io, "http://x.example/");
    expect(r.redirectLoop).toBe(true);
    expect(r.error).toContain("redirect loop");
  });

  it("caps redirect chains at maxRedirects", async () => {
    let n = 0;
    const io = ioWith(() => fakeResponse(302, { location: `/hop-${n++}` }));
    const r = await probeHttp(io, "http://x.example/start", { maxRedirects: 3 });
    expect(r.error).toContain("more than 3 redirects");
  });
});

describe("readModeEndpoints — server-side mirror of the launcher keys", () => {
  it("reads LAN from the existing keys and remote modes from suffixed keys", () => {
    const rows = [
      { key: "ohif_base_url", category: "viewer", value: "http://192.168.1.137:3010" },
      { key: "weasis_wado_url", category: "viewer", value: "http://192.168.1.137:8042/wado" },
      { key: "ohif_base_url_tailscale", category: "viewer", value: "http://100.65.255.115:3010" },
      { key: "wado_base_url_cloudflare", category: "viewer", value: "https://pacs.clinic.com/wado" },
      { key: "ohif_base_url_cloudflare", category: "viewer", value: "https://pacs.clinic.com/ohif" },
    ];
    const eps = readModeEndpoints(rows);
    expect(eps.LAN.viewerUrl).toBe("http://192.168.1.137:3010");
    expect(eps.LAN.wadoUrl).toBe("http://192.168.1.137:8042/wado");
    expect(eps.TAILSCALE.viewerUrl).toBe("http://100.65.255.115:3010");
    expect(eps.CLOUDFLARE.wadoUrl).toBe("https://pacs.clinic.com/wado");
    expect(eps.PUBLIC.viewerUrl).toBe("");
  });

  it("legacy public_pacs_host still derives a PUBLIC viewer URL, and legacy wado_uri_base_url backs LAN WADO", () => {
    const eps = readModeEndpoints([
      { key: "public_pacs_host", category: "viewer", value: "pacs.clinic.com" },
      { key: "wado_uri_base_url", category: "viewer", value: "http://192.168.1.137:8042/wado" },
    ]);
    expect(eps.PUBLIC.viewerUrl).toBe("https://pacs.clinic.com");
    expect(eps.LAN.wadoUrl).toBe("http://192.168.1.137:8042/wado");
  });
});
