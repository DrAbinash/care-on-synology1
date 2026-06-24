import { db } from "@workspace/db";
import { pacsSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

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
    : "192.168.1.137";

  const erpBase = process.env.PUBLIC_BASE_URL || `http://${defaultHost}:8888`;

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
