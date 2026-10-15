import { describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";

const BRAIN_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;

type Tile = {
  label: string;
  sentence: string;
  impressionSentence?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  scopeBodyPart?: string;
  scopeModality?: string;
  field?: string;
};

const TILES_BRAIN = (TILES as unknown as Tile[]).filter(
  (t) => t.scopeModality === "MR" && t.field === "findings" && /brain/i.test(t.scopeBodyPart ?? "BRAIN") && t.sentence,
);

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({ modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto" }),
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], voiceComposerObservations: [],
  });
}

function run(order: Tile[]): { text: string; impressions: string[] } {
  reset();
  useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
  for (const [i, tile] of order.entries()) {
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: tile.sentence, impression: tile.impressionSentence },
      templates: { findings: tile.sentence, impression: tile.impressionSentence },
      ownership: {
        anatomicalSection: tile.anatomicalSection,
        conflictGroup: tile.conflictGroup,
        baselineReplaces: tile.baselineReplaces,
      },
      source: "quick-select",
      id: `p${i}`,
      region: tile.scopeBodyPart,
      label: tile.label,
      findingsText: tile.sentence,
    });
  }
  const s = useWorkspace.getState();
  return { text: s.findingsText, impressions: [s.impressionText] };
}

/** The clinical content of a field: its sentences as a multiset, ignoring layout. */
function content(text: string): string[] {
  return splitToSentences(text).map(normalizeForDedupe).filter(Boolean).sort();
}

