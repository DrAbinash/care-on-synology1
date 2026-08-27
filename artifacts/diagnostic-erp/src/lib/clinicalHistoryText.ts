/**
 * clinicalHistoryText — pure helpers for toggling Clinical History quick-select
 * phrases into and out of the free-text Clinical History field.
 *
 * Safety rules encoded here (see the Reporting Workspace clinical-history chips):
 *   - Manually typed text is never clobbered — append only adds, remove only
 *     deletes an exact previously-inserted phrase and tidies ONLY the seam it
 *     leaves behind (never reflows the rest of the field, so line breaks and
 *     intentional spacing the radiologist typed elsewhere are preserved).
 *   - The same exact phrase is never inserted twice (duplicate-safe).
 *   - "present" (drives the chip's selected state) and "removable" use the SAME
 *     exact match, so a highlighted chip can always be toggled back off.
 *   - Removal that can't be done cleanly (the phrase was edited away) is a
 *     no-op, leaving the field exactly as the radiologist left it.
 *   - Laterality: templates may include `{side}`; resolved phrases are what
 *     appear in the field (reuse fillTemplate / Side from abnormalityEngine).
 */

import { fillTemplate, EMPTY_INSTANCE } from "./abnormalityEngine";
import type { Side } from "./sideSwap";

export type { Side };

const HISTORY_SIDES: Side[] = ["right", "left", "bilateral"];

/** True when `phrase` appears verbatim in `text`. Exact so that the chip's
 *  selected state matches what removeClinicalPhrase can actually remove. */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return text.includes(p);
}

/** True when the chip template asks for laterality via `{side}`. */
export function historyTemplateNeedsSide(template: string): boolean {
  return /\{side\}/i.test(String(template ?? ""));
}

/** Resolve a chip template with an optional side (no-op when no `{side}`). */
export function resolveHistoryPhrase(template: string, side: Side | "" = ""): string {
  const raw = String(template ?? "").trim();
  if (!raw) return "";
  if (!historyTemplateNeedsSide(raw)) return raw;
  return fillTemplate(raw, { ...EMPTY_INSTANCE, side }).trim();
}

/** All concrete phrases a laterality template might have inserted. */
export function historyPhraseVariants(template: string): string[] {
  const raw = String(template ?? "").trim();
  if (!raw) return [];
  if (!historyTemplateNeedsSide(raw)) return [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const side of HISTORY_SIDES) {
    const phrase = resolveHistoryPhrase(raw, side);
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
  }
  return out;
}

/** Selected when any exact inserted variant of this chip is present. */
export function hasHistoryChipContribution(text: string, template: string): boolean {
  return historyPhraseVariants(template).some((p) => hasPhrase(text, p));
}

/**
 * Toggle a history chip contribution. When the template needs `{side}` and
 * none is chosen yet, returns `{ needsSide: true }` without mutating text.
 * Safe removal only deletes an exact prior contribution.
 */
export function toggleHistoryChipContribution(
  text: string,
  template: string,
  side: Side | "" = "",
): { next: string; needsSide: boolean; active: boolean } {
  const raw = String(template ?? "").trim();
  if (!raw) return { next: text, needsSide: false, active: false };

  const variants = historyPhraseVariants(raw);
  const present = variants.find((p) => hasPhrase(text, p));
  if (present) {
    return { next: removeClinicalPhrase(text, present), needsSide: false, active: false };
  }

  if (historyTemplateNeedsSide(raw) && !side) {
    return { next: text, needsSide: true, active: false };
  }

  const phrase = resolveHistoryPhrase(raw, side);
  return { next: appendClinicalPhrase(text, phrase), needsSide: false, active: true };
}

/**
 * Append `phrase` to `text` with sensible sentence spacing. Returns `text`
 * unchanged when the phrase is already present (duplicate-safe). Preserves any
 * trailing whitespace/line break the radiologist typed (the phrase is added
 * after it) rather than rewriting it.
 */
export function appendClinicalPhrase(text: string, phrase: string): string {
  const p = phrase.trim();
  if (!p) return text;
  if (hasPhrase(text, p)) return text;
  if (!text.trim()) return p;
  // Field already ends in whitespace (space or newline) → append directly,
  // keeping the user's spacing/line break intact.
  if (/\s$/.test(text)) return text + p;
  // Otherwise separate sentences: a lone space after a terminator, else ". ".
  const sep = /[.!?;:]$/.test(text) ? " " : ". ";
  return text + sep + p;
}

/**
 * Remove a previously-inserted `phrase` from `text`, tidying ONLY the seam left
 * where it was removed (not the rest of the field). Only an exact occurrence is
 * removed; if the phrase has been edited (no exact match) the text is returned
 * untouched, so a radiologist's manual edits are never destroyed.
 */
export function removeClinicalPhrase(text: string, phrase: string): string {
  const p = phrase.trim();
  if (!p) return text;
  const idx = text.indexOf(p);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const after = text.slice(idx + p.length);
  let joined: string;
  if (before && /\s$/.test(before) && /^\s/.test(after)) {
    // Whitespace on both sides of the removed phrase — keep `before`'s
    // separator, drop `after`'s leading whitespace so the seam is single.
    joined = before + after.replace(/^\s+/, "");
  } else if (!before) {
    // Phrase was at the very start — drop the separator that followed it.
    joined = after.replace(/^\s+/, "");
  } else {
    joined = before + after;
  }
  // Trim only the outer ends; internal spacing and line breaks are preserved.
  return joined.trim();
}
