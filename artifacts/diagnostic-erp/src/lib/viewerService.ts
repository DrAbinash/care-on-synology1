/**
 * viewerService.ts
 * Central utility service for resolving URLs and launching radiology viewers (OHIF and Weasis).
 * Handles network profiles (LAN/Tailscale), launch safety checks, and diagnostic overlays.
 */

export function adaptUrlToProfile(url: string, profile: "LAN" | "TAILSCALE" | "PUBLIC"): string {
  if (!url) return "";
  const targetHost = profile === "LAN" ? "192.168.1.137" : profile === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com";
  
  // Replace both standard LAN IP and Tailscale IP with the active profile host
  return url
    .replace(/192\.168\.1\.137/g, targetHost)
    .replace(/100\.65\.255\.115/g, targetHost);
}

export async function resolveActiveProfile(): Promise<"LAN" | "TAILSCALE" | "PUBLIC"> {
  const override = localStorage.getItem("pacs_network_profile");
  if (override && override !== "auto") {
    return override as "LAN" | "TAILSCALE" | "PUBLIC";
  }

  // Fast auto-detection with cache
  const cached = localStorage.getItem("pacs_detected_profile");
  const cachedTime = localStorage.getItem("pacs_detected_profile_time");
  if (cached && cachedTime && Date.now() - Number(cachedTime) < 20000) {
    return cached as "LAN" | "TAILSCALE" | "PUBLIC";
  }

  const lanUrl = "http://192.168.1.137:8042/system";
  const tsUrl = "http://100.65.255.115:8042/system";

  const probe = async (url: string): Promise<boolean> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    try {
      await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal });
      clearTimeout(id);
      return true;
    } catch (e) {
      clearTimeout(id);
      return false;
    }
  };

  const lanReachable = await probe(lanUrl);
  if (lanReachable) {
    localStorage.setItem("pacs_detected_profile", "LAN");
    localStorage.setItem("pacs_detected_profile_time", String(Date.now()));
    return "LAN";
  }

  const tsReachable = await probe(tsUrl);
  if (tsReachable) {
    localStorage.setItem("pacs_detected_profile", "TAILSCALE");
    localStorage.setItem("pacs_detected_profile_time", String(Date.now()));
    return "TAILSCALE";
  }

  localStorage.setItem("pacs_detected_profile", "PUBLIC");
  localStorage.setItem("pacs_detected_profile_time", String(Date.now()));
  return "PUBLIC";
}

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

interface SafetyCheckResults {
  studyUidValid: boolean;
  studyExists: boolean;
  metadataValid: boolean;
  wadoReachable: boolean;
  viewerReachable: boolean;
}

