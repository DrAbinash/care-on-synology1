// Shared helper for the staff session that the patient portal sets in
// localStorage when a staff member signs in. Read by Layout.tsx and App.tsx
// to filter the sidebar nav and to redirect to the first page the user is
// permitted to access.
//
// If no session is present (e.g. the user opened the ERP directly without
// going through the portal), all menu items remain visible — backwards
// compatibility with the existing "open" ERP behaviour.

export const ERP_SESSION_KEY = "erp_session";

export type StaffUser = {
  id: number;
  name: string;
  email: string;
  username?: string | null;
  role: string;
  permissions: string[];
  maxDiscount: number | null;
  photoDataUrl?: string | null;
  // Uploaded signature image — printed on this user's bills in place of a
  // blank signature line when present (see printBill.ts).
  signatureDataUrl?: string | null;
  // Per-user sidebar theme synced from the server. Seeded into localStorage
  // on login so the local useUserTheme hook picks it up immediately.
  sidebarTheme?: string | null;
  pacsNetworkProfile?: string | null;
  // Per-user default start page
  defaultStartPage?: string | null;
  // Server-issued flag — when true the staff-login flow forces the user
  // through the change-PIN screen before persisting this session.
  mustChangePin?: boolean;
};

export type StaffSession = {
  token: string;
  user: StaffUser;
};

