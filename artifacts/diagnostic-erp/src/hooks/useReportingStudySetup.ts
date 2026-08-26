/**
 * useReportingStudySetup — DICOM-driven protocol / technique / test-name
 * auto-select for the new Radiology Reporting Workspace.
 *
 * Ports the legacy chain:
 *   modality+studyDescription → matchStudyRegion → ReportingStudyContext
 *   → pickQuickProtocol / pickStructuredTemplateForRegion / resolvedChocolateBoxSet
 *
 * Additive only: callers write into the Z.ai store via setters; nothing here
 * replaces FindingsEditor / CopilotRail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { matchStudyRegion, filterRegionNamesForModality, nextStudyRegions } from "@/lib/studyRegion";
import { pickQuickProtocol } from "@/lib/pickQuickProtocol";
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
import { resolvedChocolateBoxSet, type ChocolateBoxSet } from "@/lib/findingsMacros";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { mergeBlock } from "@/lib/quickFindingsMerge";
import { mergeTechnique } from "@/lib/reportFieldMerge";
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
};

export type UseReportingStudySetupArgs = {
  studyId: number | null | undefined;
  modality: string | null | undefined;
  studyDescription: string | null | undefined;
  bodyPart?: string | null;
  isLoadingExistingDraft: boolean;
  /** True once draft content (or confirmed empty) has been written into the editor. */
  draftHydrated: boolean;
  existingDraft: unknown;
  disabled?: boolean;
  setters: StudySetupSetters;
  onToast?: (opts: { title: string; description?: string; variant?: "destructive" }) => void;
};

