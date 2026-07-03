import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { NETWORK_LAN_HOST, ERP_HTTP_PORT } from "../networkDefaults";

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

  // Detected/default LAN fallback
  const defaultHost = process.env.ORTHANC_URL 
    ? new URL(process.env.ORTHANC_URL).hostname 
    : NETWORK_LAN_HOST;

  const erpBase = process.env.PUBLIC_BASE_URL || `http://${defaultHost}:${ERP_HTTP_PORT}`;

  return {
    orthanc: {
      aeTitle: getVal("orthanc_ae_title", "orthanc") || getVal("pacs_ae_title", "viewer") || process.env.ORTHANC_AE_TITLE || "ORTHANC",
      ip: getVal("orthanc_ip", "orthanc") || getVal("pacs_ip", "viewer") || process.env.ORTHANC_IP || defaultHost,
      dicomPort: getNum("orthanc_dicom_port", "orthanc") || 4242,
      httpPort: getNum("orthanc_http_port", "orthanc") || 8042,
      dicomWebUrl: getVal("orthanc_dicomweb_url", "orthanc") || getVal("dicom_web_base_url", "viewer") || `${process.env.ORTHANC_URL || `http://${defaultHost}:8042`}/dicom-web`,
      wadoUrl: getVal("orthanc_wado_url", "orthanc") || getVal("wado_uri_base_url", "viewer") || `${process.env.ORTHANC_URL || `http://${defaultHost}:8042`}/wado`,
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
      baseUrl: getVal("ohif_base_url", "viewer") || process.env.OHIF_URL || `http://${defaultHost}:3010`,
      studyLaunchTemplate: getVal("ohif_study_url_template", "viewer") || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
    },
    weasis: {
      wadoUrl: getVal("weasis_wado_url", "viewer") || getVal("wado_uri_base_url", "viewer") || `${process.env.ORTHANC_URL || `http://${defaultHost}:8042`}/wado`,
      launchTemplate: getVal("weasis_manifest_url_template", "viewer") || 'weasis://$dicom:get -w "{WADO_URL}" -r "studyUID={studyInstanceUID}"',
    },
    default_viewer: getVal("default_viewer", "viewer") || "OHIF",
    viewer_mode: getVal("viewer_mode", "viewer") || "BOTH",
  };
}

export async function validateRadiologyConfig(): Promise<string[]> {
  const cfg = await getRadiologyConfig();
  const warnings: string[] = [];

  // Check for Docker Bridge IP leaks
  const isBridgeIp = (ip: string) => ip.startsWith("172.16.1.") || ip.startsWith("172.");
  
  if (isBridgeIp(cfg.orthanc.ip)) {
    warnings.push("Orthanc IP uses Docker bridge network (172.x.x.x) which is unreachable by LAN workstations.");
  }
  if (isBridgeIp(cfg.conquest.ip)) {
    warnings.push("Conquest IP uses Docker bridge network (172.x.x.x) which is unreachable by LAN workstations.");
  }
  if (cfg.ohif.baseUrl.includes("172.16.1.")) {
    warnings.push("OHIF Base URL uses Docker bridge IP (172.x.x.x) - browser clients will fail to launch OHIF.");
  }
  if (cfg.weasis.wadoUrl.includes("172.16.1.")) {
    warnings.push("Weasis WADO endpoint uses Docker bridge IP (172.x.x.x) - local Weasis installations cannot read scans.");
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

