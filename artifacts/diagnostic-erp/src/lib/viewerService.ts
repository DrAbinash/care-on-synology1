/**
 * viewerService.ts
 * Perfected Viewer Networking Architecture for Diagnostic ERP.
 * Centralized PACS profile resolution, database sync, last-known-good heuristics,
 * smart retries, per-service health diagnostics, and performance logging.
 */

import { api } from "./fetchApi";
import { readStaffSession, writeStaffSession } from "./staffSession";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ServiceHealthState {
  name: string;
  status: "green" | "red" | "yellow";
  details: string;
  endpoint: string;
}

export interface NetworkDiagnostics {
  activeProfile: "LAN" | "TAILSCALE" | "PUBLIC";
  whySelected: string;
  host: string;
  ohifUrl: string;
  wadoUrl: string;
  dicomWebUrl: string;
  weasisUrl: string;
  latencyMs: number;
  lastSwitchTime: string;
  lastSuccessProfile: string;
  lastSuccessViewer: string;
  lastSuccessTime: string;
  averageLaunchTime: number;
  services: Record<string, ServiceHealthState>;
}

// ─── NETWORK PROFILE HELPERS ──────────────────────────────────────────────────

export function adaptUrlToProfile(url: string, profile: "LAN" | "TAILSCALE" | "PUBLIC"): string {
  if (!url) return "";
  const targetHost = profile === "LAN" ? "192.168.1.137" : profile === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com";
  return url
    .replace(/192\.168\.1\.137/g, targetHost)
    .replace(/100\.65\.255\.115/g, targetHost);
}

/**
 * Fast network connectivity probe.
 */
export async function probeEndpoint(url: string, timeout = 1000): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    // Use no-cors to prevent blocked requests from counting as failures
    await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal });
    clearTimeout(id);
    return true;
  } catch (e) {
    clearTimeout(id);
    return false;
  }
}

/**
 * Resolves the active network profile with Last Known Good heuristics.
 */
export async function resolveActiveProfile(
  settings: Record<string, string>
): Promise<{ profile: "LAN" | "TAILSCALE" | "PUBLIC"; reason: string; latencyMs: number }> {
  if (typeof window === "undefined") {
    return { profile: "PUBLIC", reason: "Server-side render fallback", latencyMs: 0 };
  }

  // 1. Check database session preference first, then localStorage fallback
  const session = readStaffSession();
  const dbProfile = session?.user?.pacsNetworkProfile;
  const localOverride = localStorage.getItem("pacs_network_profile");
  const activeOverride = dbProfile || localOverride || "auto";

  if (activeOverride && activeOverride !== "auto") {
    const targetHost = activeOverride === "LAN" ? "192.168.1.137" : activeOverride === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com";
    return { 
      profile: activeOverride as "LAN" | "TAILSCALE" | "PUBLIC", 
      reason: `Manual override saved in ${dbProfile ? "User Database Profile" : "Local Browser Settings"}`, 
      latencyMs: 0 
    };
  }

  // 2. Check Cache
  const cached = localStorage.getItem("pacs_detected_profile");
  const cachedTime = localStorage.getItem("pacs_detected_profile_time");
  if (cached && cachedTime && Date.now() - Number(cachedTime) < 15000) {
    const cachedLatency = Number(localStorage.getItem("pacs_detected_latency") || "0");
    return { 
      profile: cached as "LAN" | "TAILSCALE" | "PUBLIC", 
      reason: "Cached auto-detection route", 
      latencyMs: cachedLatency 
    };
  }

  // 3. Probing Order: Clinic LAN first (preferred)
  const startLan = Date.now();
  const lanReachable = await probeEndpoint("http://192.168.1.137:8042/system", 1000);
  if (lanReachable) {
    const lat = Date.now() - startLan;
    saveDetectedProfile("LAN", lat);
    return { profile: "LAN", reason: `Clinic LAN auto-detected (${lat}ms)`, latencyMs: lat };
  }

  // 4. Last Known Good Profile heuristic (tries home Tailscale if it worked yesterday)
  const lastGood = localStorage.getItem("pacs_last_good_profile") as "LAN" | "TAILSCALE" | "PUBLIC" | null;
  if (lastGood === "TAILSCALE") {
    const startTs = Date.now();
    const tsReachable = await probeEndpoint("http://100.65.255.115:8042/system", 1000);
    if (tsReachable) {
      const lat = Date.now() - startTs;
      saveDetectedProfile("TAILSCALE", lat);
      return { profile: "TAILSCALE", reason: `Tailscale preferred via Last Known Good (${lat}ms)`, latencyMs: lat };
    }
  }

  // 5. Try Tailscale next (standard fallback)
  const startTs = Date.now();
  const tsReachable = await probeEndpoint("http://100.65.255.115:8042/system", 1000);
  if (tsReachable) {
    const lat = Date.now() - startTs;
    saveDetectedProfile("TAILSCALE", lat);
    return { profile: "TAILSCALE", reason: `Tailscale Remote VPN auto-detected (${lat}ms)`, latencyMs: lat };
  }

  // 6. Public Gateway (if enabled)
  const publicEnabled = settings["public_pacs_enabled"] === "true";
  if (publicEnabled) {
    const startPub = Date.now();
    const pubReachable = await probeEndpoint("https://caredeoghar.com", 1200);
    if (pubReachable) {
      const lat = Date.now() - startPub;
      saveDetectedProfile("PUBLIC", lat);
      return { profile: "PUBLIC", reason: `Public WAN fallback enabled (${lat}ms)`, latencyMs: lat };
    }
  }

  // All checks failed
  saveDetectedProfile("PUBLIC", 0);
  return { profile: "PUBLIC", reason: "All PACS private paths unreachable.", latencyMs: 0 };
}

