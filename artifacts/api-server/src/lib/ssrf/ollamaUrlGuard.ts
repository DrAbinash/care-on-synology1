/**
 * Ollama / AI egress URL SSRF guard — PURE (no DB, no network). Gate G2 (P0),
 * hardened in P5.
 *
 * Extracted from routes/radiologyOllama.ts so the security-critical guard is
 * independently unit-testable (the route module imports @workspace/db, which
 * throws without DATABASE_URL). Behaviour is unchanged except the P5 hardening
 * documented on `canonicalHostsForGuard`.
 *
 * Policy (in order):
 *   1. ALWAYS_BLOCKED  — metadata / unspecified: never reachable, even in LAN mode.
 *   2. AI_EGRESS_ALLOWLIST — if set, an exact host[:port] allowlist is authoritative.
 *   3. PRIVATE_RANGES  — private / LAN / CGNAT: blocked UNLESS Local/LAN mode.
 */

// Never reachable, regardless of Local/LAN mode.
export const ALWAYS_BLOCKED: RegExp[] = [
  /^169\.254\.169\.254$/,             // cloud instance metadata (AWS/GCP/Azure/OpenStack)
  /^metadata(\.google)?\.internal$/i, // GCP metadata hostname
  /^0\.0\.0\.0$/,
  /^\[?::\]?$/,                        // IPv6 unspecified
];

// Private / LAN / CGNAT ranges — require Local/LAN mode when no allowlist is set.
export const PRIVATE_RANGES: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,             // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // 100.64.0.0/10 CGNAT / Tailscale tailnet
  /^\[?::1\]?$/,                       // IPv6 loopback
  /^\[?fe80::/i,                      // IPv6 link-local
  /^\[?f[cd][0-9a-f]{2}:/i,           // IPv6 unique-local fc00::/7
];

/** Optional exact-endpoint egress allowlist from AI_EGRESS_ALLOWLIST
 *  (comma-separated host or host:port). Empty ⇒ no allowlist (legacy behaviour). */
export function egressAllowlist(): Set<string> {
  return new Set(
    (process.env.AI_EGRESS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Canonicalise the URL hostname for SSRF matching. The WHATWG URL parser leaves
 * two evasions that defeated the raw-regex checks (verified against Node's
 * parser): a trailing dot (`localhost.`, `127.0.0.1.`) that dodges the anchored
 * regexes, and IPv4-mapped IPv6 (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`,
 * `[::ffff:169.254.169.254]`) that reaches loopback / metadata / LAN without
 * matching any IPv4 rule. Returns the de-bracketed, trailing-dot-stripped host
 * PLUS any embedded IPv4 so every form is checked. Pure + unit-tested (P5).
 */
export function canonicalHostsForGuard(rawHostname: string): string[] {
  const hosts = new Set<string>();
  const host = rawHostname.trim().toLowerCase();
  const debracketed = host.replace(/^\[/, "").replace(/\]$/, "");
  const noTrailingDot = debracketed.replace(/\.+$/, "");
  hosts.add(host);
  hosts.add(debracketed);
  hosts.add(noTrailingDot);
  // `.+` (not `[^:]+`): the embedded form after `::ffff:` may itself contain a
  // colon (`a9fe:a9fe`, `7f00:1`) once the URL parser normalises the mapped IPv6.
  const mapped = /^::(?:ffff:)?(.+)$/i.exec(debracketed);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) {
      hosts.add(rest); // dotted form, e.g. ::ffff:127.0.0.1
    } else {
      // Two hex groups, e.g. ::ffff:7f00:1 or ::ffff:a9fe:a9fe → dotted IPv4.
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
      if (hex) {
        const h1 = parseInt(hex[1], 16), h2 = parseInt(hex[2], 16);
        hosts.add(`${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`);
      }
    }
  }
  return [...hosts];
}

export function validateOllamaUrl(raw: string, allowLocal = false): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "Invalid URL format" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// are allowed" };
  }
  const host = u.hostname;
  // Every canonical form of the host (de-bracketed, trailing-dot-stripped, and
  // any embedded IPv4 from IPv4-mapped IPv6) must clear the guards.
  const candidates = canonicalHostsForGuard(host);

  // 1. Metadata / unspecified endpoints are NEVER reachable, even in LAN mode.
  for (const re of ALWAYS_BLOCKED) {
    if (candidates.some((h) => re.test(h))) return { ok: false, reason: `Blocked host (${host})` };
  }

  // 2. An explicit allowlist is authoritative — even in Local/LAN mode.
  const allow = egressAllowlist();
  if (allow.size > 0) {
    const hostKey = host.toLowerCase();
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (!allow.has(hostKey) && !allow.has(`${hostKey}:${port}`)) {
      return { ok: false, reason: `Host not in AI egress allowlist (${host})` };
    }
    return { ok: true, url: u };
  }

  // 3. No allowlist configured: private/LAN/CGNAT require Local/LAN mode.
  if (!allowLocal) {
    for (const re of PRIVATE_RANGES) {
      if (candidates.some((h) => re.test(h))) {
        return {
          ok: false,
          reason: `Private/LAN addresses require "Local / LAN mode" to be enabled in Settings → Radiology → AI Assistant (${host})`,
        };
      }
    }
  }
  return { ok: true, url: u };
}
