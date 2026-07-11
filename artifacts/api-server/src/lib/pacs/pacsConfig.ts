import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { NETWORK_LAN_HOST, ERP_HTTP_PORT } from "../networkDefaults";
import { logger } from "../logger";

// ── Docker bridge IP detection ──────────────────────────────────────────────
// Docker's default bridge network hands containers addresses in 172.16.0.0/12
// (e.g. 172.17.0.x, 172.18.0.x...). Those addresses only resolve *inside* the
// Docker host — a doctor's browser or a Weasis install on another machine can
// never reach them. If one of these leaks into a URL meant for browser/client
// launch (OHIF, Weasis WADO), the viewer silently fails to load.
//
// This differs from care ERP's actual clinic LAN, which happens to also sit
// in a private range (e.g. 172.16.1.139) — see isBridgeIp below, which is
// deliberately narrower than a private-IP check to avoid false-flagging a
// real clinic LAN address that happens to start with 172.16 or 172.31.
export function isDockerBridgeIp(value: string | undefined | null): boolean {
  if (!value) return false;
  // Docker's default bridge and user-defined bridge networks both live in
  // 172.17.x.x–172.31.x.x by convention; care-compose networks in this repo
  // use 172.2x.x.x. We match the whole 172.16.0.0/12 block EXCEPT the
  // clinic's own known LAN octet (172.16.1.x), which is a real, browser
  // reachable address, not a bridge address, if that's genuinely the LAN.
  const m = value.match(/172\.(1[6-9]|2[0-9]|3[01])\.(\d+)\./);
  if (!m) return false;
  const secondOctet = Number(m[1]);
  const thirdOctet = Number(m[2]);
  // 172.16.1.x is treated as a real LAN address (matches this clinic's
  // documented LAN subnet), everything else in 172.16.0.0/12 is bridge-only.
  if (secondOctet === 16 && thirdOctet === 1) return false;
  return true;
}

export interface RadiologyConfig {
  // Orthanc Settings
  orthanc: {
    aeTitle: string;
    ip: string;
    dicomPort: number;
    httpPort: number;
    dicomWebUrl: string;
    wadoUrl: string;
  };
  // Conquest Settings
  conquest: {
    aeTitle: string;
    ip: string;
    dicomPort: number;
    wadoUrl: string;
  };
  // ERP Settings
  erp: {
    lanUrl: string;
    internalApiUrl: string;
    hasApiKey: boolean;
  };
  // OHIF Settings
  ohif: {
    baseUrl: string;
    studyLaunchTemplate: string;
  };
  // Weasis Settings
  weasis: {
    wadoUrl: string;
    launchTemplate: string;
  };
  default_viewer: string;
  viewer_mode: string;
}

