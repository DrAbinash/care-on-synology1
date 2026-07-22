/**
 * usgActivationService — safe production-activation control plane (final
 * activation mission). Classifies every USG flag into an activation GROUP and
 * gates infra-dependent activation on real health checks. It reuses the P9
 * readiness service + the canonical PACS provider health; it creates no new
 * flag store (writes go through the audited /api/usg-admin enable path).
 *
 *   GROUP A — safe, deterministic UI features. Enable after build/route tests
 *             (no external infrastructure). One-click, audited, reversible.
 *   GROUP B — infra-dependent. Enable ONLY when the matching health check passes
 *             (Orthanc / embedded viewer / AI gateway). If a check fails the
 *             feature stays OFF and is shown "Unavailable — infrastructure not
 *             connected"; the rest of the workspace stays usable.
 *   GROUP C — safety controls that are ALWAYS active and are NOT feature flags
 *             (PCPNDT fail-closed, auth, locks, signed-report immutability, AI
 *             write-guard, no fetal sex, cross-patient protection, audit).
 */

import { getPacsProvider } from "./pacs/providers";

export type ActivationGroup = "A" | "B";
export type InfraKind = "orthanc" | "viewer" | "ai_gateway" | "none";

export interface ActivationEntry {
  flag: string;
  group: ActivationGroup;
  infra: InfraKind;
  label: string;
}

/** The USG flags and their activation group + infra dependency. */
export const USG_ACTIVATION_PLAN: ActivationEntry[] = [
  { flag: "ff_radiology_usg_workspace",          group: "A", infra: "none",       label: "USG Companion workspace" },
  { flag: "ff_radiology_usg_companion_p2",       group: "A", infra: "none",       label: "P2 workflow / readiness" },
  { flag: "ff_radiology_usg_prior_intelligence", group: "A", infra: "none",       label: "Prior-study comparison" },
  { flag: "ff_radiology_usg_pregnancy_timeline", group: "A", infra: "none",       label: "Pregnancy timeline" },
  { flag: "ff_radiology_usg_ob_canonical",       group: "A", infra: "none",       label: "Canonical OB sections" },
  { flag: "ff_radiology_usg_doppler_canonical",  group: "A", infra: "none",       label: "Canonical Doppler sections" },
  { flag: "ff_radiology_usg_dicom_extraction",   group: "B", infra: "orthanc",    label: "DICOM extraction" },
  { flag: "ff_radiology_usg_exact_provenance",   group: "B", infra: "viewer",     label: "Exact frame provenance / viewer nav" },
  { flag: "ff_radiology_usg_cine",               group: "B", infra: "viewer",     label: "Cine playback" },
  { flag: "ff_radiology_usg_report_to_pacs",     group: "B", infra: "orthanc",    label: "Report → PACS return" },
  { flag: "ff_radiology_usg_ai_assistant",       group: "B", infra: "ai_gateway", label: "AI assistant" },
  { flag: "ff_radiology_usg_ai_growth",          group: "B", infra: "ai_gateway", label: "AI growth assistant" },
];

export interface InfraSetupGuide {
  kind: InfraKind;
  title: string;
  unlocks: string;
  envVars: string[];
  steps: string[];
}

/** In-app setup guide for the infrastructure that Group-B features need. Shown
 *  on the Admin rollout page next to the live health chips. */
export const INFRA_SETUP: InfraSetupGuide[] = [
  {
    kind: "orthanc",
    title: "Orthanc (PACS)",
    unlocks: "Auto-measurement extraction + Report-to-PACS return",
    envVars: ["ORTHANC_URL=http://<orthanc-host>:8042", "ORTHANC_USERNAME=<user>", "ORTHANC_PASSWORD=<pass>"],
    steps: [
      "Run Orthanc and make it reachable from the care-api container.",
      "Enable the Orthanc DICOMweb plugin (extraction + WADO frame fetch use it).",
      "Set the env vars on care-api (Container Manager → Environment), or the DICOMweb URL in PACS settings.",
      "Point the GE Voluson to send studies to the Orthanc AE title.",
      "When the Orthanc chip turns green, use “Enable infra features where healthy”.",
    ],
  },
  {
    kind: "viewer",
    title: "Embedded OHIF viewer",
    unlocks: "Exact frame navigation + cine playback",
    envVars: [],
    steps: [
      "Confirm the embedded OHIF viewer is deployed and reachable (reads the same Orthanc DICOMweb).",
      "Ensure it serves multi-frame ultrasound studies.",
      "Viewer capability is verified in the browser — the server cannot assert it.",
      "Frame-navigation commands + multi-frame playback need a final wiring pass against the live viewer.",
    ],
  },
  {
    kind: "ai_gateway",
    title: "AI gateway",
    unlocks: "AI suggestions + growth notes",
    envVars: ["USG_AI_GATEWAY_URL=https://<your-ai-gateway>"],
    steps: [
      "Stand up the CARE AI gateway (or point at your model endpoint).",
      "Set USG_AI_GATEWAY_URL on care-api.",
      "Turn on the global AI master flag (ff_radiology_ai) in AI settings.",
      "Set the per-radiologist AI policy to pilot/production.",
      "When the AI-gateway chip turns green, the AI panel generates instead of showing “unavailable”.",
    ],
  },
];

