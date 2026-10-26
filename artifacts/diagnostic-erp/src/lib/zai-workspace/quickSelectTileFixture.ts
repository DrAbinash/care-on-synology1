/**
 * The shipped tile catalogue, read as the database boxes it seeds.
 *
 * `quick-select-tiles.data.ts` is 127 boxes of authored clinical prose and the
 * factory seed's only input, so it stays the corpus the overlay-engine tests
 * drive. Production builds its patch from a `ClinicalQuickFindingBox` through
 * `quickFindingPatch` — the one builder — and this is the test-side adapter onto
 * it, not a second builder: a fixture that assembled its own
 * `PendingPathologyPatch` would let a suite pass against a payload no click can
 * produce, which is the exact drift `quickFindingPatch` was written to end.
 *
 * The numeric id stands in for the primary key PostgreSQL assigns. The factory
 * seed maps the catalogue one-to-one (`tiles.map`), so a tile has exactly one
 * row and one id; `tileRowId` hands that same number to `quickFindingRowId` so
 * no test ever spells a row id itself and the id space cannot be pinned to a
 * spelling the app has stopped writing.
 */
import type { QuickSelectField, QuickSelectTile } from "./types";
import type { PendingPathologyPatch } from "./store";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";
import { quickSelectParametersIn } from "./quickSelectParameterContract";
import {
  quickFindingPatch,
  quickFindingRowId,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";

const assignedIds = new Map<string, number>();

/**
 * The box this tile seeds, with `tile.sentence` filed under the section it is
 * offered in. A findings tile carries three sentences because one click writes
 * Findings, Impression and Recommendation together; every other section's tile
 * carries only its own.
 *
 * The column a sentence lands in is the seed's own rule, not a local guess:
 * `primaryTextField(field)` in `generate-quick-select-factory-boxes.ts` files it
 * under its section and anything unnamed — `clinicalHistory` — under
 * `finding_text`. An adapter that filed a box differently made every suite below
 * drive a box the clinic never receives, which is what it did to the eleven
 * history boxes until the parity test in
 * `quickSelectClinicalHistoryRouting.test.ts` said so.
 *
 * `field` moves the sentence between columns. It does not get its own id: the
 * seed writes one row per tile, so a tile driven through a section other than
 * its own is the same box read differently, not a second box. Keying the id on
 * tile-and-section made `tileRowId(t)` and `quickSelectTilePatch(t, "findings")`
 * disagree for every non-findings tile — the row the click wrote was not the row
 * the test looked for, and a `PRECONDITION … keeps both rows on the ledger`
 * failed on a tile that was on the ledger under its other id.
 */
export function clinicalBoxForTile(
  tile: QuickSelectTile,
  field?: QuickSelectField,
): ClinicalQuickFindingBox {
  const section = field ?? tile.field;
  let id = assignedIds.get(tile.id);
  if (id === undefined) {
    id = assignedIds.size + 1;
    assignedIds.set(tile.id, id);
  }
  // `primaryTextField` from the seed generator, in one place: the section names
  // the column, and an unnamed section falls to `findingText` because that is the
  // column default the table gives it.
  const primary = section === "impression" ? "impressionText"
    : section === "technique" ? "techniqueText"
      : section === "recommendation" ? "recommendationText"
        : "findingText";
  return {
    id,
    label: tile.label,
    studyType: tile.scopeBodyPart ?? "",
    field: section,
    findingText: primary === "findingText" ? tile.sentence : "",
    impressionText: primary === "impressionText" ? tile.sentence : (tile.impressionSentence ?? ""),
    techniqueText: primary === "techniqueText" ? tile.sentence : "",
    recommendationText: primary === "recommendationText" ? tile.sentence : (tile.recommendationSentence ?? ""),
    concept: tile.concept ?? null,
    anatomicalSection: tile.anatomicalSection,
    conflictGroup: tile.conflictGroup,
    baselineReplaces: tile.baselineReplaces,
  };
}

/** The ledger row id one click on this tile owns, at this side. */
export function tileRowId(tile: QuickSelectTile, side?: string): string {
  return quickFindingRowId(clinicalBoxForTile(tile).id, side);
}

/**
 * The level a tile's LABEL illustrates ("Disc bulge C5-C6" → "C5-C6").
 *
 * A label is chrome: production never reads it, and since the cervical conversion
 * the sentence no longer carries a level at all. A fixture that wants to click the
 * C5-C6 box must therefore SELECT C5-C6 in the strip's level chip, exactly as the
 * radiologist does, and say so in the payload. Nothing in here invents a laterality:
 * a tile that asks for one and is not given one is refused, which is the guard.
 */
export function levelIllustratedByTileLabel(tile: QuickSelectTile): string {
  const hit = String(tile.label ?? "").match(/\b([A-Z]\d-[A-Z]\d)\b/);
  return hit ? hit[1] : "";
}

/**
 * What a tile's own text says once the click's parameters are resolved — the one
 * place that answers "what does this click write", so a suite asserting the report
 * and a suite performing the click cannot drift apart.
 */
export function renderClickedTile(
  tile: QuickSelectTile,
  params: QuickSelectParameterValues = {},
): string {
  const level = params.level ?? levelIllustratedByTileLabel(tile);
  return String(tile.sentence ?? "")
    .replace(/\{side\}/g, params.side ?? "")
    .replace(/\{level\}/g, level)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * `quickSelectTilePatch` with the level the tile asks for answered from the label,
 * so a fixture states its selection instead of tripping the fail-closed contract.
 */
export function clickedTilePatch(
  tile: QuickSelectTile,
  field?: QuickSelectField,
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  const need = quickSelectParametersIn(`${tile.sentence} ${tile.impressionSentence ?? ""}`);
  const withLevel: QuickSelectParameterValues = { ...params };
  if (need.has("level") && !withLevel.level) withLevel.level = levelIllustratedByTileLabel(tile);
  return quickSelectTilePatch(tile, field ?? tile.field, withLevel);
}

/** The overlay payload one click on this tile sends. */export function quickSelectTilePatch(
  tile: QuickSelectTile,
  field: QuickSelectField,
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  const box = clinicalBoxForTile(tile, field);
  return quickFindingPatch(box, { region: box.studyType }, params);
}
