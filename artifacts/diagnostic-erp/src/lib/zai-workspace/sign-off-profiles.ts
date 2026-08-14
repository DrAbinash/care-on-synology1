import type { Modality, SignOffProfile } from "./types";

const now = () => new Date().toISOString();
const uid = () => `so_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const DEFAULT_RADIOLOGIST_NAME = "Dr. Sugandha Priyadarshini";
export const DEFAULT_RADIOLOGIST_CREDENTIALS = "MD (Radiodiagnosis & Medical Imaging)";

export const DEFAULT_SIGN_OFF_PROFILES: SignOffProfile[] = (
  ["MR", "CT", "XR", "US", "MG", "DX", "NM", "PT", "DOPPLER", "ECHO", "USG_OB"] as Modality[]
).map((m) => ({
  id: uid(),
  modality: m,
  signerName: DEFAULT_RADIOLOGIST_NAME,
  signerCredentials: DEFAULT_RADIOLOGIST_CREDENTIALS,
  isDefault: true,
  createdAt: now(),
}));

export function lookupProfile(p: SignOffProfile[], m: Modality): SignOffProfile | null {
  return p.find((x) => x.modality === m) ?? p.find((x) => x.isDefault) ?? null;
}
export function formatSignOff(p: SignOffProfile): string {
  return `${p.signerName}, ${p.signerCredentials}`;
}

const SK = "zai-rad-signoff-v1";

function looksLikePlaceholderAbinash(profiles: SignOffProfile[]): boolean {
  return profiles.length > 0 && profiles.every((p) => /abinash/i.test(p.signerName));
}

export function loadProfiles(): SignOffProfile[] {
  try {
    const r = localStorage.getItem(SK);
    if (!r) return DEFAULT_SIGN_OFF_PROFILES;
    const parsed = JSON.parse(r) as SignOffProfile[];
    if (!Array.isArray(parsed) || parsed.length === 0 || looksLikePlaceholderAbinash(parsed)) {
      saveProfiles(DEFAULT_SIGN_OFF_PROFILES);
      return DEFAULT_SIGN_OFF_PROFILES;
    }
    return parsed;
  } catch {
    return DEFAULT_SIGN_OFF_PROFILES;
  }
}
export function saveProfiles(p: SignOffProfile[]) {
  try {
    localStorage.setItem(SK, JSON.stringify(p));
  } catch { /* ignore quota */ }
}
export function createProfile(i: Omit<SignOffProfile, "id" | "createdAt">): SignOffProfile {
  return { ...i, id: uid(), createdAt: now() };
}
