/**
 * The Quick Select parameter contract — what one tile promises, and what the
 * radiologist has to have chosen before that promise can be kept.
 *
 * A Quick Select tile is a template. `fillTemplate` (`lib/abnormalityEngine.ts`)
 * understands five tokens — `{side} {severity} {chronicity} {level} {value}` —
 * and the substitution path the store already runs (`applySideToIncoming`) can
 * resolve exactly two of them: the side and, since this contract existed, the
 * severity. The other three belong to surfaces that fill them before the store
 * is ever called (the structured-format engine, macro variables, measurement
 * insertion).
 *
 * So the contract is narrow and it is checkable: **if a tile's own text asks for
 * a side or a severity, that value must have been chosen explicitly, or the tile
 * writes nothing.** Not "writes the sentence with the token deleted" —
 * `fillTemplate` silently removes an unfilled token together with its
 * grammatical chunk, so "{severity} {side} neural foraminal stenosis at L4-L5"
 * becomes a fluent, unfounded "Left neural foraminal stenosis at L4-L5". The
 * question the tile asked disappears along with the answer, and nobody can see
 * that it was ever asked. That deletion is why the check runs on the tile's
 * source text rather than on the substituted result.
 *
 * Two failure modes this replaces, both measured at `641f5a90`:
 *
 *   1. The Quick Select strip never passed a side, so `applySideToIncoming`
 *      returned the template untouched (`if (!side) return incoming`) and ten
 *      shipped tiles wrote literal braces into Findings, Impression and the
 *      Observation Ledger — three of them `category: "critical"`.
 *   2. The chocolate-box macros (Settings → Radiology → Quick Select, inserted
 *      through the same boundary with `source: "macro"`) passed
 *      `side: ownership.supportsLaterality ? undefined : ""` — deliberately no
 *      side for a tile that requires one — so the same braces reached the page.
 *
 * Both surfaces now either resolve the parameter from a value the radiologist
 * picked, or refuse before the first write. Refusing is fail-closed by design:
 * the alternative, guessed from the token's own default, would put "left" or
 * "mild" into a report nobody chose.
 *
 * Pure apart from the refusal notice, and deliberately not wired into
 * `mergeField` / `setField`: text a radiologist types is first-class, braces and
 * all (an unfilled `___` blank or their own shorthand is not this contract's
 * business).
 */
import { toast } from "@/hooks/use-toast";
import type { PathologyIncoming } from "@/lib/pathologyPatch";
import type { Side } from "@/lib/sideSwap";

/** The parameters a Quick Select tile can require and this boundary can resolve. */
export type QuickSelectParameterName = "side" | "severity";

export const QUICK_SELECT_PARAMETERS: readonly QuickSelectParameterName[] = ["side", "severity"];

/**
 * The write sources this contract owns. `quick-select` is the tile strip;
 * `macro` is the chocolate-box tile set, which is edited from the same Settings
 * page and inserted through the same boundary — see the module header. Every
 * other source keeps its own resolution semantics.
 */
export const QUICK_SELECT_PARAMETER_SOURCES = ["quick-select", "macro"] as const;

export function isQuickSelectSource(source: string | undefined): boolean {
  return (QUICK_SELECT_PARAMETER_SOURCES as readonly string[]).includes(source ?? "");
}

/** The three severity words `fillTemplate` can render; anything else is not a value. */
export const QUICK_SELECT_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type QuickSelectSeverity = (typeof QUICK_SELECT_SEVERITIES)[number];

const QUICK_SELECT_TOKEN = /\{(side|severity)\}/g;

/** Which of the two contract parameters one piece of template text asks for. */
export function quickSelectParametersIn(text: string | undefined): Set<QuickSelectParameterName> {
  const found = new Set<QuickSelectParameterName>();
  if (!text) return found;
  for (const match of text.matchAll(QUICK_SELECT_TOKEN)) {
    found.add(match[1] as QuickSelectParameterName);
  }
  return found;
}

/** True when the text asks for something the radiologist has to supply. */
export function requiresQuickSelectParameter(text: string | undefined): boolean {
  return quickSelectParametersIn(text).size > 0;
}

export type QuickSelectParameterValues = {
  side?: Side | "";
  severity?: string;
};

/**
 * The parameters the sections ask for that were NOT explicitly supplied.
 *
 * `sections` is whatever is about to be written — the tile's Findings, Impression
 * and Recommendation sentences together, because one tile press commits all three
 * and a half-resolved tile is the contradiction the payload module already
 * prevents. An empty/whitespace value counts as not supplied: there is no default
 * side and no default severity here or anywhere else in this module.
 */
export function unresolvedQuickSelectParameters(
  sections: Record<string, string | undefined> | PathologyIncoming,
  values: QuickSelectParameterValues,
): QuickSelectParameterName[] {
  const required = new Set<QuickSelectParameterName>();
  for (const text of Object.values(sections as Record<string, unknown>)) {
    for (const name of quickSelectParametersIn(typeof text === "string" ? text : undefined)) {
      required.add(name);
    }
  }
  const unresolved: QuickSelectParameterName[] = [];
  if (required.has("side") && !isSuppliedSide(values.side)) unresolved.push("side");
  if (required.has("severity") && !isSuppliedSeverity(values.severity)) unresolved.push("severity");
  return unresolved;
}

function isSuppliedSide(side: Side | "" | undefined): boolean {
  return side === "left" || side === "right" || side === "bilateral";
}

function isSuppliedSeverity(severity: string | undefined): boolean {
  const v = (severity ?? "").trim().toLowerCase();
  return (QUICK_SELECT_SEVERITIES as readonly string[]).includes(v);
}

/** A severity that satisfies the contract, normalised for the substitution path. */
export function resolvedQuickSelectSeverity(severity: string | undefined): QuickSelectSeverity | "" {
  const v = (severity ?? "").trim().toLowerCase();
  return (QUICK_SELECT_SEVERITIES as readonly string[]).includes(v)
    ? (v as QuickSelectSeverity)
    : "";
}

const LABELS: Record<QuickSelectParameterName, string> = {
  side: "side (left / right / bilateral)",
  severity: "severity (mild / moderate / severe)",
};

/**
 * Says out loud why a tile did not land, in the same voice the signed-report
 * refusal already uses. Without this the radiologist clicks, the box does
 * nothing, and the only evidence is a console line — the exact failure the
 * refusal notice was written for.
 */
export function announceQuickSelectParameterRefusal(
  unresolved: QuickSelectParameterName[],
): void {
  if (unresolved.length === 0) return;
  const what = unresolved.map((name) => LABELS[name]).join(" and ");
  toast({
    title: unresolved.length === 1
      ? `Nothing was applied — choose the ${unresolved[0]}`
      : "Nothing was applied — choose the side and severity",
    description: `This Quick Select sentence needs its ${what} before it can be written. Pick ${unresolved.length === 1 ? "it" : "them"} in the Quick Select bar and click the tile again. Nothing in the report was changed.`,
    variant: "destructive",
    duration: 8000,
  });
}
