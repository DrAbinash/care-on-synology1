// Pluggable PACS provider abstraction.
//
// Two providers are recognised today:
//   - "orthanc"  — REST-API native; rich endpoints under /studies, /patients, etc.
//                  Configured via ORTHANC_URL / ORTHANC_USERNAME / ORTHANC_PASSWORD.
//   - "conquest" — DICOM-over-TCP server with a CGI-style HTTP interface
//                  (default port 5678) at /cgi-bin/dgate. Has limited REST
//                  capabilities; many features require local file access on the
//                  Conquest host (dicom.ini, worklist directory).
//
// The viewer/browser routes in `routes/pacs.ts` remain Orthanc-specific.
// This abstraction is what new code (DICOM nodes, MWL push, share links)
// uses so it can branch by provider.

export type PacsProviderType = "orthanc" | "conquest" | "none";

export interface PacsProvider {
  type: PacsProviderType;
  displayName: string;
  baseUrl: string | null;
  // Reachability check — quick HTTP HEAD/GET. Real DIMSE C-ECHO requires a
  // native DICOM library; this is a lightweight liveness probe.
  health(): Promise<{ ok: boolean; status?: number; message?: string }>;
  // Capability hints that drive the UI ("Show CD export button", etc.).
  capabilities: {
    studyArchive: boolean;        // Can return a ZIP of a study's DICOM files
    teleradiologyShare: boolean;  // Can mint signed share URLs natively
    mwlPush: boolean;             // Can accept MWL entries via REST
    instanceMetadata: boolean;    // Can return DICOM tags as JSON
  };
}

class OrthancProvider implements PacsProvider {
  readonly type = "orthanc" as const;
  readonly displayName = "Orthanc";
  readonly baseUrl: string | null;
  private readonly user: string;
  private readonly pass: string;
  readonly capabilities = {
    studyArchive: true,
    teleradiologyShare: true,
    mwlPush: true,
    instanceMetadata: true,
  };
  constructor(url: string, user: string, pass: string) {
    this.baseUrl = url || null;
    this.user = user;
    this.pass = pass;
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.user && this.pass) {
      h["Authorization"] = "Basic " + Buffer.from(`${this.user}:${this.pass}`).toString("base64");
    }
    return h;
  }
  async health(): Promise<{ ok: boolean; status?: number; message?: string }> {
    if (!this.baseUrl) return { ok: false, message: "ORTHANC_URL not set" };
    try {
      const resp = await fetch(`${this.baseUrl}/system`, { headers: this.headers() });
      return { ok: resp.ok, status: resp.status, message: resp.ok ? "OK" : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "fetch failed" };
    }
  }
}

class ConquestProvider implements PacsProvider {
  readonly type = "conquest" as const;
  readonly displayName = "Conquest";
  readonly baseUrl: string | null;
  readonly capabilities = {
    studyArchive: false,        // Conquest can build ZIPs but only via lua scripts
    teleradiologyShare: false,  // No native signed URLs
    mwlPush: false,             // Requires file-system write to WL directory
    instanceMetadata: true,     // dgate CGI returns basic patient/study lists
  };
  constructor(url: string) {
    this.baseUrl = url || null;
  }
  async health(): Promise<{ ok: boolean; status?: number; message?: string }> {
    if (!this.baseUrl) return { ok: false, message: "CONQUEST_URL not set" };
    try {
      // Conquest's built-in HTTP server returns the dgate landing page on GET /.
      const resp = await fetch(`${this.baseUrl}/`, { method: "GET" });
      return { ok: resp.ok, status: resp.status, message: resp.ok ? "OK" : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "fetch failed" };
    }
  }
}

class NoneProvider implements PacsProvider {
  readonly type = "none" as const;
  readonly displayName = "Not configured";
  readonly baseUrl = null;
  readonly capabilities = {
    studyArchive: false, teleradiologyShare: false, mwlPush: false, instanceMetadata: false,
  };
  async health() { return { ok: false, message: "No PACS provider configured" }; }
}

import { getRadiologyConfig } from "./pacsConfig.js";

export async function getPacsProvider(): Promise<PacsProvider> {
  const cfg = await getRadiologyConfig();
  const explicit = (process.env.PACS_PROVIDER || cfg.default_viewer || "").toLowerCase();
  
  // Use DB values primarily, falling back to env/defaults
  const orthancUrl = (cfg.orthanc.dicomWebUrl || "").replace(/\/dicom-web$/, "").replace(/\/$/, "");
  const conquestUrl = (cfg.conquest.wadoUrl || "").replace(/\/$/, ""); // Or conquest wado URL

  if (explicit === "conquest" || (!explicit && conquestUrl && !orthancUrl)) {
    return new ConquestProvider(conquestUrl);
  }
  if (explicit === "orthanc" || explicit === "ohif" || (!explicit && orthancUrl)) {
    return new OrthancProvider(orthancUrl, process.env.ORTHANC_USERNAME || "", process.env.ORTHANC_PASSWORD || "");
  }
  return new NoneProvider();
}

