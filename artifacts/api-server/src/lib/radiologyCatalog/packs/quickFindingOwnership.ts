/**
 * Map pack findings onto radiology_quick_findings ownership columns.
 * Does not create a second store — fills the existing QS table shape.
 */
import type { ContentPack, FindingDecl } from "./types";
import type { NormFinding } from "./graph";

export type QuickFindingOwnershipRow = {
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  conflictGroup: string;
  anatomicalSection: string;
  baselineReplaces: string;
};

export function packFindingToQuickFindingRow(f: FindingDecl, pack: ContentPack): QuickFindingOwnershipRow {
  return {
    studyType: (f.study_type || pack.pack.modality || pack.pack.id || "").trim(),
    label: f.display_name,
    findingText: f.default_sentence,
    impressionText: f.impression_fragment,
    conflictGroup: f.conflict_group ?? "",
    anatomicalSection: f.anatomical_section ?? "",
    baselineReplaces: f.baseline_replaces ?? "",
  };
}

export function graphFindingToQuickFindingRow(f: NormFinding): QuickFindingOwnershipRow {
  return {
    studyType: f.meta.study_type || f.meta.source_pack,
    label: f.display_name,
    findingText: f.narrative,
    impressionText: f.impression,
    conflictGroup: f.meta.conflict_group,
    anatomicalSection: f.meta.anatomical_section,
    baselineReplaces: f.meta.baseline_replaces,
  };
}
