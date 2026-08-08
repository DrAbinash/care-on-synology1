/** Map reporting workspace study region + modality to MeasurementAssistant study type key. */
export function studyRegionToMeasurementType(
  studyRegion: string | null | undefined,
  modality: string | null | undefined,
): string {
  const r = (studyRegion ?? "").toLowerCase();
  const mod = (modality ?? "").toUpperCase();
  if (mod.startsWith("US") || mod === "USG") {
    if (r.includes("obstetric") || r.includes("fetal") || r.includes("ob ")) return "OBSTETRIC";
    if (r.includes("doppler")) return "DOPPLER";
    return "USG";
  }
  if (mod.startsWith("CT")) return "CT";
  if (mod.startsWith("MR")) {
    if (r.includes("spine") || r.includes("lumbar") || r.includes("cervical") || r.includes("dorsal") || r.includes("ls")) {
      return "MRI_SPINE";
    }
    return "MRI_BRAIN";
  }
  if (mod === "MG" || mod.includes("MAMMO")) return "MAMMOGRAPHY";
  return "";
}