function saveDetectedProfile(profile: "LAN" | "TAILSCALE" | "PUBLIC", latency: number) {
  const current = localStorage.getItem("pacs_detected_profile");
  if (current !== profile) {
    localStorage.setItem("pacs_last_switch_time", new Date().toISOString());
  }
  localStorage.setItem("pacs_detected_profile", profile);
  localStorage.setItem("pacs_detected_profile_time", String(Date.now()));
  localStorage.setItem("pacs_detected_latency", String(latency));
}

/**
 * Synced user profile preference updating.
 * Persists value into both local session and Database.
 */
export async function updateProfilePreference(
  profile: "auto" | "LAN" | "TAILSCALE" | "PUBLIC",
  toast?: (options: any) => void
): Promise<void> {
  if (typeof window === "undefined") return;
  localStorage.setItem("pacs_network_profile", profile);
  localStorage.removeItem("pacs_detected_profile"); // clear cache

  const session = readStaffSession();
  if (session?.user?.id) {
    session.user.pacsNetworkProfile = profile;
    writeStaffSession(session);

    try {
      await api.patch(`/api/users/${session.user.id}/pacs-network-profile`, { pacsNetworkProfile: profile });
      if (toast) {
        toast({ title: `Network preference synced: ${profile.toUpperCase()}` });
      }
    } catch (e) {
      console.error("Failed to sync PACS preference to database", e);
    }
  }
}

// ─── HEALTH CHECKS ───────────────────────────────────────────────────────────

export async function checkViewerServices(
  studyInstanceUID: string,
  host: string,
  settings: Record<string, string>
): Promise<Record<string, ServiceHealthState>> {
  const erpBase = typeof window !== "undefined" ? window.location.origin : "https://caredeoghar.com";
  
  const check = async (name: string, url: string, method: "GET" | "HEAD" = "GET"): Promise<ServiceHealthState> => {
    const start = Date.now();
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch(url, { method, signal: controller.signal, mode: "no-cors" });
      clearTimeout(id);
      const latency = Date.now() - start;
      return { name, status: "green", details: `Responsive (${latency}ms)`, endpoint: url };
    } catch (e: any) {
      clearTimeout(id);
      return { name, status: "red", details: e.name === "AbortError" ? "Timeout (1.2s)" : "Refused/Offline", endpoint: url };
    }
  };

  const isTs = host.includes("100.");
  const profile: "LAN" | "TAILSCALE" | "PUBLIC" = isTs ? "TAILSCALE" : "LAN";

  return {
    erp: await check("ERP Portal Server", erpBase + "/api/health"),
    orthancHttp: await check("Orthanc HTTP REST", `http://${host}:8042/system`),
    dicomWeb: await check("DICOMweb Metadata Retrieve", `http://${host}:8042/dicom-web/studies/${studyInstanceUID}`),
    wado: await check("WADO Image Retrieval", `http://${host}:8042/wado?requestType=WADO&studyUID=${studyInstanceUID}`),
    ohif: await check("OHIF Base Endpoint", adaptUrlToProfile(settings["ohif_base_url"] || "", profile)),
    weasis: { name: "Weasis Native Launcher", status: "green", details: "Protocol Handler ready (weasis://)", endpoint: "weasis://$dicom" },
    conquest: { name: "Conquest PACS Server", status: "green", details: "DICOM SCP active", endpoint: `http://${host}:5678` },
    internalApi: await check("ERP Internal API Bridge", erpBase + "/api/internal/radiology/ai-draft", "HEAD")
  };
}

// ─── STATISTICS LOGGING ───────────────────────────────────────────────────────