export async function launchViewer(
  studyInstanceUID: string | null | undefined,
  viewerType: "OHIF" | "WEASIS",
  settings: Record<string, string>,
  toast: (options: { title: string; description?: string; variant?: "default" | "destructive" }) => void
): Promise<void> {
  if (!studyInstanceUID?.trim()) {
    toast({
      title: "Study UID missing. Cannot open viewer.",
      variant: "destructive"
    });
    return;
  }

  const profile = await resolveActiveProfile();
  const host = profile === "LAN" ? "192.168.1.137" : profile === "TAILSCALE" ? "100.65.255.115" : "caredeoghar.com";
  const dicomWebUrl = `http://${host}:8042/dicom-web/studies/${studyInstanceUID}`;
  const wadoUrl = `http://${host}:8042/wado?requestType=WADO&studyUID=${studyInstanceUID}`;
  const viewerBase = viewerType === "OHIF" 
    ? adaptUrlToProfile(settings["ohif_base_url"] || "", profile)
    : `http://${host}:8042`;

  const results: SafetyCheckResults = {
    studyUidValid: true,
    studyExists: false,
    metadataValid: false,
    wadoReachable: false,
    viewerReachable: false,
  };

  let failedEndpoint = "";
  let failedStatus = "Unknown";
  let failedStage = "";

  const checkEndpoint = async (url: string, mode: "HEAD" | "GET" = "HEAD"): Promise<{ ok: boolean; status: string }> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(url, { method: mode, signal: controller.signal });
      clearTimeout(id);
      return { ok: res.ok || res.status === 401 || res.status === 405 || res.status === 404, status: String(res.status) };
    } catch (e: any) {
      clearTimeout(id);
      return { ok: false, status: e.name === "AbortError" ? "Timeout" : "Connection Refused" };
    }
  };

  // 1. Verify Study Exists in Orthanc
  const orthancStudyCheck = await checkEndpoint(`http://${host}:8042/tools/lookup`, "GET");
  if (orthancStudyCheck.ok) {
    results.studyExists = true;
  } else {
    failedStage = "Orthanc Access Check";
    failedEndpoint = `http://${host}:8042/tools/lookup`;
    failedStatus = orthancStudyCheck.status;
  }

  // 2. DICOMweb Metadata Endpoint check
  if (results.studyExists) {
    const metaCheck = await checkEndpoint(dicomWebUrl, "GET");
    if (metaCheck.ok) {
      results.metadataValid = true;
    } else {
      failedStage = "DICOMweb Metadata Retrieve";
      failedEndpoint = dicomWebUrl;
      failedStatus = metaCheck.status;
    }
  }

  // 3. WADO check
  if (results.studyExists) {
    const wadoCheck = await checkEndpoint(`http://${host}:8042/wado?requestType=WADO&studyUID=${studyInstanceUID}`, "GET");
    if (wadoCheck.ok) {
      results.wadoReachable = true;
    } else {
      failedStage = "WADO Retrieve Service";
      failedEndpoint = wadoUrl;
      failedStatus = wadoCheck.status;
    }
  }

  // 4. Viewer base check
  if (results.studyExists) {
    const viewCheck = await checkEndpoint(viewerBase, "GET");
    if (viewCheck.ok) {
      results.viewerReachable = true;
    } else {
      failedStage = `${viewerType} Viewer Base Service`;
      failedEndpoint = viewerBase;
      failedStatus = viewCheck.status;
    }
  }

  const allPassed = results.studyUidValid && results.studyExists && results.metadataValid && results.wadoReachable && results.viewerReachable;

  const resolvedOhifUrl = getOhifUrl(studyInstanceUID, settings, profile);
  const resolvedWeasisUrl = getWeasisUrl(studyInstanceUID, settings, profile);
  const launchUrl = viewerType === "OHIF" ? resolvedOhifUrl : resolvedWeasisUrl;

  if (allPassed) {
    const openMode = settings["viewer_open_mode"] || "NEW_TAB";
    if (openMode === "SAME_TAB") {
      window.open(launchUrl, "_self");
    } else {
      window.open(launchUrl, "_blank");
    }
  } else {
    // Render beautiful diagnostic overlay in the DOM
    showDiagnosticOverlay({
      studyInstanceUID,
      viewerType,
      profile,
      failedStage,
      failedEndpoint,
      failedStatus,
      launchUrl,
      resolvedOhifUrl,
      resolvedWeasisUrl,
      wadoUrl,
      settings,
      toast
    });
  }
}