export function readStaffSession(): StaffSession | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(ERP_SESSION_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffSession;
    if (!parsed?.user || !Array.isArray(parsed.user.permissions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStaffSession(s: StaffSession) {
  try { window.localStorage.setItem(ERP_SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function clearStaffSession() {
  try { window.localStorage.removeItem(ERP_SESSION_KEY); } catch { /* ignore */ }
}

// Paths recognized by the user-management permission system. Any path NOT in
// this set is considered "unrestricted" — visible to every signed-in user
// regardless of their permissions array. This mirrors how the existing
// Settings → Users tab presents permissions: only these paths are toggleable.
export const PERMISSIONED_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/patients",
  "/register",
  "/orders",
  "/tests",
  "/billing",
  "/dues",
  "/payments",
  "/doctors",
  "/reports",
  "/report-generator",
  "/inventory",
  "/referrals",
  "/accounting",
  "/discounts",
  "/settings",
  "/dicom-nodes",
  "/website",
  "/form-f",
  "/queue",
  "/patient-reports",
  "/signatures",
  "/banking",
  "/samples",
  "/radiology",
  "/dicom-studies",
  "/dicom-workflow",
  "/smart-radiology",
  "/ris-monitor",
  "/radiology-workflow",
  "/teaching-cases",
  "/backup-replication",
]);

// Permission aliases — paths whose access is granted by another permission.
// HR Forms intentionally piggybacks on the /settings permission (per task
// spec): "visible only to roles whose permissions include /settings or
// admin/super_admin". Adding /hr-forms as a separate toggle would require
// every clinic to re-grant it; aliasing keeps existing /settings users
// flowing through unchanged.
//
// /form-f, /patient-reports, and /signatures piggyback on /reports:
// they are operational screens within the clinical report workflow and
// should be available to any role that has already been granted /reports.
const PERMISSION_ALIASES: Readonly<Record<string, string>> = {
  "/hr-forms": "/settings",
  "/patient-reports": "/reports",
  "/signatures": "/reports",
  "/backup-replication": "/settings",
  "/dicom-studies": "/dicom-nodes",
  "/dicom-workflow": "/radiology",
  "/smart-radiology": "/radiology",
  "/ris-monitor": "/radiology",
  "/radiology-workflow": "/radiology",
  "/teaching-cases": "/radiology",
  "/teaching-collections": "/radiology",
  "/teaching-favorites": "/radiology",
  "/teaching-ai": "/radiology",
  "/teaching-research": "/radiology",
  "/teaching-mode": "/radiology",
  "/teaching-analytics": "/radiology",
  "/teaching-presentation": "/radiology",
  "/radiology/worklist": "/radiology",
  // R1.4 review finding: RadiologyWorklist's "Report" button gates its
  // visibility with may("/radiology/report") — without this alias, the
  // bare literal "/radiology/report" is in neither PERMISSION_ALIASES nor
  // PERMISSIONED_PATHS, so canAccess() falls through its "path isn't part
  // of the permission system → always allowed" branch and the button-level
  // check silently becomes a no-op for every signed-in staff member. Actual
  // navigation to /radiology/report/:studyId stays correctly gated via
  // App.tsx's prefix-match fallback to "/radiology" — this alias closes the
  // matching button-level gap, mirroring every sibling radiology route.
  "/radiology/report": "/radiology",
  "/radiology/pacs-settings": "/radiology",
  "/radiology/network-control-center": "/radiology",
  "/radiology/pacs-logs": "/radiology",
  "/radiology/dicom-agent-dashboard": "/radiology",
  "/radiology/modality-management": "/radiology",
  "/radiology/viewer": "/radiology",
  "/radiology/report-generator": "/radiology",
  "/radiology/reporting-workspace": "/radiology",
  "/radiology/unified-report": "/radiology",
  "/radiology/pacs-dashboard": "/radiology",
  "/radiology/agent-setup": "/radiology",
  "/radiology/ai-reporting-settings": "/radiology",
  "/radiology/ai-prompt-templates": "/radiology",
  "/radiology/ai-prompt-manager": "/radiology",
  "/radiology/ai-comparison": "/radiology",
  "/radiology/missed-finding-detector": "/radiology",
  "/radiology/image-review": "/radiology",
  "/radiology/provider-fallback": "/radiology",
  "/radiology/productivity": "/radiology",
  "/radiology/ai-model-routing": "/radiology",
  "/radiology/structured-report-templates": "/radiology",
  "/radiology/ai-audit-log": "/radiology",
  "/radiology/ai-quality-scores": "/radiology",
  "/radiology/ai-prompt-effectiveness": "/radiology",
  "/radiology/ai-dicom-findings": "/radiology",
  "/radiology/rag-vector-store": "/radiology",
  "/radiology/ai-search-retrieval": "/radiology",
  "/radiology/anomaly-alerts": "/radiology",
  "/radiology/report-diff": "/radiology",
  "/radiology/feedback-loop-analytics": "/radiology",
  "/radiology/template-versions": "/radiology",
  "/radiology/billing-suggestions": "/radiology",
  "/radiology/peer-review-assignments": "/radiology",
};

export function normalizeRole(role: string): string {
  if (!role) return "";
  const r = role.toLowerCase().replace(/[^a-z0-9]/g, "_").trim();
  if (r === "superadmin" || r === "super" || r === "owner" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  return r;
}

// Roles that always get full access regardless of stored permissions.
export const FULL_ACCESS_ROLES = new Set(["admin", "super_admin"]);

// Returns true if the session belongs to an owner-level role (admin / super_admin).
// Used to gate Owner Dashboard access and the sidebar nav item.
export function isOwnerRole(session: StaffSession | null): boolean {
  if (!session) return false;
  return FULL_ACCESS_ROLES.has(normalizeRole(session.user.role));
}

export function canAccess(session: StaffSession | null, path: string): boolean {
  const required = PERMISSION_ALIASES[path] ?? path;
  // No session → deny access to all permissioned paths.
  if (!session) return !PERMISSIONED_PATHS.has(required);
  // Path isn't part of the permission system → always allowed.
  if (!PERMISSIONED_PATHS.has(required)) return true;
  if (FULL_ACCESS_ROLES.has(normalizeRole(session.user.role))) return true;
  // Also check if they have any of the sub-permissions for this path, which grants view access
  const hasSub = session.user.permissions.some(p => p === required || p.startsWith(required + ":"));
  if (hasSub) return true;
  return session.user.permissions.includes(required);
}

export function hasSubPermission(session: StaffSession | null, modulePath: string, action: string): boolean {
  if (!session) return false;
  if (FULL_ACCESS_ROLES.has(normalizeRole(session.user.role))) return true;
  const required = PERMISSION_ALIASES[modulePath] ?? modulePath;
  if (session.user.permissions.includes(required)) return true;
  return session.user.permissions.includes(`${required}:${action}`);
}

// Given a session and an ordered list of candidate paths, return the first
// one the user is permitted to view. Falls back to "/" when nothing matches.
export function firstAllowedPath(session: StaffSession | null, candidates: readonly string[]): string {
  for (const p of candidates) {
    if (canAccess(session, p)) return p;
  }
  return "/";
}

// Stricter than firstAllowedPath: returns the first candidate that is BOTH
// in the permissioned set AND explicitly granted to this user (or the user
// is admin/super_admin). Used to pick a meaningful landing page after login —
// e.g. a lab user lands on /orders, not on the unrestricted /dashboard that
// happens to be earlier in the nav order.
export function firstPermissionedPath(session: StaffSession | null, candidates: readonly string[]): string | null {
  if (!session) return null;
  const isFull = FULL_ACCESS_ROLES.has(normalizeRole(session.user.role));
  for (const p of candidates) {
    if (!PERMISSIONED_PATHS.has(p)) continue;
    if (isFull || session.user.permissions.includes(p)) return p;
  }
  return null;
}

// Returns the longest path in `candidates` that is a prefix of `pathname`.
// Used by the route guard so that e.g. "/orders/123/edit" resolves to "/orders"
// rather than the first candidate that happens to match.
// Feature flags for rollout-safe feature toggling.
// Each flag is stored in localStorage so it can be toggled per-browser for testing.
// New workflow features default to OFF. Existing workflow is unaffected.
//
// Toggle in browser console: localStorage.setItem("featureFlags", JSON.stringify({ showUnifiedReporting: true }))
//
const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = {
  showUnifiedReporting: false,
  // Phase 2B radiology feature flags (legacy names, kept for backward compatibility)
  showMeasurementPanel: false,
  showAiDraftPanel: false,
  showRadiologyMacros: false,
  showPreviousReportPanel: false,
  showFavoritesLibrary: false,
  showQuickAddButtons: false,
  showSmartFormatBuilder: false,
  // Phase 2C radiology feature flags (new names, aligned with Settings UI)
  radiologyMeasurements: false,
  radiologyAiAssistant: false,
  radiologyMacros: false,
  radiologyPreviousReports: false,
  radiologyFavorites: false,
  radiologyQuickAdd: false,
  radiologySmartFormat: false,
  // Phase 2D radiology intelligence flags (all default OFF)
  radiologyStructuredFindings: false,
  radiologyImpressionSync: false,
  radiologyConflictDetection: false,
  radiologyQualityChecker: false,
  radiologySmartImpression: false,
  radiologyMeasurementLibrary: false,
  radiologyPriorityEngine: false,
  radiologyComparison: false,
  radiologyFavoritesPack: false,
  // Phase 2D: Intelligence Layer
  radiologyKnowledgeBase: false,
  radiologyVersionHistory: false,
  radiologyAnalytics: false,
  // Phase 3: Premium Radiology Workstation flags (all default OFF)
  radiologyMasterLibrary: false,
  radiologyOneClickReports: false,
  radiologyAdvancedMeasurements: false,
  radiologyAiHooks: false,
  // Phase 3 Chunk 2: Report Assembler, QA Guard, Finalization Dashboard
  radiologyReportAssembler: false,
  radiologyQAGuard: false,
  radiologyFinalizationDashboard: false,
  // Phase 4: Radiology Knowledge Platform
  radiologyKnowledgePlatform: false,
  radiologyMasterTemplates: false,
  radiologyPersonalLibrary: false,
  radiologyTemplatePacks: false,
  radiologyKnowledgeBase_v2: false,
  radiologySignOffProfiles: false,
  radiologyTemplateAnalytics: false,
  // Phase 5: Structured Smart Reporting Engine (all default OFF)
  radiologySmartFindings_v2: false,
  radiologyImpressionRules: false,
  radiologyFavoriteFindingSets: false,
  radiologySmartAnalytics: false,
  // Phase 6: Enterprise Multi-AI Radiology Copilot (all default OFF)
  radiologyAICopilot: false,
  radiologyMultiAI: false,
  radiologyImageReview: false,
  radiologyDifferentialDiagnosis: false,
  radiologyQualityCheck: false,
  radiologyComparePrevious: false,
  radiologyPromptManager: false,
  radiologyFollowUp: false,
  radiologyLanguagePolish: false,
  // Phase 7A: Advanced Multi-AI Radiology Assistant (all default OFF)
  radiologyPromptManager_v2: false,
  radiologyImageReviewAssistant: false,
  radiologyAIComparison: false,
  radiologyMissedFindingDetector: false,
  radiologyProviderRouting: false,
  radiologyProviderFallback: false,
  // Phase 8: DICOM-Aware Radiology Copilot + Teaching Files (all default OFF)
  radiologyPriorComparison: false,
  radiologyMeasurementTracker: false,
  radiologySmartImpression_v2: false,
  radiologyConsistencyChecker: false,
  radiologyFollowupAssistant: false,
  radiologyDicomMetadataAssistant: false,
  radiologyStructuredReporting: false,
  radiologyTeachingMode: false,
  radiologyTeachingFiles: false,
  radiologyTeachingAI: false,
  radiologyTeachingCollections: false,
  radiologyTeachingPresentation: false,
  radiologyTeachingResearch: false,
  // Phase 9: Radiology Memory + Context Engine (all default OFF)
  radiologyMemoryEngine: false,
  radiologyStyleLearning: false,
  radiologyImpressionMemory: false,
  radiologyMeasurementMemory: false,
  radiologyDecisionMemory: false,
  radiologyFeedbackLoop: false,
  radiologyCaseMemory: false,
  radiologyAnalyticsMemory: false,
  radiologyMacroEngine: false,
  // Phase 10: DICOM Image Intelligence Platform (all default OFF)
  dicomImageIntelligence: false,
  lesionTracking: false,
  changeDetection: false,
  spineIntelligence: false,
  brainIntelligence: false,
  tumorFollowup: false,
  imageAnnotations: false,
  researchDatabase: false,
  teachingGenerator: false,
  multiAIImageReview: false,
  measurementAssistant: false,
  confidenceVisualization: false,
  ollamaSupport: false,
  caseOfMonth: false,
  annotationLayer: false,
  hideDeprecatedNav: false,
  billingDeskStepped: false,
  // Billing Desk display preferences (all apply immediately without page refresh)
  billingDeskQuickTests: true,       // Show quick test slots
  billingDeskShowPackages: true,     // Show packages section
  billingDeskAutoAdvance: false,     // Auto-advance stepped wizard
  billingDeskStickyBillSummary: true,  // Keep bill summary always visible
  billingDeskStickyPayment: true,    // Keep payment section always visible
  billingDeskDenseTestList: false,   // Reduce row height in test catalog
  billingDeskLargeFont: false,       // Increase font size for accessibility
  billingDeskShowOptionalFields: false, // Show DOB, blood group, address always
  billingDeskKeyboardNav: true,      // Enable keyboard shortcuts
  billingDeskAutoFocus: true,        // Auto-focus next field after selection
  // Radiology Implementation Roadmap (Ticket T0.1+) — server-backed flags.
  // Defaults here are the pre-hydration fallback only; once
  // setServerFeatureFlags() has been called (see hooks/useServerFeatureFlags),
  // the server's feature_flags table is authoritative for these keys and
  // wins over both this default and any stale localStorage copy. All off.
  ff_radiology_structured_core: false,
  ff_radiology_render_v2: false,
  ff_radiology_measurement_pool: false,
  ff_radiology_classification: false,
  ff_radiology_modality_expand: false,
  ff_radiology_catalog_delta: false,
  ff_radiology_search_v2: false,
  ff_radiology_hierarchy: false,
  ff_radiology_presets: false,
  ff_radiology_voice_structured: false,
  ff_radiology_multiwindow: false,
  ff_radiology_ai_assist: false,
  ff_radiology_scale_partition: false,
  // Dedicated USG Companion Workspace (P0/P1). Off by default: the canonical
  // RadiologyReportingWorkspace continues to serve every USG study until this
  // is enabled, so there is no regression when the flag is off.
  ff_radiology_usg_workspace: false,
};

const RADIOLOGY_FLAG_PREFIX = "ff_radiology_";

// Populated by setServerFeatureFlags() once /api/feature-flags has loaded.
// Deliberately NOT fetched from this file — staffSession.ts must stay free
// of any dependency on lib/fetchApi.ts, which itself imports from this file
// (ERP_SESSION_KEY/StaffSession/clearStaffSession); importing `api` here
// would create a circular module dependency. The actual fetch lives in
// hooks/useServerFeatureFlags.ts, a layer above both.
let serverRadiologyFlags: Record<string, boolean> | null = null;

export function getFeatureFlags(): Record<string, boolean> {
  let flags: Record<string, boolean>;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("featureFlags") : null;
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    flags = { ...FEATURE_FLAG_DEFAULTS, ...parsed };
  } catch {
    flags = { ...FEATURE_FLAG_DEFAULTS };
  }
  // Server wins for ff_radiology_* keys once hydrated — overlaid last so
  // neither the default nor a locally-toggled value can shadow it.
  if (serverRadiologyFlags) {
    return { ...flags, ...serverRadiologyFlags };
  }
  return flags;
}

export function isFeatureEnabled(flag: string): boolean {
  return getFeatureFlags()[flag] ?? FEATURE_FLAG_DEFAULTS[flag] ?? false;
}

/**
 * Called once by hooks/useServerFeatureFlags after GET /api/feature-flags
 * resolves. Only "ff_radiology_" prefixed keys are accepted — this function
 * can never be used to make a server value override any other (pre-existing,
 * client-only) flag. Re-dispatches the same "featureFlagsChanged" event the
 * existing setFeatureFlag() uses, so any component already re-rendering on
 * local toggles picks up the server values immediately, with no new
 * subscription mechanism needed.
 */
export function setServerFeatureFlags(flags: Record<string, boolean>): void {
  const radiologyOnly: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (key.startsWith(RADIOLOGY_FLAG_PREFIX)) radiologyOnly[key] = value;
  }
  serverRadiologyFlags = radiologyOnly;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("featureFlagsChanged", { detail: { source: "server" } }));
  }
}

export function setFeatureFlag(flag: string, value: boolean): void {
  try {
    const current = getFeatureFlags();
    current[flag] = value;
    window.localStorage.setItem("featureFlags", JSON.stringify(current));
    // Notify all same-tab components that a feature flag changed.
    // The "storage" event only fires in OTHER tabs, not the current one.
    // This custom event fills that gap so components re-render immediately
    // without a page refresh (fixes billing desk settings live-update bug).
    window.dispatchEvent(new CustomEvent("featureFlagsChanged", { detail: { flag, value } }));
  } catch { /* ignore */ }
}

export function longestMatchingNavPath(pathname: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  for (const p of candidates) {
    const matches = p === "/" ? pathname === "/" : (pathname === p || pathname.startsWith(p + "/"));
    if (matches && (best === null || p.length > best.length)) best = p;
  }
  return best;
}
