// "Chocolate Box" quick-macro engine for the freeform Findings & Observation
// editor — context-aware macro sets keyed off study modality/description,
// each tile's text inserted at the live cursor position (see
// insertAtCursor below), with any [bracketed] variable auto-selected for
// immediate typing/dictation overwrite.
//
// These are DRAFT narrative starting points, same spirit as every other
// template/macro/snippet mechanism already in this workspace (Templates
// tab, Normal Shortcuts, applyMacro) — inserted text is always reviewed
// and edited by the radiologist before Finalize, never auto-signed.

export type ChocolateTile = { label: string; text: string };
export type ChocolateBoxSet = { key: string; label: string; tiles: ChocolateTile[] };

const BRAIN_SET: ChocolateBoxSet = {
  key: "brain",
  label: "Brain",
  tiles: [
    {
      label: "Infarct",
      text: "Focal area of restricted diffusion with corresponding T2/FLAIR hyperintensity in the [location], consistent with an acute infarct involving the [vascular territory] territory.",
    },
    {
      label: "Senile Changes",
      text: "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system, in keeping with senile/involutional changes. No focal mass lesion or acute infarct.",
    },
    {
      label: "Pituitary Tumor",
      text: "The pituitary gland is enlarged, measuring approximately [size] cm, with a [homogeneous/heterogeneous] lesion suggestive of a pituitary macroadenoma. [Optic chiasm/cavernous sinus] involvement [is/is not] noted.",
    },
    {
      label: "Normal Brain",
      text: "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified. Ventricles and sulci are normal for age.",
    },
  ],
};

const SPINE_SET: ChocolateBoxSet = {
  key: "spine",
  label: "Spine",
  tiles: [
    {
      label: "Disc Bulge",
      text: "Diffuse disc bulge at the [Level] level indenting the anterior thecal sac, [with/without] impingement on the [exiting nerve root].",
    },
    {
      label: "Disc Desiccation",
      text: "Loss of normal T2 signal intensity (desiccation) of the intervertebral disc at [Level], in keeping with early degenerative disc disease.",
    },
    {
      label: "L1-2 Level",
      text: "At the L1-2 level: vertebral body height and alignment are maintained. Disc space is [normal/reduced]. [Findings].",
    },
    {
      label: "Normal Spine",
      text: "Vertebral body heights and alignment are maintained throughout. No disc bulge, herniation, or significant canal/foraminal stenosis identified. Visualized cord/cauda equina and paraspinal soft tissues are unremarkable.",
    },
  ],
};

const SETS: ChocolateBoxSet[] = [BRAIN_SET, SPINE_SET];

const BRAIN_RE = /\b(brain|head|cerebr|cranial|intracranial)\b/i;
const SPINE_RE = /\b(spine|spinal|cervical|lumbar|dorsal|thoracic|lumbosacral|whole\s*spine)\b/i;

/** Picks the macro tile set matching the active study, or null if neither brain nor spine. */
export function chocolateBoxSetFor(modality: string | null | undefined, studyDescription: string | null | undefined): ChocolateBoxSet | null {
  const desc = `${modality ?? ""} ${studyDescription ?? ""}`;
  if (BRAIN_RE.test(desc)) return BRAIN_SET;
  if (SPINE_RE.test(desc)) return SPINE_SET;
  return null;
}

export function allChocolateBoxSets(): ChocolateBoxSet[] {
  return SETS;
}

/**
 * Splices `insertText` into `currentValue` at the given textarea's cursor
 * (falls back to appending at the end if the element/selection isn't
 * available). Calls `onChange` with the new full value, then — after
 * React has re-rendered the controlled textarea with that value — restores
 * focus and either:
 *   - selects the FIRST `[bracketed]` variable in the inserted text (so the
 *     radiologist can immediately type or voice-dictate over it), or
 *   - places a plain caret right after the inserted text.
 *
 * This is the one cursor-aware insertion primitive shared by the macro
 * engine and can also back voice-dictation "insert at cursor" (currently
 * whole-string append everywhere in this codebase — see the `applyMacro`/
 * VoiceDictationButton call sites, which append rather than splice).
 */
export function insertAtCursor(
  el: HTMLTextAreaElement | null,
  currentValue: string,
  insertText: string,
  onChange: (next: string) => void,
) {
  const start = el?.selectionStart ?? currentValue.length;
  const end = el?.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  // Keep inserted macros visually separated from existing text with a
  // blank line, matching the spacing convention applyMacro() already uses
  // — but only when there's preceding text to separate from.
  const separator = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const spliced = separator + insertText;
  const next = before + spliced + after;
  onChange(next);

  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const bracketMatch = spliced.match(/\[[^\]]*\]/);
    if (bracketMatch && bracketMatch.index != null) {
      const selStart = start + bracketMatch.index;
      const selEnd = selStart + bracketMatch[0].length;
      el.setSelectionRange(selStart, selEnd);
    } else {
      const caret = start + spliced.length;
      el.setSelectionRange(caret, caret);
    }
  });
}
