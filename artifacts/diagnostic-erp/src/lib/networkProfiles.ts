/**
 * networkProfiles.ts — Single source of truth for network hosts in the ERP UI.
 *
 * GOVERNANCE (DEVELOPMENT_PRINCIPLES.md — "Never Hardcode"):
 * The LAN IP, Tailscale IP, and public domain used to be hardcoded in
 * viewerService.ts, NetworkControlCenter.tsx, PacsSettings.tsx and others.
 * They now live HERE ONLY.
 *
 * Value priority (highest wins):
 *   1. Admin settings from the database (pacs_settings), applied at runtime
 *      via applyNetworkSettings() — no rebuild needed to change them.
 *   2. Vite build-time env vars (VITE_NETWORK_*) — set in .env before build.
 *   3. Defaults below — identical to the previously hardcoded values, so
 *      existing deployments behave exactly as before.
 */

export type NetworkProfile = "LAN" | "TAILSCALE" | "PUBLIC";

const env = (import.meta as any).env || {};

function intVal(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Mutable runtime state. Do not export directly — use the accessors. */
const state = {
  hosts: {
    LAN: (env.VITE_NETWORK_LAN_HOST as string) || "172.16.1.139",
    LAN_ALT: (env.VITE_NETWORK_LAN_HOST_ALT as string) || "",
    TAILSCALE: (env.VITE_NETWORK_TAILSCALE_HOST as string) || "100.65.255.115",
    PUBLIC: (env.VITE_NETWORK_PUBLIC_DOMAIN as string) || "caredeoghar.com",
  } as Record<NetworkProfile | "LAN_ALT", string>,
  orthancHttpPort: intVal(env.VITE_ORTHANC_HTTP_PORT, 8042),
  ohifPort: intVal(env.VITE_OHIF_HTTP_PORT, 3010),
  erpPort: intVal(env.VITE_ERP_HTTP_PORT, 8888),
};

const NETWORK_SETTINGS_CACHE_KEY = "erp_network_hosts_cache_v2";
const LAST_WORKING_LAN_HOST_KEY = "erp_last_working_lan_host";

/** Build-time default LAN — used to drop stale cached IPs after NAS moves. */
const BUILD_DEFAULT_LAN = (env.VITE_NETWORK_LAN_HOST as string) || "172.16.1.139";

/**
 * Hydrate hosts/ports from the admin PACS settings record.
 * Safe to call repeatedly; unknown/empty keys are ignored.
 * Recognized keys: network_lan_host, network_tailscale_host,
 * network_public_domain, orthanc_http_port, ohif_http_port, erp_http_port.
 */
export function applyNetworkSettings(
  settings: Record<string, string> | null | undefined,
): void {
  if (!settings) return;
  if (settings.network_lan_host?.trim()) state.hosts.LAN = settings.network_lan_host.trim();
  if (settings.network_lan_host_alt?.trim()) state.hosts.LAN_ALT = settings.network_lan_host_alt.trim();
  if (settings.network_tailscale_host?.trim()) state.hosts.TAILSCALE = settings.network_tailscale_host.trim();
  if (settings.network_public_domain?.trim()) state.hosts.PUBLIC = settings.network_public_domain.trim();
  if (settings.orthanc_http_port) state.orthancHttpPort = intVal(settings.orthanc_http_port, state.orthancHttpPort);
  if (settings.ohif_http_port) state.ohifPort = intVal(settings.ohif_http_port, state.ohifPort);
  if (settings.erp_http_port) state.erpPort = intVal(settings.erp_http_port, state.erpPort);
  try {
    window.localStorage.setItem(NETWORK_SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Restore last-known network hosts (used before LAN failover bootstrap). */
export function hydrateNetworkSettingsFromCache(): void {
  if (typeof window === "undefined") return;
  try {
    // Drop v1 cache — may contain the obsolete 192.168.1.137 LAN IP.
    window.localStorage.removeItem("erp_network_hosts_cache");
    const last = window.localStorage.getItem(LAST_WORKING_LAN_HOST_KEY)?.trim();
    if (last === "192.168.1.137" && BUILD_DEFAULT_LAN !== "192.168.1.137") {
      window.localStorage.removeItem(LAST_WORKING_LAN_HOST_KEY);
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = window.localStorage.getItem(NETWORK_SETTINGS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed.network_lan_host?.trim()) {
      const cached = parsed.network_lan_host.trim();
      // Drop stale LAN IPs left in cache after a NAS address change (e.g.
      // 192.168.1.137 → 172.16.1.139) — wrong redirects broke login on some PCs.
      if (cached !== BUILD_DEFAULT_LAN && cached === "192.168.1.137") {
        /* ignore obsolete cache */
      } else {
        state.hosts.LAN = cached;
      }
    }
    if (parsed.network_lan_host_alt?.trim()) state.hosts.LAN_ALT = parsed.network_lan_host_alt.trim();
    if (parsed.network_tailscale_host?.trim()) state.hosts.TAILSCALE = parsed.network_tailscale_host.trim();
    if (parsed.network_public_domain?.trim()) state.hosts.PUBLIC = parsed.network_public_domain.trim();
    if (parsed.orthanc_http_port) state.orthancHttpPort = intVal(parsed.orthanc_http_port, state.orthancHttpPort);
    if (parsed.ohif_http_port) state.ohifPort = intVal(parsed.ohif_http_port, state.ohifPort);
    if (parsed.erp_http_port) state.erpPort = intVal(parsed.erp_http_port, state.erpPort);
  } catch {
    /* ignore */
  }
}

/** Host (IP or bare domain) for a given network profile. */
export function hostForProfile(profile: NetworkProfile): string {
  return state.hosts[profile];
}

/** All configured hosts, e.g. for rewriting URLs between profiles. */
export function knownHosts(): string[] {
  return [state.hosts.LAN, state.hosts.TAILSCALE, state.hosts.PUBLIC];
}

export function orthancHttpPort(): number {
  return state.orthancHttpPort;
}

export function ohifPort(): number {
  return state.ohifPort;
}

export function erpPort(): number {
  return state.erpPort;
}

/** Orthanc REST base for a profile, e.g. "http://<lan-host>:8042". */
export function orthancBaseForProfile(profile: NetworkProfile): string {
  return `http://${state.hosts[profile]}:${state.orthancHttpPort}`;
}

/** Orthanc REST base for a raw host string. */
export function orthancBaseForHost(host: string): string {
  return `http://${host}:${state.orthancHttpPort}`;
}

/** OHIF base for a profile, e.g. "http://<lan-host>:3010". */
export function ohifBaseForProfile(profile: NetworkProfile): string {
  return `http://${state.hosts[profile]}:${state.ohifPort}`;
}

/** Public site base, e.g. "https://<public-domain>". */
export function publicBaseUrl(): string {
  return `https://${state.hosts.PUBLIC}`;
}

/** ERP SPA origin on LAN, e.g. "http://172.16.1.139:8888/erp". */
export function erpLanOrigin(): string {
  return erpLanOriginForHost(state.hosts.LAN);
}

/** ERP SPA origin for a specific LAN host (primary or alt NAS IP). */
export function erpLanOriginForHost(host: string): string {
  const basePath = String(env.BASE_URL || "/erp/").replace(/\/?$/, "/");
  return `http://${host}:${state.erpPort}${basePath}`;
}

/** Primary + optional alternate NAS LAN IPs (Synology dual-homed setups). */
export function lanHostAlternates(): string[] {
  const out: string[] = [];
  const add = (h: string | undefined) => {
    const t = h?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(state.hosts.LAN);
  add(state.hosts.LAN_ALT);
  return out;
}

/** Remember which LAN IP worked on this PC (subnet/VLAN varies by desk). */
export function recordWorkingLanHost(host: string): void {
  const h = host.trim();
  if (!h || !lanHostAlternates().some((a) => a.toLowerCase() === h.toLowerCase())) return;
  try {
    window.localStorage.setItem(LAST_WORKING_LAN_HOST_KEY, h);
  } catch {
    /* ignore */
  }
}

/** Last LAN host that worked on this workstation, or null if never recorded. */
export function getLastWorkingLanHost(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const last = window.localStorage.getItem(LAST_WORKING_LAN_HOST_KEY)?.trim();
    if (last && lanHostAlternates().some((a) => a.toLowerCase() === last.toLowerCase())) {
      return last;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Best LAN host for failover on this workstation. */
export function preferredLanHost(): string {
  try {
    const last = window.localStorage.getItem(LAST_WORKING_LAN_HOST_KEY)?.trim();
    if (last && lanHostAlternates().some((a) => a.toLowerCase() === last.toLowerCase())) {
      return last;
    }
  } catch {
    /* ignore */
  }
  return state.hosts.LAN;
}

/** ERP SPA origin on the public domain, e.g. "https://caredeoghar.com/erp". */
export function erpPublicOrigin(): string {
  const basePath = String(env.BASE_URL || "/erp/").replace(/\/?$/, "/");
  return `https://${state.hosts.PUBLIC}${basePath}`;
}

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.|localhost$)/i;

/** True when this hostname is a private/LAN address (not the public domain). */
export function isLanHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (lanHostAlternates().some((a) => a.toLowerCase() === h)) return true;
  return PRIVATE_IP.test(h);
}

/** True when the browser is on the clinic's public ERP domain. */
export function isPublicErpHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  const pub = state.hosts.PUBLIC.toLowerCase();
  return h === pub || h === `www.${pub}` || h === `erp.${pub}`;
}

/**
 * Rewrite any known host inside a URL to the host of the target profile.
 */
export function rewriteUrlToProfile(url: string, profile: NetworkProfile): string {
  if (!url) return "";
  const target = state.hosts[profile];
  let out = url;
  for (const h of knownHosts()) {
    if (h && h !== target) {
      out = out.split(h).join(target);
    }
  }
  return out;
}
