/**
 * radiologyFeatureFlagRegistry.ts — Ticket BEND-1 Phase 10: the ONE
 * code-backed registry of radiology feature flags.
 *
 * Every ff_radiology_* key that exists in the database seeds is declared here
 * with its default, dependencies, purpose, safe enable order, rollback
 * effect, owner subsystem, and whether server code actually gates on it
 * TODAY ("wired"). A source-scan test pins that every isFeatureEnabledServer
 * literal in the backend appears here — a new gated flag cannot ship
 * unregistered. validateFlagDependencies() flags enabled-flag-with-disabled-
 * dependency states for the ops health surface.
 *
 * BEND-1 creates NO new flags — this documents and validates what exists.
 */

export interface RadiologyFlagEntry {
  key: string;
  /** All radiology flags seed disabled. */
  defaultValue: false;
  /** Flags that must be ON before this one may be enabled. */
  dependsOn: string[];
  purpose: string;
  /** 1-based safe enable order (same number = order-independent peers). */
  enableOrder: number;
  rollbackEffect: string;
  ownerSubsystem: string;
  /** True when server code gates on the flag today; false = seeded for a
   *  future strand, currently inert. */
  wired: boolean;
}

export const RADIOLOGY_FLAG_REGISTRY: RadiologyFlagEntry[] = [
  {
    key: "ff_radiology_structured_core",
    defaultValue: false, dependsOn: [], enableOrder: 1, wired: true,
    purpose: "Strand A — FindingInstance dual-write into report_finding_instances; gates the A4 structured cache + A5 drift tooling",
    rollbackEffect: "disable → dual-write, cache regen and drift scans stop; existing rows remain readable",
    ownerSubsystem: "structured core",
  },
  {
    key: "ff_radiology_catalog",
    defaultValue: false, dependsOn: ["ff_radiology_structured_core"], enableOrder: 2, wired: true,
    purpose: "Structured finding catalog endpoints (B tickets) backing D1 documents",
    rollbackEffect: "disable → catalog endpoints refuse; existing drafts keep their materialized text",
    ownerSubsystem: "catalog",
  },
  {
    key: "ff_radiology_structured_d1_draft",
    defaultValue: false, dependsOn: ["ff_radiology_structured_core", "ff_radiology_catalog"], enableOrder: 3, wired: true,
    purpose: "Ticket D3 — persist the canonical D1 document to radiology_report_drafts.structured_json_d1",
    rollbackEffect: "disable → drafts stop writing structured_json_d1; legacy draft columns unaffected",
    ownerSubsystem: "draft D1",
  },
  {
    key: "ff_radiology_structured_final",
    defaultValue: false, dependsOn: ["ff_radiology_structured_d1_draft"], enableOrder: 4, wired: true,
    purpose: "Ticket D5 — sign/finalize through the D1 pipeline (legacy fallback preserved)",
    rollbackEffect: "disable → finalize falls back to the legacy path; already-signed structured reports stay valid",
    ownerSubsystem: "final structured",
  },
  {
    key: "ff_radiology_structured_read",
    defaultValue: false, dependsOn: ["ff_radiology_structured_final"], enableOrder: 5, wired: true,
    purpose: "Ticket D6 — serve viewer/print/PDF/PACS surfaces from the D4 render of structured_json",
    rollbackEffect: "disable → read surfaces fall back to stored legacy HTML/body; no data change",
    ownerSubsystem: "structured read",
  },
  {
    key: "ff_radiology_voice_structured",
    defaultValue: false, dependsOn: ["ff_radiology_structured_core", "ff_radiology_catalog"], enableOrder: 6, wired: false,
    purpose: "Strand K — voice slot-filling into structured findings (M1.6B2/B3 shipped voice WITHOUT this; it stays reserved for structured slot-filling)",
    rollbackEffect: "inert today — no server code gates on it",
    ownerSubsystem: "voice",
  },
  {
    key: "ff_radiology_render_v2", defaultValue: false, dependsOn: ["ff_radiology_structured_core"], enableOrder: 7, wired: false,
    purpose: "Strand F — merged renderEngine as sole text producer (not yet wired server-side)",
    rollbackEffect: "inert today", ownerSubsystem: "renderer",
  },
  {
    key: "ff_radiology_measurement_pool", defaultValue: false, dependsOn: ["ff_radiology_structured_core"], enableOrder: 7, wired: false,
    purpose: "Strand C — measurement pool attach/detach", rollbackEffect: "inert today", ownerSubsystem: "measurements",
  },
  {
    key: "ff_radiology_classification", defaultValue: false, dependsOn: ["ff_radiology_structured_core"], enableOrder: 7, wired: false,
    purpose: "Strand D — TI-RADS/NIHSS grading engine", rollbackEffect: "inert today", ownerSubsystem: "classification",
  },
  {
    key: "ff_radiology_modality_expand", defaultValue: false, dependsOn: ["ff_radiology_catalog"], enableOrder: 7, wired: false,
    purpose: "Strand E — XA/IR/NM/PT vocabulary", rollbackEffect: "inert today", ownerSubsystem: "catalog",
  },
  {
    key: "ff_radiology_catalog_delta", defaultValue: false, dependsOn: ["ff_radiology_catalog"], enableOrder: 7, wired: false,
    purpose: "Strand H — versioned catalog + delta sync", rollbackEffect: "inert today", ownerSubsystem: "catalog",
  },
  {
    key: "ff_radiology_search_v2", defaultValue: false, dependsOn: [], enableOrder: 7, wired: false,
    purpose: "Strand G — pg_trgm fuzzy search", rollbackEffect: "inert today", ownerSubsystem: "search",
  },
  {
    key: "ff_radiology_hierarchy", defaultValue: false, dependsOn: ["ff_radiology_catalog"], enableOrder: 7, wired: false,
    purpose: "Strand I — zone/structure hierarchy layers", rollbackEffect: "inert today", ownerSubsystem: "catalog",
  },
  {
    key: "ff_radiology_presets", defaultValue: false, dependsOn: ["ff_radiology_catalog"], enableOrder: 7, wired: false,
    purpose: "Strand J — doctor/dept/hospital presets", rollbackEffect: "inert today", ownerSubsystem: "presets",
  },
  {
    key: "ff_radiology_multiwindow", defaultValue: false, dependsOn: [], enableOrder: 7, wired: false,
    purpose: "Strand L — dockable multi-monitor workspace", rollbackEffect: "inert today", ownerSubsystem: "unified workspace",
  },
  {
    key: "ff_radiology_ai_assist", defaultValue: false, dependsOn: ["ff_radiology_structured_core"], enableOrder: 8, wired: false,
    purpose: "Strand M — AI suggestions behind a confirmation gate", rollbackEffect: "inert today", ownerSubsystem: "ai assist",
  },
  {
    key: "ff_radiology_scale_partition", defaultValue: false, dependsOn: [], enableOrder: 8, wired: false,
    purpose: "Strand N — partitioning + read replicas", rollbackEffect: "inert today", ownerSubsystem: "scale",
  },
  {
    key: "ff_radiology_usg_dicom_extraction", defaultValue: false, dependsOn: [], enableOrder: 9, wired: false,
    purpose: "USG P3 — DICOM-native SR content-tree extraction (parser + extraction hierarchy)",
    rollbackEffect: "disable → extraction falls back to the legacy shallow SR parse; no data change",
    ownerSubsystem: "usg extraction",
  },
  {
    key: "ff_radiology_usg_exact_provenance", defaultValue: false, dependsOn: ["ff_radiology_usg_dicom_extraction"], enableOrder: 10, wired: true,
    purpose: "USG P3 — exact frame/SCOORD-caliper provenance. Wired: extraction ingests SR rows into viewer_measurements (real frame, never fabricated; idempotent). Frame-level VIEWER NAVIGATION UI still needs the live OHIF viewer.",
    rollbackEffect: "disable → provenance degrades to series/SR-document level; viewer_measurements not populated from SR",
    ownerSubsystem: "usg provenance",
  },
  {
    key: "ff_radiology_usg_prior_intelligence", defaultValue: false, dependsOn: [], enableOrder: 11, wired: true,
    purpose: "USG P4 — prior-study matching + structured current-vs-prior comparison (suggestion-only, same-patient guarded). Wired: /api/usg-prior gates on this flag; the workspace comparison panel is live.",
    rollbackEffect: "disable → no automatic prior suggestions surfaced; manual comparison unaffected; no data change",
    ownerSubsystem: "usg comparison",
  },
  {
    key: "ff_radiology_usg_pregnancy_timeline", defaultValue: false, dependsOn: ["ff_radiology_usg_prior_intelligence"], enableOrder: 12, wired: false,
    purpose: "USG P4 — pregnancy-episode grouping + GA/EFW trend timeline (reuses canonical obstetric engine)",
    rollbackEffect: "disable → timeline panel hidden; per-scan obstetric calculations unaffected; no data change",
    ownerSubsystem: "usg obstetrics",
  },
  {
    key: "ff_radiology_usg_ob_canonical", defaultValue: false, dependsOn: [], enableOrder: 13, wired: true,
    purpose: "USG P5 — canonical obstetric section builder (GA/EDD/EFW/AFI via the one obstetric engine; PCPNDT-safe, no fetal sex)",
    rollbackEffect: "disable → OB reporting uses the legacy autofill text; no data change",
    ownerSubsystem: "usg obstetrics",
  },
  {
    key: "ff_radiology_usg_doppler_canonical", defaultValue: false, dependsOn: [], enableOrder: 14, wired: true,
    purpose: "USG P5 — canonical Doppler section builder (RI/PI/S-D/CPR via the one obstetric engine; descriptive flags only)",
    rollbackEffect: "disable → Doppler reporting uses the legacy autofill text; no data change",
    ownerSubsystem: "usg doppler",
  },
  {
    key: "ff_radiology_usg_report_to_pacs", defaultValue: false, dependsOn: [], enableOrder: 15, wired: true,
    purpose: "USG P6 — return the signed USG report to PACS via the canonical archiveReportToPacs, gated by a fail-closed eligibility policy (finalized + latest version + PCPNDT-compliant for OB)",
    rollbackEffect: "disable → no automated USG report-to-PACS return; manual archive path unchanged; no data change",
    ownerSubsystem: "usg pacs return",
  },
  {
    key: "ff_radiology_usg_cine", defaultValue: false, dependsOn: ["ff_radiology_usg_dicom_extraction"], enableOrder: 16, wired: true,
    purpose: "USG P7 — cine-loop (multi-frame US) key-frame selection + playback capability, reusing the P3 SrImageRef provenance model",
    rollbackEffect: "disable → cine key-frame capture/playback hidden; single-frame extraction unaffected; no data change",
    ownerSubsystem: "usg cine",
  },
  {
    key: "ff_radiology_usg_ai_assistant", defaultValue: false, dependsOn: [], enableOrder: 17, wired: true,
    purpose: "USG P8 — advisory AI assistant (suggestion-only; never signs/finalizes, never writes patient_reports, never bypasses Form F, never emits fetal sex; reuses the canonical AI enablement policy)",
    rollbackEffect: "disable → no AI suggestions surfaced; manual reporting unaffected; no data change",
    ownerSubsystem: "usg ai",
  },
  {
    key: "ff_radiology_usg_ai_growth", defaultValue: false, dependsOn: ["ff_radiology_usg_ai_assistant", "ff_radiology_usg_pregnancy_timeline"], enableOrder: 18, wired: false,
    purpose: "USG P8 — AI growth-note suggestions over the P4 pregnancy timeline (advisory; never auto-classifies IUGR/macrosomia)",
    rollbackEffect: "disable → no AI growth notes; the timeline and manual interpretation are unaffected; no data change",
    ownerSubsystem: "usg ai",
  },
  {
    key: "ff_radiology_usg_sugandha_mode", defaultValue: false, dependsOn: [], enableOrder: 19, wired: false,
    purpose: "USG P9 — curated single-radiologist rollout profile (validated P0–P2 baseline); enables nothing on its own",
    rollbackEffect: "disable → the rollout profile is inert; per-flag enablement is unaffected; no data change",
    ownerSubsystem: "usg rollout",
  },
];

export interface FlagDependencyViolation {
  key: string;
  missingDependencies: string[];
}

/** Enabled flags whose dependencies are NOT enabled — the health surface
 *  reports these as configuration errors. */
export function validateFlagDependencies(liveFlags: Record<string, boolean>): FlagDependencyViolation[] {
  const violations: FlagDependencyViolation[] = [];
  for (const entry of RADIOLOGY_FLAG_REGISTRY) {
    if (!liveFlags[entry.key]) continue;
    const missing = entry.dependsOn.filter((dep) => !liveFlags[dep]);
    if (missing.length > 0) violations.push({ key: entry.key, missingDependencies: missing });
  }
  return violations;
}

/** Registry keys sorted by safe enable order (peers keep declaration order). */
export function safeEnableOrder(): string[] {
  return [...RADIOLOGY_FLAG_REGISTRY].sort((a, b) => a.enableOrder - b.enableOrder).map((e) => e.key);
}
