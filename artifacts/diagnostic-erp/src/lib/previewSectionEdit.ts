/** Sections a radiologist can jump to from the report preview. */
export type PreviewEditSectionId =
  | "history"
  | "technique"
  | "findings"
  | "impression"
  | "recommendation";

export const PREVIEW_EDIT_SECTIONS: ReadonlyArray<{ id: PreviewEditSectionId; label: string }> = [
  { id: "history", label: "Clinical history" },
  { id: "technique", label: "Technique" },
  { id: "findings", label: "Findings" },
  { id: "impression", label: "Impression" },
  { id: "recommendation", label: "Recommendation" },
] as const;

/** Map a preview heading (from buildPreviewHtml / print HTML) to an editor section. */
export function previewHeadingToSection(heading: string): PreviewEditSectionId | null {
  const h = heading.trim().toLowerCase().replace(/\s+/g, " ");
  if (!h) return null;
  if (/clinical history|^history\b/.test(h)) return "history";
  if (/technique/.test(h)) return "technique";
  if (/findings|observation/.test(h)) return "findings";
  if (/impression/.test(h)) return "impression";
  if (/recommendation/.test(h)) return "recommendation";
  return null;
}
