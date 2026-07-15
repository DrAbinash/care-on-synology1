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
 */

/** True when `phrase` appears verbatim in `text`. Exact so that the chip's
 *  selected state matches what removeClinicalPhrase can actually remove. */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return text.includes(p);
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
