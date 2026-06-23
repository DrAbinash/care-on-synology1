/**
 * viewerService.ts
 * Central utility service for resolving URLs and launching radiology viewers (OHIF and Weasis).
 */

export function getOhifUrl(studyInstanceUID: string, settings: Record<string, string>): string {
  const rawBaseUrl = settings["ohif_base_url"]?.trim();
  const ohifBase = rawBaseUrl || "http://192.168.1.137:3010";
  const normalizedBase = ohifBase.replace(/\/$/, "");

  const template = settings["ohif_study_url_template"]?.trim() || "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}";
  
  return template
    .replace(/\{OHIF_BASE_URL\}/g, normalizedBase)
    .replace(/\{studyInstanceUID\}/g, encodeURIComponent(studyInstanceUID));
}

export function getWeasisUrl(studyInstanceUID: string, settings: Record<string, string>): string {
  const template = settings["weasis_manifest_url_template"]?.trim();
  if (template) {
    return template.replace(/\{studyInstanceUID\}/g, studyInstanceUID);
  }

  // Fallback construction matching backend launch endpoint
  const wadoUrl =
    settings["wado_uri_base_url"]?.trim() ||
    settings["wado_base_url"]?.trim() ||
    (settings["conquest_wado_base_url"]?.trim()) ||
    "";
  
  return `weasis://$dicom:get -w "${wadoUrl}" -r "studyUID=${studyInstanceUID}"`;
}

export function launchViewer(
  studyInstanceUID: string | null | undefined,
  viewerType: "OHIF" | "WEASIS",
  settings: Record<string, string>,
  toast: (options: { title: string; description?: string; variant?: "default" | "destructive" }) => void
): void {
  if (!studyInstanceUID?.trim()) {
    toast({
      title: "Study UID missing. Cannot open viewer.",
      variant: "destructive"
    });
    return;
  }

  const url = viewerType === "OHIF" 
    ? getOhifUrl(studyInstanceUID, settings) 
    : getWeasisUrl(studyInstanceUID, settings);

  const openMode = settings["viewer_open_mode"] || "NEW_TAB";

  if (openMode === "SAME_TAB") {
    window.open(url, "_self");
  } else {
    window.open(url, "_blank");
  }
}
