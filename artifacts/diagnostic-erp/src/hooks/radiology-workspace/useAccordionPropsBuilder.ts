/**
 * Accordion header props builder for RadiologyReportingWorkspace.
 * Phase 5a extraction — pure move; behavior unchanged.
 *
 * Owns collapsed-section summaries + status + the shared accordionProps()
 * factory used by ReportCanvas. Layout focus callbacks are injected so this
 * hook stays free of panel-ref ownership.
 */

import { useMemo, type ReactNode } from "react";
import { REPORT_LAYOUT_OPTIONS, type ReportLayoutKey } from "@/components/radiology/ReportLayoutQuickSelect";
import {
  REPORT_SECTIONS,
  countAssisted,
  sectionStatuses,
  summarizeDemography,
  summarizeFieldText,
  summarizeFindings,
  summarizeImpression,
  summarizeRecommendation,
  summarizeRefDoctor,
  summarizeRegion,
  summarizeReport,
  summarizeTechnique,
  type ReportSectionId,
} from "@/lib/reportSectionAccordion";
import {
  provenanceMapToSegments,
  provenanceVisualKind,
  type FieldProvenanceMap,
} from "@/lib/reportFieldMerge";
import { runLintRules, type Modality } from "@/lib/zai-workspace/types";
import type { ReportDemography } from "@/lib/reportDemography";

export type UseAccordionPropsBuilderOptions = {
  canonicalDemography: ReportDemography;
  findingsText: string;
  findingsProvenance: FieldProvenanceMap | null | undefined;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  useStructured: boolean;
  studyModality: string | null | undefined;
  studySex: string | null | undefined;
  reportLayout: ReportLayoutKey;
  studyRegions: readonly string[];
  activeProtocolName: string | null | undefined;
  testName: string | null | undefined;
  templateMismatch: boolean;
  clinicalHistoryText: string;
  techniqueText: string;
  impressionText: string;
  recommendationText: string;
  isCritical: boolean;
  hasPatient: boolean;
  draftId: number | null | undefined;
  activeReportSection: ReportSectionId | null;
  activateReportSection: (id: ReportSectionId) => void;
  enterClinicalEditorFocus: () => void;
  enterReportingFocusMode: () => void;
  exclusiveReportSections: boolean;
  compactAccordion: boolean;
};

export function useAccordionPropsBuilder(opts: UseAccordionPropsBuilderOptions) {
  const {
    canonicalDemography,
    findingsText,
    findingsProvenance,
    findingsMap,
    useStructured,
    studyModality,
    studySex,
    reportLayout,
    studyRegions,
    activeProtocolName,
    testName,
    templateMismatch,
    clinicalHistoryText,
    techniqueText,
    impressionText,
    recommendationText,
    isCritical,
    hasPatient,
    draftId,
    activeReportSection,
    activateReportSection,
    enterClinicalEditorFocus,
    enterReportingFocusMode,
    exclusiveReportSections,
    compactAccordion,
  } = opts;

  // Always use catalog-enriched REF. BY (Settings → Doctors degree), not the raw
  // worklist string which often lacks qualification.
  const referringDoctorName = canonicalDemography.referringDoctor || null;
  const findingsAssistedCount = useMemo(
    () =>
      countAssisted(
        provenanceMapToSegments(findingsText, findingsProvenance ?? {}).map((seg) => ({
          kind: provenanceVisualKind(seg.sources),
          label: "",
        })),
      ),
    [findingsText, findingsProvenance],
  );
  const findingsLintCount = useMemo(() => {
    if (!findingsText) return 0;
    const modality = (studyModality ?? "XR") as Modality;
    const sex =
      studySex === "M" || studySex === "F" || studySex === "O" ? studySex : undefined;
    return runLintRules(findingsText, { modality, sex }).length;
  }, [findingsText, studyModality, studySex]);
  const reportLayoutLabel = REPORT_LAYOUT_OPTIONS.find((o) => o.key === reportLayout)?.label ?? "Classic";
  const regions = studyRegions;
  const sectionSummaries: Record<ReportSectionId, string> = {
    demography: summarizeDemography({
      patientName: canonicalDemography.patientName,
      age: canonicalDemography.age,
      sex: canonicalDemography.sex,
      // No numeric-PK fallback: the merge layer refuses to present a Postgres
      // sequence value as a patient code, and the chip must not re-admit it.
      patientCode: canonicalDemography.uhid || null,
    }),
    refDoctor: summarizeRefDoctor(referringDoctorName),
    region: summarizeRegion({
      regions,
      protocolName: activeProtocolName ?? null,
      testName,
      templateMismatch,
    }),
    history: summarizeFieldText(clinicalHistoryText, "Not recorded"),
    technique: summarizeTechnique({
      techniqueText,
      protocolName: activeProtocolName ?? null,
    }),
    findings: summarizeFindings({
      findingsText,
      structured: useStructured,
      structuredSectionCount: Object.keys(findingsMap).length,
      assistedCount: findingsAssistedCount,
      lintCount: findingsLintCount,
    }),
    impression: summarizeImpression(impressionText),
    recommendation: summarizeRecommendation(recommendationText, isCritical),
    report: summarizeReport({ layoutLabel: reportLayoutLabel, paper: "A4" }),
  };
  const sectionStatus = sectionStatuses({
    hasPatient,
    refDoctor: referringDoctorName,
    regions,
    templateMismatch,
    clinicalHistoryText,
    techniqueText,
    findingsText,
    structured: useStructured,
    structuredSectionCount: Object.keys(findingsMap).length,
    impressionText,
    recommendationText,
    critical: isCritical,
    reportReady: !!draftId,
  });
  const sectionMeta = (id: ReportSectionId) => {
    const idx = REPORT_SECTIONS.findIndex((s) => s.id === id);
    const meta = REPORT_SECTIONS[idx];
    return { index: idx + 1, label: meta.label, accent: meta.accent };
  };
  /** Shared props for every accordion header — keeps the nine call sites terse. */
  const accordionProps = (id: ReportSectionId, extra?: { collapsedWarning?: ReactNode }) => {
    const meta = sectionMeta(id);
    const clinicalEditor = id === "findings" || id === "impression";
    return {
      id,
      index: meta.index,
      label: meta.label,
      accent: meta.accent,
      summary: sectionSummaries[id],
      status: sectionStatus[id],
      active: activeReportSection === id,
      onActivate: (sectionId: ReportSectionId) => {
        activateReportSection(sectionId);
        // Findings / Impression: grow the report column (~2/3) so the editor
        // is not a 1–2 line slit beside OHIF. Other sections still collapse
        // chrome on laptop exclusive mode.
        if (sectionId === "findings" || sectionId === "impression") {
          enterClinicalEditorFocus();
        } else if (exclusiveReportSections) {
          enterReportingFocusMode();
        }
      },
      collapsedWarning: extra?.collapsedWarning,
      density: (compactAccordion ? "compact" : "comfortable") as "compact" | "comfortable",
      // Primary clinical sections already get emphasis via continuous/active
      // height rules — mark Findings / Impression for the larger min-heights.
      ...(clinicalEditor ? { emphasis: "primary" as const } : {}),
    };
  };

  return {
    accordionProps,
    sectionMeta,
    sectionStatus,
    sectionSummaries,
    // Exposed on the workspace vm bag (parity with pre-extract clinical UI).
    referringDoctorName,
    findingsAssistedCount,
    findingsLintCount,
    reportLayoutLabel,
  };
}
