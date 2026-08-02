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
    TAILSCALE: (env.VITE_NETWORK_TAILSCALE_HOST as string) || "100.65.255.115",
    PUBLIC: (env.VITE_NETWORK_PUBLIC_DOMAIN as string) || "caredeoghar.com",
  } as Record<NetworkProfile, string>,
  orthancHttpPort: intVal(env.VITE_ORTHANC_HTTP_PORT, 8042),
  ohifPort: intVal(env.VITE_OHIF_HTTP_PORT, 3010),
  erpPort: intVal(env.VITE_ERP_HTTP_PORT, 8888),
};

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
  if (settings.network_tailscale_host?.trim()) state.hosts.TAILSCALE = settings.network_tailscale_host.trim();
  if (settings.network_public_domain?.trim()) state.hosts.PUBLIC = settings.network_public_domain.trim();
  if (settings.orthanc_http_port) state.orthancHttpPort = intVal(settings.orthanc_http_port, state.orthancHttpPort);
  if (settings.ohif_http_port) state.ohifPort = intVal(settings.ohif_http_port, state.ohifPort);
  if (settings.erp_http_port) state.erpPort = intVal(settings.erp_http_port, state.erpPort);
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
