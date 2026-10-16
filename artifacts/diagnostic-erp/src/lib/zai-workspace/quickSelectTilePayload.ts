/**
 * What one Quick Select box promises, kept out of the React tree so it can be
 * read and tested without a browser.
 *
 * A findings box can carry three sentences: the one in Findings, the one in
 * Impression, and the advice in Recommendation. They have to land together — a
 * disc herniation that updates the Impression but leaves the normal report's
 * advice is a report that contradicts itself — and until now the promise was
 * written inline in a click handler and in a save handler, where neither could
 * be tested and the save handler silently dropped the sentences it had no input
 * for.
 */
import type { PendingPathologyPatch } from "./store";
import type { PathologyIncoming } from "../pathologyPatch";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";

const opt = (v: string | null | undefined) => (v ?? "").trim() || undefined;

/**
 * A clinical box as PostgreSQL holds it and the API returns it.
 *
 * Every field the builder reads is optional except the identity and the four
 * sentences, because a box with no clinical metadata at all is a real and
 * permanent state, not an error: three of the boxes a clinic already had
 * (Hydrocephalus, Cerebral atrophy, Midline shift) are adopted by the factory
 * seed with their own wording, stamped customized, and no concept, conflict
 * group, baseline or category. Those boxes must keep working exactly as they do
 * today, and nothing here may invent ownership for them.
 */
export type ClinicalQuickFindingBox = {
  id: number;
  label: string;
  studyType: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  concept?: string | null;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  properties?: string;
};

/**
 * The ledger row one database box owns for one click.
 *
 * Left and Right of one box are two claims at two slots — the engine already
 * resolves them to different `slotKey`s, because `buildSlotKey` carries
 * laterality — and the report the radiologist is writing says both. With one id
 * for both clicks the second click overwrote the first row in the ledger while
 * the first sentence stayed on the page (`dropIds` and the row filter both key on
 * the id): clicking the box off then removed one statement and left the other
 * printed, saved, and no longer removable through the ledger. A box that asks
 * for no side keeps the bare `qf-<id>` it has always had, so every existing
 * deselect caller and every saved draft still resolves.
 *
 * `selectedQuickFindingIds` is the other half of this contract — it has to parse
 * what this writes, or the box stops reading as selected the moment a side is
 * recorded. Both halves are pinned together in quickSelectTilePayload.test.ts.
 */
export function quickFindingRowId(boxId: number, side?: string): string {
  const chosen = (side ?? "").trim().toLowerCase();
  return chosen ? `qf-${boxId}:${chosen}` : `qf-${boxId}`;
}

/** True for any row this box wrote, at any side — what the chip state needs. */
export function quickFindingRowBelongsTo(id: string, boxId: number): boolean {
  return id === `qf-${boxId}` || id.startsWith(`qf-${boxId}:`);
}

/**
 * The overlay payload one database box click sends.
 *
 * This is the only builder, and it exists because the promise used to be written
 * twice — once here and once inline in `handleQuickToggle`, where it carried
 * less: no concept, no severity, no declared laterality, and one row id for both
 * sides. One engine with two unequal callers meant a box clicked from the
 * database was not clinically equal to the same box clicked from the strip, and
 * the database is where every box lives.
 *
 * `supportsLaterality` is declared from all four sentences on purpose. The store
 * resolves the side only when the observation declares laterality
 * (`store.ts:2316`), while the refusal guard scans every section it is about to
 * write (`unresolvedQuickSelectParameters`). Inference alone reads `findingsText`
 * and the `properties` column, so a box carrying `{side}` only in its
 * recommendation would be asked for a side it was never allowed to use — and
 * would refuse forever. Declaring from the same set the guard scans is what keeps
 * those two in step.
 */
export function quickFindingPatch(
  box: ClinicalQuickFindingBox,
  ctx: { region: string; studyType?: string },
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  const templates: PathologyIncoming = {
    findings: box.findingText,
    impression: box.impressionText,
    technique: box.techniqueText,
    recommendation: box.recommendationText,
  };
  const sided = /\{side\}/i.test(
    `${box.findingText} ${box.impressionText} ${box.techniqueText} ${box.recommendationText}`,
  );
  return {
    incoming: templates,
    templates,
    ownership: {
      anatomicalSection: opt(box.anatomicalSection),
      conflictGroup: opt(box.conflictGroup),
      // An empty string here is not "no baseline" to the engine, it is a sentence
      // to look for. Never hand it one the box did not declare.
      baselineReplaces: opt(box.baselineReplaces),
      concept: opt(box.concept) ?? null,
    },
    source: "quick-findings",
    id: quickFindingRowId(box.id, params.side),
    region: ctx.region,
    studyType: ctx.studyType ?? box.studyType,
    concept: opt(box.concept) ?? null,
    label: box.label,
    catalogId: box.id,
    properties: box.properties,
    findingsText: box.findingText,
    supportsLaterality: sided,
    ...(sided && params.side ? { side: params.side } : {}),
    ...(opt(params.severity) ? { severity: opt(params.severity) } : {}),
  };
}

/**
 * What one click on a box did, as the clicker learns it.
 *
 * The first three are `applyPathologyOverlay`'s own verdict, passed straight
 * through: `"applied"` wrote, `"pending"` wrote and opened the same-slot confirm
 * dialog, `"refused"` wrote nothing — a signed report, or a `{side}`/`{severity}`
 * nobody chose. `"removed"` is the deselect branch, which goes through
 * `removeObservation` instead and has no overlay verdict to report.
 *
 * A clicker has to be able to tell `"refused"` from the rest, because everything
 * it would otherwise do next is a claim that the write landed: counting a use,
 * highlighting the finding as feedback, firing a draft save the server is
 * certain to refuse.
 */
export type QuickToggleOutcome = "applied" | "pending" | "refused" | "removed";