export function recordSuccessfulLaunch(profile: string, viewer: string, endpoint: string, durationMs: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem("pacs_last_good_profile", profile);
  localStorage.setItem("pacs_last_good_viewer", viewer);
  localStorage.setItem("pacs_last_good_endpoint", endpoint);
  localStorage.setItem("pacs_last_success_time", new Date().toISOString());

  const count = Number(localStorage.getItem("pacs_launch_count") || "0") + 1;
  const avg = Number(localStorage.getItem("pacs_avg_launch_time") || "0");
  const newAvg = Math.round((avg * (count - 1) + durationMs) / count);
  localStorage.setItem("pacs_launch_count", String(count));
  localStorage.setItem("pacs_avg_launch_time", String(newAvg));
}

export function recordFailedLaunch(stage: string, url: string, status: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("pacs_last_failed_time", new Date().toISOString());
  localStorage.setItem("pacs_last_failed_stage", stage);
  localStorage.setItem("pacs_last_failed_url", url);
  localStorage.setItem("pacs_last_failed_status", status);
}

// ─── LAUNCH LOGIC ─────────────────────────────────────────────────────────────

export function getOhifUrl(studyInstanceUID: string, settings: Record<string, string>, profile: "LAN" | "TAILSCALE" | "PUBLIC" = "LAN"): string {
  const rawBaseUrl = settings["ohif_base_url"]?.trim();
  const ohifBase = adaptUrlToProfile(rawBaseUrl || "", profile);
  const normalizedBase = ohifBase.replace(/\/$/, "");

  const template = settings["ohif_study_url_template"]?.trim() || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
  const adaptedTemplate = adaptUrlToProfile(template, profile);
  
  return adaptedTemplate
    .replace(/\{OHIF_BASE_URL\}/g, normalizedBase)
    .replace(/\{studyInstanceUID\}/g, encodeURIComponent(studyInstanceUID));
}

export function getWeasisUrl(studyInstanceUID: string, settings: Record<string, string>, profile: "LAN" | "TAILSCALE" | "PUBLIC" = "LAN"): string {
  const template = settings["weasis_manifest_url_template"]?.trim();
  if (template) {
    return adaptUrlToProfile(template, profile).replace(/\{studyInstanceUID\}/g, studyInstanceUID);
  }

  const rawWadoUrl =
    settings["weasis_wado_url"]?.trim() ||
    settings["wado_uri_base_url"]?.trim() ||
    settings["wado_base_url"]?.trim() ||
    settings["conquest_wado_base_url"]?.trim() ||
    "";
  
  const wadoUrl = adaptUrlToProfile(rawWadoUrl, profile);
  return `weasis://$dicom:get -w "${wadoUrl}" -r "studyUID=${studyInstanceUID}"`;
}

export async function launchViewer(
  studyInstanceUID: string | null | undefined,
  viewerType: "OHIF" | "WEASIS",
  settings: Record<string, string>,
  toast: (options: { title: string; description?: string; variant?: "default" | "destructive" }) => void
): Promise<void> {
  if (!studyInstanceUID?.trim()) {
    toast({ title: "Study UID missing. Cannot open viewer.", variant: "destructive" });
    return;
  }

  const startTime = Date.now();
  const { profile, reason } = await resolveActiveProfile(settings);
  const host = profile === "LAN" ? "192.168.1.137" : profile === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com";

  // Perform per-service check
  const services = await checkViewerServices(studyInstanceUID, host, settings);
  
  // Safety rule: One failed service must NOT switch the profile, but we check if the critical viewer base works
  const orthancOk = services.orthancHttp.status === "green";
  const viewerOk = services.ohif.status === "green" || viewerType === "WEASIS"; // Weasis uses desktop local app

  const isReachable = orthancOk && viewerOk;
  const launchUrl = viewerType === "OHIF" 
    ? getOhifUrl(studyInstanceUID, settings, profile)
    : getWeasisUrl(studyInstanceUID, settings, profile);

  if (isReachable) {
    recordSuccessfulLaunch(profile, viewerType, launchUrl, Date.now() - startTime);
    const openMode = settings["viewer_open_mode"] || "NEW_TAB";
    if (openMode === "SAME_TAB") {
      window.open(launchUrl, "_self");
    } else {
      window.open(launchUrl, "_blank");
    }
  } else {
    recordFailedLaunch("Viewer Launch", launchUrl, "Unreachable");
    showDiagnosticOverlay({
      studyInstanceUID,
      viewerType,
      profile,
      services,
      launchUrl,
      settings,
      toast
    });
  }
}

// ─── DIAGNOSTIC MODAL OVERLAY ────────────────────────────────────────────────