// Block obviously dangerous targets to limit SSRF abuse. The tcpProbe is
// reachable from any authenticated session, so we refuse cloud metadata
// services, loopback, and private/link-local network ranges.
const SSRF_BLOCK_LITERAL = new Set([
  "169.254.169.254",   // AWS / GCP / Azure / DigitalOcean metadata
  "100.100.100.200",   // Alibaba Cloud metadata
  "fd00:ec2::254",     // AWS IPv6 metadata
  "localhost",
  "::1",               // IPv6 loopback
  "0.0.0.0",
]);

function parseIPv4Parts(h: string): number[] | null {
  const parts = h.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIPv4(h: string): boolean {
  const p = parseIPv4Parts(h);
  if (!p) return false;
  const [a, b] = p;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local (covers all, not just 169.254.169.x)
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — CGNAT / shared address space
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

function expandIPv6(addr: string): string | null {
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const full = [...left, ...Array(missing).fill("0"), ...right];
  return full.map((g) => g.padStart(4, "0")).join(":");
}

function extractMappedIPv4(h: string): string | null {
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  const lower = bare.toLowerCase();

  const dottedRe = /^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
  const dottedMatch = lower.match(dottedRe);
  if (dottedMatch) {
    const prefix = dottedMatch[1];
    const ipv4 = dottedMatch[2];
    const expanded = expandIPv6(prefix + ":0:0");
    if (expanded && expanded.startsWith("0000:0000:0000:0000:0000:ffff:")) return ipv4;
  }

  const expanded = expandIPv6(lower);
  if (!expanded) return null;
  const groups = expanded.split(":");
  if (
    groups[0] === "0000" && groups[1] === "0000" && groups[2] === "0000" &&
    groups[3] === "0000" && groups[4] === "0000" && groups[5] === "ffff"
  ) {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(h: string): boolean {
  // Strip brackets like [::1]
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (bare === "::1") return true;
  const lower = bare.toLowerCase();
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // fc00::/7 — ULA (fc and fd)
  if (/^f[cd]/i.test(lower)) return true;
  return false;
}

export function isBlockedHost(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return "host is empty";
  if (process.env.ALLOW_PRIVATE_IPS === "true") {
    if (SSRF_BLOCK_LITERAL.has(h)) return `${h} is a blocked address`;
    return null;
  }
  if (SSRF_BLOCK_LITERAL.has(h)) return `${h} is a blocked address`;
  if (isPrivateIPv4(h)) return `${h} is a private/loopback address and is blocked`;
  if (isPrivateIPv6(h)) return `${h} is a private/loopback IPv6 address and is blocked`;
  const mappedV4 = extractMappedIPv4(h);
  if (mappedV4) {
    if (SSRF_BLOCK_LITERAL.has(mappedV4)) return `${h} maps to blocked address ${mappedV4}`;
    if (isPrivateIPv4(mappedV4)) return `${h} maps to private/loopback address ${mappedV4} and is blocked`;
  }
  return null;
}

// Resolve a hostname to its IP addresses and check every resolved address
// against the private-range blocklist. Returns either a blocking error string
// or the first safe resolved IP to connect to. By returning the IP, callers
// avoid a second DNS lookup that could be exploited by DNS rebinding.
type HostCheckResult =
  | { ok: false; error: string }
  | { ok: true; resolvedIp: string };

export async function resolveAndCheckHost(host: string): Promise<HostCheckResult> {
  // Check literal string first (catches bare IPs and "localhost").
  const literalBlocked = isBlockedHost(host);
  if (literalBlocked) return { ok: false, error: literalBlocked };

  const dns = await import("node:dns/promises");
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: `Could not resolve host: ${host}` };
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, error: `No addresses resolved for: ${host}` };
  }
  for (const { address } of addresses) {
    const blocked = isBlockedHost(address);
    if (blocked) {
      return { ok: false, error: `${host} resolves to a blocked address (${address}): ${blocked}` };
    }
  }
  // Return the first resolved IP so callers can connect to it directly,
  // eliminating the second OS-level DNS lookup and the rebinding race window.
  return { ok: true, resolvedIp: addresses[0].address };
}

// TCP reachability check used by the DICOM Node "Test" button. Real C-ECHO
// requires a native DIMSE library; this verifies that the modality is at
// least listening on the configured AE port.
export async function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<{
  ok: boolean; latencyMs: number; message: string;
}> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, latencyMs: 0, message: `Invalid port ${port}` };
  }
  // Resolve the hostname once, check all resolved IPs against the blocklist,
  // then connect to the returned IP directly — no second lookup, no rebinding race.
  const check = await resolveAndCheckHost(host);
  if (!check.ok) return { ok: false, latencyMs: 0, message: check.error };
  const connectIp = check.resolvedIp;

  const net = await import("node:net");
  const start = Date.now();
  return await new Promise((resolve) => {
    const sock = new net.Socket();
    let didResolve = false;
    const finish = (ok: boolean, msg: string) => {
      if (didResolve) return;
      didResolve = true;
      try { sock.destroy(); } catch { /* noop */ }
      resolve({ ok, latencyMs: Date.now() - start, message: msg });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true, `TCP connect OK (${Date.now() - start}ms)`));
    sock.once("timeout", () => finish(false, `Timed out after ${timeoutMs}ms`));
    sock.once("error", (err) => finish(false, err.message));
    try {
      sock.connect(port, connectIp);
    } catch (err) {
      finish(false, err instanceof Error ? err.message : "connect threw");
    }
  });
}
