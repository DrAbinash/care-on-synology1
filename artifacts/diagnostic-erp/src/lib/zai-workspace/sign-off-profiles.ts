import type { Modality, SignOffProfile } from "./types";
const now = () => new Date().toISOString();
const uid = () => `so_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
export const DEFAULT_SIGN_OFF_PROFILES: SignOffProfile[] = (["MR","CT","XR","US","MG","DX","NM","PT","DOPPLER","ECHO","USG_OB"] as Modality[]).map(m => ({ id: uid(), modality: m, signerName: "Dr. Abinash Kumar", signerCredentials: m === "MR" || m === "CT" || m === "MG" ? "MD (Radiodiagnosis)" : "MD", isDefault: true, createdAt: now() }));
export function lookupProfile(p: SignOffProfile[], m: Modality): SignOffProfile | null { return p.find(x => x.modality === m) ?? p.find(x => x.isDefault) ?? null; }
export function formatSignOff(p: SignOffProfile): string { return `${p.signerName}, ${p.signerCredentials}`; }
const SK = "zai-rad-signoff-v1";
export function loadProfiles(): SignOffProfile[] { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : DEFAULT_SIGN_OFF_PROFILES; } catch { return DEFAULT_SIGN_OFF_PROFILES; } }
export function saveProfiles(p: SignOffProfile[]) { try { localStorage.setItem(SK, JSON.stringify(p)); } catch {} }
export function createProfile(i: Omit<SignOffProfile, "id" | "createdAt">): SignOffProfile { return { ...i, id: uid(), createdAt: now() }; }
