import { describe, expect, it } from "vitest";
import { useWorkspace, type EditorField } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import type { QuickSelectTile } from "./zai-workspace/types";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTilePayload";
import { reconstructStartingCanvasBaseline } from "./zai-workspace/startingCanvasHighlight";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { activeSuppressors, canonicalOrderFromText, falsifies } from "./clinicalSelection/normalSuppression";

/**
 * Stage C-1 · shared-baseline retirement.
 *
 * Two shipped MRI Cervical Spine tiles falsify the SAME normal sentence —
 * `quick-select-tiles.data.ts:157` (Burst fracture C5) and `:161` (Lytic lesion C2) both declare
 * `baselineReplaces: "Cervical vertebral bodies demonstrate normal height and marrow signal."`
 * The radiologist can therefore hold both abnormalities at once, and either one alone makes that
 * normal false.
 *
 * The engine used to record, per patch, only the baseline sentences THAT PATCH happened to replace
 * (`observationLedger.ts:53`, filled at `store.ts:2472`), and deselecting a patch restored exactly its
 * own private list (`restoreBaselineSentences` had no other caller). So the second tile, which found
 * the normal already gone, restored nothing, and the first tile put the sentence back while the second
 * tile's lesion was still on the page — a report stating normal cervical vertebral bodies alongside a
 * C2 lytic lesion, and a different report depending on which box was clicked first.
 *
 * That is now closed: suppression is computed from the complete surviving set, and the sentences a
 * removal has authority to restore are *derived* from the recorded canonical baseline plus the removed
 * observation's own declaration (`claimsDeclaredBy`), so a claim does not live or die with whichever
 * row deleted the text first. These tests pin the behaviour against the real store rather than the
 * schema, so a passing test means a passing report; three mutants of the fix (drop the surviving set,
 * drop the derived claim, drop the canonical order) each fail between 8 and 9 of them.
 */

const SHARED_NORMAL = "Cervical vertebral bodies demonstrate normal height and marrow signal.";
const UNRELATED_NORMAL = "Cervical spinal cord signal intensity is normal.";
const THIRD_NORMAL = "No spinal canal stenosis is seen.";
const C2_LESION = "Focal lytic lesion of the C2 vertebral body without cortical breach.";
const C5_BURST = "Burst fracture of the C5 vertebral body with loss of posterior vertebral body height.";

const BASELINE = [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL].join("\n");

type Tile = QuickSelectTile;

