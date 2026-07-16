/*
 * audit-data.js — CARE Radiology Engineering Cockpit — EDITABLE DATA SNAPSHOT
 * ---------------------------------------------------------------------------
 * This file holds the cockpit's data. `index.html` is only presentation +
 * rendering; edit THIS file to keep the cockpit current, then bump
 * `meta.auditVersion` / `meta.lastUpdated` and append a row to `auditHistory`.
 *
 * IMPORTANT — this is an AUDIT SNAPSHOT, not live telemetry.
 *   • Nothing here is connected to the live repository, runtime, or database.
 *   • Asset counts (templates / protocols / Copilot modules / modalityMap) were
 *     code-verified at `meta.auditBaseCommit`; readiness %, study-coverage
 *     totals, and effort/risk are ENGINEERING JUDGMENTS (estimates).
 *   • Evidence-backed issue detail lives in ../CARE_PLATFORM_MASTER_AUDIT.md.
 *
 * Capability status codes used in `modalities[].caps`:
 *   2 = full · 1 = partial · 0 = none · "p" = planned/flag-reserved
 */
window.CARE_AUDIT = {
  meta: {
    title: "CARE Radiology — Engineering Cockpit",
    auditVersion: "1.0.0",
    auditDate: "2026-07-16",
    // Commit whose tree the evidence file:line references reflect (post MRI PR 5).
    auditBaseCommit: "8200e766",
    // Commit these docs were committed onto (may be newer than the audit base).
    committedOnto: "01b0ee49",
    lastUpdated: "2026-07-16",
    reviewer: "DrAbinash (platform owner) — pending human sign-off",
    method: "Six independent read-only audit sweeps, cross-checked and consolidated, verified against the MRI PR 1–5 implementation history.",
    // Headline KPIs (engineering judgments).
    engHealth: 60,
    liveModalitiesPct: 86,
    allModalityPct: 28,
    productionOrDev: "2 / 11",
    // Honest freshness caveat.
    freshnessNote: "Audit reflects the platform as of 2026-07-16 (base ≈ 8200e766, post MRI PR 5). USG consolidation (#92) merged subsequently, so USG-related items may already be advancing beyond what is shown.",
  },

  // Column labels for the capability matrix / per-modality cards (order matters).
  capabilities: [
    "Templates", "Protocols", "Clin History", "Quick Findings", "Structured",
    "Measurements", "Copilot", "Recommend", "AI Validate", "Critical Find",
    "Prev Compare", "Voice", "Cmd Palette", "Print", "Viewer/DICOM",
    "Worklist", "Reliability", "Audit",
  ],

  // Per-modality snapshot. `caps` aligns 1:1 with `capabilities` above.
  // `cov` = [studies with dedicated assets (verified), domain target (estimated)].
  modalities: [
    { n: "MRI", code: "MR", pct: 92, st: ["Production Ready", "st-prod"], mc: "--good", cov: [12, 45],
      cr: "Deep neuro/spine: 8 templates, 7 protocol specs, measurement library, structured findings, all core Copilot.",
      caps: [2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,1,2],
      issues: "C2 structured silent-loss · H9 state leak · MRI-specific Copilot module absent (KB covers)",
      audit: "C2,H2,H3,H9 (isolated); render/template consolidation (deferred)",
      cur: "—", nxt: "Phase 0 safety hotfixes (C1/C2/H4)",
      blk: "Fixes sit in conflict-hot workspace/patient-reports files", rem: "Audit remediation · body/MSK/abdomen MRI templates", dep: "—" },
    { n: "USG", code: "US", pct: 80, st: ["In Development", "st-dev"], mc: "--high", cov: [18, 37],
      cr: "Richest Copilot coverage (6 modules), USG measurement review (SR/GE/OCR), Form F / PCPNDT, Voluson.",
      caps: [2,0,2,2,2,2,2,1,2,1,2,2,2,2,2,2,1,2],
      issues: "No USG protocol specs · bolted-on isUltrasound/isObstetric branches · critical-alert table split",
      audit: "C1 (alert split) · M14 generalization",
      cur: "USG Platform Consolidation (PR B, #88/#92 merged) + PCPNDT backend", nxt: "USG completion + Voluson automation",
      blk: "PCPNDT backend in flight", rem: "Protocol specs · template/study breadth · consolidation onto generic path", dep: "PCPNDT backend" },
    { n: "CT", code: "CT", pct: 15, st: ["Planning", "st-plan"], mc: "--plan", cov: [2, 42],
      cr: "2 templates (CT Brain, HRCT Chest). Generic engine/infra work; no CT protocols or CT-specific Copilot.",
      caps: [1,0,1,1,2,1,0,0,2,1,2,2,2,2,2,2,2,2],
      issues: "No CT protocol schema · no CT Copilot module · thin template set", audit: "M14 modality generalization",
      cur: "—", nxt: "CT on the generalized catalog path",
      blk: "Modality generalization (M14) unwired; no CT protocol schema", rem: "Templates · protocols · CT Copilot · measurement library", dep: "Phase 4 generalization" },
    { n: "X-Ray", code: "XR", pct: 6, st: ["Planning", "st-plan"], mc: "--plan", cov: [0, 70],
      cr: "Recognized in modalityMap; generic infra available. No XR templates, protocols, or findings assets.",
      caps: [0,0,0,0,1,0,0,0,1,0,2,2,2,2,2,2,2,2],
      issues: "Zero XR clinical content", audit: "M14",
      cur: "—", nxt: "XR vocabulary + high-volume templates (chest/bone/abdomen)",
      blk: "No XR content; modality-expand flag unwired", rem: "Templates · findings · measurements · Copilot", dep: "Phase 4" },
    { n: "Mammography", code: "MG", pct: 8, st: ["Planning", "st-plan"], mc: "--plan", cov: [1, 12],
      cr: "A BI-RADS recommendation rule exists in the Copilot; no MG templates, structured BI-RADS fields, or modalityMap entry.",
      caps: [0,0,0,0,1,0,0,1,1,0,2,2,2,2,2,2,2,1],
      issues: "Not in modalityMap · no BI-RADS structured schema", audit: "M14 + structured BI-RADS fields",
      cur: "—", nxt: "BI-RADS structured fields + MG templates",
      blk: "No MG in modalityMap; BI-RADS schema absent", rem: "Templates · BI-RADS categories · density/lesion fields", dep: "Phase 4 + structured-fields" },
    { n: "OPG", code: "OPG", pct: 0, st: ["Not Started", "st-none"], mc: "--na", cov: [0, 8],
      cr: "Dental panoramic. No assets; not in modalityMap.",
      caps: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      issues: "Not started", audit: "—",
      cur: "—", nxt: "—", blk: "Not in modalityMap; no assets", rem: "Full modality build", dep: "Phase 4" },
    { n: "DEXA", code: "DEXA", pct: 0, st: ["Not Started", "st-none"], mc: "--na", cov: [0, 4],
      cr: "Bone densitometry (T/Z scores). No assets; not in modalityMap.",
      caps: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      issues: "Not started", audit: "—",
      cur: "—", nxt: "—", blk: "Needs T/Z-score structured fields + FRAX; not in map", rem: "Full modality build", dep: "Phase 4" },
    { n: "Fluoroscopy", code: "RF", pct: 0, st: ["Not Started", "st-none"], mc: "--na", cov: [0, 10],
      cr: "Barium/interventional fluoro. No assets; not in modalityMap.",
      caps: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      issues: "Not started", audit: "—",
      cur: "—", nxt: "—", blk: "Not in modalityMap; no assets", rem: "Full modality build", dep: "Phase 4" },
    { n: "PET-CT", code: "PT", pct: 5, st: ["Planning", "st-plan"], mc: "--plan", cov: [0, 6],
      cr: "Reserved by ff_radiology_modality_expand (“XA/IR/NM/PT vocabulary”, wired:false). No assets yet.",
      caps: ["p","p",0,0,0,0,"p",0,0,0,"p","p","p","p","p","p","p","p"],
      issues: "Flag-reserved, unwired", audit: "M13/M14",
      cur: "—", nxt: "Wire modality-expand vocab", blk: "ff_radiology_modality_expand wired:false", rem: "Full modality build + SUV/uptake fields", dep: "Phase 4 catalog" },
    { n: "Nuclear Med", code: "NM", pct: 5, st: ["Planning", "st-plan"], mc: "--plan", cov: [0, 8],
      cr: "Reserved by ff_radiology_modality_expand. No assets yet.",
      caps: ["p","p",0,0,0,0,"p",0,0,0,"p","p","p","p","p","p","p","p"],
      issues: "Flag-reserved, unwired", audit: "M13/M14",
      cur: "—", nxt: "Wire modality-expand vocab", blk: "ff_radiology_modality_expand wired:false", rem: "Full modality build", dep: "Phase 4 catalog" },
    { n: "Future (XA/IR)", code: "…", pct: 2, st: ["Planning", "st-plan"], mc: "--plan", cov: [0, 0],
      cr: "Angiography / interventional — vocabulary slot reserved in the modality-expand flag.",
      caps: ["p","p",0,0,0,0,"p",0,0,0,"p","p","p","p","p","p","p","p"],
      issues: "Reserved", audit: "—",
      cur: "—", nxt: "—", blk: "Reserved slot only", rem: "—", dep: "Phase 4" },
  ],

  // Issue tracker — seeded from the audit's Critical + High. Fill status/owner/PR/
  // commit/fixedIn as work lands. Full ~75 issues live in the master audit.
  // Row: [id, severity, issue, status, statusClass, prPhase, risk(h|m|l), evidence, notes]
  issues: [
    ["C1","crit","Critical-alert triplication — route shadowed, ack 404","Open","bg-open","Phase 0 / 3","h","routes/index.ts:537 · CriticalAlertsManager.tsx:45","Mount-order + missing ack = small; table converge = deferred"],
    ["C2","crit","Silent data loss — findingsMap absent from dirty/backup/rescue","Open","bg-open","Phase 0","m","workspaceReportState.ts:23 · Workspace:2451","Isolated logic; conflict-hot file — sequence around USG"],
    ["C3","crit","Unauthenticated PHI via public booking","Open","bg-open","Phase 1","m","public-booking.ts:290,1581","Pre-existing writeup; outside reporting core"],
    ["C4","crit","Stored XSS in report body → server PDF/print, CSP off","Open","bg-open","Phase 1","m","patient-reports.ts:1913 · reportPresentation.ts:365","Sanitize on write+render + CSP"],
    ["H1","high","Sign/verify forgery on default legacy path","Open","bg-open","Phase 1","m","patient-reports.ts:2045,2109","Default flag off → legacy path trusts client identity"],
    ["H2","high","TemplatesTab remount → search focus loss","Open","bg-open","Phase 2","l","Workspace:3681,5297","Extract to module-level component"],
    ["H3","high","Undebounced per-keystroke Copilot/quality (×2)","Open","bg-open","Phase 2","m","Workspace:1640 · copilotOrchestrator.ts:216","Debounce advisory analyses off typing path"],
    ["H4","high","“Ask Copilot (AI)” broken — promptText vs prompt","Open","bg-open","Phase 0","l","Workspace:1708 · aiReporting.ts:470","One-line param fix; conflict-hot file"],
    ["H6","high","transitioning deadlock on failed study load","Open","bg-open","Phase 2","l","Workspace:1930 · useReportingWorkflow.ts:129","Clear on entry-query error / timeout"],
    ["H9","high","Protocol/checklist/nudge state leaks across studies","Open","bg-open","Phase 2","l","Workspace:1876","Add resets to resetWorkspaceState"],
    ["H10","high","Four critical-keyword scanners, no shared source","Deferred","bg-defer","Phase 3","m","criticalResults.ts:33 · criticalFindingsAlert.ts:68","Consolidate to one shared dictionary"],
    ["H15","high","~9 template stores + StructuredTemplate ×3","Deferred","bg-defer","Phase 3","h","radiologyMasterTemplates.ts + 8 DB tables","Converge on DB catalog — planning only"],
    ["H16","high","4–5 render/PDF producers","Deferred","bg-defer","Phase 3","h","Workspace:354 · reportPresentation.ts:315","Wire render_v2 — planning only"],
    ["H12","high","Dead AI-copilot cluster (~68KB, 0 importers)","Planned","bg-plan","Phase 3","l","RadiologyAICopilotPanel.tsx +3 engines","Isolated delete; low risk — batch with sweep"],
    ["H18","high","Unauthenticated PHI files from /uploads","Open","bg-open","Phase 1","m","app.ts:282 · scans.ts:161","Authenticated download endpoint"],
  ],

  // Subsystems checked and found sound (do not "fix").
  verifiedSolid: [
    "Reporting lifecycle / finalize", "CARE Copilot (registry + composition)", "Command Palette",
    "Voice Commands (safety-classed)", "Previous Comparison", "Viewer / DICOM integration",
    "Study-lock (heartbeat/expiry)", "Reliability — free-text flow", "Structured D5/D9 sign & verify",
    "Server-side RBAC", "No SQLi (parameterized Drizzle)", "Local-Ollama AI — never executed",
    "Clean artifact boundaries", "Governed feature-flag registry", "Lazy routing + vendor chunking",
    "Wrong-patient defense",
  ],

  // Engineering cockpit control center. [title, cssVar, [[html, tag], ...]]
  controlCenter: [
    ["Current Branches", "--accent", [
      ["<code>feature/website-login-redirection</code>", "default"],
      ["<code>claude/radiology-clinical-history-chips-j04t4b</code>", "MRI 1–5 + docs"],
      ["<code>claude/usg-platform-consolidation-*</code>", "USG PR B · #88/#92 merged"],
      ["PCPNDT backend branch", "in flight"],
    ]],
    ["Open PRs", "--accent", [["None open right now", "—"], ["MRI series #84–90", "merged"], ["USG #88/#92 · print #85", "merged"]]],
    ["Audit Status", "--good", [["Master audit complete", "16 Jul 2026"], ["4 Critical · 19 High", "tracked"], ["18 Medium · 20 Low", "backlog"], ["Overall health <b>60/100</b>", ""]]],
    ["Recent Migrations", "--med", [["<code>zz_schema_reconcile_20260709</code>", "hand-SQL"], ["MRI protocol seeds", "7 specs"], ["Two migration systems", "drift risk (M18)"]]],
    ["Known Merge Risks", "--crit", [["<code>RadiologyReportingWorkspace.tsx</code>", "5.7k · hot"], ["<code>patient-reports.ts</code>", "2.9k · hot"], ["<code>schema/*</code> · <code>Settings.tsx</code>", "USG/PCPNDT overlap"]]],
    ["Future PR Queue", "--accent", [["<b>Phase 0</b> safety/data hotfixes", "C1a·C2·H4"], ["<b>Phase 1</b> security", "C3·C4·H1·H18"], ["<b>Phase 2</b> correctness/perf", "H2·H3·H6·H9"], ["<b>Phase 3</b> consolidation", "templates·render·voice·alerts"], ["<b>Phase 4</b> modality generalization", "catalog + Knowledge Packs"]]],
    ["Architecture Docs", "--high", [["<b>Missing:</b> COPILOT.md (H19)", "gap"], ["CARE_RADIOLOGY_BACKEND_V1_FREEZE", "exists"], ["structuredReport/README · PROTECTED_FILES", "exists"], ["~70 duplicate docs · no README (M15)", "cleanup"]]],
    ["Knowledge Packs", "--plan", [["Per-modality catalog seed bundles", "concept"], ["findings · protocols · critical terms · checklists", "the “add a modality” unit"], ["Loaded into the unified catalog", "Phase 4"]]],
    ["Technical Debt", "--crit", [["~250KB dead code", "H12·H13·M11·L15"], ["97MB .SynologyWorkingDirectory", "tracked (M16)"], ["~19 unread + 12 unwired flags", "M13"], ["Advisory-only FKs on core entities", "H7"]]],
  ],

  // Versioned snapshot history. Append a new row each time the cockpit is refreshed.
  auditHistory: [
    { version: "1.0.0", date: "2026-07-16", base: "8200e766",
      summary: "Initial master audit — 4 Critical / 19 High / 18 Medium / 20 Low. Overall engineering health 60/100. Six independent sweeps consolidated.",
      reviewer: "pending human sign-off" },
    // { version: "1.1.0", date: "YYYY-MM-DD", base: "<commit>", summary: "...", reviewer: "..." },
  ],
};
