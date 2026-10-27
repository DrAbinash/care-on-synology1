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
  sectionOwningFocus,
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
  /** Which accordion section currently holds the caret, or null outside the pane. */
  sectionWithCaret: ReportSectionId | null;
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
  const [sectionWithCaret, setSectionWithCaret] = useState<ReportSectionId | null>(null);

  // The accordion hides the section it is not showing, and a hidden editor is a
  // blurred one: this is the only signal that tells a layout change whether it
  // is about to interrupt typing. `focusin` carries the element gaining focus, so
  // the caret is read from the event. On `focusout` to an element the page does
  // not make focusable (a bare `blur()`, a disabled control, the browser chrome)
  // `relatedTarget` is null AND `document.activeElement` is still the old editor
  // while the event runs, so the settle is read one frame later — reading it
  // inline left the caret pinned to a section that had already closed, and a
  // deferred reveal never came.
  useEffect(() => {
    const sync = () => setSectionWithCaret(sectionOwningFocus(document.activeElement));
    const onFocusIn = (event: FocusEvent) => setSectionWithCaret(sectionOwningFocus(event.target as Element | null));
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) {
        setSectionWithCaret(sectionOwningFocus(event.relatedTarget as Element | null));
        return;
      }
      requestAnimationFrame(sync);
    };
    sync();
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);

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
    sectionWithCaret,
    activateReportSection,
    selectFindingsTool,
    focusClinicalEditor,
    focusReportField,
    enterReportingFocusModeRef,
    enterClinicalEditorFocusRef,
    exclusiveReportSectionsRef,
  };
}
