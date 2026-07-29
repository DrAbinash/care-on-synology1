export type ReferralModality = "USG" | "MRI" | "CT" | "X-Ray" | "Other";

/** Map category / test name → modality bucket for Referral Register filters. */
export function classifyModality(category: string, testName: string): ReferralModality {
  const s = `${category} ${testName}`.toUpperCase();
  if (/\b(USG|ULTRASOUND|SONO|DOPPLER|ECHO)\b/.test(s)) return "USG";
  if (/\bMRI\b/.test(s)) return "MRI";
  if (/\b(CT|CECT|HRCT)\b/.test(s)) return "CT";
  if (/\b(X[\s-]?RAY|XRAY|RADIOGRAPH|SKULL|CHEST PA|KUB)\b/.test(s) || /\bXR\b/.test(s)) return "X-Ray";
  return "Other";
}
