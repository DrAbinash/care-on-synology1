/**
 * The database box catalogue, scoped for one section's Quick Select strip.
 *
 * The strip used to render `quickSelectTiles` out of localStorage, which meant a
 * box authored at the reporting desk existed only in the browser that authored
 * it, and a clinic edit to a shipped box had nothing to be preserved against.
 * The boxes now live in `radiology_quick_findings`; this is the read path that
 * puts them in front of the radiologist.
 *
 * Scoping deliberately reuses `lookupTilesForContext` rather than growing a
 * second region matcher. The seed wrote each shipped tile's `scopeBodyPart` into
 * the box's `study_type` column (`generate-quick-select-factory-boxes.ts:169`),
 * so mapping `study_type` back onto `scopeBodyPart` reproduces the strip's
 * existing behaviour exactly — including the ten cross-region boxes the seed
 * wrote with `study_type = ''`, which score 10 and so survive for every region.
 * A second matcher is how a Whole Spine study ends up with a different strip
 * than a Cervical one for no clinical reason.
 */
import type { ClinicalQuickFindingBox } from "./quickSelectTilePayload";
import { lookupTilesForContext } from "./quick-select-library";
import type { Modality, QuickSelectField, QuickSelectTile } from "./types";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";

/**
 * A box as the wire returns it, widened with the columns the strip's chrome
 * reads. `ClinicalQuickFindingBox` carries only what `quickFindingPatch` needs;
 * these four are all `NOT NULL` (or nullable with a documented default) on the
 * table, so they are always present at runtime and optional here only because
 * hand-built fixtures in tests are allowed to omit them.
 */
export type QuickSelectCatalogueBox = ClinicalQuickFindingBox & {
  field?: string | null;
  mnemonic?: string | null;
  category?: string | null;
  scopeModality?: string | null;
  sortOrder?: number | null;
};

const FIELD_NAMES: readonly string[] = [
  "clinicalHistory",
  "technique",
  "findings",
  "impression",
  "recommendation",
];

const CATEGORY_NAMES = new Set(["normal", "abnormal", "variant", "critical"]);

/**
 * The section a box writes its own sentence into.
 *
 * Falls back to `findings` because that is the column default
 * (`radiologyQuickFindings.ts:93`), not a guess: a row whose `field` is somehow
 * empty behaves in the strip exactly as the database says it behaves.
 */
export function quickSelectBoxField(box: QuickSelectCatalogueBox): QuickSelectField {
  const named = (box.field ?? "").trim();
  return FIELD_NAMES.includes(named) ? (named as QuickSelectField) : "findings";
}

/**
 * The sentence this strip shows, searches and previews for one box.
 *
 * A box is not field-scoped in its columns — it carries all four sentences and
 * `quickFindingPatch` writes all four as one patch — but it IS field-scoped in
 * its identity: the seed put the tile's sentence into `primaryTextField(field)`
 * and left the rest empty, and `clinicalHistory` falls through that switch to
 * `findingText`. So the sentence the radiologist reads on the chip is the one
 * this section owns, while the write still carries whatever else the box
 * declares.
 */
export function quickSelectBoxSentence(
  box: QuickSelectCatalogueBox,
  field: QuickSelectField,
): string {
  switch (field) {
    case "impression":
      return box.impressionText ?? "";
    case "technique":
      return box.techniqueText ?? "";
    case "recommendation":
      return box.recommendationText ?? "";
    default:
      return box.findingText ?? "";
  }
}

/**
 * Every sentence one click of this box can write, joined for parameter scanning.
 *
 * This has to be the same set `quickFindingPatch` derives `supportsLaterality`
 * from and the same set the store's refusal guard scans, or the strip offers no
 * side chip for a box that then refuses forever for want of one — the defect
 * `quickFindingPatch`'s own docblock names. Reading the tile's three sentence
 * fields instead would miss a `{side}` carried only in Technique.
 */
export function quickSelectBoxWrittenText(box: QuickSelectCatalogueBox): string {
  return [
    box.findingText ?? "",
    box.impressionText ?? "",
    box.techniqueText ?? "",
    box.recommendationText ?? "",
  ].join(" ");
}

/**
 * One box rendered as the tile shape `lookupTilesForContext` scopes.
 *
 * The tile is a scoping and display adapter only — nothing applies it. The click
 * goes through the box, so the patch carries the concept, catalogue id,
 * declared laterality and region that a tile-shaped patch dropped.
 */
export function quickSelectBoxTile(
  box: QuickSelectCatalogueBox,
  field: QuickSelectField,
): QuickSelectTile {
  const modality = (box.scopeModality ?? "").trim();
  const region = (box.studyType ?? "").trim();
  const category = (box.category ?? "").trim();
  return {
    id: String(box.id),
    field,
    scopeModality: (modality || undefined) as Modality | undefined,
    // '' is the seed's sentinel for "every region". As `undefined` it scores 10
    // in `lookupTilesForContext` and so is offered for any resolved region,
    // which is the only way the ten cross-region boxes reach the strip at all.
    scopeBodyPart: region || undefined,
    label: box.label,
    mnemonic: (box.mnemonic ?? "").trim() || undefined,
    category: CATEGORY_NAMES.has(category)
      ? (category as QuickSelectTile["category"])
      : "normal",
    sentence: quickSelectBoxSentence(box, field),
    impressionSentence: (box.impressionText ?? "").trim() || undefined,
    recommendationSentence: (box.recommendationText ?? "").trim() || undefined,
    createdAt: "",
    updatedAt: "",
    concept: (box.concept ?? "").trim() || undefined,
    anatomicalSection: (box.anatomicalSection ?? "").trim() || undefined,
    conflictGroup: (box.conflictGroup ?? "").trim() || undefined,
    baselineReplaces: (box.baselineReplaces ?? "").trim() || undefined,
    properties: box.properties ?? undefined,
  };
}

/**
 * The boxes one strip renders, in the order the region matcher ranks them.
 *
 * A box whose own sentence for this section is empty is dropped: it would render
 * as a chip with nothing to preview and, on click, write only the other sections
 * it carries — a box the radiologist clicked in Impression that changes Findings
 * and leaves Impression alone is worse than a box that is not offered.
 *
 * Generic in the box type and returning the SAME objects it was given, so a
 * caller that decorated its boxes first (favorites, usage counts) keeps the
 * decoration through the scoping instead of having to look each one up again.
 */
export function lookupBoxesForContext<T extends QuickSelectCatalogueBox>(
  boxes: readonly T[],
  field: QuickSelectField,
  modality: Modality | undefined,
  ctx: ReportingStudyContext | null | undefined,
): T[] {
  const inField = boxes.filter(
    (box) =>
      quickSelectBoxField(box) === field &&
      quickSelectBoxSentence(box, field).trim().length > 0,
  );
  const byId = new Map(inField.map((box) => [String(box.id), box]));
  return lookupTilesForContext(
    inField.map((box) => quickSelectBoxTile(box, field)),
    field,
    modality,
    ctx,
  )
    .map((tile) => byId.get(tile.id))
    .filter((box): box is T => box !== undefined);
}
