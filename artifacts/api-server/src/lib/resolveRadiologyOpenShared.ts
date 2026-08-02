/** Pure helpers for radiology open deep-links (no DB import — unit-testable). */

/** Map free-text / DICOM modality aliases to a canonical filter bucket. */
export function canonicalizeModalityFilter(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return null;
  if (v === "MRI" || v === "MR" || v.includes("MAGNETIC")) return "MR";
  if (v === "CT" || v.includes("COMPUTED")) return "CT";
  if (v === "US" || v === "USG" || v.includes("ULTRASOUND") || v.includes("DOPPLER")) return "US";
  if (v === "XR" || v === "XRAY" || v === "X-RAY" || v === "CR" || v === "DX") return "CR";
  if (v === "MG" || v.includes("MAMMO")) return "MG";
  return v;
}

/** Query-string builder for the SPA fallback worklist when no study is ready. */
export function radiologyOpenFallbackPath(opts: {
  modality?: string | null;
  patientName?: string | null;
}): string {
  const params = new URLSearchParams();
  const mod = canonicalizeModalityFilter(opts.modality);
  if (mod) params.set("modality", mod);
  const q = (opts.patientName ?? "").trim();
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/radiology/worklist?${qs}` : "/radiology/worklist";
}