function tile(label: string): Tile {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const BURST_C5 = tile("Burst fracture C5");
const LYTIC_C2 = tile("Lytic lesion C2");

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null, voiceComposerObservations: [],
    // The canonical anatomical order. A real format application records this (`store.ts:1925`);
    // without it there is no order to restore into and the ledger keeps its historical behaviour,
    // which is what a surface with no recorded baseline must do.
    startingCanvasBaseline: {
      formatName: "Synthetic MRI Cervical Spine — Normal",
      formatRevision: null,
      findings: BASELINE,
      impression: "Synthetic normal cervical spine.",
      appliedAt: "2026-10-16T00:00:00.000Z",
    },
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Cervical Spine Plain",
      regions: ["Cervical Spine"], source: "auto",
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

function deselect(t: Tile): void {
  useWorkspace.getState().removeObservation(`qs-${t.id}`);
}

function sentences(field = useWorkspace.getState().findingsText): string[] {
  return splitToSentences(field).map(normalizeForDedupe).filter(Boolean);
}

function holds(sentence: string, field?: string): boolean {
  return sentences(field).includes(normalizeForDedupe(sentence));
}

function indexOf(sentence: string): number {
  return sentences().indexOf(normalizeForDedupe(sentence));
}

describe("Stage C-1 · a normal falsified by two abnormalities", () => {
  it("holds the two shipped tiles that share one baseline", () => {
    expect(BURST_C5.baselineReplaces).toBe(LYTIC_C2.baselineReplaces);
    expect(BURST_C5.baselineReplaces).toBe(SHARED_NORMAL);
  });

  it("removes the shared normal while both are selected", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    expect(holds(SHARED_NORMAL), "both tiles falsify the vertebral-body normal").toBe(false);
    expect(holds(C5_BURST), "the first lesion prints").toBe(true);
    expect(holds(C2_LESION), "the second lesion prints").toBe(true);
  });

  it("keeps the shared normal suppressed when one of the two is deselected", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    deselect(BURST_C5);

    // The C2 lesion is still selected, and a lytic lesion of the C2 body is not a normal body.
    expect(holds(C2_LESION), "the surviving lesion must stay on the page").toBe(true);
    expect(holds(SHARED_NORMAL),
      "a C2 lytic lesion is still selected, so \"vertebral bodies demonstrate normal height and "
      + "marrow signal\" must NOT return").toBe(false);
  });

  it("restores the shared normal only when the last tile that falsifies it is removed", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    deselect(LYTIC_C2);
    expect(holds(SHARED_NORMAL), "Burst fracture C5 still falsifies it").toBe(false);
    deselect(BURST_C5);
    expect(holds(SHARED_NORMAL),
      "nothing selected now contradicts the vertebral-body normal, so it must return").toBe(true);
  });

  it("leaves an unrelated normal standing throughout", () => {
    reset();
    select(BURST_C5, LYTIC_C2);
    expect(holds(UNRELATED_NORMAL), "a C2 lesion does not make the cord normal false").toBe(true);
    deselect(BURST_C5);
    expect(holds(UNRELATED_NORMAL)).toBe(true);
    expect(holds(THIRD_NORMAL)).toBe(true);
  });

  it("returns a restored normal to its own anatomical position, not to the end of the field", () => {
    reset();
    const syrinx = tile("Cervical syrinx");
    select(BURST_C5, syrinx);
    deselect(syrinx);

    const findings = useWorkspace.getState().findingsText;
    expect(holds(UNRELATED_NORMAL, findings),
      "the syrinx was the only falsifier of the cord sentence, so it must return").toBe(true);
    const lines = sentences(findings);
    expect(lines.indexOf(normalizeForDedupe(UNRELATED_NORMAL)),
      "the cord sentence sits before the stenosis sentence in the recorded baseline, so restoration "
      + "must rejoin it there instead of appending it after the findings it sits above")
      .toBeLessThan(lines.indexOf(normalizeForDedupe(THIRD_NORMAL)));
  });

  it("restores the shared normal even when its only recorded holder left first", () => {
    // The defect this slice closes. `replacedBaseline` is stored per patch, so Burst fracture C5 is
    // the only row that ever recorded the vertebral-body sentence. Deselecting it used to consume that
    // record while the C2 lesion still legitimately suppressed the normal, leaving nothing to bring
    // the sentence back when the lesion went too: the report simply never stated the vertebral bodies
    // again. The claim is now *derived* from the canonical baseline plus the removed observation's own
    // `baselineReplaces`, so it does not live in the row that happened to delete the text first.
    reset();
    const syrinx = tile("Cervical syrinx");
    select(BURST_C5, LYTIC_C2, syrinx);
    deselect(BURST_C5);
    deselect(LYTIC_C2);
    expect(holds(SHARED_NORMAL),
      "the lesion was the last falsifier, so the vertebral-body normal must return with it").toBe(true);
    deselect(syrinx);
    expect(holds(SHARED_NORMAL)).toBe(true);
    for (const sentence of [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL]) {
      expect(holds(sentence), `the whole recorded baseline is stated again once nothing opposes it`)
        .toBe(true);
    }
  });

  it("leaves radiologist-authored text exactly as written through a shared-baseline cycle", () => {
    reset();
    const MANUAL = "Prior C5 burst fracture is healed; the patient was counseled about residual symptoms.";
    useWorkspace.getState().setField("findings", `${BASELINE}\n${MANUAL}`, {
      source: "manual", replaceProvenance: true,
    });
    select(BURST_C5, LYTIC_C2);
    deselect(BURST_C5);
    deselect(LYTIC_C2);
    expect(holds(MANUAL),
      "a manual sentence declares no baseline, so suppression never touches it").toBe(true);
  });

  it("is a function of which tiles are selected, across all four click orders", () => {
    // The property the whole slice exists to establish. Every reachable selection set is visited by
    // more than one click sequence — {Burst C5} is arrived at by clicking it first or by deselecting
    // the lesion — and all of them must produce the same report. Comparing one deselect order against
    // itself would not show it: a wrong-but-symmetric engine passes that.
    const pairs = [[BURST_C5, LYTIC_C2], [LYTIC_C2, BURST_C5]];
    const observed = new Map<string, Set<string>>();
    const setKey = (selected: Tile[]) => [...selected].map((t) => t.id).sort().join(",");
    const record = (selected: Tile[]) => {
      const key = setKey(selected);
      const value = sentences().slice().sort().join("\n");
      const seen = observed.get(key) ?? new Set<string>();
      seen.add(value);
      observed.set(key, seen);
    };

    for (const order of pairs) {
      for (const deselectOrder of [order, [...order].reverse()]) {
        reset();
        record([]);
        let selected: Tile[] = [];
        for (const t of order) {
          select(t);
          selected = [...selected, t];
          record(selected);
        }
        for (const t of deselectOrder) {
          deselect(t);
          // Cumulative: the set that remains after *this* deselection, not this deselection alone.
          // Stating it wrong once made this test report an order dependence the engine does not have.
          selected = selected.filter((s) => s.id !== t.id);
          record(selected);
        }
      }
    }

    for (const [key, values] of observed) {
      expect(values.size,
        `selection set [${key}] was reached ${values.size} ways and produced ${values.size} different `
        + "reports; the clinical content must depend only on which tiles are selected\n"
        + [...values].join("\n--- and ---\n"))
        .toBe(1);
    }
    // Both single-abnormality states must be one of the two reports, and neither may state the
    // vertebral-body normal — the sets are reachable from both directions, so this is the same
    // property stated as a clinical outcome rather than as equality.
    for (const single of [setKey([BURST_C5]), setKey([LYTIC_C2])]) {
      const text = [...(observed.get(single) ?? new Set<string>())][0] ?? "";
      expect(text.includes(normalizeForDedupe(SHARED_NORMAL)),
        `with only one abnormality held it still falsifies the shared normal: [${single}]`).toBe(false);
    }
    const emptyAgain = [...(observed.get("") ?? new Set<string>())][0] ?? "";
    for (const s of [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL]) {
      expect(emptyAgain.includes(normalizeForDedupe(s)),
        `deselecting everything returns the whole recorded baseline, "${s}"`).toBe(true);
    }
  });
});

