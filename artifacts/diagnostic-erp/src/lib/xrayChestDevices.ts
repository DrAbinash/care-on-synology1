/**
 * xrayChestDevices.ts — structured lines / tubes / devices (spec §13).
 *
 * A device is an object with kind, side, course, tip, position judgement and
 * complication — never a free-text sentence the radiologist has to retype.
 *
 * The rule that matters: a tip distance is NEVER invented. `tipCm` is only ever
 * what the radiologist typed, and if the tip was not seen the emitted prose says
 * so explicitly instead of asserting satisfactory placement. This mirrors the
 * canonical library (§15: "Do not invent tip distances or declare vascular
 * placement without adequate visualization").
 *
 * Pure functions only — no store, no React.
 */
import { chestAtomsToPatches, chestBundleId, type ChestAtomSpec } from "./xrayChestAtoms";
import { CHEST_NORMAL_SENTENCES } from "./xrayChestNormalAtoms";

export type XrayDeviceKind =
  | "etTube"
  | "entericTube"
  | "cvc"
  | "picc"
  | "chestDrain"
  | "pacemaker"
  | "icd"
  | "prostheticValve"
  | "sternotomyWires"
  | "other";

export type XrayDevicePosition = "satisfactory" | "malpositioned" | "notAssessed";

export const XRAY_DEVICE_LABELS: Record<XrayDeviceKind, string> = {
  etTube: "endotracheal tube",
  entericTube: "enteric tube",
  cvc: "central venous catheter",
  picc: "peripherally inserted central catheter",
  chestDrain: "intercostal drain",
  pacemaker: "pacemaker",
  icd: "implantable cardioverter-defibrillator",
  prostheticValve: "prosthetic valve",
  sternotomyWires: "sternotomy wires",
  other: "other device",
};

const DEVICE_CONCEPTS: Record<XrayDeviceKind, string> = {
  etTube: "et_tube_position",
  entericTube: "enteric_tube_position",
  cvc: "cvc_position",
  picc: "picc_position",
  chestDrain: "chest_drain_position",
  pacemaker: "pacemaker_leads",
  icd: "icd_device",
  prostheticValve: "prosthetic_valve",
  sternotomyWires: "sternotomy_wires",
  other: "surgical_hardware_other",
};

export type XrayDeviceInput = {
  kind: XrayDeviceKind;
  laterality?: "right" | "left" | null;
  /** Free text describing the observed course, e.g. "unfolding through the left brachiocephalic vein". */
  course?: string | null;
  /** Free text describing the observed tip, e.g. "at the level of the carina". */
  tip?: string | null;
  /** Radiologist-typed distance only. Never estimated by the system. */
  tipCm?: number | null;
  position: XrayDevicePosition;
  /** Complication attributable to the device, if any. */
  complication?: string | null;
  region?: string;
  bundleId?: string;
};

/**
 * Whether a positive positional claim is permitted for this device entry.
 * A tip must have been seen; a distance alone is not enough.
 */
export function devicePositionClaimable(device: XrayDeviceInput): boolean {
  if (device.position === "notAssessed") return false;
  return Boolean((device.tip ?? "").trim() || (device.course ?? "").trim());
}

export function composeDeviceSentence(device: XrayDeviceInput): string {
  const label = XRAY_DEVICE_LABELS[device.kind];
  const side = device.laterality ? ` on the ${device.laterality}` : "";
  const parts: string[] = [`${label[0].toUpperCase()}${label.slice(1)} in situ${side}`];

  const course = (device.course ?? "").trim();
  if (course) parts.push(course.replace(/\.$/, ""));

  const tip = (device.tip ?? "").trim();
  const tipCm = device.tipCm && Number.isFinite(device.tipCm) && device.tipCm > 0
    ? `${device.tipCm} cm`
    : null;
  if (tip && tipCm) parts.push(`tip ${tipCm} ${tip.replace(/\.$/, "")}`);
  else if (tip) parts.push(`tip ${tip.replace(/\.$/, "")}`);
  else if (tipCm) parts.push(`tip measured at ${tipCm}`);
  else parts.push("the tip is not adequately visualised for positional assessment");

  let sentence = `${parts.join("; ")}.`;
  if (device.position === "malpositioned") {
    sentence += " Malpositioned.";
  } else if (device.position === "satisfactory") {
    // "Satisfactory" is only written when the course or tip was actually seen.
    sentence += devicePositionClaimable(device)
      ? " Position is satisfactory."
      : " Position cannot be confirmed on this projection.";
  }
  const complication = (device.complication ?? "").trim();
  if (complication) sentence += ` Associated ${complication.replace(/\.$/, "")}.`;
  return sentence;
}

export function buildChestDeviceAtoms(device: XrayDeviceInput): {
  bundleId: string;
  observations: ReturnType<typeof chestAtomsToPatches>;
} {
  const region = device.region ?? "Chest";
  const bundleId = device.bundleId ?? chestBundleId("device", device.kind);
  const malpositioned = device.position === "malpositioned";

  const atoms: ChestAtomSpec[] = [
    {
      concept: DEVICE_CONCEPTS[device.kind],
      conflictGroup: DEVICE_CONCEPTS[device.kind],
      anatomicalSection: "lines and tubes",
      findings: composeDeviceSentence(device),
      impression: malpositioned
        ? `Malpositioned ${XRAY_DEVICE_LABELS[device.kind]}.`
        : undefined,
      // Supersedes the "No lines, tubes or devices are identified." baseline.
      baselineReplaces: CHEST_NORMAL_SENTENCES.noDevices,
      laterality: device.laterality ?? undefined,
      severity: malpositioned ? "severe" : undefined,
      measurement: device.tipCm && device.tipCm > 0 ? `tip ${device.tipCm} cm` : undefined,
      supportsLaterality: Boolean(device.laterality),
    },
  ];

  return { bundleId, observations: chestAtomsToPatches(region, bundleId, atoms) };
}

export const XRAY_DEVICE_POSITION_OPTIONS: Array<{
  value: XrayDevicePosition;
  label: string;
}> = [
  { value: "satisfactory", label: "Satisfactory position" },
  { value: "malpositioned", label: "Malpositioned" },
  { value: "notAssessed", label: "Not assessable on this film" },
];
