/** Normalize DICOM modality codes onto the AI policy vocabulary (MR/CT/CR/US/…). */
export function normalizeAiModality(modality: string): string {
  const m = modality.trim().toUpperCase();
  if (m === "MRI" || m.startsWith("MR")) return "MR";
  if (m === "CT" || m.startsWith("CT") || m === "HRCT") return "CT";
  if (m === "DX" || m === "XR" || m === "XA" || m === "RF" || m === "CR" || m.includes("X-RAY") || m.includes("XRAY")) return "CR";
  if (m === "USG" || m === "US" || m.startsWith("US")) return "US";
  if (m === "MG" || m.startsWith("MG")) return "MG";
  if (m.includes("DOPPLER")) return "Doppler";
  return m;
}
