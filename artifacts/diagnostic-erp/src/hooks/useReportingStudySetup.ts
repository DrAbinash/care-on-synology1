/**
 * useReportingStudySetup — DICOM-driven protocol / technique / test-name
 * auto-select for the new Radiology Reporting Workspace.
 *
 * Ports the legacy chain:
 *   modality+studyDescription → matchStudyRegion → pickQuickProtocol → technique
 *   modality+studyDescription → pickStructuredTemplate → test name (+ fill-empty)
 *
 * Additive only: callers write into the Z.ai store via setters; nothing here
 * replaces FindingsEditor / CopilotRail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { matchStudyRegion, filterRegionNamesForModality } from "@/lib/studyRegion";
import { pickQuickProtocol } from "@/lib/pickQuickProtocol";
import {
  pickStructuredTemplate,
  studyRegionToBodyPart,
  templateRegionMismatch,
} from "@/lib/pickStructuredTemplate";
import { templateCatalogModality } from "@/lib/radiologyTemplateModality";
import { mergeBlock } from "@/lib/quickFindingsMerge";
import { combineStudyRegionTitle } from "@/lib/combineStudyRegions";
import { chocolateBoxSetFor, type ChocolateBoxSet } from "@/lib/findingsMacros";
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

  const availableProtocols = useMemo(
    () => (quickSelectData?.protocols ?? [])
      .filter((p) => p.isActive && studyRegions.includes(p.studyType))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [quickSelectData, studyRegions],
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const templateMismatch = useMemo(
    () => templateRegionMismatch(matchedStudyRegion, selectedTemplate?.bodyPart ?? null),
    [matchedStudyRegion, selectedTemplate?.bodyPart],
  );

  const chocolateBoxSet: ChocolateBoxSet | null = useMemo(
    () => chocolateBoxSetFor(modality, studyDescription),
    [modality, studyDescription],
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
      setters.setRecommendation((prev) => mergeBlock(prev, protocol.recommendationText));
    }
    if (protocol.techniqueText) {
      const fields = setters.readFields();
      if (replaceTechnique) {
        // Replace when empty or still holding last auto-inserted protocol text.
        if (!fields.technique.trim() || fields.technique === lastInsertedTechniqueRef.current) {
          setters.setTechnique(protocol.techniqueText);
          lastInsertedTechniqueRef.current = protocol.techniqueText;
        } else {
          // Radiologist has edited — merge instead of clobber.
          setters.setTechnique(mergeBlock(fields.technique, protocol.techniqueText));
        }
      } else {
        setters.setTechnique((prev) => {
          if (!prev.trim()) {
            lastInsertedTechniqueRef.current = protocol.techniqueText;
            return protocol.techniqueText;
          }
          return mergeBlock(prev, protocol.techniqueText);
        });
      }
    }
  }, [disabled, setters]);

  const requestProtocolChange = useCallback((protocol: QuickProtocol | null) => {
    if (!protocol) {
      setActiveProtocol(null);
      return;
    }
    applyProtocol(protocol, false);
  }, [applyProtocol]);

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

  // Auto structured template (test name) once per study — after hydrate.
  useEffect(() => {
    if (!studyId || templates.length === 0 || !draftHydrated) return;
    if (autoTemplateForStudyRef.current === studyId) return;
    autoTemplateForStudyRef.current = studyId;
    let match = pickStructuredTemplate(templates, modality, studyDescription);
    if (!match && matchedStudyRegion) {
      const bodyPart = studyRegionToBodyPart(matchedStudyRegion);
      const mod = templateCatalogModality(modality);
      if (bodyPart) {
        match = templates.find(
          (t) => templateCatalogModality(t.modality) === mod && t.bodyPart === bodyPart,
        ) ?? null;
      }
    }
    if (match) {
      templateApplySourceRef.current = "auto";
      setSelectedTemplateId(match.id);
    }
  }, [studyId, templates, modality, studyDescription, matchedStudyRegion, draftHydrated]);

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
      setters.setTechnique(sections.technique || fields.technique);
      setters.setFindings(selectedTemplate.defaultFindings || "");
      setters.setImpression(selectedTemplate.defaultImpression || "");
      setters.setRecommendation(fields.recommendation.trim() ? fields.recommendation : "Please correlate with clinical findings.");
      return;
    }

    // Auto: fill-empty only — never clobber draft / typed text.
    if (!fields.technique.trim() && sections.technique) {
      setters.setTechnique(sections.technique);
      lastInsertedTechniqueRef.current = sections.technique;
    }
    if (!fields.findings.trim() && selectedTemplate.defaultFindings) {
      setters.setFindings(selectedTemplate.defaultFindings);
    }
    if (!fields.impression.trim() && selectedTemplate.defaultImpression) {
      setters.setImpression(selectedTemplate.defaultImpression);
    }
    if (!fields.recommendation.trim()) {
      setters.setRecommendation("Please correlate with clinical findings.");
    }
  }, [selectedTemplate, disabled, setters]);

  const handleCompanionAutoPopulate = useCallback((plan: AutoPopulatePlan) => {
    if (disabled) return;
    let applied = 0;
    for (const b of plan.blocks) {
      if (b.section === "technique") {
        setters.setTechnique((prev) => (prev.trim() ? prev : b.text));
      } else if (b.section === "findings") {
        setters.setFindings((prev) => mergeBlock(prev, b.text));
      } else if (b.section === "recommendation") {
        setters.setRecommendation((prev) => mergeBlock(prev, b.text));
      } else if (b.section === "impression") {
        setters.setImpression((prev) => (prev.trim() ? prev : b.text));
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
      setters.setFindings((prev) => mergeBlock(prev, generated.finding));
    }
    if (generated.impression?.trim()) {
      setters.setImpression((prev) => {
        const lines = prev.split("\n").filter(Boolean);
        return lines.includes(generated.impression.trim())
          ? prev
          : [...lines, generated.impression.trim()].join("\n");
      });
    }
    if (generated.technique?.trim()) {
      setters.setTechnique((prev) => mergeBlock(prev, generated.technique));
    }
    if (generated.recommendation?.trim()) {
      setters.setRecommendation((prev) => mergeBlock(prev, generated.recommendation));
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

  const applyChocolateTile = useCallback((text: string) => {
    if (disabled || !text.trim()) return;
    setters.setFindings((prev) => mergeBlock(prev, text));
  }, [disabled, setters]);

  const selectTemplateManual = useCallback((id: number) => {
    templateApplySourceRef.current = "manual";
    setSelectedTemplateId(id);
  }, []);

  /** Toggle a study region (multi-select). Adding a region merges its technique. */
  const handleRegionToggle = useCallback((regionName: string) => {
    if (disabled) return;
    const current = new Set(studyRegions);
    if (current.has(regionName)) {
      if (current.size <= 1) return;
      current.delete(regionName);
      setRegionOverrides([...current]);
      return;
    }
    current.add(regionName);
    setRegionOverrides([...current]);
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], regionName);
    if (protocol) applyProtocol(protocol, false);
    const tab = quickSelectData?.tabs?.find((t) => t.name === regionName);
    if (tab?.techniqueText) {
      setters.setTechnique((prev) => mergeBlock(prev, tab.techniqueText));
    }
  }, [disabled, studyRegions, quickSelectData, applyProtocol, setters]);

  const resetRegionOverrides = useCallback(() => {
    setRegionOverrides(null);
  }, []);

  return {
    studyHint,
    autoStudyRegion,
    matchedStudyRegion,
    studyRegions,
    regionOverrides,
    handleRegionToggle,
    resetRegionOverrides,
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
