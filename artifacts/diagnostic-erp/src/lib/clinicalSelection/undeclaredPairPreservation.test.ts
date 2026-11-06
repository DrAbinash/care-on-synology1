import { describe, expect, it } from "vitest";
import { useWorkspace } from "../zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "../zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId } from "../zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";
import { applyPathologyPatch } from "../pathologyPatch";
import { liveContributionKeys } from "../observationSlot";
import { assertsNormalStatement } from "../generateLocalImpression";
import { stripUnfilledMeasurements } from "../unfilledMeasurements";
import { applyChangePlan } from "../voiceReportComposer/applyChangePlan";

/**
 * Stage C Phase 5 · the undeclared pair must print both findings and evict neither.
 *
 * This is the runtime half of the sentence the catalogue contract already wrote down and skipped:
 * `lib/db/src/schema/clinicalSelectionContract.db.test.ts:523` — "prints both members of an undeclared
 * pair and evicts neither, in either click order". A schema cannot answer it, so the answer is a
 * report.
 *
 * MEASURED before anything was changed. The census over every undeclared MRI Brain abnormal pair
 * (distinct concept AND distinct conflict group, no declared relationship) found 117 pairs, 4 that split
 * by click order and 4 that lose a finding — and instrumentation across both click orders shows the
 * same shape in every one of them: **the ledger row stays `live` and the sentence leaves Findings.** So
 * this is not slot mutex (`observationsMutuallyExclusive` needs an identical concept, which these pairs
 * do not have) and it is not the same-slot replacement plan. It is the narrative/ownership layer:
 * `conceptsAssertedIn` (`observationSlot.ts:457`) reads a sentence as asserting *every* concept it
 * mentions, so "Heterogeneously enhancing area in the right frontal operculum at the post-resection
 * cavity … suggestive of edema" reads as an edema statement, and the Cerebral edema box owned — deleted
 * — the Glioma box's own sentence while the Glioma row stayed on the ledger. A row present in the state
 * and absent from the page is a finding the radiologist believes they reported.
 *
 * The fix is therefore identity, not prose: `liveContributionKeys` (observationSlot.ts) collects the
 * FINDING sentences every other live ledger row rendered, and `applyPathologyPatch` refuses to own a
 * sentence in that set. Same-slot siblings are removed from the ledger before the set is built, so a
 * genuine in-place update still replaces its own earlier wording. A live row's NORMAL statements are
 * deliberately left outside the set — a contradicted normal is still a normal, and retiring those is
 * the engine's shipped job — so every retirement path the spine and brain catalogues depend on is
 * untouched. No exclusivity rule, no supersession rule and no catalogue relationship was edited; those
 * would have moved the loss rather than closed it.
 *
 * The one thing tried and REJECTED is recorded in `observationSlot.ts`: suppressing an incoming normal
 * that a live finding contradicts does make the last click-order difference disappear, and it breaks
 * four shipped `siblingContradiction.ownership` tests whose job is to keep a clicked normal on the page
 * and warn about it. A normal the radiologist selected is theirs; the system may delete it as a
 * contradicted baseline, never quietly on the way in.
 *
 * These blocks are enforced, not skipped. The paired "keeps both rows on the ledger" tests pin the half
 * of the diagnosis that must NOT change: if one of those ever fails, the loss has moved from the
 * narrative layer to the ledger and the whole investigation needs repeating.
 *
 * The baselines are **synthetic by design**: the Stage B catalogue ships examination rows only, so
 * there is no approved publication to bind to and nothing here claims to be one.
 */

type Tile = (typeof TILES)[number];

function tile(label: string): Tile {
  const found = (TILES as unknown as Tile[]).find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const BASELINE = [
  "Cerebral hemispheres demonstrate normal signal intensity.",
  "Ventricular system and cisternal spaces are normal in size and configuration.",
  "No midline shift is seen.",
  "No acute intracranial hemorrhage is identified.",
].join("\n");

function reset(): void {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    startingCanvasBaseline: {
      formatName: "Synthetic MRI Brain — Normal",
      formatRevision: null,
      findings: BASELINE,
      impression: "Synthetic normal brain.",
      appliedAt: "2026-10-16T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain",
      regions: ["Brain"], source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", BASELINE, {
    source: "template", replaceProvenance: true,
  });
}

function select(...tiles: Tile[]): void {
  for (const t of tiles) {
    const outcome = useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
    if (outcome === "refused") throw new Error(`selection refused for ${t.label}`);
  }
}

/** Every sentence of the field, keyed the way the ledger keys everything. */
function field(): string[] {
  return splitToSentences(useWorkspace.getState().findingsText).map(normalizeForDedupe).filter(Boolean);
}