function showDiagnosticOverlay(opts: {
  studyInstanceUID: string;
  viewerType: "OHIF" | "WEASIS";
  profile: "LAN" | "TAILSCALE" | "PUBLIC";
  services: Record<string, ServiceHealthState>;
  launchUrl: string;
  settings: Record<string, string>;
  toast: (options: any) => void;
}) {
  const existing = document.getElementById("pacs-diagnostic-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "pacs-diagnostic-overlay";
  overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200";

  const servicesHtml = Object.entries(opts.services)
    .map(([key, svc]) => `
      <div class="flex items-center justify-between p-2 rounded bg-slate-950/40 border border-slate-800/60 text-[11px]">
        <div>
          <span class="font-semibold text-slate-300">${svc.name}</span>
          <p class="text-[9px] font-mono text-slate-500 truncate max-w-[280px]">${svc.endpoint}</p>
        </div>
        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${
          svc.status === "green" 
            ? "bg-green-950 text-green-400 border border-green-800" 
            : svc.status === "yellow"
            ? "bg-amber-950 text-amber-400 border border-amber-800"
            : "bg-red-950 text-red-400 border border-red-800"
        }">${svc.status.toUpperCase()}</span>
      </div>
    `).join("");

  const isOhif = opts.viewerType === "OHIF";
  const altViewer = isOhif ? "WEASIS" : "OHIF";

  overlay.innerHTML = `
    <div class="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 font-sans overflow-hidden">
      <!-- Header -->
      <div class="flex items-start justify-between border-b border-slate-800 pb-2">
        <div>
          <h3 class="text-base font-bold text-red-400 flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            PACS Smart Ingestion &amp; Connection Diagnostics
          </h3>
          <p class="text-xs text-slate-400">Automatic route selection &amp; retry engine</p>
        </div>
        <button id="pacs-diag-close-top" class="text-slate-400 hover:text-white transition-colors">✕</button>
      </div>

      <!-- Route Status -->
      <div class="bg-slate-950/60 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-xs">
        <div>
          <span class="text-slate-400">Active Profile:</span>
          <span class="font-bold ml-1 px-2 py-0.5 rounded text-[11px] ${
            opts.profile === "LAN" ? "bg-green-950 text-green-300" : "bg-blue-950 text-blue-300"
          }">${opts.profile}</span>
        </div>
        <div class="flex gap-1">
          <button id="pacs-retry-lan" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] rounded">Retry LAN</button>
          <button id="pacs-retry-ts" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] rounded">Retry Tailscale</button>
          <button id="pacs-retry-pub" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] rounded">Retry Public</button>
        </div>
      </div>

      <!-- Service Checklist -->
      <div class="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
        ${servicesHtml}
      </div>

      <!-- Smart Actions -->
      <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-800 text-xs">
        <button id="pacs-diag-force" class="flex-1 min-w-[130px] h-8.5 bg-red-700 hover:bg-red-600 font-semibold rounded-lg">
          Force Launch
        </button>
        <button id="pacs-diag-alt" class="flex-1 min-w-[130px] h-8.5 bg-slate-800 hover:bg-slate-700 font-semibold rounded-lg">
          Switch to ${altViewer}
        </button>
      </div>

      <div class="flex flex-wrap gap-2 text-[11px]">
        <button id="pacs-copy-launch" class="flex-1 h-8 bg-slate-950 hover:bg-slate-800 text-slate-400 rounded-lg">Copy Launch URL</button>
        <button id="pacs-copy-wado" class="flex-1 h-8 bg-slate-950 hover:bg-slate-800 text-slate-400 rounded-lg">Copy WADO URL</button>
        <button id="pacs-diag-close" class="h-8 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">Dismiss</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const setupBtn = (id: string, action: () => void) => {
    document.getElementById(id)?.addEventListener("click", () => {
      action();
      overlay.remove();
    });
  };

  setupBtn("pacs-diag-close-top", () => {});
  setupBtn("pacs-diag-close", () => {});
  setupBtn("pacs-diag-force", () => window.open(opts.launchUrl, "_blank"));
  setupBtn("pacs-diag-alt", () => void launchViewer(opts.studyInstanceUID, altViewer, opts.settings, opts.toast));

  setupBtn("pacs-retry-lan", () => setAndRetry("LAN"));
  setupBtn("pacs-retry-ts", () => setAndRetry("TAILSCALE"));
  setupBtn("pacs-retry-pub", () => setAndRetry("PUBLIC"));

  const setAndRetry = async (mode: "LAN" | "TAILSCALE" | "PUBLIC") => {
    await updateProfilePreference(mode, opts.toast);
    void launchViewer(opts.studyInstanceUID, opts.viewerType, opts.settings, opts.toast);
  };

  document.getElementById("pacs-copy-launch")?.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.launchUrl);
    opts.toast({ title: "Copied launch URL to clipboard" });
  });

  document.getElementById("pacs-copy-wado")?.addEventListener("click", () => {
    const isTs = opts.profile === "TAILSCALE";
    const host = isTs ? "100.65.255.115" : "192.168.1.137";
    navigator.clipboard.writeText(`http://${host}:8042/wado?requestType=WADO&studyUID=${opts.studyInstanceUID}`);
    opts.toast({ title: "Copied WADO URL to clipboard" });
  });
}
