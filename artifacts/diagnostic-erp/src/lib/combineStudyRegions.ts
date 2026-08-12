/**
 * combineStudyRegions — merge study region names and technique text when a
 * radiologist selects multiple anatomy regions (e.g. Brain + Cervical Spine).
 */
import { mergeBlock } from "./quickFindingsMerge";
import { pickQuickProtocol } from "./pickQuickProtocol";
import type { QuickSelectData } from "@/components/radiology/QuickFindingsPanel";

/** Modality prefix used in combined report titles (MRI, CT, USG, …). */
export function modalityTitlePrefix(modality: string | null | undefined): string {
  const m = (modality ?? "").trim().toUpperCase();
  if (!m) return "";
  if (m === "MR" || m.startsWith("MR")) return "MRI";
  if (m === "CT" || m.startsWith("CT")) return "CT";
  if (m === "US" || m.startsWith("US")) return "USG";
  if (m === "CR" || m === "DX" || m === "XR" || m === "XA" || m === "RF") return "X-RAY";
  return m;
}

/**
 * Build a combined study / test name from selected regions.
 * e.g. MR + ["Brain", "Cervical Spine"] → "MRI BRAIN WITH CERVICAL SPINE"
 */
export function combineStudyRegionTitle(
  modality: string | null | undefined,
  regions: string[],
): string | null {
  const parts = regions.map((r) => r.trim().toUpperCase()).filter(Boolean);
  if (parts.length === 0) return null;

  const mod = modalityTitlePrefix(modality);
  const stripMod = (p: string) => {
    if (!mod) return p;
    if (p.startsWith(`${mod} `)) return p.slice(mod.length + 1);
    if (p.startsWith(mod)) return p.slice(mod.length).trim();
    return p;
  };

  if (parts.length === 1) {
    const p = parts[0];
    if (mod && !p.startsWith(mod)) return `${mod} ${p}`;
    return p;
  }

  const first = parts[0];
  const firstTitle = mod && !first.startsWith(mod) ? `${mod} ${first}` : first;
  const rest = parts.slice(1).map(stripMod);
  return [firstTitle, ...rest].join(" WITH ");
}

/** Merge default protocol + tab technique text for each selected region. */
export function mergeTechniqueForRegions(
  data: QuickSelectData | undefined,
  regions: string[],
): string {
  let merged = "";
  if (!data || regions.length === 0) return merged;
  for (const region of regions) {
    const protocol = pickQuickProtocol(data.protocols, region);
    if (protocol?.techniqueText) merged = mergeBlock(merged, protocol.techniqueText);
    const tab = data.tabs?.find((t) => t.name === region);
    if (tab?.techniqueText) merged = mergeBlock(merged, tab.techniqueText);
  }
  return merged;
}
