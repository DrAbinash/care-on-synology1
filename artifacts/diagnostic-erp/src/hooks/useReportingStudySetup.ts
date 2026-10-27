/**
 * useReportingStudySetup — study-open protocol / technique / test-name setup
 * for the Radiology Reporting Workspace.
 *
 * Region resolution priority:
 *   manual override → billed procedure (testName) → modality+StudyDescription
 *   → ReportingStudyContext → pickQuickProtocol / templates / chocolate boxes
 *
 * Additive only: callers write into the Z.ai store via setters; nothing here
 * replaces FindingsEditor / CopilotRail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  filterRegionNamesForModality,
  nextStudyRegions,
  resolveAutoStudyRegion,
} from "@/lib/studyRegion";
import { pickQuickProtocol, pickQuickProtocolForBilledName, protocolsForStudyTabDetailed } from "@/lib/pickQuickProtocol";
import { findingsBodyForTemplate } from "@/lib/reportSubHeadings";
import {
  mayAddAutoTechniqueStatement,
  recordTechniqueAutoOrigin,
  shouldAutoReplaceTechniqueOnRegionChange,
  techniqueRegionMismatch,
  type TechniqueAutoOrigin,
} from "@/lib/techniqueStudyTabOrigin";
import type { FieldProvenanceMap } from "@/lib/reportFieldMerge";
import {
  pickStructuredTemplateForRegion,
  templateRegionMismatch,
} from "@/lib/pickStructuredTemplate";
import {
  buildReportingStudyContext,
  reportingContextEqual,
  type ReportingStudyContext,
} from "@/lib/reportingStudyContext";
import { combineStudyRegionTitle } from "@/lib/combineStudyRegions";
import { documentedCoverageCeiling, planRegionTransition, regionTransitionActor, type RegionTransitionPlan } from "@/lib/regionTransition";
import { resolvedChocolateBoxSet, type ChocolateBoxSet } from "@/lib/findingsMacros";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { InsertSource } from "@/lib/reportFieldMerge";
import { resolveChocolateOwnership } from "@/lib/chocolateMacroOwnership";
import type { ChocolateTile } from "@/lib/findingsMacros";
import type {
  QuickProtocol,
  QuickSelectData,
  QuickFinding,
} from "@/components/radiology/QuickFindingsPanel";
import type { AutoPopulatePlan, PopulateBlock } from "@/components/radiology/UsgCompanionPanel";
import {
  parseQuestions,
  generateStructuredFinding,
  initialValues as structuredInitialValues,
} from "@/lib/structuredFindings";
import { adaptSectionsJson, allNormalFindingsMap } from "@/lib/structuredFormat";

export type StructuredTemplate = {
  id: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  studyType: string | null;
  sectionsJson: string;
  defaultFindings: string | null;
  defaultImpression: string | null;
  macrosJson: string;
  isActive: boolean;
  formatVersion?: number;
  schemaVersion?: number;
  isDefault?: boolean;
};

type TemplateSections = {
  technique: string;
  findingsItems: Array<{ label: string; normal: string }>;
};

function parseSectionsJson(json: string): TemplateSections {
  try {
    return JSON.parse(json) as TemplateSections;
  } catch {
    return { technique: "", findingsItems: [] };
  }
}

export type StudySetupFields = {
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  clinicalHistory: string;
};

export type StudySetupSetters = {
  setTechnique: (next: string | ((prev: string) => string)) => void;
  setFindings: (next: string | ((prev: string) => string)) => void;
  setImpression: (next: string | ((prev: string) => string)) => void;
  setRecommendation: (next: string | ((prev: string) => string)) => void;
  setClinicalHistory: (next: string | ((prev: string) => string)) => void;
  mergeTechnique: (incoming: string, source: InsertSource) => void;
  mergeFindings: (incoming: string, source: InsertSource) => void;
  mergeImpression: (incoming: string, source: InsertSource) => void;
  mergeRecommendation: (incoming: string, source: InsertSource) => void;
  setTechniqueIfEmpty: (text: string, source: InsertSource) => void;
  setFindingsIfEmpty: (text: string, source: InsertSource) => void;
  setImpressionIfEmpty: (text: string, source: InsertSource) => void;
  setRecommendationIfEmpty: (text: string, source: InsertSource) => void;
  replaceTechnique: (text: string, source: InsertSource) => void;
  replaceFindings: (text: string, source: InsertSource) => void;
  replaceImpression: (text: string, source: InsertSource) => void;
  replaceRecommendation: (text: string, source: InsertSource) => void;
  /** Read live field values (zustand getState). */
  readFields: () => StudySetupFields;
  readTechniqueProvenance?: () => FieldProvenanceMap;
};

export type TechniqueRegionMismatch = {
  originStudyTabName: string;
  currentStudyTabName: string;
};

export type UseReportingStudySetupArgs = {
  studyId: number | null | undefined;
  modality: string | null | undefined;
  studyDescription: string | null | undefined;
  /**
   * Billed / catalog procedure name from the worklist (`testName` preferred,
   * else `billedTestName`). Primary auto-region hint when it matches a Study Tab.
   */
  billedTestName?: string | null;
  bodyPart?: string | null;
  isLoadingExistingDraft: boolean;
  /** True once draft content (or confirmed empty) has been written into the editor. */
  draftHydrated: boolean;
  existingDraft: unknown;
  disabled?: boolean;
  setters: StudySetupSetters;
  techniqueText?: string;
  techniqueProvenance?: FieldProvenanceMap;
  onToast?: (opts: { title: string; description?: string; variant?: "destructive" }) => void;
};