function showDiagnosticOverlay(opts: {
  studyInstanceUID: string;
  viewerType: "OHIF" | "WEASIS";
  profile: "LAN" | "TAILSCALE" | "PUBLIC";
  failedStage: string;
  failedEndpoint: string;
  failedStatus: string;
  launchUrl: string;
  resolvedOhifUrl: string;
  resolvedWeasisUrl: string;
  wadoUrl: string;
  settings: Record<string, string>;
  toast: (options: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
}) {
  // Remove existing diagnostic overlay if present
  const existing = document.getElementById("pacs-diagnostic-overlay");
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "pacs-diagnostic-overlay";
  overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200";

  const isOhif = opts.viewerType === "OHIF";
  const altViewer = isOhif ? "WEASIS" : "OHIF";
  const altLaunchUrl = isOhif ? opts.resolvedWeasisUrl : opts.resolvedOhifUrl;

  overlay.innerHTML = `
    <div class="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 font-sans overflow-hidden">
      <!-- Header -->
      <div class="flex items-start justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="text-lg font-bold text-red-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            PACS Viewer Ingestion/Connectivity Warning
          </h3>
          <p class="text-xs text-slate-400 mt-1">Remote connection diagnostic utility</p>
        </div>
        <button id="pacs-diag-close-top" class="text-slate-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 4.293z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <!-- Network Profile Info -->
      <div class="bg-slate-950/50 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-xs">
        <div>
          <span class="text-slate-400">Selected Network Profile:</span>
          <span class="font-bold ml-1.5 px-2 py-0.5 rounded text-xs ${
            opts.profile === "LAN" 
              ? "bg-green-950 text-green-300 border border-green-800" 
              : opts.profile === "TAILSCALE" 
              ? "bg-blue-950 text-blue-300 border border-blue-800"
              : "bg-amber-950 text-amber-300 border border-amber-800"
          }">${opts.profile}</span>
        </div>
        <div class="flex gap-1.5">
          <button id="pacs-set-lan" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded transition-colors">LAN</button>
          <button id="pacs-set-ts" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded transition-colors">Tailscale</button>
          <button id="pacs-set-auto" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded transition-colors">Auto</button>
        </div>
      </div>

      <!-- Diagnostics details -->
      <div class="space-y-2 text-xs">
        <div class="grid grid-cols-3 py-1 border-b border-slate-800/50">
          <span class="text-slate-400">Failed Phase/Stage:</span>
          <span class="col-span-2 text-red-300 font-semibold">${opts.failedStage}</span>
        </div>
        <div class="grid grid-cols-3 py-1 border-b border-slate-800/50">
          <span class="text-slate-400">Failed Endpoint URL:</span>
          <span class="col-span-2 font-mono text-slate-300 break-all select-all">${opts.failedEndpoint}</span>
        </div>
        <div class="grid grid-cols-3 py-1 border-b border-slate-800/50">
          <span class="text-slate-400">HTTP/TCP Status Code:</span>
          <span class="col-span-2 font-mono text-red-400 font-bold">${opts.failedStatus}</span>
        </div>
        <div class="grid grid-cols-3 py-1">
          <span class="text-slate-400">Suggested Action:</span>
          <span class="col-span-2 text-indigo-300">
            ${
              opts.profile === "LAN" 
                ? "Verify that you are connected to the clinic Wi-Fi/LAN and your device can reach 192.168.1.137." 
                : "Ensure your Tailscale client is active and logged in, then verify connectivity to 100.65.255.115."
            }
          </span>
        </div>
      </div>

      <!-- Actions / buttons -->
      <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-800 text-xs">
        <button id="pacs-diag-force" class="flex-1 min-w-[130px] h-9 bg-red-600 hover:bg-red-500 font-semibold text-white rounded-lg transition-colors flex items-center justify-center gap-1.5">
          Force Launch Anyway
        </button>
        
        <button id="pacs-diag-fallback" class="flex-1 min-w-[150px] h-9 bg-slate-800 hover:bg-slate-700 font-semibold text-slate-100 rounded-lg transition-colors border border-slate-700 flex items-center justify-center gap-1.5">
          Try ${altViewer} Fallback
        </button>
      </div>

      <div class="flex flex-wrap gap-2 text-xs">
        <button id="pacs-diag-copy-viewer" class="flex-1 h-9 bg-slate-950 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-800 transition-colors">
          Copy ${opts.viewerType} Link
        </button>
        <button id="pacs-diag-copy-wado" class="flex-1 h-9 bg-slate-950 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-800 transition-colors">
          Copy WADO Link
        </button>
        <button id="pacs-diag-close-btn" class="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors">
          Dismiss
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Setup Actions
  document.getElementById("pacs-diag-close-top")?.addEventListener("click", () => overlay.remove());
  document.getElementById("pacs-diag-close-btn")?.addEventListener("click", () => overlay.remove());

  document.getElementById("pacs-diag-force")?.addEventListener("click", () => {
    window.open(opts.launchUrl, "_blank");
    overlay.remove();
  });

  document.getElementById("pacs-diag-fallback")?.addEventListener("click", () => {
    overlay.remove();
    void launchViewer(opts.studyInstanceUID, altViewer, opts.settings, opts.toast);
  });

  document.getElementById("pacs-diag-copy-viewer")?.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.launchUrl);
    opts.toast({ title: "Copied launch URL to clipboard" });
  });

  document.getElementById("pacs-diag-copy-wado")?.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.wadoUrl);
    opts.toast({ title: "Copied WADO URL to clipboard" });
  });

  const setProfile = (mode: "auto" | "LAN" | "TAILSCALE" | "PUBLIC") => {
    localStorage.setItem("pacs_network_profile", mode);
    localStorage.removeItem("pacs_detected_profile"); // clear cache
    overlay.remove();
    opts.toast({ title: `Network mode updated to ${mode.toUpperCase()}. Retrying...` });
    void launchViewer(opts.studyInstanceUID, opts.viewerType, opts.settings, opts.toast);
  };

  document.getElementById("pacs-set-lan")?.addEventListener("click", () => setProfile("LAN"));
  document.getElementById("pacs-set-ts")?.addEventListener("click", () => setProfile("TAILSCALE"));
  document.getElementById("pacs-set-auto")?.addEventListener("click", () => setProfile("auto"));
}
