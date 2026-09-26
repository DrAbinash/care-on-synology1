/**
 * Report accordion + setup-chrome collapse for RadiologyReportingWorkspace.
 * Phase 2 extraction — behavior unchanged (layout-only; no clinical mutations).
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  isStudyDetailsSection,
  shouldCollapseSetupChrome,
} from "@/lib/reportingPaneFocus";
import {
  nextActiveSection,
  nextFindingsTool,
  type FindingsToolId,
  type ReportSectionId,
} from "@/lib/reportSectionAccordion";
import {
  prefsAfterSectionActivate,
  readReportSectionCollapsePrefs,
  writeReportSectionCollapsePrefs,
  type ReportSectionCollapsePrefs,
} from "@/lib/reportSectionCollapsePrefs";
import type { PersonalTemplateTarget } from "@/lib/personalReportTemplates";

export type UseReportSectionChromeResult = {
  sectionCollapsePrefs: ReportSectionCollapsePrefs;
  setSectionCollapsePrefs: Dispatch<SetStateAction<ReportSectionCollapsePrefs>>;
  activeReportSection: ReportSectionId | null;
  setActiveReportSection: Dispatch<SetStateAction<ReportSectionId | null>>;
  studyDetailsOpen: boolean;
  setStudyDetailsOpen: Dispatch<SetStateAction<boolean>>;
  startingCanvasExpanded: boolean;
  setStartingCanvasExpanded: Dispatch<SetStateAction<boolean>>;
  lastClinicalTarget: PersonalTemplateTarget;
  setLastClinicalTarget: Dispatch<SetStateAction<PersonalTemplateTarget>>;
  activeFindingsTool: FindingsToolId | null;
  activeFindingsAnatomy: string | null;
  setActiveFindingsAnatomy: Dispatch<SetStateAction<string | null>>;
  activateReportSection: (id: ReportSectionId) => void;
  selectFindingsTool: (id: FindingsToolId) => void;
  focusClinicalEditor: (field: PersonalTemplateTarget) => void;
  focusReportField: (field: "findings" | "impression" | "technique" | "clinicalHistory" | "recommendation") => void;
  /** Wire from useWorkspaceLayout after it mounts. */
  enterReportingFocusModeRef: MutableRefObject<() => void>;
  enterClinicalEditorFocusRef: MutableRefObject<() => void>;
  exclusiveReportSectionsRef: MutableRefObject<boolean>;
};

export function useReportSectionChrome(): UseReportSectionChromeResult {
  const [sectionCollapsePrefs, setSectionCollapsePrefs] = useState<ReportSectionCollapsePrefs>(() =>
    readReportSectionCollapsePrefs(typeof window !== "undefined" ? window.localStorage : null),
  );
  const [activeReportSection, setActiveReportSection] = useState<ReportSectionId | null>(
    () => sectionCollapsePrefs.preferredActive || "findings",
  );
  const [studyDetailsOpen, setStudyDetailsOpen] = useState(false);
  const [startingCanvasExpanded, setStartingCanvasExpanded] = useState(false);
  const [lastClinicalTarget, setLastClinicalTarget] = useState<PersonalTemplateTarget>("findings");
  const [activeFindingsTool, setActiveFindingsTool] = useState<FindingsToolId | null>(null);
  const [activeFindingsAnatomy, setActiveFindingsAnatomy] = useState<string | null>(null);

  const enterReportingFocusModeRef = useRef<() => void>(() => {});
  const enterClinicalEditorFocusRef = useRef<() => void>(() => {});
  const exclusiveReportSectionsRef = useRef(false);

  const focusClinicalEditor = useCallback((field: PersonalTemplateTarget) => {
    setLastClinicalTarget(field);
    setActiveReportSection(field);
    // Layout-only: never mutates clinical text / observations / study.
    if (field === "findings" || field === "impression") {
      enterClinicalEditorFocusRef.current();
    } else if (exclusiveReportSectionsRef.current) {
      enterReportingFocusModeRef.current();
    }
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`[data-testid="canonical-${field}-editor"]`);
      el?.focus();
    });
  }, []);

  const activateReportSection = useCallback((id: ReportSectionId) => {
    setActiveReportSection((cur) => {
      const next = nextActiveSection(cur, id);
      const prefs = prefsAfterSectionActivate(sectionCollapsePrefs, next, cur);
      setSectionCollapsePrefs(prefs);
      writeReportSectionCollapsePrefs(
        typeof window !== "undefined" ? window.localStorage : null,
        prefs,
      );
      return next;
    });
  }, [sectionCollapsePrefs]);

  useEffect(() => {
    if (isStudyDetailsSection(activeReportSection)) {
      setStudyDetailsOpen(true);
      return;
    }
    if (shouldCollapseSetupChrome(activeReportSection)) {
      setStudyDetailsOpen(false);
      setStartingCanvasExpanded(false);
    }
  }, [activeReportSection]);

  const selectFindingsTool = useCallback((id: FindingsToolId) => {
    setActiveFindingsTool((cur) => nextFindingsTool(cur, id));
  }, []);

  const focusReportField = useCallback((field: "findings" | "impression" | "technique" | "clinicalHistory" | "recommendation") => {
    const sectionByField: Record<typeof field, ReportSectionId> = {
      clinicalHistory: "history",
      technique: "technique",
      findings: "findings",
      impression: "impression",
      recommendation: "recommendation",
    };
    activateReportSection(sectionByField[field]);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-report-field="${field}"] textarea`) as HTMLTextAreaElement | null;
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }, [activateReportSection]);

  return {
    sectionCollapsePrefs,
    setSectionCollapsePrefs,
    activeReportSection,
    setActiveReportSection,
    studyDetailsOpen,
    setStudyDetailsOpen,
    startingCanvasExpanded,
    setStartingCanvasExpanded,
    lastClinicalTarget,
    setLastClinicalTarget,
    activeFindingsTool,
    activeFindingsAnatomy,
    setActiveFindingsAnatomy,
    activateReportSection,
    selectFindingsTool,
    focusClinicalEditor,
    focusReportField,
    enterReportingFocusModeRef,
    enterClinicalEditorFocusRef,
    exclusiveReportSectionsRef,
  };
}