/** The examination the test drives, as a format library entry. Synthetic content, not clinical. */
const FORMAT = {
  name: "Synthetic MRI Cervical Spine — Normal",
  findings: BASELINE,
  impression: "Synthetic normal cervical spine.",
};

const C5_PAIR = { tile: BURST_C5, sentence: C5_BURST };
const C2_PAIR = { tile: LYTIC_C2, sentence: C2_LESION };
const MANUAL_NOTE = "Prior C5 fusion hardware is present and the patient reports residual paraesthesias.";

/**
 * A normal that is printed while some selected observation falsifies it is a clinically contradictory
 * report, whatever else is right about it. Checked against the canonical baseline of each field, after
 * every step of the scenario, using the same falsification oracle the reducer uses — so this fails if
 * the engine and the rule it is supposed to implement ever disagree.
 *
 * Scope note: it can only judge sentences the recorded baseline states. A false normal that no baseline
 * owns is a different defect, caught elsewhere.
 */
function assertNoContradictoryNormal(step: string): void {
  const active = activeSuppressors(useWorkspace.getState().appliedPathologyPatches);
  const fields: [EditorField, string | null | undefined][] = [
    ["findings", useWorkspace.getState().startingCanvasBaseline?.findings],
    ["impression", useWorkspace.getState().startingCanvasBaseline?.impression],
  ];
  for (const [field, canonicalText] of fields) {
    const text = field === "findings"
      ? useWorkspace.getState().findingsText
      : useWorkspace.getState().impressionText;
    for (const slot of canonicalOrderFromText(canonicalText)) {
      if (!holds(slot.sentence, text)) continue;
      const by = active.find((o) => falsifies(o, slot.sentence));
      expect(by,
        `${step}: "${slot.sentence}" is printed in ${field} while an observation that falsifies it `
        + "is still selected").toBeUndefined();
    }
  }
}

/** Save, then open the draft again — the real serializer, the real hydrator, no shortcuts. */
function saveAndReopen(): void {
  const ws = useWorkspace.getState();
  const saved = ws.serializeObservationLedger();
  const narrative = {
    findings: ws.findingsText,
    impression: ws.impressionText,
    technique: ws.techniqueText,
    recommendation: ws.recommendationText,
    clinicalHistory: ws.clinicalHistoryText,
  };
  const selected = ws.appliedPathologyPatches.length;

  reset();
  // `useDraftPersistence.ts:360-375` — the canonical baseline is not a stored column. On reopen it is
  // rebuilt from the persisted format identity against the format library the app ships, and the
  // restoration order depends on it. If reconstruction fails, the deterministic engine has no baseline
  // to restore into, which is exactly what this proves it still does.
  const canvas = reconstructStartingCanvasBaseline({
    formatName: FORMAT.name,
    formatRevision: null,
    appliedAt: "2026-10-16T00:00:00.000Z",
    format: FORMAT,
  });
  expect(canvas, "the canonical baseline must be reconstructible from the persisted format identity")
    .not.toBeNull();
  useWorkspace.setState({
    startingCanvasBaseline: canvas,
    findingsText: "", impressionText: "", techniqueText: "", recommendationText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
  });
  for (const field of ["findings", "impression", "technique", "recommendation"] as EditorField[]) {
    useWorkspace.getState().setField(field, narrative[field], { source: "template", replaceProvenance: true });
  }

  const hydration = useWorkspace.getState().hydrateObservationLedger(saved);
  expect(hydration.ok, `the observation ledger must reopen intact: ${hydration.reason}`).toBe(true);
  expect(hydration.patchCount, "every still-selected observation comes back").toBe(selected);
  expect(hydration.warning ?? "", "no observation may come back stale — its text is the saved text")
    .toBe("");
}

