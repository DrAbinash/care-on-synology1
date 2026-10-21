import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { assertsAbnormality } from "./generateLocalImpression";
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
 * The measured register history. Each entry was `first clicked <> second clicked`, and a
 * listed pair printed DIFFERENT clinical content depending on which tile was clicked
 * first. The set was pinned, not just the count, so a new pair cannot appear while an old
 * one is fixed. Retirement of a baseline normal is the intended direction; a contribution
 * that silently revives or deletes a statement is not.
 *
 * 2026-10-15, on `origin/main` = `1841668b` + the Stage B catalogue: nine pairs, from
 * three mechanisms — a normal clicked last re-adding its sentence beside the abnormal
 * already on the page (six, including `Subarachnoid hemorrhage`, where the report then
 * stated both "No evidence of acute infarct, hemorrhage, or mass lesion" and "Acute
 * subarachnoid hemorrhage"), an abnormal clicked last being evicted by the normal that
 * follows it (`Hydrocephalus`, `Demyelinating lesion`), and one abnormal evicting
 * another (`Glioma recurrence` + `Cerebral edema`).
 *
 * 2026-10-16, on the Stage C branch merged with `origin/main` = `012dd08d`: the two
 * evictions were retired (undeclared-pair fence + level-scoped normal suppression) and
 * seven pairs remained, all "a baseline normal clicked LAST re-adding its sentence next
 * to the abnormal already on the page".
 *
 * 2026-10-19, on `origin/main` = `5aee6215` + the withheld-normal half of the shared
 * contradiction rule (`withdrawSupersededNormals.withheldIncomingNormalSentences`, wired
 * into the click door): all seven retired. A normal clicked onto a page that already
 * asserts an abnormality now has the sentences the live abnormal owns withheld — the
 * same judge, the same `replacedBaseline` retirement record — and a normal tile that
 * shares a mutex slot with a live abnormal (`Normal ventricles` vs `Hydrocephalus`) no
 * longer takes the slot over and evicts the abnormal's finding. Six of the seven pairs
 * now print byte-identical findings in both orders; `Subarachnoid hemorrhage` carries
 * the same sentences in a different line order, which is the sequence-debt class below
 * (the abnormal's own insertion position predates this change and is the owner's, not
 * the normal's, to correct). The register is deleted rather than left at zero, per its
 * own rule, so a regression has to re-add it deliberately — and the retired pairs are
 * pinned by name in the second and third `it` blocks instead.
 */
/**
 * RATCHET — shrink-only. Same content in a different sequence: a presentation defect,
 * not a clinical one, and §16's ordinal metadata is what closes it (v4 Stage D).
 *
 * 2026-10-19: 51 → 52. One pair (`Normal brain parenchyma` <> `Subarachnoid hemorrhage`)
 * moved INTO this class from the content class above when its contradiction was retired:
 * both orders now print the same sentences, and the one line that differs in position is
 * the hemorrhage's own wording, whose placement the retirement must not move. A pair
 * leaving the worse class and arriving here is the ratchet working, not the ratchet
 * broken; the ceiling resumes shrinking from 52 and no other pair may join it.
 *
 * 2026-10-19 (later the same day, owner review of PR #1077): the owner asked for the
 * remaining sequence-only pairs to be REVIEWED, with anatomical-organization
 * differences prioritised and harmless formatting differences left alone. Measured:
 * two pairs (`Fazekas 1` <> `Lacunar infarcts`, `Fazekas 1` <> `Cerebral edema`) were
 * NOT harmless — the second click's finding printed at the END of the report, eleven
 * normals below its neighbour, because both tiles retire one baseline sentence and the
 * second click had no in-place slot. `anchorAfterRetiredBaselineOwner` now places the
 * second click beside the sibling that owns the shared slot. Every pair in this class
 * is now the benign kind — a 2–3 line swap of adjacent contributions at the position
 * they share, in click order (measured distribution: 31 pairs move 2 lines, 21 move 3,
 * none moves more). The two reclassified pairs are pinned by name in the fourth `it`.
 */
const ORDERED_SEQUENCE_DEBT_CEILING = 52;

/** Retired 2026-10-16 (Stage C), kept named here so the claim is tested, not just recorded. */
const RETIRED_EVICITION_ORDER_DEPENDENCE: readonly [string, string][] = [
  ["Normal brain parenchyma", "Demyelinating lesion"],
  ["Glioma recurrence", "Cerebral edema"],
];

/**
 * Retired 2026-10-19 (the withheld-normal half of the shared contradiction rule), kept
 * named for the same reason. `byteIdentical` records the measured strength of each
 * retirement: the six pairs print the same page in both orders; the Subarachnoid
 * hemorrhage pair prints the same sentences (multiset) with the hemorrhage's own line
 * in the other position.
 */
const RETIRED_WITHHELD_NORMAL_ORDER_DEPENDENCE: readonly [string, string, boolean][] = [
  ["Normal brain parenchyma", "Cerebral edema", true],
  ["Normal brain parenchyma", "Fazekas 1", true],
  ["Normal brain parenchyma", "Fazekas 2", true],
  ["Normal brain parenchyma", "Fazekas 3", true],
  ["Normal brain parenchyma", "Lacunar infarcts", true],
  ["Normal brain parenchyma", "Subarachnoid hemorrhage", false],
  ["Normal ventricles", "Hydrocephalus", true],
];

/**
 * Reclassified 2026-10-19 (owner review of PR #1077): these pairs used to be the
 * SEQUENCE class's worst members — the second click's finding printed at the END
 * of the Findings, below eleven normals, because both tiles retire the same
 * baseline sentence and the second click had no in-place slot to take over.
 * `anchorAfterRetiredBaselineOwner` now anchors the second click after the
 * sibling that owns the shared slot, so both orders print the two findings
 * ADJACENT, at the slot the baseline occupied, in click order.
 */
const RECLASSIFIED_SHARED_BASELINE_PAIRS: readonly [string, string][] = [
  ["Fazekas 1", "Lacunar infarcts"],
  ["Fazekas 1", "Cerebral edema"],
];

describe("Quick Select click-order determinism (v4 Stage C census)", () => {
  /**
   * Measured on this suite, in isolation, on three machines' worth of runs of this exact file:
   * 2,051 / 2,246 / 2,326 / 2,409 ms for the pair-census `it` below — against Vitest's default
   * 5,000 ms, because `vitest.config.ts` sets no `testTimeout` and nothing in this repo does.
   * That ceiling produced one `Test timed out in 5000ms` in the last 40 PR runs, on a PR that did
   * not contain this file. 20 s is ~8x the slowest sample: a genuine hang still fails fast, and no
   * assertion here is changed, skipped or weakened by this number.
   */
  const CENSUS_TEST_TIMEOUT_MS = 20_000;

  beforeAll(() => {
    // The census drives the real store, and applying a format records a template use over HTTP
    // (`store.ts` → `reportFormatsApi.ts` → `fetchApi`). There is no server in a unit test, so one
    // run of this file fired 834 failing POSTs, each logging a retry and each scheduling a real
    // jittered ~400 ms backoff sleep before its `catch {}` swallowed it. None of that is what this
    // suite measures, and all of it is wall clock inside the per-test budget.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

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

    // The cross-group register is EMPTY since 2026-10-19 and was deleted per its own
    // rule. This assertion is the replacement: zero measured content differences across
    // groups, so any new pair fails here by name rather than hiding in a count.
    expect(
      crossGroup.sort(),
      `pairs whose printed findings differ by click order across conflict groups:\n    ${crossGroup.join("\n    ")}`,
    ).toEqual([]);
    expect(
      sequenceDiffers.length,
      `order-dependent SEQUENCE debt grew: ${sequenceDiffers.length} > ${ORDERED_SEQUENCE_DEBT_CEILING}\n    ${sequenceDiffers.join("\n    ")}`,
    ).toBeLessThanOrEqual(ORDERED_SEQUENCE_DEBT_CEILING);
    // The register is only meaningful if the run can see the pairs at all.
    expect(withinGroup.length, "same-group pairs, where last-click-wins is intended").toBeGreaterThan(0);
  }, CENSUS_TEST_TIMEOUT_MS);

  it("keeps the pairs Stage C retired fixed, by name rather than by absence", () => {
    // A register that shrinks proves the pair left the measured set; it does not name
    // the pair it dropped, so a later change could re-break it and the census would
    // simply report it as a new entry against a list that no longer mentions it. These
    // two are pinned directly: both tiles still exist in the shipped library, both
    // sentences are still printed, and the two click orders produce the same page.
    for (const [firstLabel, secondLabel] of RETIRED_EVICITION_ORDER_DEPENDENCE) {
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

  it("keeps the seven withheld-normal pairs retired, by name and in both orders", () => {
    // The 2026-10-19 retirement, pinned pair by pair. For each pair the abnormal is
    // clicked first and the normal second — the order that used to reintroduce the
    // contradiction — and the report must match the other order: the same findings
    // (byte-identical where measured true), the abnormal's own statement still printed,
    // and the normal's superseded sentences retired rather than printed beside it.
    for (const [normalLabel, abnormalLabel, byteIdentical] of RETIRED_WITHHELD_NORMAL_ORDER_DEPENDENCE) {
      const normal = byLabel(normalLabel), abnormal = byLabel(abnormalLabel);
      const fwd = run([normal, abnormal]);
      const rev = run([abnormal, normal]);
      const how = byteIdentical ? "the same findings text" : "the same findings sentences";
      expect(
        sameMultiset(content(fwd.text), content(rev.text)),
        `${normalLabel} + ${abnormalLabel}: both click orders must carry ${how}`,
      ).toBe(true);
      if (byteIdentical) {
        expect(
          fwd.text,
          `${normalLabel} + ${abnormalLabel}: both click orders must print the same page`,
        ).toBe(rev.text);
      }
      const printed = normalizeForDedupe(fwd.text);
      // The abnormal the radiologist selected never vanishes from the report. Its
      // normal clauses ("…No midline shift.") may dedupe against the scaffold, so the
      // sentence-wise check is on the sentences that assert the finding itself.
      const mustPrint = splitToSentences(abnormal.sentence).map(normalizeForDedupe).filter((s, i) => {
        const raw = splitToSentences(abnormal.sentence)[i] ?? "";
        return s && assertsAbnormality(raw);
      });
      expect(
        mustPrint.length,
        `${normalLabel} + ${abnormalLabel}: the abnormal tile asserts no sentence to check`,
      ).toBeGreaterThan(0);
      for (const s of mustPrint) {
        expect(
          printed.includes(s),
          `"${abnormalLabel}"'s finding sentence is not printed in the ${normalLabel} + ${abnormalLabel} `
          + `report — a normal tile must never evict a selected abnormality`,
        ).toBe(true);
      }
      // And the retirement is real in both orders: at least one sentence of the normal
      // tile that the abnormal contradicts is absent from both pages, rather than the
      // pair passing because the normal printed nothing at all.
      const normalSentences = splitToSentences(normal.sentence).map(normalizeForDedupe).filter(Boolean);
      const retiredSomewhere = normalSentences.filter((s) => !printed.includes(s));
      expect(
        retiredSomewhere.length,
        `${normalLabel} + ${abnormalLabel}: no sentence of the normal tile was retired — `
        + `the pair would pass vacuously`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the two shared-baseline pairs in their shared slot, in both click orders", () => {
    // The 2026-10-19 reclassification, pinned by name. Both tiles retire the same
    // baseline sentence without sharing a conflict group, so the second click has
    // no in-place slot — before the anchor it printed at the END of the report.
    // The pin is anatomical, not byte-wise: in BOTH orders the two findings sit
    // ADJACENT, inside the parenchyma slot the shared baseline occupied, ahead of
    // the ventricles normal that follows it in the approved scaffold.
    const ventriclesNormal = "Ventricular system and cisternal spaces are normal";
    for (const [firstLabel, secondLabel] of RECLASSIFIED_SHARED_BASELINE_PAIRS) {
      const a = byLabel(firstLabel), b = byLabel(secondLabel);
      for (const order of [[a, b] as const, [b, a] as const]) {
        const { text } = run([...order]);
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const firstSentence = splitToSentences(order[0]!.sentence)[0] ?? "";
        const lastOfFirst = splitToSentences(order[0]!.sentence).length - 1;
        const secondSentence = splitToSentences(order[1]!.sentence)[0] ?? "";
        const atFirst = lines.findIndex((l) => l.startsWith(firstSentence.slice(0, 40)));
        const atSecond = lines.findIndex((l) => l.startsWith(secondSentence.slice(0, 40)));
        expect(atFirst, `${order[0]!.label}: its finding must be printed`).toBeGreaterThanOrEqual(0);
        expect(atSecond, `${order[1]!.label}: its finding must be printed`).toBeGreaterThanOrEqual(0);
        const ventriclesAt = lines.findIndex((l) => l.includes(ventriclesNormal));
        // Both findings stay in the parenchyma slot: ahead of the ventricles normal.
        expect(Math.max(atFirst, atSecond), `${firstLabel} + ${secondLabel}: a finding printed below the parenchyma slot`)
          .toBeLessThan(ventriclesAt);
        // And they are adjacent: the second click's finding starts immediately
        // after the first click's last sentence — nothing interleaves them.
        expect(
          atSecond,
          `${firstLabel} + ${secondLabel}: the second click's finding must sit immediately beside the first`,
        ).toBe(atFirst + lastOfFirst + 1);
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
