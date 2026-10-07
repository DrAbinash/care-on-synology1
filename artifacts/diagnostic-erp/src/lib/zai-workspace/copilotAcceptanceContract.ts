/**
 * copilotAcceptanceContract.ts — what accepting one Copilot / AI suggestion
 * promises, kept out of the store so the promise can be read and tested without
 * one.
 *
 * AI in CARE is assistive. A model may propose Findings, an Impression, a
 * Recommendation or better wording, but a proposal is not clinical truth: it
 * becomes report content only when the radiologist explicitly accepts it. That
 * acceptance is a three-part promise, and all three parts have to survive the
 * trip through the boundary:
 *
 *   WHAT     the text the item carries, inserted verbatim (the merge layer and
 *            #878's non-destructive rules decide how it joins the field);
 *   WHERE    the field the producer declared — `insertTarget`;
 *   WHO      the provenance label the accepted text carries.
 *
 * Before B-03 the store answered the second and third questions with hard-coded
 * constants: `mergeField("findings", item.insertText, "companion")`. So an item
 * whose own producer declared `insertTarget: "impression"` — the AI reasoner's
 * `IMPRESSION:` line in `copilotAiModule.ts`, or the deterministic
 * `recommendation:rec-mra` rule in `copilotOrchestrator.ts`, whose button the
 * panel even renders as "Insert → recommendation" — landed in Findings, and
 * AI-authored prose entered the record attributed to the companion panel.
 * Landing an AI impression in Findings is not cosmetic: next to a radiologist's
 * "No acute infarct." it produces a Findings section that asserts a thing and
 * its negation in the one field a referrer reads, while the Impression the
 * radiologist still has to write contains nothing.
 *
 * The rules, in order:
 *
 *   1. A declared target is authoritative. It is never re-derived from the text,
 *      never keyword-guessed, never re-classified by a model, and never defaulted
 *      to Findings.
 *   2. An unknown target fails closed. A dead Insert button is a visible bug; a
 *      sentence in the wrong clinical field is a medico-legal one.
 *   3. An item that declares AI authorship and no target also fails closed —
 *      that exact pair is what the old default mis-filed.
 *   4. An item with no target keeps the documented existing default (Findings,
 *      `companion`). That is not a guess invented here: the only items the live
 *      rail produces with insertable text are findings sentences — the viewer
 *      measurement line and the prior-study comparison nudge from
 *      `runCopilotAnalysis` — and #840's study-stamp tests pin that insert. The
 *      default is kept because removing it would silently disable the rail's
 *      only working buttons, which is a different change with its own review.
 *   5. Provenance uses CARE's existing vocabulary. `ai-draft` is what accepted AI
 *      prose already uses on the two paths that get it right — `acceptGhostText`
 *      and `applyAiComposerAccepted` — and downstream behaviour keys off it:
 *      `fullReportFormat.ts` reports a field as AI-derived, the ledger panel
 *      badges it "AI", `undoLastAbnormal.ts` excludes it, and it is not a source
 *      that can be stripped as boilerplate. No new label, no migration, no
 *      renaming of anything else.
 *
 * What is deliberately NOT decided here: whether two sentences mean the same
 * thing, which of two conflicting statements wins, whether the Impression is now
 * reconciled with the Findings (that is `mergeField`'s own rule, and this module
 * refuses to claim it), and anything about providers, prompts or models.
 */
import type { InsertSource } from "../reportFieldMerge";

/** The three fields a suggestion can be destined for. Mirrors the merge layer's
 *  report fields; Technique and Clinical History are not Copilot destinations. */
export const COPILOT_TARGET_FIELDS = ["findings", "impression", "recommendation"] as const;

export type CopilotTargetField = (typeof COPILOT_TARGET_FIELDS)[number];

/** The part of an item this decision reads. Deliberately structural, so a
 *  producer cannot satisfy it by accident through an unrelated field. */
export interface CopilotAcceptanceItem {
  /** Declared by the producer that built the suggestion. */
  insertTarget?: unknown;
  /** Declared provenance wins over the `kind` heuristic below. */
  provenance?: InsertSource;
  /** The rail's own item kind; `"ai-draft"` is CARE's AI marker. */
  kind?: unknown;
}

export type CopilotAcceptance =
  | { readonly accepted: true; readonly field: CopilotTargetField; readonly source: InsertSource }
  | {
      readonly accepted: false;
      readonly reason: "invalid-insert-target" | "ai-proposal-without-target";
      readonly detail: string;
    };

const TARGET_SET: readonly string[] = COPILOT_TARGET_FIELDS;

/** True when something about this item declares it as model-authored. */
export function isAiAuthoredCopilotItem(item: CopilotAcceptanceItem): boolean {
  return item.kind === "ai-draft" || item.provenance === "ai-draft";
}

export function resolveCopilotAcceptance(item: CopilotAcceptanceItem): CopilotAcceptance {
  const declared = item.insertTarget;
  const hasDeclared = declared !== undefined && declared !== null && declared !== "";

  if (hasDeclared) {
    if (typeof declared !== "string" || !TARGET_SET.includes(declared)) {
      return {
        accepted: false,
        reason: "invalid-insert-target",
        detail: `a suggestion declared insertTarget "${String(declared)}", which is not one of `
          + "findings | impression | recommendation — nothing was inserted",
      };
    }
    return {
      accepted: true,
      field: declared as CopilotTargetField,
      source: item.provenance ?? (isAiAuthoredCopilotItem(item) ? "ai-draft" : "companion"),
    };
  }

  // No declared destination. For model-authored prose that is precisely the case
  // that used to be guessed wrong, so it stays closed rather than defaulting.
  if (isAiAuthoredCopilotItem(item)) {
    return {
      accepted: false,
      reason: "ai-proposal-without-target",
      detail: "an AI-authored suggestion declared no insertTarget, so the boundary refused to "
        + "guess Findings for it — the producer must say which field it belongs to",
    };
  }

  // Documented backward-compatible default (rule 4 above).
  return { accepted: true, field: "findings", source: item.provenance ?? "companion" };
}