/**
 * The nine steps the Stage C brief specifies, driven through the real store.
 *
 * `pair` order is the click order, so the same runner proves order-independence; `reopenAfterBoth`
 * inserts a save-and-reopen between steps 3 and 4, which is the brief's third repetition.
 */
function nineStep(
  pair: [{ tile: Tile; sentence: string }, { tile: Tile; sentence: string }],
  opts: { reopenAfterBoth?: boolean; manual?: boolean } = {},
): void {
  const [first, second] = pair;
  const manual = opts.manual ? MANUAL_NOTE : "";
  reset();
  if (manual) {
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${manual}`, {
      source: "manual", replaceProvenance: true,
    });
  }

  // 1 · the normal cervical baseline is on the page.
  for (const s of [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL]) {
    expect(holds(s), `step 1: the baseline states "${s}"`).toBe(true);
  }

  // 2 · select the first abnormality.
  select(first.tile);
  expect(holds(first.sentence), "step 2: the finding prints").toBe(true);
  expect(holds(SHARED_NORMAL), "step 2: it falsifies the vertebral-body normal").toBe(false);
  assertNoContradictoryNormal("step 2");

  // 3 · select the second, overlapping abnormality.
  select(second.tile);
  expect(holds(second.sentence), "step 3: both lesions print").toBe(true);
  expect(holds(first.sentence), "step 3: the first lesion is still on the page").toBe(true);
  expect(holds(SHARED_NORMAL), "step 3: still suppressed by both").toBe(false);
  assertNoContradictoryNormal("step 3");

  if (opts.reopenAfterBoth) saveAndReopen();

  // 4 · deselect the first abnormality.
  deselect(first.tile);
  expect(holds(first.sentence), "step 4: the deselected finding is off the page").toBe(false);
  expect(holds(second.sentence), "step 4: the surviving finding is untouched").toBe(true);
  assertNoContradictoryNormal("step 4");

  // 5 · the shared normal must still be suppressed.
  expect(holds(SHARED_NORMAL),
    "step 5: an abnormality that falsifies it is still selected").toBe(false);

  // 6 · deselect the second abnormality.
  deselect(second.tile);
  assertNoContradictoryNormal("step 6");

  // 7 · the original normal returns.
  expect(holds(SHARED_NORMAL),
    "step 7: nothing selected contradicts it now, so the baseline sentence must be stated again")
    .toBe(true);

  // 8 · at its canonical position, among its own neighbours rather than appended after the findings.
  const lines = sentences();
  expect(indexOf(SHARED_NORMAL), "step 8: the sentence is present")
    .toBeGreaterThanOrEqual(0);
  expect(lines.indexOf(normalizeForDedupe(SHARED_NORMAL)),
    "step 8: vertebral bodies are stated before the cord in the recorded baseline, so the restored "
    + "sentence rejoins them there")
    .toBeLessThan(lines.indexOf(normalizeForDedupe(UNRELATED_NORMAL)));
  expect(lines.indexOf(normalizeForDedupe(UNRELATED_NORMAL)))
    .toBeLessThan(lines.indexOf(normalizeForDedupe(THIRD_NORMAL)));
  for (const s of [SHARED_NORMAL, UNRELATED_NORMAL, THIRD_NORMAL]) {
    expect(holds(s), `step 8: the whole baseline is stated again, "${s}"`).toBe(true);
  }

  // 9 · text the radiologist wrote is exactly as they wrote it, in the same place.
  if (manual) {
    expect(useWorkspace.getState().findingsText.includes(manual),
      "step 9: the manual sentence survives verbatim").toBe(true);
    expect(lines.indexOf(normalizeForDedupe(manual)),
      "step 9: and keeps the position it was written in, after the restored baseline")
      .toBeGreaterThan(lines.indexOf(normalizeForDedupe(THIRD_NORMAL)));
  }
}

describe("Stage C-1 · the nine-step shared-baseline scenario", () => {
  it("runs end to end in the order the tiles are shown", () => {
    nineStep([C5_PAIR, C2_PAIR]);
  });

  it("runs end to end in the reverse click order", () => {
    nineStep([C2_PAIR, C5_PAIR]);
  });

  it("runs end to end after saving and reopening the draft", () => {
    nineStep([C5_PAIR, C2_PAIR], { reopenAfterBoth: true });
  });

  it("runs end to end in reverse order after saving and reopening the draft", () => {
    nineStep([C2_PAIR, C5_PAIR], { reopenAfterBoth: true });
  });

  it("leaves manually authored text exactly where the radiologist wrote it", () => {
    nineStep([C5_PAIR, C2_PAIR], { manual: true });
  });

  it("keeps manual text untouched through a save, reopen and the reverse order", () => {
    nineStep([C2_PAIR, C5_PAIR], { reopenAfterBoth: true, manual: true });
  });
});
