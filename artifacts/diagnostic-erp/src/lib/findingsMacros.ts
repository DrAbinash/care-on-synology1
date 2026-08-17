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
//
// Built-in tiles ship as defaults. Radiologists can add / edit / delete
// boxes from the reporting workspace (pencil + blank add box) and from
// Settings → Radiology → Quick Select. Customisations persist in
// localStorage (with an in-memory fallback for tests / private mode).

export type ChocolateTile = {
  id: string;
  label: string;
  text: string;
  custom?: boolean;
};
export type ChocolateBoxSet = { key: string; label: string; tiles: ChocolateTile[] };

type StoredSets = Record<string, ChocolateTile[]>;

const BRAIN_SET: ChocolateBoxSet = {
  key: "brain",
  label: "Brain",
  tiles: [
    {
      id: "brain-infarct",
      label: "Infarct",
      text: "Focal area of restricted diffusion with corresponding T2/FLAIR hyperintensity in the [location], consistent with an acute infarct involving the [vascular territory] territory.",
    },
    {
      id: "brain-senile",
      label: "Senile Changes",
      text: "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system, in keeping with senile/involutional changes. No focal mass lesion or acute infarct.",
    },
    {
      id: "brain-pituitary",
      label: "Pituitary Tumor",
      text: "The pituitary gland is enlarged, measuring approximately [size] cm, with a [homogeneous/heterogeneous] lesion suggestive of a pituitary macroadenoma. [Optic chiasm/cavernous sinus] involvement [is/is not] noted.",
    },
    {
      id: "brain-normal",
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
      id: "spine-disc-bulge",
      label: "Disc Bulge",
      text: "Diffuse disc bulge at the [Level] level indenting the anterior thecal sac, [with/without] impingement on the [exiting nerve root].",
    },
    {
      id: "spine-desiccation",
      label: "Disc Desiccation",
      text: "Loss of normal T2 signal intensity (desiccation) of the intervertebral disc at [Level], in keeping with early degenerative disc disease.",
    },
    {
      id: "spine-l1-2",
      label: "L1-2 Level",
      text: "At the L1-2 level: vertebral body height and alignment are maintained. Disc space is [normal/reduced]. [Findings].",
    },
    {
      id: "spine-normal",
      label: "Normal Spine",
      text: "Vertebral body heights and alignment are maintained throughout. No disc bulge, herniation, or significant canal/foraminal stenosis identified. Visualized cord/cauda equina and paraspinal soft tissues are unremarkable.",
    },
  ],
};

const SETS: ChocolateBoxSet[] = [BRAIN_SET, SPINE_SET];

const BRAIN_RE = /\b(brain|head|cerebr|cranial|intracranial)\b/i;
const SPINE_RE = /\b(spine|spinal|cervical|lumbar|dorsal|thoracic|lumbosacral|whole\s*spine)\b/i;

const STORAGE_KEY = "care-rad-chocolate-boxes-v1";
export const CHOCOLATE_BOX_CHANGED = "care:chocolate-box-changed";

let memoryStore: StoredSets = {};

function uid(): string {
  return `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function slug(value: string): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "custom";
}

function readLocal(): StoredSets | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSets;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStore(): StoredSets {
  return { ...memoryStore, ...(readLocal() ?? {}) };
}

function writeStore(store: StoredSets): void {
  memoryStore = { ...store };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }
  } catch {
    /* private mode / quota */
  }
  try {
    window.dispatchEvent(new Event(CHOCOLATE_BOX_CHANGED));
  } catch {
    /* SSR / tests */
  }
}

export function resetAllChocolateBoxes(): void {
  memoryStore = {};
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function catalogSetForKey(key: string): ChocolateBoxSet | undefined {
  return SETS.find((s) => s.key === key);
}

export function defaultsForKey(key: string): ChocolateTile[] {
  return (catalogSetForKey(key)?.tiles ?? []).map((t) => ({ ...t }));
}

export function loadChocolateTiles(key: string): ChocolateTile[] {
  const stored = readStore()[key];
  if (Array.isArray(stored)) return stored.map((t) => ({ ...t }));
  return defaultsForKey(key);
}

export function saveChocolateTiles(key: string, tiles: ChocolateTile[]): void {
  const store = readStore();
  store[key] = tiles.map((t) => ({ ...t }));
  writeStore(store);
}

export function upsertChocolateTile(
  key: string,
  input: { id?: string; label: string; text: string },
): ChocolateTile {
  const label = input.label.trim();
  const text = input.text.trim();
  const tiles = loadChocolateTiles(key);
  if (input.id) {
    const i = tiles.findIndex((t) => t.id === input.id);
    if (i >= 0) {
      tiles[i] = { ...tiles[i], label, text };
      saveChocolateTiles(key, tiles);
      return tiles[i];
    }
  }
  const next: ChocolateTile = { id: input.id || uid(), label, text, custom: true };
  tiles.push(next);
  saveChocolateTiles(key, tiles);
  return next;
}

export function deleteChocolateTile(key: string, id: string): void {
  saveChocolateTiles(
    key,
    loadChocolateTiles(key).filter((t) => t.id !== id),
  );
}

export function resetChocolateTiles(key: string): void {
  const store = readStore();
  delete store[key];
  writeStore(store);
}

/**
 * Picks the catalog macro set matching the active study, or null if neither
 * brain nor spine. `tiles` here are the built-in defaults — call
 * `loadChocolateTiles(set.key)` (or `resolvedChocolateBoxSet`) for the
 * workstation's edited list.
 *
 * `region` is the region the radiologist selected in the workspace's Region /
 * Study / Protocol section and wins over the DICOM StudyDescription.
 */
export function chocolateBoxSetFor(
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
  region?: string | null,
): ChocolateBoxSet | null {
  const selected = region ?? "";
  if (BRAIN_RE.test(selected)) return BRAIN_SET;
  if (SPINE_RE.test(selected)) return SPINE_SET;
  const desc = `${modality ?? ""} ${studyDescription ?? ""}`;
  if (BRAIN_RE.test(desc)) return BRAIN_SET;
  if (SPINE_RE.test(desc)) return SPINE_SET;
  return null;
}

/**
 * Always returns a set so Findings can show the blank "add macro" box even
 * when the study is not Brain/Spine. Custom keys persist independently.
 */
export function resolvedChocolateBoxSet(
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
  region?: string | null,
): ChocolateBoxSet {
  const catalog = chocolateBoxSetFor(modality, studyDescription, region);
  if (catalog) {
    return { ...catalog, tiles: loadChocolateTiles(catalog.key) };
  }
  const label = region?.trim() || "Findings";
  const key = slug(label);
  return { key, label, tiles: loadChocolateTiles(key) };
}

export function allChocolateBoxSets(): ChocolateBoxSet[] {
  return SETS;
}

export function listedChocolateBoxSets(): ChocolateBoxSet[] {
  const storedKeys = Object.keys(readStore());
  const extras = storedKeys.filter((k) => !SETS.some((s) => s.key === k));
  return [
    ...SETS.map((s) => ({ ...s, tiles: loadChocolateTiles(s.key) })),
    ...extras.map((k) => ({ key: k, label: k, tiles: loadChocolateTiles(k) })),
  ];
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