export function useReportingStudySetup(args: UseReportingStudySetupArgs) {
  const {
    studyId,
    modality,
    studyDescription,
    billedTestName,
    bodyPart: dicomBodyPart,
    isLoadingExistingDraft,
    draftHydrated,
    existingDraft,
    disabled,
    setters,
    techniqueText: techniqueTextArg = "",
    techniqueProvenance = {},
    onToast,
  } = args;

  const [techniqueOrigin, setTechniqueOrigin] = useState<TechniqueAutoOrigin | null>(null);

  const [regionOverrides, setRegionOverrides] = useState<string[] | null>(null);
  const [activeProtocol, setActiveProtocol] = useState<QuickProtocol | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [checklistPercent, setChecklistPercent] = useState(100);
  const [checklistRemaining, setChecklistRemaining] = useState<string[]>([]);
  const [companionLedger, setCompanionLedger] = useState<PopulateBlock[]>([]);
  const [structuredDialog, setStructuredDialog] = useState<{ finding: QuickFinding; editing: boolean } | null>(null);
  const [highlightFindings, setHighlightFindings] = useState(false);

  const autoProtocolForStudyRef = useRef<number | null>(null);
  const autoTemplateForStudyRef = useRef<number | null>(null);
  const lastRegionForTemplateRef = useRef<string | null>(null);
  const lastRegionForProtocolRef = useRef<string | null>(null);
  const templateApplySourceRef = useRef<"auto" | "manual">("auto");
  const lastInsertedTechniqueRef = useRef<string | null>(null);
  const structuredValuesRef = useRef<Map<number, Record<string, string>>>(new Map());
  const sessionMemoryRef = useRef<Record<string, string>>({});
  const hydratedTemplateApplyRef = useRef<number | null>(null);

  const billedProcedureName = useMemo(() => {
    const n = (billedTestName ?? "").trim();
    return n || null;
  }, [billedTestName]);

  /** Prefer billed procedure for hints (Findings library / legacy); DICOM second. */
  const studyHint = useMemo(() => {
    const mod = (modality ?? "").trim();
    const primary = billedProcedureName || (studyDescription ?? "").trim() || "";
    return `${mod} ${primary}`.trim();
  }, [modality, billedProcedureName, studyDescription]);

  const { data: quickSelectData } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  const { data: templatesData } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get("/api/radiology/structured-report-templates"),
    staleTime: 5 * 60_000,
  });
  const templates = templatesData ?? [];
  /** An empty template list is a real state, not "still loading" — the normal
   *  auto-bootstrap needs to tell them apart before it commits one decision. */
  const templatesLoaded = templatesData !== undefined;

  /** Server-backed Study Tabs for Section 1 (id + name). Authoritative catalog. */
  const availableStudyTabs = useMemo(() => {
    const active = (quickSelectData?.tabs ?? [])
      .filter((t) => t.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const allowedNames = new Set(filterRegionNamesForModality(active.map((t) => t.name), modality));
    return active
      .filter((t) => allowedNames.has(t.name))
      .map((t) => ({ id: t.id, name: t.name }));
  }, [quickSelectData, modality]);

  const availableRegions = useMemo(
    () => availableStudyTabs.map((t) => t.name),
    [availableStudyTabs],
  );

  const autoRegionMatch = useMemo(
    () =>
      resolveAutoStudyRegion({
        modality,
        studyDescription,
        billedTestName: billedProcedureName,
        orderedRegionNames: availableRegions,
      }),
    [modality, studyDescription, billedProcedureName, availableRegions],
  );

  const autoStudyRegion = autoRegionMatch.region;

  const studyRegions = useMemo(() => {
    if (regionOverrides && regionOverrides.length > 0) return regionOverrides;
    return autoStudyRegion ? [autoStudyRegion] : [];
  }, [regionOverrides, autoStudyRegion]);

  /** Primary region (first selected) — drives default template / protocol pick. */
  const matchedStudyRegion = studyRegions[0] ?? null;

  const studyContext: ReportingStudyContext = useMemo(
    () =>
      buildReportingStudyContext({
        modality,
        studyDescription,
        dicomBodyPart,
        regions: studyRegions,
        source: regionOverrides
          ? "override"
          : autoRegionMatch.source === "billed"
            ? "billed"
            : autoRegionMatch.source === "dicom"
              ? "dicom"
              : matchedStudyRegion
                ? "auto"
                : "unresolved",
        protocolName: activeProtocol?.name ?? null,
      }),
    [
      modality,
      studyDescription,
      dicomBodyPart,
      studyRegions,
      regionOverrides,
      matchedStudyRegion,
      activeProtocol?.name,
      autoRegionMatch.source,
    ],
  );

  /**
   * What this report is still allowed to document, as a ceiling on automatic selection.
   *
   * The Templates-screen row is matched by body part, and a Cervical row can declare it
   * also screens the dorsal and lumbosacral spine ("… with Whole Spine Screening"). A
   * report the radiologist has recorded as cervical-only must not be handed that row by
   * itself: the segments it retired would come back as normal statements, with no decision
   * behind them. An explicit region choice caps the report at what was chosen — selecting
   * "Cervical Spine" in the control is a declaration of the cervical spine, not of the
   * whole spine. This is the same ceiling the normal-format resolver applies (#970's
   * follow-up), computed from the same record, so the two ways CARE gives a report its
   * prose cannot disagree.
   */
  const regionTransitionRecords = useWorkspace((s) => s.regionTransitions);
  const coverageCeiling = useMemo(
    () => documentedCoverageCeiling({
      source: studyContext.source,
      regions: studyContext.regions.length ? studyContext.regions : [studyContext.region],
      records: regionTransitionRecords,
    }),
    [studyContext.source, studyContext.regions, studyContext.region, regionTransitionRecords],
  );

  /** Canonical Study Tab id for the primary selected region (Section 1). */
  const selectedStudyTabId = useMemo(() => {
    const name = matchedStudyRegion;
    if (!name) return null;
    return (quickSelectData?.tabs ?? []).find((t) => t.isActive && t.name === name)?.id ?? null;
  }, [quickSelectData, matchedStudyRegion]);

  /** Techniques/protocols for the selected Study Tab (ID + legacy name fallback). */
  const availableProtocols = useMemo(() => {
    const all = quickSelectData?.protocols ?? [];
    const { matched } = protocolsForStudyTabDetailed(all, selectedStudyTabId, matchedStudyRegion);
    return matched
      .filter((p) => p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [quickSelectData, matchedStudyRegion, selectedStudyTabId]);

  const techniqueMismatch = useMemo(
    () => techniqueRegionMismatch({
      techniqueText: techniqueTextArg,
      provenance: techniqueProvenance,
      origin: techniqueOrigin,
      currentStudyTabId: selectedStudyTabId,
      currentStudyTabName: matchedStudyRegion,
    }),
    [techniqueTextArg, techniqueProvenance, techniqueOrigin, selectedStudyTabId, matchedStudyRegion],
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const templateMismatch = useMemo(
    () => templateRegionMismatch(matchedStudyRegion, selectedTemplate?.bodyPart ?? null),
    [matchedStudyRegion, selectedTemplate?.bodyPart],
  );

  const chocolateBoxSet: ChocolateBoxSet = useMemo(
    () => resolvedChocolateBoxSet(studyContext),
    [studyContext],
  );

  const combinedTestName = useMemo(
    () => (studyRegions.length > 1 ? combineStudyRegionTitle(modality, studyRegions) : null),
    [modality, studyRegions],
  );

  const testName = combinedTestName
    ?? selectedTemplate?.templateName
    ?? studyDescription
    ?? activeProtocol?.name
    ?? null;

  /** Reset once-per-study guards when the study changes. */
  useEffect(() => {
    autoProtocolForStudyRef.current = null;
    autoTemplateForStudyRef.current = null;
    lastRegionForTemplateRef.current = null;
    lastRegionForProtocolRef.current = null;
    hydratedTemplateApplyRef.current = null;
    setRegionOverrides(null);
    setActiveProtocol(null);
    setSelectedTemplateId(null);
    setChecklistPercent(100);
    setChecklistRemaining([]);
    setCompanionLedger([]);
    setStructuredDialog(null);
    structuredValuesRef.current = new Map();
    // The dialog's "remembered for the next one" answers are THIS patient's
    // clinical statements. The workspace is not remounted between studies — the
    // route swaps `studyId` and reuses the instance — so carrying them into the
    // next patient opened patient B's renal-calculus box pre-answered with
    // patient A's side and size. Cleared with every other per-study guard.
    sessionMemoryRef.current = {};
    lastInsertedTechniqueRef.current = null;
    templateApplySourceRef.current = "auto";
    setTechniqueOrigin(null);
    setPendingRegionTransition(null);
  }, [studyId]);

  const noteTechniqueAutoApply = useCallback((
    protocol: QuickProtocol | null,
    appliedText: string,
    tabId: number | null,
    tabName: string,
  ) => {
    const origin = recordTechniqueAutoOrigin(protocol, tabId, tabName, appliedText);
    setTechniqueOrigin(origin);
  }, []);

  const applyProtocol = useCallback((
    protocol: QuickProtocol | null,
    replaceTechnique: boolean,
    tabContext?: { tabId: number | null; tabName: string },
    /** `technique: false` selects the protocol for this examination without writing its
     *  acquisition text — used by the automatic setup pass when the report already states one. */
    options?: { technique?: boolean },
  ) => {
    setActiveProtocol(protocol);
    if (!protocol || disabled) return;
    if (protocol.recommendationText) {
      setters.mergeRecommendation(protocol.recommendationText, "protocol");
    }
    if (options?.technique === false) return;
    if (protocol.techniqueText) {
      const fields = setters.readFields();
      const tabId = tabContext?.tabId ?? protocol.studyTabId ?? selectedStudyTabId;
      const tabName = tabContext?.tabName ?? protocol.studyType ?? matchedStudyRegion ?? "";
      if (replaceTechnique) {
        if (!fields.technique.trim() || fields.technique === lastInsertedTechniqueRef.current) {
          setters.replaceTechnique(protocol.techniqueText, "protocol");
          lastInsertedTechniqueRef.current = protocol.techniqueText;
          noteTechniqueAutoApply(protocol, protocol.techniqueText, tabId ?? null, tabName);
        } else {
          setters.mergeTechnique(protocol.techniqueText, "protocol");
        }
      } else {
        if (!fields.technique.trim()) {
          setters.replaceTechnique(protocol.techniqueText, "protocol");
          lastInsertedTechniqueRef.current = protocol.techniqueText;
          noteTechniqueAutoApply(protocol, protocol.techniqueText, tabId ?? null, tabName);
        } else {
          setters.mergeTechnique(protocol.techniqueText, "protocol");
        }
      }
    }
  }, [disabled, setters, selectedStudyTabId, matchedStudyRegion, noteTechniqueAutoApply]);

  const applyDefaultTechniqueForRegion = useCallback((
    regionName: string,
    tabId: number | null,
  ) => {
    // The billed / catalog row may name its own protocol for this tab (e.g.
    // "MRI LS Spine with Whole Spine Screening"); only when it names nothing
    // does the tab default load. Same fail-closed matcher as study-open.
    const protocol =
      pickQuickProtocolForBilledName(quickSelectData?.protocols ?? [], billedProcedureName, regionName, tabId)
      ?? pickQuickProtocol(quickSelectData?.protocols ?? [], regionName, tabId);
    if (protocol) {
      applyProtocol(protocol, true, { tabId, tabName: regionName });
      return;
    }
    setActiveProtocol(null);
    const tab = quickSelectData?.tabs?.find((t) => t.name === regionName);
    if (tab?.techniqueText) {
      setters.replaceTechnique(tab.techniqueText, "protocol");
      lastInsertedTechniqueRef.current = tab.techniqueText;
      noteTechniqueAutoApply(null, tab.techniqueText, tabId, regionName);
    }
  }, [quickSelectData, billedProcedureName, applyProtocol, setters, noteTechniqueAutoApply]);

  const syncTechniqueOnRegionChange = useCallback((
    regionName: string,
    tabId: number | null,
  ) => {
    const fields = setters.readFields();
    const provenance = setters.readTechniqueProvenance?.() ?? techniqueProvenance;
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], regionName, tabId);
    if (shouldAutoReplaceTechniqueOnRegionChange({
      techniqueText: fields.technique,
      provenance,
      origin: techniqueOrigin,
      nextStudyTabId: tabId,
    })) {
      applyDefaultTechniqueForRegion(regionName, tabId);
    } else {
      setActiveProtocol(protocol);
    }
  }, [
    setters, techniqueProvenance, techniqueOrigin, quickSelectData,
    applyDefaultTechniqueForRegion,
  ]);

  const loadCurrentRegionDefaultTechnique = useCallback(() => {
    if (!matchedStudyRegion) return;
    applyDefaultTechniqueForRegion(matchedStudyRegion, selectedStudyTabId);
  }, [matchedStudyRegion, selectedStudyTabId, applyDefaultTechniqueForRegion]);

  const requestProtocolChange = useCallback((protocol: QuickProtocol | null) => {
    if (!protocol) {
      setActiveProtocol(null);
      return;
    }
    // Manual protocol pick before any region is resolved — seed the region
    // so macros / templates / technique follow the chosen study type.
    if (studyRegions.length === 0 && protocol.studyType?.trim()) {
      setRegionOverrides([protocol.studyType.trim()]);
    }
    // Explicit Technique dropdown / Edit save: replace when empty or prior auto-insert.
    applyProtocol(protocol, true, {
      tabId: protocol.studyTabId ?? selectedStudyTabId,
      tabName: protocol.studyType,
    });
  }, [applyProtocol, studyRegions.length, selectedStudyTabId]);

  // Auto protocol once per study (after draft hydrate settles). The billed /
  // catalog row names its own protocol when it can (fail-closed matcher);
  // otherwise the region default loads — both only when Technique is empty, so
  // nothing a radiologist (or a hydrated draft) wrote is ever replaced.
  useEffect(() => {
    if (!studyId || !quickSelectData || isLoadingExistingDraft || !draftHydrated) return;
    if (autoProtocolForStudyRef.current === studyId) return;
    // Identity must resolve first. A deep-linked study whose queue row is
    // filtered out hydrates with no modality, description or billed name; both
    // protocol pickers answer null then, and burning the once-per-study token
    // on that empty pass left Technique permanently unseeded — the detail read
    // that arrives a moment later had no one-shot left to spend. Wait until
    // SOMETHING names this study, then decide.
    const hasIdentitySignal =
      Boolean(matchedStudyRegion)
      || Boolean(billedProcedureName)
      || Boolean((modality ?? "").trim())
      || Boolean((studyDescription ?? "").trim());
    if (!hasIdentitySignal) return;
    const fields = setters.readFields();
    if (fields.technique.trim()) {
      // Nothing to seed — the technique already exists (draft or hand-typed).
      // The token is spent here because the goal is achieved, not because a
      // picker ran.
      autoProtocolForStudyRef.current = studyId;
      return;
    }
    const protocol =
      pickQuickProtocolForBilledName(quickSelectData.protocols, billedProcedureName, matchedStudyRegion, selectedStudyTabId)
      ?? pickQuickProtocol(quickSelectData.protocols, matchedStudyRegion, selectedStudyTabId);
    // A signal alone is not a decision: with only a modality (region still
    // resolving, billed name absent) BOTH pickers answer null, and burning the
    // token on that pass left Technique permanently unseeded — the region that
    // arrived moments later had no one-shot left to spend. Keep the token until
    // a pass can actually pick, then spend it on the result.
    if (!protocol) return;
    autoProtocolForStudyRef.current = studyId;
    applyProtocol(protocol, true, { tabId: selectedStudyTabId, tabName: matchedStudyRegion ?? protocol.studyType });
  }, [
    studyId, quickSelectData, isLoadingExistingDraft, draftHydrated, existingDraft,
    matchedStudyRegion, selectedStudyTabId, billedProcedureName, modality, studyDescription, applyProtocol, setters,
  ]);

  // Region override: switch Technique dropdown; auto-replace only when empty or untouched auto text.
  useEffect(() => {
    if (!studyId || !quickSelectData || !draftHydrated) return;
    if (!matchedStudyRegion) return;
    if (lastRegionForProtocolRef.current === matchedStudyRegion) return;
    const isFirst = lastRegionForProtocolRef.current == null;
    lastRegionForProtocolRef.current = matchedStudyRegion;
    if (isFirst) return;
    const tabId = (quickSelectData.tabs ?? []).find((t) => t.isActive && t.name === matchedStudyRegion)?.id ?? null;
    syncTechniqueOnRegionChange(matchedStudyRegion, tabId);
  }, [studyId, quickSelectData, draftHydrated, matchedStudyRegion, syncTechniqueOnRegionChange]);

  // Keep the workspace store's reporting context in lockstep so snippet /
  // format / Quick Select tile lookups consume the same resolved identity.
  useEffect(() => {
    const prev = useWorkspace.getState().reportingContext;
    if (reportingContextEqual(prev, studyContext)) return;
    useWorkspace.getState().setReportingContext(studyContext);
  }, [studyContext]);

  // Auto structured template from the resolved region. Re-runs when the
  // radiologist overrides the region, but always with fill-empty-only apply
  // (templateApplySourceRef = "auto") so typed Findings/Impression are kept.
  useEffect(() => {
    if (!studyId || templates.length === 0 || !draftHydrated) return;
    if (!matchedStudyRegion) return;
    if (lastRegionForTemplateRef.current === matchedStudyRegion) return;
    lastRegionForTemplateRef.current = matchedStudyRegion;
    const match = pickStructuredTemplateForRegion(templates, modality, matchedStudyRegion, coverageCeiling);
    if (!match) return;
    autoTemplateForStudyRef.current = studyId;
    templateApplySourceRef.current = "auto";
    setSelectedTemplateId(match.id);
  }, [studyId, templates, modality, matchedStudyRegion, coverageCeiling, draftHydrated]);

  // Apply template content fill-empty-only on auto; full replace on manual.
  useEffect(() => {
    if (!selectedTemplate || disabled) return;
    if (hydratedTemplateApplyRef.current === selectedTemplate.id
      && templateApplySourceRef.current === "auto") {
      return;
    }
    hydratedTemplateApplyRef.current = selectedTemplate.id;
    const sections = parseSectionsJson(selectedTemplate.sectionsJson);
    const fields = setters.readFields();

    if (templateApplySourceRef.current === "manual") {
      setters.replaceTechnique(sections.technique || fields.technique, "template");
      setters.replaceFindings(findingsBodyForTemplate(selectedTemplate), "template");
      setters.replaceImpression(selectedTemplate.defaultImpression || "", "template");
      // The recommendation is deliberately untouched. `TemplateSections` carries
      // technique and findingsItems only, so the sentence this branch used to
      // insert was never the template's own wording — it was a hardcoded literal
      // that went on to be signed as the radiologist's recommendation. What is
      // already in the field stays exactly as authored; an empty field stays
      // empty and the renderer omits the section.
      return;
    }

    // Auto: fill-empty only — never clobber draft / typed text.
    if (!fields.technique.trim() && sections.technique) {
      setters.setTechniqueIfEmpty(sections.technique, "template");
      lastInsertedTechniqueRef.current = sections.technique;
    }
    if (!fields.findings.trim()) {
      // Sections, not just the authored paragraph: a format that declares its
      // anatomy but carries no structured text still produces a sub-headed
      // report, so adding a section in the Templates screen is enough.
      const body = findingsBodyForTemplate(selectedTemplate);
      if (body) setters.setFindingsIfEmpty(body, "template");
    }
    if (!fields.impression.trim() && selectedTemplate.defaultImpression) {
      setters.setImpressionIfEmpty(selectedTemplate.defaultImpression, "template");
    }
    // No auto-filled recommendation, for the same reason the manual branch above
    // leaves it alone: the template declares none, so the only thing this could
    // write is a sentence the radiologist never entered.
  }, [selectedTemplate, disabled, setters]);

  const handleCompanionAutoPopulate = useCallback((plan: AutoPopulatePlan) => {
    if (disabled) return;
    let applied = 0;
    for (const b of plan.blocks) {
      if (b.section === "technique") {
        setters.setTechniqueIfEmpty(b.text, "companion");
      } else if (b.section === "findings") {
        setters.mergeFindings(b.text, "companion");
      } else if (b.section === "recommendation") {
        setters.mergeRecommendation(b.text, "companion");
      } else if (b.section === "impression") {
        setters.setImpressionIfEmpty(b.text, "companion");
      }
      applied++;
    }
    setCompanionLedger(plan.blocks);
    if (applied > 0) {
      onToast?.({
        title: "Report auto-populated",
        description: `${applied} section(s) filled from machine data — review before finalizing.`,
      });
    }
  }, [disabled, setters, onToast]);

  const handleChecklistChange = useCallback((percent: number, remaining: string[]) => {
    setChecklistPercent(percent);
    setChecklistRemaining(remaining);
  }, []);

  const findingQuestions = useCallback((f: QuickFinding) => parseQuestions(f.questionsJson), []);

  const handleFindingClick = useCallback((
    f: QuickFinding,
    selectedIds: Set<number>,
    onToggle: (finding: QuickFinding, nowSelected: boolean) => void,
  ) => {
    if (disabled) return;
    if (findingQuestions(f).length === 0) {
      onToggle(f, !selectedIds.has(f.id));
      return;
    }
    setStructuredDialog({ finding: f, editing: selectedIds.has(f.id) });
  }, [disabled, findingQuestions]);

  const structuredDialogInitial = useCallback((dlg: { finding: QuickFinding; editing: boolean }) => {
    const questions = findingQuestions(dlg.finding);
    const existing = structuredValuesRef.current.get(dlg.finding.id);
    const memory = dlg.editing && existing ? existing : sessionMemoryRef.current;
    return structuredInitialValues(questions, memory);
  }, [findingQuestions]);

  const applyStructuredDialog = useCallback((
    values: Record<string, string>,
    selectedIds: Set<number>,
    onToggle: (finding: QuickFinding, nowSelected: boolean) => void,
  ) => {
    const dlg = structuredDialog;
    if (!dlg) return;
    const f = dlg.finding;
    sessionMemoryRef.current = { ...sessionMemoryRef.current, ...values };
    structuredValuesRef.current.set(f.id, values);
    setStructuredDialog(null);

    const generated = generateStructuredFinding(f, values);
    const patched: QuickFinding = {
      ...f,
      findingText: generated.finding ?? "",
      impressionText: generated.impression ?? "",
      techniqueText: generated.technique ?? "",
      recommendationText: generated.recommendation ?? "",
    };
    if (selectedIds.has(f.id)) onToggle(f, false);
    onToggle(patched, true);
  }, [structuredDialog, setters]);

  const removeStructuredFinding = useCallback((
    f: QuickFinding,
    selectedIds: Set<number>,
    onToggle: (finding: QuickFinding, nowSelected: boolean) => void,
  ) => {
    setStructuredDialog(null);
    if (selectedIds.has(f.id)) onToggle(f, false);
    else structuredValuesRef.current.delete(f.id);
  }, []);

  const applyChocolateTile = useCallback((tile: ChocolateTile | { id?: string; label?: string; text: string }) => {
    if (disabled || !tile.text.trim()) return;
    const full = tile as ChocolateTile;
    if (full.observations && full.observations.length > 0) {
      const region = useWorkspace.getState().reportingContext.region ?? "";
      const bundleId = `choco-${full.id ?? "bundle"}-${Date.now().toString(36)}`;
      useWorkspace.getState().applyMacroBundle({
        bundleId,
        observations: full.observations.map((obs, i) => ({
          incoming: {
            findings: obs.findingsText,
            impression: obs.impressionText,
            recommendation: obs.recommendationText,
          },
          templates: {
            findings: obs.findingsText,
            impression: obs.impressionText,
            recommendation: obs.recommendationText,
          },
          ownership: {
            anatomicalSection: obs.anatomicalSection,
            conflictGroup: obs.conflictGroup,
            baselineReplaces: obs.baselineReplaces,
            concept: obs.concept,
          },
          source: "macro" as const,
          id: `${bundleId}-${obs.concept ?? i}`,
          region,
          concept: obs.concept,
          level: obs.level,
          laterality: obs.laterality,
          label: full.label,
          findingsText: obs.findingsText,
          supportsLaterality: obs.supportsLaterality,
          sectionsOwned: obs.sectionsOwned,
          bundleId,
        })),
      });
      return;
    }
    const resolved = resolveChocolateOwnership({
      id: full.id ?? "legacy",
      label: full.label,
      concept: full.concept,
      anatomicalSection: full.anatomicalSection,
      conflictGroup: full.conflictGroup,
      baselineReplaces: full.baselineReplaces,
      supportsLaterality: full.supportsLaterality,
      sectionsOwned: full.sectionsOwned,
      legacyAppend: full.legacyAppend,
    });
    if (resolved.mode === "legacy-append") {
      setters.mergeFindings(tile.text, "macro");
      return;
    }
    const ownership = resolved.ownership;
    const sections = ownership.sectionsOwned ?? ["findings"];
    const incoming: Record<string, string | undefined> = {};
    if (sections.includes("findings")) incoming.findings = tile.text;
    if (sections.includes("impression") && full.impressionText) incoming.impression = full.impressionText;
    useWorkspace.getState().applyPathologyOverlay({
      incoming,
      templates: incoming,
      ownership: {
        concept: ownership.concept,
        anatomicalSection: ownership.anatomicalSection,
        conflictGroup: ownership.conflictGroup,
        baselineReplaces: ownership.baselineReplaces,
      },
      source: "macro",
      side: ownership.supportsLaterality ? undefined : "",
      id: full.id ? `choco-${full.id}` : undefined,
      region: useWorkspace.getState().reportingContext.region ?? "",
      concept: ownership.concept,
      label: full.label,
      findingsText: tile.text,
      supportsLaterality: ownership.supportsLaterality,
    });
  }, [disabled, setters]);

  const selectTemplateManual = useCallback((id: number) => {
    templateApplySourceRef.current = "manual";
    setSelectedTemplateId(id);
  }, []);

  /** Pick the structured template that matches the current study region (LS Spine ≠ Brain). */
  const loadCorrectTemplate = useCallback(() => {
    if (disabled || !matchedStudyRegion) return null;
    const match = pickStructuredTemplateForRegion(
      templates,
      modality,
      matchedStudyRegion,
      coverageCeiling,
    );
    if (match) {
      selectTemplateManual(match.id);
      onToast?.({
        title: "Template loaded",
        description: match.templateName,
      });
      return match;
    }
    // A button that silently does nothing is read as a broken button. Saying only that the
    // report documents less than the template is also saying what to do about it, because a
    // template the radiologist picks from the list themselves is a decision, not an
    // automatic claim about anatomy.
    if (coverageCeiling) {
      onToast?.({
        title: "No template applied",
        description: `This report documents ${matchedStudyRegion}. A template that also documents more than that is not applied by itself — pick it in the Templates list if the wider examination was actually performed.`,
      });
    }
    return null;
  }, [disabled, matchedStudyRegion, templates, modality, coverageCeiling, selectTemplateManual, onToast]);

  /** Reload default protocol + template for current region(s). */
  const reapplyDefaults = useCallback((opts?: { confirm?: boolean }) => {
    if (disabled || studyRegions.length === 0) return;
    const multi = studyRegions.length > 1;
    if (opts?.confirm !== false) {
      const ok = window.confirm(
        multi
          ? `Reload defaults for ${studyRegions.join(" + ")}? Technique texts will be merged; findings follow the primary region template.`
          : "Reload the default protocol and structured template for this study region? Technique may be replaced.",
      );
      if (!ok) return;
    }
    studyRegions.forEach((region, i) => {
      const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region, selectedStudyTabId);
      if (protocol) applyProtocol(protocol, i === 0);
      else if (i === 0) setActiveProtocol(null);
    });
    const primary = studyRegions[0] ?? matchedStudyRegion;
    const match = pickStructuredTemplateForRegion(templates, modality, primary, coverageCeiling);
    if (match) selectTemplateManual(match.id);
    onToast?.({
      title: "Study setup applied",
      description: `${quickSelectData ? (pickQuickProtocol(quickSelectData.protocols, primary, selectedStudyTabId)?.name ?? "Protocol") : "Protocol"} · ${match?.templateName ?? "template"}`,
    });
  }, [
    disabled, studyRegions, matchedStudyRegion, quickSelectData, applyProtocol,
    templates, modality, coverageCeiling, selectTemplateManual, onToast,
  ]);

  /**
   * One-click Start Report — the SETUP half, and only the setup half.
   *
   * Which protocol and which structured template belong to this study is a fact
   * about the examination, so applying it can never erase what the radiologist
   * has already typed. The report prose is built by
   * `useWorkspace.generateProfessionalReport`, which merges the approved normal
   * format against the existing text and replays the observation ledger. This
   * function writes no findings, no impression and no recommendation: the
   * bootstrap it replaces called `setFindings`/`setImpression`/`setRecommendation`
   * with template content, which deleted pre-selected Quick Select findings and
   * dictated text, and filled "Please correlate with clinical findings." into
   * every report whether or not anyone meant it.
   */
  const startReportSetup = useCallback(() => {
    if (disabled || studyRegions.length === 0) return null;
    studyRegions.forEach((region, i) => {
      const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region, selectedStudyTabId);
      // Which protocol and Study Tab belong to this examination is setup information, and it is
      // recorded either way. Writing their Technique is not: this runs on every Generate press,
      // and by then the approved template's Technique is already on the page, so a second machine
      // sentence was a second account of one scan — measured on MRI Dorsal Spine, where it printed
      // an STIR claim no dorsal template establishes. One region, one statement; a multi-region
      // examination composes one per part, which is what its report has to say.
      const allowTechnique = mayAddAutoTechniqueStatement({
        techniqueText: setters.readFields().technique,
        regionCount: studyRegions.length,
      });
      // replaceTechnique only for the primary region, and applyProtocol itself
      // only replaces while the field is empty or still exactly what it last
      // auto-inserted — anything the radiologist touched is merged into.
      if (protocol) applyProtocol(protocol, i === 0, undefined, { technique: allowTechnique });
      const tab = quickSelectData?.tabs?.find((t) => t.name === region);
      if (tab?.techniqueText && allowTechnique) setters.mergeTechnique(tab.techniqueText, "protocol");
    });
    const match = pickStructuredTemplateForRegion(
      templates,
      modality,
      studyRegions[0] ?? matchedStudyRegion,
      coverageCeiling,
    );
    if (!match) return { templateId: null };
    // Selecting a template the way the Templates dropdown does —
    // `selectTemplateManual` — is a CONTENT apply: the effect behind it replaces
    // technique, findings and impression with the template's own copy. Start
    // Report is allowed to say which template belongs to this examination. It is
    // not allowed to overwrite prose with it, which is the exact thing this
    // function used to do by hand.
    // "auto" is the fill-empty-only source, and by the time the effect runs the
    // generator has already written every field, so it settles into a no-op.
    templateApplySourceRef.current = "auto";
    setSelectedTemplateId(match.id);
    return { templateId: match.id };
  }, [
    disabled, studyRegions, setters, quickSelectData, applyProtocol,
    selectedStudyTabId, templates, modality, coverageCeiling, matchedStudyRegion,
  ]);

  /** Parse findings section cards from the selected structured template. */
  const templateFindingsSections = useMemo(() => {
    if (!selectedTemplate) return [] as Array<{ label: string; normal: string }>;
    try {
      const map = allNormalFindingsMap(adaptSectionsJson(selectedTemplate.sectionsJson));
      return Object.entries(map).map(([label, v]) => ({ label, normal: v.text }));
    } catch {
      return parseSectionsJson(selectedTemplate.sectionsJson).findingsItems;
    }
  }, [selectedTemplate]);

  /**
   * ADR-004 — a region change that would invalidate report content stops here until the
   * radiologist confirms it. The plan is computed from the LIVE ledger at the moment of the
   * click and carried unchanged to the confirm; nothing is written to the report or to the
   * region in between, and cancelling writes nothing at all.
   */
  const [pendingRegionTransition, setPendingRegionTransition] = useState<{
    studyId: number | null | undefined;
    plan: RegionTransitionPlan;
    /** What the region list becomes on confirm; null restores the auto-detected region. */
    nextRegions: string[] | null;
    /**
     * Which control the click came from. Confirming has to finish that control's own work
     * and only that: the manual dropdown replays protocol/technique for the new region,
     * while the chip toggle and "reset to auto" write the region and stop.
     */
    source: "toggle" | "primary" | "reset";
  } | null>(null);

  // Update during render: a retained confirmation can fire before the study-reset
  // effect, or after the current study has become locked. Its closure is not authority.
  const regionTransitionScopeRef = useRef({ studyId, disabled, pendingRegionTransition });
  regionTransitionScopeRef.current = { studyId, disabled, pendingRegionTransition };

  /**
   * What this transition would invalidate, or null when there is nothing to talk about. An
   * empty ledger returns null deliberately: a dialog that asks permission to change a report
   * which does not exist yet trains the radiologist to click through confirmations, which is
   * the failure mode ADR-004 §Consequences names.
   */
  const transitionPlanFor = useCallback((toRegions: readonly string[]) => {
    if (toRegions.length === 0) return null;
    const state = useWorkspace.getState();
    // A `protected` row is left out on purpose: protection is the product's own refusal to
    // withdraw a sentence, so announcing one as removable would promise the radiologist a
    // deletion the store then declines to make. Measured on the whole-spine screening
    // normal: its limitation row comes out of the format apply already protected, and the
    // plan the hook builds retires eleven rows, not twelve. What the strip names is
    // exactly what leaves.
    const rows = state.appliedPathologyPatches
      .filter((p) => !p.stale && !p.protected)
      .map((p) => ({
        id: p.id,
        role: p.observation?.role ?? null,
        concept: p.observation?.concept ?? null,
        region: p.observation?.region ?? null,
        level: p.observation?.level ?? null,
        // Whichever field the row actually writes: normals go to Findings, the normal-study
        // conclusion to Impression. Both are report content that is at stake.
        text: (p.lastRendered.findings ?? "").trim() || (p.lastRendered.impression ?? "").trim(),
      }))
      .filter((r) => r.text.length > 0);
    if (rows.length === 0) return null;
    return planRegionTransition({ fromRegions: studyRegions, toRegions, rows, findingsText: state.findingsText });
  }, [studyRegions]);

  const confirmRegionTransition = useCallback(() => {
    const pending = pendingRegionTransition;
    const current = regionTransitionScopeRef.current;
    const state = useWorkspace.getState();
    if (!pending
      || pending !== current.pendingRegionTransition
      || pending.studyId == null
      || pending.studyId !== current.studyId
      || state.activeStudyId !== String(pending.studyId)
      || current.disabled
      || state.isFinalized) return;
    setRegionOverrides(pending.nextRegions);
    // Retirement runs after the region is written, through the store's own withdrawal path:
    // one undo frame, a manual sentence refused by `removeObservation` rather than deleted,
    // any baseline a retired row had been covering restored, and the decision recorded with
    // every sentence that left the report.
    useWorkspace.getState().commitRegionTransition(pending.plan, regionTransitionActor());
    if (pending.source === "primary" && pending.nextRegions) {
      const only = pending.nextRegions[0] ?? null;
      const tabId = (quickSelectData?.tabs ?? []).find((t) => t.isActive && t.name === only)?.id ?? null;
      syncTechniqueOnRegionChange(only, tabId);
    }
    setPendingRegionTransition(null);
  }, [pendingRegionTransition, quickSelectData, syncTechniqueOnRegionChange]);

  const cancelRegionTransition = useCallback(() => {
    // Nothing was written on the way here, so nothing has to be undone: the region and the
    // report stay exactly as the radiologist left them.
    setPendingRegionTransition(null);
  }, []);

  /** Toggle a study region (multi-select). Last-clicked region becomes
   *  primary so macros / Quick Select follow what the radiologist just clicked. */
  const handleRegionToggle = useCallback((regionName: string) => {
    if (disabled) return;
    const next = nextStudyRegions(studyRegions, regionName);
    if (!next) return;
    const added = !studyRegions.includes(regionName);
    // Adding a region only widens what the examination covers, so it can invalidate no
    // sentence already on the page; the policy answers that with an empty plan and the
    // click stays silent. Re-ordering (clicking a non-primary chip) leaves the coverage
    // unchanged for the same reason. Only a narrowing reaches `requiresConfirmation`.
    const plan = transitionPlanFor(next);
    if (plan?.requiresConfirmation) {
      setPendingRegionTransition({ studyId, plan, nextRegions: next, source: "toggle" });
      return;
    }
    setRegionOverrides(next);
    if (!added) return;
    const tabId = (quickSelectData?.tabs ?? []).find((t) => t.isActive && t.name === regionName)?.id ?? null;
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], regionName, tabId);
    const fields = setters.readFields();
    // Multi-region add may accumulate technique via merge when field already has text.
    if (protocol) applyProtocol(protocol, !fields.technique.trim());
    const tab = quickSelectData?.tabs?.find((t) => t.name === regionName);
    if (tab?.techniqueText && !fields.technique.trim()) {
      setters.mergeTechnique(tab.techniqueText, "protocol");
    }
  }, [studyId, disabled, studyRegions, quickSelectData, applyProtocol, setters, transitionPlanFor]);

  const resetRegionOverrides = useCallback(() => {
    // The link is only offered after a manual selection, so this click replaces whatever the
    // radiologist chose with what the billing/DICOM resolved — a narrowing like any other, and
    // the third of the three writers of `regionOverrides` that had to stop writing silently.
    const plan = transitionPlanFor(autoStudyRegion ? [autoStudyRegion] : []);
    if (plan?.requiresConfirmation) {
      setPendingRegionTransition({ studyId, plan, nextRegions: null, source: "reset" });
      return;
    }
    setRegionOverrides(null);
  }, [studyId, transitionPlanFor, autoStudyRegion]);

  /** Replace the region list with a single primary region (manual dropdown). */
  const selectPrimaryRegion = useCallback((regionName: string | null) => {
    if (disabled) return;
    if (!regionName) {
      // Clearing the selection falls back to whatever billing/DICOM resolved, which can be
      // narrower than what is on the page — the same event the "reset to auto" link is, so
      // it is gated the same way. Choosing the placeholder must not quietly cost a report its
      // sentences.
      const clearedPlan = transitionPlanFor(autoStudyRegion ? [autoStudyRegion] : []);
      if (clearedPlan?.requiresConfirmation) {
        setPendingRegionTransition({ studyId, plan: clearedPlan, nextRegions: null, source: "primary" });
        return;
      }
      setRegionOverrides(null);
      return;
    }
    // ADR-004: the dropdown REPLACES the region, so the report may now contain normals for
    // anatomy the chosen examination does not acquire. Ask before writing anything.
    const plan = transitionPlanFor([regionName]);
    if (plan?.requiresConfirmation) {
      setPendingRegionTransition({ studyId, plan, nextRegions: [regionName], source: "primary" });
      return;
    }
    setRegionOverrides([regionName]);
    const tabId = (quickSelectData?.tabs ?? []).find((t) => t.isActive && t.name === regionName)?.id ?? null;
    syncTechniqueOnRegionChange(regionName, tabId);
  }, [studyId, disabled, quickSelectData, syncTechniqueOnRegionChange, matchedStudyRegion, transitionPlanFor, autoStudyRegion]);

  return {
    // Identity-shaped context, exposed so canvas-level controls (format list,
    // abnormal strip, modality gates) don't have to re-read the queue row —
    // which is null for any study outside the reading-queue filter.
    modality,
    studyDescription,
    studyHint,
    studyContext,
    autoStudyRegion,
    autoRegionMatch,
    matchedStudyRegion,
    studyRegions,
    regionOverrides,
    handleRegionToggle,
    resetRegionOverrides,
    selectPrimaryRegion,
    pendingRegionTransition,
    confirmRegionTransition,
    cancelRegionTransition,
    availableRegions,
    availableStudyTabs,
    availableProtocols,
    selectedStudyTabId,
    activeProtocol,
    setActiveProtocol,
    applyProtocol,
    requestProtocolChange,
    techniqueMismatch,
    loadCurrentRegionDefaultTechnique,
    selectedTemplateId,
    selectedTemplate,
    selectTemplateManual,
    templateMismatch,
    loadCorrectTemplate,
    reapplyDefaults,
    startReportSetup,
    templateFindingsSections,
    testName,
    checklistPercent,
    checklistRemaining,
    handleChecklistChange,
    companionLedger,
    handleCompanionAutoPopulate,
    chocolateBoxSet,
    applyChocolateTile,
    highlightFindings,
    setHighlightFindings,
    structuredDialog,
    setStructuredDialog,
    structuredDialogInitial,
    handleFindingClick,
    applyStructuredDialog,
    removeStructuredFinding,
    quickSelectData,
    templates,
    templatesLoaded,
  };
}
