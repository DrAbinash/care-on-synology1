/**
 * Catalog of admin pages formerly cluttering the left sidebar.
 * Radiology discovery now deep-links into /settings/radiology?tab=… whenever
 * the surface is already embedded in the Radiology Settings Center.
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

/** Radiology PACS / DICOM / network / agent tooling — prefer Settings Center tabs. */
export const RADIOLOGY_INFRA_LINKS: SettingsHubLink[] = [
  {
    title: "Radiology Settings (hub)",
    path: "/settings/radiology",
    description: "Canonical hub for PACS, viewers, MWL, modalities, USG, Quick Select, AI, and diagnostics.",
  },
  {
    title: "Overview",
    path: "/settings/radiology?tab=overview",
    description: "Traffic-light health for Orthanc, MWL, sync workers, and deployment endpoints.",
  },
  {
    title: "Modalities",
    path: "/settings/radiology?tab=modalities",
    description: "Modality AE titles, rooms, and worklist bindings.",
  },
  {
    title: "PACS / DICOM (Full)",
    path: "/settings/radiology?tab=pacs-advanced",
    description: "Full PACS KV editor + DICOM node registry.",
  },
  {
    title: "Modality Worklist",
    path: "/settings/radiology?tab=mwl",
    description: "MWL deployment status, sync, staging/live mounts.",
  },
  {
    title: "Sync / Automation",
    path: "/settings/radiology?tab=sync",
    description: "care-erp-sync, poller, pull agent, Windows agent setup.",
  },
  {
    title: "USG Extraction",
    path: "/settings/radiology?tab=usg-extraction",
    description: "Ultrasound acquisition, SR, and companion admin (was /radiology/usg-admin-settings).",
  },
  {
    title: "Quick Select",
    path: "/settings/radiology?tab=quick-select",
    description: "Finding chips / macros for Reporting Workspace (was /settings/radiology-quick-select).",
  },
  {
    title: "Diagnostics",
    path: "/settings/radiology?tab=diagnostics",
    description: "Flight Deck, logs, watchdog, DICOM agent, network control shortcuts.",
  },
  {
    title: "Deployment (read-only)",
    path: "/settings/radiology?tab=deployment",
    description: "Resolved ORTHANC_INTERNAL_URL, worklist mounts, worker flags — no secrets.",
  },
  {
    title: "Knowledge Packs",
    path: "/settings/radiology/knowledge-packs",
    description: "Install and manage radiology knowledge packs for reporting.",
  },
];

/** Radiology AI / reporting assistant tooling — deep-link into hub when embedded. */
export const RADIOLOGY_AI_LINKS: SettingsHubLink[] = [
  {
    title: "AI & Templates",
    path: "/settings/radiology?tab=reporting",
    description: "AI reporting + inference panels (canonical).",
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
    description: "Side-by-side AI draft comparison workspace.",
  },
  {
    title: "Missed Finding Detector",
    path: "/radiology/missed-finding-detector",
    description: "Missed-finding detector admin / review.",
  },
  {
    title: "Image Review",
    path: "/radiology/image-review",
    description: "Image review assistant configuration.",
  },
  {
    title: "Provider Fallback",
    path: "/radiology/provider-fallback",
    description: "AI provider failover routing.",
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