export async function getRadiologyConfig(): Promise<RadiologyConfig> {
  const settings = await db.select().from(pacsSettingsTable);
  
  const getVal = (key: string, category: string): string | undefined => {
    return settings.find(s => s.key === key && s.category === category)?.value ?? undefined;
  };

  const getNum = (key: string, category: string): number | undefined => {
    const val = getVal(key, category);
    return val ? parseInt(val, 10) : undefined;
  };

  // ── Public/browser-facing default host ────────────────────────────────────
  // This host is used to build fallback URLs for OHIF, Orthanc WADO/DICOMweb,
  // and Weasis — all things a doctor's BROWSER or a Weasis install on another
  // machine must reach directly. It must NEVER resolve to a Docker bridge IP
  // (172.17.x.x etc.) — only to the clinic's real LAN IP, Tailscale IP, or
  // public domain. ORTHANC_INTERNAL_URL (container-to-container only, e.g.
  // http://care-orthanc:8042) is deliberately never used here — see that var
  // used correctly for internal probes in routes/pacsEnterprise.ts instead.
  const orthancUrlCandidate = process.env.ORTHANC_URL;
  let defaultHost = NETWORK_LAN_HOST;
  if (orthancUrlCandidate) {
    try {
      const candidateHost = new URL(orthancUrlCandidate).hostname;
      if (isDockerBridgeIp(candidateHost)) {
        logger.warn(
          { orthancUrlCandidate },
          "ORTHANC_URL is set to a Docker bridge IP, which browsers and Weasis cannot reach. " +
          `Ignoring it for browser/client launch URLs — set ORTHANC_URL to your clinic's real ` +
          `LAN IP (e.g. http://${NETWORK_LAN_HOST}:8042), Tailscale IP, or public domain instead. ` +
          "(Container-to-container Orthanc access should use ORTHANC_INTERNAL_URL, which is unaffected.)",
        );
      } else {
        defaultHost = candidateHost;
      }
    } catch {
      logger.warn({ orthancUrlCandidate }, `ORTHANC_URL is not a valid URL — falling back to default LAN host ${NETWORK_LAN_HOST}`);
    }
  }

  const erpBase = process.env.PUBLIC_BASE_URL || `http://${defaultHost}:${ERP_HTTP_PORT}`;

  // ── OHIF public/browser launch URL ────────────────────────────────────────
  // OHIF_URL is the existing env var for this (see .env.example / docker-
  // compose.yml) — reused as-is per "use existing env names, don't invent
  // duplicates." If it's itself a bridge IP, treat it as unset and fall
  // through to the guarded defaultHost above, with a clear warning.
  let ohifPublicUrlEnv = process.env.OHIF_URL;
  if (ohifPublicUrlEnv && isDockerBridgeIp(ohifPublicUrlEnv)) {
    logger.warn(
      { ohifPublicUrlEnv },
      "OHIF_URL is set to a Docker bridge IP — browsers cannot reach it. " +
      "Set OHIF_URL to your LAN IP (e.g. http://192.168.1.137:3010), Tailscale IP " +
      "(e.g. http://100.65.255.115:3010), or your Cloudflare/public domain instead.",
    );
    ohifPublicUrlEnv = undefined;
  }

  // ── Weasis public/browser launch URL ──────────────────────────────────────
  // WEASIS_WADO_PUBLIC_URL is a new, explicitly-documented env var (see
  // .env.example) for the WADO endpoint Weasis itself connects to — distinct
  // from ORTHANC_INTERNAL_URL, which is container-to-container only.
  let weasisWadoPublicUrlEnv = process.env.WEASIS_WADO_PUBLIC_URL;
  if (weasisWadoPublicUrlEnv && isDockerBridgeIp(weasisWadoPublicUrlEnv)) {
    logger.warn(
      { weasisWadoPublicUrlEnv },
      "WEASIS_WADO_PUBLIC_URL is set to a Docker bridge IP — local Weasis installs cannot reach it. " +
      "Set WEASIS_WADO_PUBLIC_URL to your LAN IP (e.g. http://192.168.1.137:8042/wado), Tailscale IP, " +
      "or public domain instead.",
    );
    weasisWadoPublicUrlEnv = undefined;
  }

  // ── Guarded Orthanc URL for browser-facing WADO/DICOMweb fallback defaults —
  // same bridge-IP protection as defaultHost, since this uses the raw
  // ORTHANC_URL string (with path/port), not just its hostname.
  const orthancBrowserBase = orthancUrlCandidate && !isDockerBridgeIp(orthancUrlCandidate)
    ? orthancUrlCandidate
    : `http://${defaultHost}:8042`;

  return {
    orthanc: {
      aeTitle: getVal("orthanc_ae_title", "orthanc") || getVal("pacs_ae_title", "viewer") || process.env.ORTHANC_AE_TITLE || "ORTHANC",
      ip: getVal("orthanc_ip", "orthanc") || getVal("pacs_ip", "viewer") || process.env.ORTHANC_IP || defaultHost,
      dicomPort: getNum("orthanc_dicom_port", "orthanc") || 4242,
      httpPort: getNum("orthanc_http_port", "orthanc") || 8042,
      dicomWebUrl: getVal("orthanc_dicomweb_url", "orthanc") || getVal("dicom_web_base_url", "viewer") || `${orthancBrowserBase}/dicom-web`,
      wadoUrl: getVal("orthanc_wado_url", "orthanc") || getVal("wado_uri_base_url", "viewer") || `${orthancBrowserBase}/wado`,
    },
    conquest: {
      aeTitle: getVal("conquest_ae_title", "conquest") || process.env.CONQUEST_AE_TITLE || "CONQUESTPACS",
      ip: getVal("conquest_ip", "conquest") || process.env.CONQUEST_HOST || "",
      dicomPort: getNum("conquest_port", "conquest") || getNum("pacs_port", "viewer") || parseInt(process.env.CONQUEST_PORT || "5678", 10),
      wadoUrl: getVal("conquest_wado_url", "conquest") || "",
    },
    erp: {
      lanUrl: getVal("erp_lan_url", "erp") || erpBase,
      internalApiUrl: getVal("erp_internal_api_url", "erp") || `${erpBase}/api/internal`,
      hasApiKey: !!(process.env.INTERNAL_API_KEY || getVal("erp_internal_api_key", "erp")),
    },
    ohif: {
      baseUrl: getVal("ohif_base_url", "viewer") || ohifPublicUrlEnv || `http://${defaultHost}:3010`,
      studyLaunchTemplate: getVal("ohif_study_url_template", "viewer") || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
    },
    weasis: {
      wadoUrl: getVal("weasis_wado_url", "viewer") || getVal("wado_uri_base_url", "viewer") || weasisWadoPublicUrlEnv || `${orthancBrowserBase}/wado`,
      launchTemplate: getVal("weasis_manifest_url_template", "viewer") || 'weasis://$dicom:get -w "{WADO_URL}" -r "studyUID={studyInstanceUID}"',
    },
    default_viewer: getVal("default_viewer", "viewer") || "OHIF",
    viewer_mode: getVal("viewer_mode", "viewer") || "BOTH",
  };
}