export function useReportingStudySetup(args: UseReportingStudySetupArgs) {
  const {
    studyId,
    modality,
    studyDescription,
    bodyPart: dicomBodyPart,
    isLoadingExistingDraft,
    draftHydrated,
    existingDraft,
    disabled,
    setters,
    onToast,
  } = args;

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

  const studyHint = useMemo(
    () => `${modality ?? ""} ${studyDescription ?? ""}`.trim(),
    [modality, studyDescription],
  );

  const { data: quickSelectData } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  const { data: templates = [] } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get("/api/radiology/structured-report-templates"),
    staleTime: 5 * 60_000,
  });

  const availableRegions = useMemo(() => {
    const all = (quickSelectData?.tabs ?? [])
      .filter((t) => t.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((t) => t.name);
    return filterRegionNamesForModality(all, modality);
  }, [quickSelectData, modality]);

  const autoStudyRegion = useMemo(
    () => matchStudyRegion(studyHint, availableRegions),
    [studyHint, availableRegions],
  );

  const studyRegions = useMemo(() => {
    if (regionOverrides && regionOverrides.length > 0) return regionOverrides;
    return autoStudyRegion ? [autoStudyRegion] : [];
  }, [regionOverrides, autoStudyRegion]);

  /** Primary region (first selected) — drives default template / protocol pick. */
  const matchedStudyRegion = studyRegions[0] ?? null;

    const studyContext: ReportingStudyContext = useMemo(
    () => buildReportingStudyContext({
      modality,
      studyDescription,
      dicomBodyPart,
      regions: studyRegions,
      source: regionOverrides ? "override" : (matchedStudyRegion ? "auto" : "unresolved"),
      protocolName: activeProtocol?.name ?? null,
    }),
    [modality, studyDescription, dicomBodyPart, studyRegions, regionOverrides, matchedStudyRegion, activeProtocol?.name],
  );

  /** Protocols for the selected region(s). When no region is chosen yet, show
   *  every active protocol so the radiologist can pick manually (selecting a
   *  protocol then seeds the region from protocol.studyType). */
  const availableProtocols = useMemo(() => {
    const all = (quickSelectData?.protocols ?? [])
      .filter((p) => p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    if (studyRegions.length === 0) return all;
    return all.filter((p) => studyRegions.includes(p.studyType));
  }, [quickSelectData, studyRegions]);

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
    lastInsertedTechniqueRef.current = null;
    templateApplySourceRef.current = "auto";
  }, [studyId]);

  const applyProtocol = useCallback((protocol: QuickProtocol | null, replaceTechnique: boolean) => {
    setActiveProtocol(protocol);
    if (!protocol || disabled) return;
    if (protocol.recommendationText) {
      setters.mergeRecommendation(protocol.recommendationText, "protocol");
    }
    if (protocol.techniqueText) {
      const fields = setters.readFields();
      if (replaceTechnique) {
        if (!fields.technique.trim() || fields.technique === lastInsertedTechniqueRef.current) {
          setters.replaceTechnique(protocol.techniqueText, "protocol");
          lastInsertedTechniqueRef.current = protocol.techniqueText;
        } else {
          setters.mergeTechnique(protocol.techniqueText, "protocol");
        }
      } else {
        if (!fields.technique.trim()) {
          setters.replaceTechnique(protocol.techniqueText, "protocol");
          lastInsertedTechniqueRef.current = protocol.techniqueText;
        } else {
          setters.mergeTechnique(protocol.techniqueText, "protocol");
        }
      }
    }
  }, [disabled, setters]);

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
    applyProtocol(protocol, false);
  }, [applyProtocol, studyRegions.length]);

  // Auto protocol once per study (after draft hydrate settles).
  useEffect(() => {
    if (!studyId || !quickSelectData || isLoadingExistingDraft || !draftHydrated) return;
    if (autoProtocolForStudyRef.current === studyId) return;
    autoProtocolForStudyRef.current = studyId;
    const fields = setters.readFields();
    if (fields.technique.trim()) return;
    const protocol = pickQuickProtocol(quickSelectData.protocols, matchedStudyRegion);
    if (protocol) applyProtocol(protocol, true);
  }, [
    studyId, quickSelectData, isLoadingExistingDraft, draftHydrated, existingDraft,
    matchedStudyRegion, applyProtocol, setters,
  ]);

  // Region override: switch the protocol selector without replacing typed technique.
  useEffect(() => {
    if (!studyId || !quickSelectData || !draftHydrated) return;
    if (!matchedStudyRegion) return;
    if (lastRegionForProtocolRef.current === matchedStudyRegion) return;
    const isFirst = lastRegionForProtocolRef.current == null;
    lastRegionForProtocolRef.current = matchedStudyRegion;
    if (isFirst) return;
    const protocol = pickQuickProtocol(quickSelectData.protocols, matchedStudyRegion);
    if (protocol) applyProtocol(protocol, false);
    else setActiveProtocol(null);
  }, [studyId, quickSelectData, draftHydrated, matchedStudyRegion, applyProtocol]);

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
    const match = pickStructuredTemplateForRegion(templates, modality, matchedStudyRegion);
    if (!match) return;
    autoTemplateForStudyRef.current = studyId;
    templateApplySourceRef.current = "auto";
    setSelectedTemplateId(match.id);
  }, [studyId, templates, modality, matchedStudyRegion, draftHydrated]);

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
      setters.replaceFindings(selectedTemplate.defaultFindings || "", "template");
      setters.replaceImpression(selectedTemplate.defaultImpression || "", "template");
      if (fields.recommendation.trim()) {
        setters.setRecommendation(fields.recommendation);
      } else {
        setters.replaceRecommendation("Please correlate with clinical findings.", "template");
      }
      return;
    }

    // Auto: fill-empty only — never clobber draft / typed text.
    if (!fields.technique.trim() && sections.technique) {
      setters.setTechniqueIfEmpty(sections.technique, "template");
      lastInsertedTechniqueRef.current = sections.technique;
    }
    if (!fields.findings.trim() && selectedTemplate.defaultFindings) {
      setters.setFindingsIfEmpty(selectedTemplate.defaultFindings, "template");
    }
    if (!fields.impression.trim() && selectedTemplate.defaultImpression) {
      setters.setImpressionIfEmpty(selectedTemplate.defaultImpression, "template");
    }
    if (!fields.recommendation.trim()) {
      setters.setRecommendationIfEmpty("Please correlate with clinical findings.", "template");
    }
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
    if (generated.finding?.trim()) {
      setters.mergeFindings(generated.finding, "quick-findings");
    }
    if (generated.impression?.trim()) {
      setters.mergeImpression(generated.impression, "quick-findings");
    }
    if (generated.technique?.trim()) {
      setters.mergeTechnique(generated.technique, "quick-findings");
    }
    if (generated.recommendation?.trim()) {
      setters.mergeRecommendation(generated.recommendation, "quick-findings");
    }

    if (!selectedIds.has(f.id)) {
      // Mark selected without re-inserting static template text — generated already applied.
      onToggle({ ...f, findingText: "", impressionText: "", techniqueText: "", recommendationText: "" }, true);
    }
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
    const resolved = resolveChocolateOwnership({
      id: full.id ?? "legacy",
      label: full.label,
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
        anatomicalSection: ownership.anatomicalSection,
        conflictGroup: ownership.conflictGroup,
        baselineReplaces: ownership.baselineReplaces,
      },
      source: "macro",
      side: ownership.supportsLaterality ? undefined : "",
      id: full.id ? `choco-${full.id}` : undefined,
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
      studyDescription,
    );
    if (match) {
      selectTemplateManual(match.id);
      onToast?.({
        title: "Template loaded",
        description: match.templateName,
      });
    }
    return match;
  }, [disabled, matchedStudyRegion, templates, modality, studyDescription, selectTemplateManual, onToast]);

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
      const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region);
      if (protocol) applyProtocol(protocol, i === 0);
      else if (i === 0) setActiveProtocol(null);
    });
    const primary = studyRegions[0] ?? matchedStudyRegion;
    const match = pickStructuredTemplateForRegion(templates, modality, primary, studyDescription);
    if (match) selectTemplateManual(match.id);
    onToast?.({
      title: "Study setup applied",
      description: `${quickSelectData ? (pickQuickProtocol(quickSelectData.protocols, primary)?.name ?? "Protocol") : "Protocol"} · ${match?.templateName ?? "template"}`,
    });
  }, [
    disabled, studyRegions, matchedStudyRegion, quickSelectData, applyProtocol,
    templates, modality, studyDescription, selectTemplateManual, onToast,
  ]);

  /**
   * One-click Start Report bootstrap: apply protocol(s) + matching template,
   * fill technique / default findings / impression / recommendation.
   * Returns a snapshot the caller can use for Undo.
   */
  const startReportBootstrap = useCallback(() => {
    if (disabled || studyRegions.length === 0) return null;
    const before = setters.readFields();
    const snapshot = {
      ...before,
      selectedTemplateId,
      activeProtocolId: activeProtocol?.id ?? null,
    };

    let mergedTechnique = "";
    for (const region of studyRegions) {
      const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region);
      if (protocol?.techniqueText) mergedTechnique = mergeTechnique(mergedTechnique, protocol.techniqueText);
      const tab = quickSelectData?.tabs?.find((t) => t.name === region);
      if (tab?.techniqueText) mergedTechnique = mergeTechnique(mergedTechnique, tab.techniqueText);
    }
    const primaryProtocol = pickQuickProtocol(quickSelectData?.protocols ?? [], studyRegions[0]!);
    if (primaryProtocol) {
      applyProtocol(primaryProtocol, true);
      for (const region of studyRegions.slice(1)) {
        const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region);
        if (protocol) applyProtocol(protocol, false);
      }
    }
    if (mergedTechnique) {
      setters.setTechnique(mergedTechnique);
      lastInsertedTechniqueRef.current = mergedTechnique;
    }

    let match = pickStructuredTemplateForRegion(
      templates,
      modality,
      studyRegions[0] ?? matchedStudyRegion,
      studyDescription,
    );
    const sectionMap: Record<string, { normal: boolean; text: string }> = {};
    if (match) {
      selectTemplateManual(match.id);
      const sections = parseSectionsJson(match.sectionsJson);
      for (const item of sections.findingsItems) {
        sectionMap[item.label] = { normal: true, text: item.normal };
      }
      const techniqueText = mergedTechnique.trim() || sections.technique || "";
      if (techniqueText) {
        setters.setTechnique(techniqueText);
        lastInsertedTechniqueRef.current = techniqueText;
      }
      if (match.defaultFindings) setters.setFindings(match.defaultFindings);
      else if (Object.keys(sectionMap).length) {
        setters.setFindings(
          Object.entries(sectionMap).map(([label, v]) => `${label}: ${v.text}`).join("\n\n"),
        );
      }
      if (match.defaultImpression) setters.setImpression(match.defaultImpression);
      const baseRec = "Please correlate with clinical findings.";
      setters.setRecommendation(
        primaryProtocol?.recommendationText
          ? mergeBlock(baseRec, primaryProtocol.recommendationText)
          : baseRec,
      );
    } else if (primaryProtocol) {
      if (primaryProtocol.normalText) setters.setFindings(primaryProtocol.normalText);
      if (primaryProtocol.recommendationText) {
        setters.setRecommendation(primaryProtocol.recommendationText);
      }
    }

    onToast?.({
      title: "Report started",
      description: `${studyRegions.join(" + ")} — protocol & template applied. Undo available.`,
    });
    return { snapshot, sectionMap, templateId: match?.id ?? null };
  }, [
    disabled, studyRegions, setters, selectedTemplateId, activeProtocol,
    quickSelectData, applyProtocol, templates, modality, studyDescription,
    selectTemplateManual, onToast,
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

  /** Toggle a study region (multi-select). Last-clicked region becomes
   *  primary so macros / Quick Select follow what the radiologist just clicked. */
  const handleRegionToggle = useCallback((regionName: string) => {
    if (disabled) return;
    const next = nextStudyRegions(studyRegions, regionName);
    if (!next) return;
    const added = !studyRegions.includes(regionName);
    setRegionOverrides(next);
    if (!added) return;
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], regionName);
    if (protocol) applyProtocol(protocol, false);
    const tab = quickSelectData?.tabs?.find((t) => t.name === regionName);
    if (tab?.techniqueText) {
      setters.mergeTechnique(tab.techniqueText, "protocol");
    }
  }, [disabled, studyRegions, quickSelectData, applyProtocol, setters]);

  const resetRegionOverrides = useCallback(() => {
    setRegionOverrides(null);
  }, []);

  /** Replace the region list with a single primary region (manual dropdown). */
  const selectPrimaryRegion = useCallback((regionName: string | null) => {
    if (disabled) return;
    if (!regionName) {
      setRegionOverrides(null);
      return;
    }
    setRegionOverrides([regionName]);
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], regionName);
    if (protocol) applyProtocol(protocol, false);
    const tab = quickSelectData?.tabs?.find((t) => t.name === regionName);
    if (tab?.techniqueText) {
      setters.mergeTechnique(tab.techniqueText, "protocol");
    }
  }, [disabled, quickSelectData, applyProtocol, setters]);

  return {
    studyHint,
    studyContext,
    autoStudyRegion,
    matchedStudyRegion,
    studyRegions,
    regionOverrides,
    handleRegionToggle,
    resetRegionOverrides,
    selectPrimaryRegion,
    availableRegions,
    availableProtocols,
    activeProtocol,
    setActiveProtocol,
    applyProtocol,
    requestProtocolChange,
    selectedTemplateId,
    selectedTemplate,
    selectTemplateManual,
    templateMismatch,
    loadCorrectTemplate,
    reapplyDefaults,
    startReportBootstrap,
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
  };
}
