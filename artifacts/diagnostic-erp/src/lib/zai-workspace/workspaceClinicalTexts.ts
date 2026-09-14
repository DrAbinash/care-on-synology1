import { useEffect, useState } from "react";
import {
  EMPTY_FIELD_PROVENANCE,
  useWorkspace,
  type WorkspaceStore,
} from "@/lib/zai-workspace/store";
import type { FieldProvenanceMap } from "@/lib/reportFieldMerge";

/**
 * Clinical report body fields that live in the workspace store.
 * FindingsEditor already subscribes per-field; the workspace shell must NOT
 * subscribe live to these or every keystroke re-renders the entire cockpit.
 */
export type WorkspaceClinicalTexts = {
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  techniqueText: string;
  clinicalHistoryText: string;
  findingsProvenance: FieldProvenanceMap;
  impressionProvenance: FieldProvenanceMap;
  techniqueProvenance: FieldProvenanceMap;
};

export function readWorkspaceClinicalTexts(
  s: WorkspaceStore = useWorkspace.getState(),
): WorkspaceClinicalTexts {
  return {
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    techniqueText: s.techniqueText,
    clinicalHistoryText: s.clinicalHistoryText,
    findingsProvenance: s.fieldProvenance.findings ?? EMPTY_FIELD_PROVENANCE,
    impressionProvenance: s.fieldProvenance.impression ?? EMPTY_FIELD_PROVENANCE,
    techniqueProvenance: s.fieldProvenance.technique ?? EMPTY_FIELD_PROVENANCE,
  };
}

function clinicalTextsChanged(a: WorkspaceStore, b: WorkspaceStore): boolean {
  return (
    a.findingsText !== b.findingsText
    || a.impressionText !== b.impressionText
    || a.recommendationText !== b.recommendationText
    || a.techniqueText !== b.techniqueText
    || a.clinicalHistoryText !== b.clinicalHistoryText
    || a.fieldProvenance.findings !== b.fieldProvenance.findings
    || a.fieldProvenance.impression !== b.fieldProvenance.impression
    || a.fieldProvenance.technique !== b.fieldProvenance.technique
    || a.activeStudyId !== b.activeStudyId
  );
}

/**
 * Debounced mirror of clinical texts for shell chrome (accordion summaries,
 * progress dots, draft-backup snapshot identity, banners).
 *
 * Study switches flush immediately so wrong-patient chrome cannot linger.
 * Save / finalize / export must call {@link readWorkspaceClinicalTexts} —
 * never rely on this hook for clinical persistence.
 */
export function useDebouncedWorkspaceClinicalTexts(delayMs = 300): WorkspaceClinicalTexts {
  const [texts, setTexts] = useState(readWorkspaceClinicalTexts);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      setTexts(readWorkspaceClinicalTexts());
    };

    const unsub = useWorkspace.subscribe((state, prev) => {
      if (!clinicalTextsChanged(state, prev)) return;
      if (state.activeStudyId !== prev.activeStudyId) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flush();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  return texts;
}