/**
 * A tile's contribution is several sentences, and the findings among them have to stay.
 * A normal clause that travels inside a tile ("No midline shift.") is still a NORMAL: once
 * another selected finding contradicts it, the report cannot carry both, so the engine is
 * right to retire it — see the pair test below that pins exactly that.
 */
function holds(t: Tile, sentences = field()): boolean {
  const own = findingsOf(t);
  return own.length > 0 && own.every((s) => sentences.includes(s));
}

/** The finding sentences of a tile — everything it asserts except its normal clauses. */
function findingsOf(t: Tile): string[] {
  return ownSentences(t).filter((s) => !assertsNormalStatement(s));
}

/** The normal statements a tile carries, which are retirable like any other normal. */
function normalsOf(t: Tile): string[] {
  return ownSentences(t).filter((s) => assertsNormalStatement(s));
}

/**
 * The tile's own sentences, after the rewrite the click applies. The door drops a
 * measurement the box has no question for ("maximum thickness ___ mm"), so the
 * expectation has to be derived the same way the write is — otherwise a sentence that
 * is legitimately absent reads as a lost finding, and a sentence the door invented
 * would justify itself.
 */
function ownSentences(t: Tile): string[] {
  return splitToSentences(stripUnfilledMeasurements(t.sentence).text)
    .map(normalizeForDedupe).filter(Boolean);
}

/** What the page asserts as findings — the order-independent half of a report. */
function findingSet(): string[] {
  return field().filter((s) => !assertsNormalStatement(s)).sort();
}

function rowOf(t: Tile) {
  return useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === tileRowId(t)) ?? null;
}

/** The four pairs the census measured. Nothing is chosen to pass. */
const PAIRS: Array<[Tile, Tile]> = [
  [tile("Hydrocephalus"), tile("Acute ICH")],
  [tile("Hydrocephalus"), tile("SDH")],
  [tile("Glioma recurrence"), tile("Cerebral edema")],
  [tile("Acute infarct (CT)"), tile("Stroke team")],
];