export async function validateRadiologyConfig(): Promise<string[]> {
  const cfg = await getRadiologyConfig();
  const warnings: string[] = [];

  // Check for Docker Bridge IP leaks (uses the same guard as getRadiologyConfig
  // itself — see isDockerBridgeIp above — so this never false-flags the real
  // clinic LAN address 172.16.1.x as a bridge IP, unlike the previous check).
  if (isDockerBridgeIp(cfg.orthanc.ip)) {
    warnings.push("Orthanc IP uses a Docker bridge network address, unreachable by LAN workstations. Set ORTHANC_IP or ORTHANC_URL to the clinic's real LAN IP (e.g. 192.168.1.137) in .env.");
  }
  if (isDockerBridgeIp(cfg.conquest.ip)) {
    warnings.push("Conquest IP uses a Docker bridge network address, unreachable by LAN workstations. Set CONQUEST_HOST to the clinic's real LAN IP in .env.");
  }
  if (isDockerBridgeIp(cfg.ohif.baseUrl)) {
    warnings.push("OHIF Base URL uses a Docker bridge IP — browser clients will fail to launch OHIF. Set OHIF_URL in .env (or the OHIF Base URL field in PACS Settings) to a LAN IP (http://192.168.1.137:3010), Tailscale IP (http://100.65.255.115:3010), or your public domain.");
  }
  if (isDockerBridgeIp(cfg.weasis.wadoUrl)) {
    warnings.push("Weasis WADO endpoint uses a Docker bridge IP — local Weasis installations cannot read scans. Set WEASIS_WADO_PUBLIC_URL in .env (or the Weasis WADO field in PACS Settings) to a LAN IP, Tailscale IP, or public domain.");
  }

  // Check missing settings
  if (!cfg.orthanc.aeTitle) warnings.push("Orthanc AE Title is missing.");
  if (!cfg.conquest.aeTitle) warnings.push("Conquest AE Title is missing.");
  if (!cfg.orthanc.dicomPort) warnings.push("Orthanc DICOM port is missing.");
  if (!cfg.conquest.dicomPort) warnings.push("Conquest DICOM port is missing.");
  if (!cfg.orthanc.wadoUrl) warnings.push("Orthanc WADO URL is missing.");
  if (!cfg.orthanc.dicomWebUrl) warnings.push("Orthanc DICOMweb URL is missing.");
  if (!cfg.ohif.baseUrl) warnings.push("OHIF Base URL is missing.");
  if (!cfg.weasis.launchTemplate) warnings.push("Weasis launch template is missing.");
  if (!cfg.erp.internalApiUrl) warnings.push("ERP Internal API URL is missing.");

  // Check Duplicate AE Titles
  if (cfg.conquest.aeTitle && cfg.orthanc.aeTitle && cfg.conquest.aeTitle === cfg.orthanc.aeTitle) {
    warnings.push(`Duplicate AE Title conflict: Both Orthanc and Conquest are named '${cfg.orthanc.aeTitle}'.`);
  }

  // Check Duplicate DICOM ports
  if (cfg.orthanc.dicomPort && cfg.conquest.dicomPort && cfg.orthanc.dicomPort === cfg.conquest.dicomPort) {
    warnings.push(`Duplicate Port conflict: Both Orthanc and Conquest listen on DICOM port ${cfg.orthanc.dicomPort}.`);
  }

  // Invalid LAN IP
  const isPrivateIp = (ip: string) => 
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip) || ip === "localhost" || ip === "127.0.0.1";
  if (cfg.orthanc.ip && !isPrivateIp(cfg.orthanc.ip)) {
    warnings.push(`Orthanc LAN IP '${cfg.orthanc.ip}' is not in a standard private subnet (192.168.x.x, 10.x.x.x, 172.16.x.x).`);
  }
  if (cfg.conquest.ip && !isPrivateIp(cfg.conquest.ip)) {
    warnings.push(`Conquest LAN IP '${cfg.conquest.ip}' is not in a standard private subnet.`);
  }

  // Check Tailscale IP
  const settings = await db.select().from(pacsSettingsTable);
  const tailscaleHost = settings.find(s => s.key === "tailscale_host" && s.category === "network")?.value;
  if (tailscaleHost && !tailscaleHost.startsWith("100.")) {
    warnings.push(`Tailscale Host IP '${tailscaleHost}' does not start with 100.x.x.x.`);
  }

  // Check placeholders
  if (cfg.erp.lanUrl.includes("YOUR_DOMAIN.replit.app") || cfg.erp.internalApiUrl.includes("YOUR_DOMAIN.replit.app")) {
    warnings.push("Placeholder Replit URL detected in ERP settings. Update to your LAN IP or caredeoghar.com domain.");
  }
  if (!cfg.erp.hasApiKey) {
    warnings.push("INTERNAL_API_KEY is not set. Hook sync from Orthanc/Conquest will fail authorization.");
  }

  return warnings;
}

