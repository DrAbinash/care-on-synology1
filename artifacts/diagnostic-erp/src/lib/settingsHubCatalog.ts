/**
 * Catalog of admin pages formerly cluttering the left sidebar.
 * Surfaced as hub cards under Settings → Integrations & Ops (non-radiology)
 * and Settings → Radiology Tools (radiology). Standalone routes stay wired —
 * hubs only organize discovery; they do not re-implement the pages.
 */

export type SettingsHubLink = {
  title: string;
  path: string;
  description: string;
  /** Where the feature is also configured / already embedded. */
  alsoIn?: string;
};

/** Non-radiology: partner integrations, reception ops, credentials, knowledge. */
export const INTEGRATIONS_OPS_LINKS: SettingsHubLink[] = [
  {
    title: "Hope Connection",
    path: "/hope-connection",
    description: "Partner hospital connection, WhatsApp health, and Hope Care bridge settings.",
  },
  {
    title: "Reception Command Center",
    path: "/reception-command-center",
    description: "Live reception feed, status panels, and front-desk command view.",
  },
  {
    title: "Diagnostic Integration",
    path: "/diagnostic-integration",
    description: "Integration admin for external diagnostic partners and sync endpoints.",
  },
  {
    title: "Knowledge Base",
    path: "/knowledge-base",
    description: "Clinic knowledge articles and searchable reference content.",
  },
  {
    title: "AI Caller Credentials",
    path: "/ai-caller-credentials",
    description: "API credentials for the AI caller / outbound voice integrations (not radiology LLM keys).",
  },
];

/** Radiology PACS / DICOM / network / agent tooling. */
export const RADIOLOGY_INFRA_LINKS: SettingsHubLink[] = [
  {
    title: "Radiology Settings Center",
    path: "/settings/radiology",
    description: "Canonical hub for PACS, viewers, MWL, modalities, AI reporting panels, and diagnostics.",
  },
  {
    title: "Network Control Center",
    path: "/radiology/network-control-center",
    description: "LAN / Tailscale / public profile routing and sync diagnostics.",
    alsoIn: "Radiology Settings → Diagnostics",
  },
  {
    title: "DICOM Nodes",
    path: "/dicom-nodes",
    description: "DICOM node registry, provider endpoints, and pull jobs.",
    alsoIn: "Radiology Settings → PACS Servers",
  },
  {
    title: "Modality Management",
    path: "/radiology/modality-management",
    description: "Modality AE titles, rooms, and worklist bindings.",
    alsoIn: "Radiology Settings → Modalities",
  },
  {
    title: "DICOM Agent",
    path: "/radiology/dicom-agent-dashboard",
    description: "Agent status, logs, and MWL bridge health.",
    alsoIn: "Radiology Settings → Diagnostics",
  },
  {
    title: "Watchdog",
    path: "/radiology/watchdog",
    description: "PACS / Orthanc watchdog dashboard and alerts.",
    alsoIn: "Radiology Settings → Diagnostics",
  },
  {
    title: "HL7 Settings",
    path: "/radiology/hl7-settings",
    description: "HL7 ORM message settings, inbox, and connection test.",
    alsoIn: "Radiology Settings → General (related links)",
  },
  {
    title: "Knowledge Packs",
    path: "/settings/radiology/knowledge-packs",
    description: "Install and manage radiology knowledge packs for reporting.",
  },
  {
    title: "Quick Select Buttons",
    path: "/settings/radiology-quick-select",
    description: "USG / reporting quick-select button configuration.",
  },
  {
    title: "Advanced Tools catalog",
    path: "/radiology/advanced-tools",
    description: "Searchable launcher for experimental and owner-only radiology admin pages.",
  },
];

/** Radiology AI / reporting assistant tooling. */
export const RADIOLOGY_AI_LINKS: SettingsHubLink[] = [
  {
    title: "AI Reporting",
    path: "/radiology/ai-reporting-settings",
    description: "Providers, models, prompts, and auto-generation rules.",
    alsoIn: "Radiology Settings → AI & Templates",
  },
  {
    title: "AI Prompt Manager",
    path: "/radiology/ai-prompt-manager",
    description: "Prompt library CRUD for radiology AI drafts.",
  },
  {
    title: "AI Comparison",
    path: "/radiology/ai-comparison",
    description: "Run multi-model comparisons and save preferred outputs.",
  },
  {
    title: "Missed Finding Detector",
    path: "/radiology/missed-finding-detector",
    description: "Client-side checklist assistant for common missed findings.",
  },
  {
    title: "Image Review Assistant",
    path: "/radiology/image-review",
    description: "AI-assisted image review prompts and review workflow.",
  },
  {
    title: "Provider Fallback",
    path: "/radiology/provider-fallback",
    description: "Configure AI provider fallback chain when primary is down.",
  },
  {
    title: "AI Extraction Review",
    path: "/radiology/ai-extraction-review",
    description: "Queue for reviewing AI-extracted measurements before report insert.",
  },
  {
    title: "Teaching Files",
    path: "/teaching-cases",
    description: "Teaching case library linked to radiology reporting.",
  },
];
