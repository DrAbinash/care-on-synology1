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
  const isFindings = section === "findings";
  return {
    id,
    label: tile.label,
    studyType: tile.scopeBodyPart ?? "",
    findingText: isFindings ? tile.sentence : "",
    impressionText: isFindings
      ? tile.impressionSentence ?? ""
      : section === "impression"
        ? tile.sentence
        : "",
    techniqueText: section === "technique" ? tile.sentence : "",
    recommendationText: isFindings
      ? tile.recommendationSentence ?? ""
      : section === "recommendation"
        ? tile.sentence
        : "",
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

/** The overlay payload one click on this tile sends. */
export function quickSelectTilePatch(
  tile: QuickSelectTile,
  field: QuickSelectField,
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  const box = clinicalBoxForTile(tile, field);
  return quickFindingPatch(box, { region: box.studyType }, params);
}
