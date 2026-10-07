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
import type { QuickSelectField, QuickSelectTile } from "./types";
import type { PendingPathologyPatch } from "./store";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";

const opt = (v: string | undefined) => (v ?? "").trim() || undefined;

/**
 * The overlay payload one click sends. `incoming` and `templates` are the same
 * object because a Quick Select contribution has no separate "display" wording.
 *
 * `params` carries what the radiologist picked in the strip for this tile's
 * parameters. It was never passed before, which is how ten shipped tiles came to
 * write a literal `{side}` into Findings, Impression and the Observation Ledger:
 * the substitution path the store runs (`applySideToIncoming`) resolves the
 * template from `opts.side`, got `undefined`, and returned the template as
 * written. Omitting a parameter here is not a default — the store refuses the
 * write when the tile asks for a value nobody chose
 * (`quickSelectParameterContract`).
 */
export function quickSelectTilePatch(
  tile: QuickSelectTile,
  field: QuickSelectField,
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  const templates = field === "findings"
    ? {
      findings: tile.sentence,
      impression: tile.impressionSentence,
      recommendation: tile.recommendationSentence,
    }
    : { impression: tile.sentence };
  return {
    incoming: templates,
    templates,
    ownership: {
      anatomicalSection: tile.anatomicalSection || undefined,
      conflictGroup: tile.conflictGroup || undefined,
      baselineReplaces: tile.baselineReplaces,
      concept: tile.concept,
    },
    source: "quick-select",
    id: `qs-${tile.id}`,
    region: tile.scopeBodyPart,
    concept: tile.concept,
    label: tile.label,
    findingsText: tile.sentence,
    supportsLaterality: /\{side\}/i.test(`${tile.sentence} ${tile.impressionSentence ?? ""}`),
    ...(params.side ? { side: params.side } : {}),
    ...(opt(params.severity) ? { severity: opt(params.severity) } : {}),
  };
}

/** Everything one Save click writes back for a box. */
export type QuickSelectTileForm = {
  field: QuickSelectField;
  label: string;
  sentence: string;
  mnemonic: string;
  category: QuickSelectTile["category"];
  scopeModality: string;
  scopeBodyPart: string;
  favorite: boolean;
  conflictGroup: string;
  anatomicalSection: string;
  baselineReplaces: string;
  impressionSentence: string;
  recommendationSentence: string;
};

export type SavedQuickSelectTile =
  Omit<QuickSelectTile, "id" | "createdAt" | "updatedAt"> & { id?: string };

/**
 * Built from every sentence the box carries, not only the fields that have an
 * input: editing a shipped box to change its label used to delete the line it
 * wrote into the Impression.
 */
export function quickSelectTileFromForm(
  editing: QuickSelectTile | null,
  form: QuickSelectTileForm,
): SavedQuickSelectTile {
  return {
    id: editing?.id,
    field: form.field,
    label: form.label.trim(),
    sentence: form.sentence.trim(),
    mnemonic: opt(form.mnemonic),
    category: form.category,
    scopeModality: (form.scopeModality || undefined) as QuickSelectTile["scopeModality"],
    scopeBodyPart: opt(form.scopeBodyPart),
    favorite: form.favorite,
    custom: true,
    usageCount: editing?.usageCount ?? 0,
    conflictGroup: opt(form.conflictGroup),
    anatomicalSection: opt(form.anatomicalSection),
    baselineReplaces: opt(form.baselineReplaces),
    impressionSentence: opt(form.impressionSentence),
    recommendationSentence: opt(form.recommendationSentence),
  };
}