describe("Stage C Phase 5 · an undeclared pair coexists", () => {
  it("holds the measured premise: these pairs are unrelated by concept and by conflict group", () => {
    for (const [a, b] of PAIRS) {
      expect(a.concept, `${a.label} and ${b.label} must not share a concept`);
      expect(a.concept).not.toBe(b.concept);
      expect(a.conflictGroup).not.toBe(b.conflictGroup);
    }
    expect(PAIRS).toHaveLength(4);
  });

  for (const [a, b] of PAIRS) {
    const name = `${a.label} + ${b.label}`;

    it(`PRECONDITION: ${name} keeps both rows on the ledger`, () => {
      // Pinned because it is the half of the diagnosis that must not change: if a
      // future fix made this fail, the loss would have moved from the narrative layer to the ledger,
      // and the whole investigation would need repeating. Supersession would be the wrong remedy.
      reset();
      select(a, b);
      expect(rowOf(a), "the first row must still be on the ledger").not.toBeNull();
      expect(rowOf(b), "the second row must still be on the ledger").not.toBeNull();
      expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
      reset();
      select(b, a);
      expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
    });

    it(`${name} prints both findings, whichever is clicked first`, () => {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        reset();
        select(x, y);
        expect(holds(x), `${x.label} is selected, so its own words must be on the page`)
          .toBe(true);
        expect(holds(y), `${y.label} is selected, so its own words must be on the page`)
          .toBe(true);
      }
    });

    it(`${name} yields one report, not two depending on the mouse`, () => {
      // Compared over the FINDING sentences. Normal clauses are deliberately outside the
      // determinism claim: whether one survives depends on which box was clicked, and the
      // shipped sibling-contradiction detector names the case that stays — see the test
      // below, which pins that instead of pretending it is settled.
      reset();
      select(a, b);
      const forward = findingSet();
      reset();
      select(b, a);
      expect(findingSet(), `click order changed which findings exist in ${name}`)
        .toEqual(forward);
    });
  }

  it("a selected tile's sentence is never a normal for another tile to retire", () => {
    // The clinical statement, in one case. Glioma recurrence is a post-resection enhancing mass; the
    // cerebral edema tile does not make it less true. Losing that sentence is losing a finding.
    reset();
    select(tile("Glioma recurrence"));
    expect(holds(tile("Glioma recurrence")), "the finding is on the page before the second click")
      .toBe(true);
    select(tile("Cerebral edema"));
    expect(holds(tile("Glioma recurrence")),
      "a compatible abnormality was added, so the first finding must still be printed").toBe(true);
    expect(holds(tile("Cerebral edema"))).toBe(true);
  });

  it("retires a contradicted normal when the finding is clicked second — and does not delete it silently when first", () => {
    // The fence must not become "evict nothing": Hydrocephalus carries one finding
    // sentence plus the normal clause "No midline shift.", and a hemorrhage that
    // states a midline shift still retires it, along with the scaffold's own
    // "No midline shift is seen.".
    //
    // What the fence deliberately does NOT do is suppress that clause on the way IN.
    // Doing so made both click orders agree and broke four shipped tests
    // (`siblingContradiction.ownership` T1, T2, T7, T9) whose whole job is to keep a
    // normal the radiologist clicked on the page AND warn about it. So the denial is
    // retired when the finding lands second, and printed-plus-warned when it lands
    // first; what is now order-independent is the findings, which is what this phase
    // guarantees. Closing the last of the asymmetry means the contradiction check
    // reading the ledger instead of the page — a composition change, not a fence.
    const HYD = tile("Hydrocephalus"), ICH = tile("Acute ICH");
    expect(normalsOf(HYD), "the premise: this box does carry a normal clause").toHaveLength(1);

    reset();
    select(HYD, ICH);
    expect(field(), "a normal contradicted by a finding clicked after it is retired")
      .not.toContain(normalizeForDedupe("No midline shift."));
    expect(field(), "and the scaffold's version of the same normal goes with it")
      .not.toContain(normalizeForDedupe("No midline shift is seen."));

    for (const [x, y] of [[HYD, ICH], [ICH, HYD]] as const) {
      reset();
      select(x, y);
      expect(holds(HYD), `${x.label} then ${y.label}: the finding the box was clicked for stays`)
        .toBe(true);
      expect(holds(ICH), `${x.label} then ${y.label}: and so does the other one's`).toBe(true);
    }
  });

  it("leaves the radiologist's own words alone through the same pair", () => {
    // This half already works, and it must keep working: the fix may not reach manual text with the
    // same authority it reaches a tile's contribution.
    reset();
    const MANUAL = "The patient declined contrast; the study is non-contrast only.";
    useWorkspace.getState().setField("findings", `${BASELINE}\n${MANUAL}`, {
      source: "manual", replaceProvenance: true,
    });
    select(tile("Glioma recurrence"), tile("Cerebral edema"));
    expect(field()).toContain(normalizeForDedupe(MANUAL));
  });

  it("restores the whole baseline once both tiles are deselected", () => {
    // Deselection is the other half of the contract already discharged by the shared-normal work;
    // asserted here so a Phase 5 fix cannot regress it while touching the composition layer.
    reset();
    const [a, b] = PAIRS[2];
    select(a, b);
    useWorkspace.getState().removeObservation(tileRowId(b));
    useWorkspace.getState().removeObservation(tileRowId(a));
    for (const sentence of splitToSentences(BASELINE).map(normalizeForDedupe)) {
      expect(field(), `${sentence} should be back with nothing selected`).toContain(sentence);
    }
  });
});

/**
 * The fence has to hold at every door that writes the same report. Two exist: the click path through
 * `applyPathologyOverlay`, and the dictation plan through `applyChangePlan` — which calls the patch
 * engine itself. Covering one and leaving the other is the defect this repo has already been bitten by
 * twice (two template-application paths, three demography writers).
 *
 * A spine line is also the shape that proves both halves of the match matter: the ledger keys a
 * contribution by its whole text, level prefix included, while the field walk splits the prefix off
 * before testing ownership. A fence that compares only one form silently misses the other.
 */