function sameMultiset(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Named lookups, so a renamed or removed tile fails the test that cites it. */
function byLabel(label: string): Tile {
  const found = TILES_BRAIN.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped MRI Brain findings tile labelled ${label}`);
  return found;
}

/**
 * The measured register. Each entry is `first clicked <> second clicked`, and a listed
 * pair prints DIFFERENT clinical content depending on which tile was clicked first.
 * The set is pinned, not just the count, so a new pair cannot appear while an old one
 * is fixed. Retirement of a baseline normal is the intended direction; a contribution
 * that silently revives or deletes a statement is not. Lowering this list is v4 Stage
 * C, and when it empties the register must be deleted rather than left at zero, so that
 * a regression has to be re-added deliberately.
 *
 * 2026-10-15, on `origin/main` = `1841668b` + the Stage B catalogue: nine pairs, from
 * three mechanisms — a normal clicked last re-adding its sentence beside the abnormal
 * already on the page (six, including `Subarachnoid hemorrhage`, where the report then
 * stated both "No evidence of acute infarct, hemorrhage, or mass lesion" and "Acute
 * subarachnoid hemorrhage"), an abnormal clicked last being evicted by the normal that
 * follows it (`Hydrocephalus`, `Demyelinating lesion`), and one abnormal evicting
 * another (`Glioma recurrence` + `Cerebral edema`: the post-resection tumour sentence
 * disappeared when edema was clicked second).
 *
 * 2026-10-16, on the Stage C branch merged with `origin/main` = `012dd08d`:
 * `tiles=29 pairs=406 identical=345 sequence-only=51 content-within-group=3
 * content-across-groups=7`. The two evictions are gone: the undeclared-pair fence prints
 * both tiles and evicts neither where nothing declared the pair, and the level-scoped
 * normal suppression stops a clicked normal from retiring a statement it does not
 * falsify. Both are named and asserted in the second `it` below rather than merely
 * dropped from this list, so their regression fails by name.
 *
 * The seven that remain are all the first mechanism — a baseline normal clicked LAST
 * re-adding its sentence next to the abnormal already on the page. Retiring them needs
 * the suppression half to treat a clicked normal as a claim to test rather than a claim
 * to insert: the next slice, recorded in
 * `docs/clinical/V4_STAGE_C_INTEGRATION_MAP.md` §13.
 */
const CROSS_GROUP_ORDER_DEPENDENCE_REGISTER: readonly string[] = [
  "Normal brain parenchyma (brain_parenchyma) <> Cerebral edema (edema)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 1 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 2 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Fazekas 3 (fazekas)",
  "Normal brain parenchyma (brain_parenchyma) <> Lacunar infarcts (lacunar)",
  "Normal brain parenchyma (brain_parenchyma) <> Subarachnoid hemorrhage (subarachnoid hemorrhage)",
  "Normal ventricles (ventricular) <> Hydrocephalus (hydrocephalus)",
];

/** Retired by Stage C, kept named here so the claim is tested and not just recorded. */
const RETIRED_ORDER_DEPENDENCE: readonly [string, string][] = [
  ["Normal brain parenchyma", "Demyelinating lesion"],
  ["Glioma recurrence", "Cerebral edema"],
];

/**
 * RATCHET — shrink-only. Same content in a different sequence: a presentation defect,
 * not a clinical one, and §16's ordinal metadata is what closes it (v4 Stage D).
 */
const ORDERED_SEQUENCE_DEBT_CEILING = 51;

describe("Quick Select click-order determinism (v4 Stage C census)", () => {
  it("lets no tile change what an unrelated tile says when the click order changes", () => {
    const crossGroup: string[] = [];
    const withinGroup: string[] = [];
    const sequenceDiffers: string[] = [];
    let pairs = 0;
    for (let i = 0; i < TILES_BRAIN.length; i++) {
      for (let j = i + 1; j < TILES_BRAIN.length; j++) {
        const a = TILES_BRAIN[i]!, b = TILES_BRAIN[j]!;
        const fwd = run([a, b]);
        const rev = run([b, a]);
        pairs++;
        if (fwd.text === rev.text) continue;
        const ca = content(fwd.text), cb = content(rev.text);
        if (sameMultiset(ca, cb)) {
          sequenceDiffers.push(`${a.label} <> ${b.label}`);
          continue;
        }
        const entry = `${a.label} (${a.conflictGroup || "no group"}) <> ${b.label} (${b.conflictGroup || "no group"})`;
        // Two tiles in one conflict group are mutually exclusive by declaration, and the
        // later click is the radiologist's intent: the grade they chose last is the grade
        // that prints. That is a decision, not a loss.
        if (a.conflictGroup && a.conflictGroup === b.conflictGroup) withinGroup.push(entry);
        else crossGroup.push(entry);
      }
    }
    console.log(
      `CENSUS tiles=${TILES_BRAIN.length} pairs=${pairs} identical=${pairs - sequenceDiffers.length - crossGroup.length - withinGroup.length} ` +
      `sequence-only=${sequenceDiffers.length} content-within-group=${withinGroup.length} content-across-groups=${crossGroup.length}`,
    );

    expect(
      crossGroup.sort(),
      `pairs whose printed findings differ by click order across conflict groups:\n    ${crossGroup.join("\n    ")}`,
    ).toEqual([...CROSS_GROUP_ORDER_DEPENDENCE_REGISTER].sort());
    expect(
      sequenceDiffers.length,
      `order-dependent SEQUENCE debt grew: ${sequenceDiffers.length} > ${ORDERED_SEQUENCE_DEBT_CEILING}\n    ${sequenceDiffers.join("\n    ")}`,
    ).toBeLessThanOrEqual(ORDERED_SEQUENCE_DEBT_CEILING);
    // The register is only meaningful if the run can see the pairs at all.
    expect(withinGroup.length, "same-group pairs, where last-click-wins is intended").toBeGreaterThan(0);
  });

  it("keeps the pairs Stage C retired fixed, by name rather than by absence", () => {
    // A register that shrinks proves the pair left the measured set; it does not name
    // the pair it dropped, so a later change could re-break it and the census would
    // simply report it as a new entry against a list that no longer mentions it. These
    // two are pinned directly: both tiles still exist in the shipped library, both
    // sentences are still printed, and the two click orders produce the same page.
    for (const [firstLabel, secondLabel] of RETIRED_ORDER_DEPENDENCE) {
      const a = byLabel(firstLabel), b = byLabel(secondLabel);
      const fwd = run([a, b]), rev = run([b, a]);
      expect(
        fwd.text,
        `${firstLabel} then ${secondLabel} must print the same findings as the other order`,
      ).toBe(rev.text);
      expect(
        sameMultiset(content(fwd.text), content(rev.text)),
        `${firstLabel} + ${secondLabel}: the two orders must carry the same sentences`,
      ).toBe(true);
      // The clinical half: neither tile's own statement is the one that disappears.
      const printed = normalizeForDedupe(fwd.text);
      for (const tile of [a, b]) {
        expect(
          printed.includes(normalizeForDedupe(tile.sentence)),
          `"${tile.label}" is no longer printed when it is clicked onto a report that already `
          + `has "${tile === a ? b.label : a.label}" — that is the eviction this pair had`,
        ).toBe(true);
      }
    }
  });

  it("measures the census population from the shipped library, not from a hand-kept count", () => {
    expect(TILES_BRAIN.length).toBeGreaterThan(20);
    expect(pairsOf(TILES_BRAIN.length)).toBe((TILES_BRAIN.length * (TILES_BRAIN.length - 1)) / 2);
  });
});

function pairsOf(n: number): number {
  return (n * (n - 1)) / 2;
}
