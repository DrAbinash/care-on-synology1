import { familyFromRegion } from "./reportingStudyContext";

/** Map reporting workspace study region + modality to MeasurementAssistant study type key. */
export function studyRegionToMeasurementType(
  studyRegion: string | null | undefined,
  modality: string | null | undefined,
): string {
  const mod = (modality ?? "").toUpperCase();
  const family = familyFromRegion(studyRegion);
  if (mod.startsWith("US") || mod === "USG") {
    const r = (studyRegion ?? "").toLowerCase();
    if (r.includes("obstetric") || r.includes("fetal") || r.includes("ob ")) return "OBSTETRIC";
    if (r.includes("doppler")) return "DOPPLER";
    return "USG";
  }
  if (mod.startsWith("CT")) return "CT";
  if (mod.startsWith("MR")) {
    if (family === "spine") return "MRI_SPINE";
    if (family === "brain") return "MRI_BRAIN";
    return "";
  }
  if (mod === "MG" || mod.includes("MAMMO")) return "MAMMOGRAPHY";
  return "";
}