describe("Stage C Phase 5 · the fence reaches the level-prefixed line and the dictation door", () => {
  const OWN = "L4-L5: Left disc herniation contacting and displacing the L5 root.";
  const INCOMING = "Disc protrusion at L4-L5 with severe central canal stenosis.";

  function spineNarrative(findings: string) {
    return { clinicalHistory: "", technique: "", findings, impression: "", recommendation: "" };
  }

  it("protects a contribution whose rendered line carries its level prefix", () => {
    const out = applyPathologyPatch({
      existing: spineNarrative(OWN),
      incoming: { findings: INCOMING },
      ownership: {
        concept: "disc_contour", conflictGroup: "disc_contour",
        anatomicalSection: "lumbar spine", baselineReplaces: "",
      },
      source: "quick-select",
      liveRows: [{ lastRendered: { findings: OWN } }],
    });
    expect(out.narrative.findings,
      "the first observation's own line must survive the second one's write")
      .toContain("Left disc herniation contacting and displacing the L5 root.");
    expect(out.narrative.findings, "and the new finding is added beside it")
      .toContain("severe central canal stenosis");
  });

  it("protects the same line when the ledger stored it WITHOUT the level prefix", () => {
    // The mirror of the case above, and the reason the match tests both forms: the
    // field line is walked with its `L4-L5:` prefix split off, so a contribution
    // stored as the bare sentence can only be recognised from the unit. One arm
    // alone protects exactly half of the spine's real ledger shapes.
    const out = applyPathologyPatch({
      existing: spineNarrative(OWN),
      incoming: { findings: INCOMING },
      ownership: {
        concept: "disc_contour", conflictGroup: "disc_contour",
        anatomicalSection: "lumbar spine", baselineReplaces: "",
      },
      source: "quick-select",
      liveRows: [{
        lastRendered: { findings: "Left disc herniation contacting and displacing the L5 root." },
      }],
    });
    expect(out.narrative.findings).toContain("Left disc herniation contacting and displacing the L5 root.");
  });

  it("protects the Impression field too, not only Findings", () => {
    // A tile writes Findings, Impression and Recommendation together. The ledger
    // stores each field separately, so a fence built from Findings alone would
    // leave the impression half of the same defect open: two impressions in the
    // box, one of them silently gone from the signed page.
    const ownImpression = "Left L5 radiculopathy from disc herniation at L4-L5.";
    const out = applyPathologyPatch({
      existing: { ...spineNarrative(""), impression: ownImpression },
      incoming: { impression: "Disc protrusion at L4-L5 with severe central canal stenosis." },
      ownership: {
        concept: "disc_contour", conflictGroup: "disc_contour",
        anatomicalSection: "lumbar spine", baselineReplaces: "",
      },
      source: "quick-select",
      liveRows: [{ lastRendered: { impression: ownImpression } }],
    });
    expect(out.narrative.impression).toContain("Left L5 radiculopathy");
  });

  it("indexes exactly the sentences that belong to a live finding", () => {
    // The set is the whole rule, so it is tested directly: a live row's finding
    // statements in; its normal clauses, its retired rows and its baseline/system rows
    // out. The last two are not covered by the wording test alone — a materialized
    // Full Normal baseline also carries sentences that state no normality at all, and
    // protecting those freezes the baseline the first abnormality must retire
    // (measured: `xrayChestSubMasters`, `cervicalQuickSelectCatalogue`,
    // `reportPreviewHarness` all fail when only the wording test is left).
    const keys = liveContributionKeys([
      { lastRendered: { findings: "Ventriculomegaly. No midline shift." } },
      { lastRendered: { impression: "Left L5 radiculopathy from disc herniation." } },
      { observation: { role: "baseline" }, lastRendered: { findings: "Routine six sequences were acquired." } },
      { source: "system", lastRendered: { findings: "Comparison with the prior study of 3 June." } },
      { stale: true, lastRendered: { findings: "A removed finding that no longer prints." } },
    ]);
    expect([...keys].sort()).toEqual([
      normalizeForDedupe("Left L5 radiculopathy from disc herniation."),
      normalizeForDedupe("Ventriculomegaly."),
    ].sort());
  });

  it("keeps a dictated plan from discarding an observation already in the report", () => {
    // Reproduced, not assumed: with the fence absent this exact pair loses the first
    // sentence from the plan path (`tmp/composer-probe.txt`) — the two statements share
    // the disc word, so the second observation owned the first one's line and deleted it
    // while its ledger row stayed live.
    const FIRST = "Left disc herniation contacting and displacing the L5 root at L4-L5.";
    const SECOND = "Disc protrusion at L4-L5 with severe central canal stenosis.";
    for (const field of ["findings", "impression"] as const) {
      const out = applyChangePlan({
        narrative: {
          clinicalHistory: "", technique: "",
          findings: field === "findings" ? FIRST : "",
          impression: field === "impression" ? FIRST : "",
          recommendation: "",
        },
        provenance: {},
        activeObservations: [{
          id: "o1", concept: "disc_contour",
          findingsText: field === "findings" ? FIRST : "",
          impressionText: field === "impression" ? FIRST : "",
        }],
        plan: {
          operation: "report_change_plan",
          observations: [{
            id: "o2", concept: "canal_stenosis",
            findingsText: field === "findings" ? SECOND : "",
            impressionText: field === "impression" ? SECOND : "",
          }],
          uncertainties: [],
        },
      });
      expect(out.ok).toBe(true);
      const text = field === "findings" ? out.narrative!.findings : out.narrative!.impression;
      expect(text, `a dictated second finding deleted the first one from ${field}`).toContain(
        "Left disc herniation contacting and displacing the L5 root");
      expect(text).toContain("severe central canal stenosis");
    }
  });
});