/** GROUP C — always-active safety controls (documented; never flag-toggled). */
export const GROUP_C_SAFETY_CONTROLS = [
  "PCPNDT / Form-F server-side finalization (fail-closed)",
  "Patient authorization + study locking",
  "Signed-report immutability + canonical versioning",
  "AI write-guard (AI never writes patient_reports / finalizes / signs)",
  "No fetal-sex generation",
  "Cross-patient comparison protection",
  "No unapproved measurement insertion",
  "Audit logging",
];

export const GROUP_A_FLAGS = USG_ACTIVATION_PLAN.filter((e) => e.group === "A").map((e) => e.flag);
export const GROUP_B_FLAGS = USG_ACTIVATION_PLAN.filter((e) => e.group === "B").map((e) => e.flag);

export interface HealthResult { ok: boolean; message: string; checkedServerSide: boolean; }
export interface InfraHealth {
  orthanc: HealthResult;
  viewer: HealthResult;
  ai_gateway: HealthResult;
}

/** Live infrastructure health for Group-B gating. Never throws. */
export async function checkInfraHealth(): Promise<InfraHealth> {
  // Orthanc — reuse the canonical PACS provider liveness probe.
  let orthanc: HealthResult;
  try {
    const provider = await getPacsProvider();
    const h = await provider.health();
    orthanc = { ok: h.ok, message: h.ok ? `${provider.displayName} reachable` : (h.message ?? "unreachable"), checkedServerSide: true };
  } catch (err) {
    orthanc = { ok: false, message: err instanceof Error ? err.message : "probe failed", checkedServerSide: true };
  }

  // AI gateway — configured URL is the server-side precondition; the deeper
  // authenticated health is confirmed by the AI subsystem at use time.
  const gatewayUrl = process.env.USG_AI_GATEWAY_URL || "";
  const ai_gateway: HealthResult = gatewayUrl
    ? { ok: true, message: "USG_AI_GATEWAY_URL configured", checkedServerSide: true }
    : { ok: false, message: "USG_AI_GATEWAY_URL not set — AI gateway not connected", checkedServerSide: true };

  // Viewer capability is a browser-side property of the installed OHIF build;
  // the server cannot assert it. Report honestly as client-checked.
  const viewer: HealthResult = { ok: false, message: "Embedded viewer capability is verified in the browser, not server-side", checkedServerSide: false };

  return { orthanc, viewer, ai_gateway };
}

export interface FlagActivationView extends ActivationEntry {
  enabled: boolean;
  /** Live status label for the admin UI. */
  status: "Live" | "Available" | "Unavailable" | "Needs Orthanc" | "Needs Viewer" | "Needs AI Gateway";
  /** True when this flag may be enabled right now given group + health. */
  activatable: boolean;
  remediation: string | null;
}

function infraOk(infra: InfraKind, health: InfraHealth): boolean {
  switch (infra) {
    case "none": return true;
    case "orthanc": return health.orthanc.ok;
    case "ai_gateway": return health.ai_gateway.ok;
    case "viewer": return health.viewer.ok; // server-side false → activated by an admin after the browser check
  }
}

/** Build the activation view (group + health + status) for the admin page. */
export function buildActivationView(live: Record<string, boolean>, health: InfraHealth): FlagActivationView[] {
  return USG_ACTIVATION_PLAN.map((e) => {
    const enabled = live[e.flag] === true;
    const ok = infraOk(e.infra, health);
    let status: FlagActivationView["status"];
    let remediation: string | null = null;
    if (enabled) status = "Live";
    else if (e.group === "A") status = "Available";
    else if (ok) status = "Available";
    else {
      status = e.infra === "orthanc" ? "Needs Orthanc" : e.infra === "viewer" ? "Needs Viewer" : "Needs AI Gateway";
      remediation = e.infra === "orthanc" ? health.orthanc.message
        : e.infra === "viewer" ? health.viewer.message
        : health.ai_gateway.message;
    }
    return {
      ...e, enabled, status, remediation,
      activatable: !enabled && (e.group === "A" || ok),
    };
  });
}

/** Group-A flags to enable, in dependency order (they have no infra needs). */
export function groupAActivationOrder(): string[] {
  return GROUP_A_FLAGS; // already listed dependency-first
}

/** Group-B flags whose infra health currently passes (safe to auto-enable). */
export function groupBActivatable(health: InfraHealth): string[] {
  return USG_ACTIVATION_PLAN.filter((e) => e.group === "B" && infraOk(e.infra, health)).map((e) => e.flag);
}
