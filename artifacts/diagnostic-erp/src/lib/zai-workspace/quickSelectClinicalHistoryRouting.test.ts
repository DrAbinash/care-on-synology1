import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { factorySeedRows } from "../../../../../scripts/src/generate-quick-select-factory-boxes";
import { buildReportingStudyContext } from "../reportingStudyContext";
import { useWorkspace } from "./store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./quick-select-tiles.data";
import { clinicalBoxForTile } from "./quickSelectTileFixture";
import {
  isClinicalHistoryBox,
  quickFindingClickRoute,
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";
import type { QuickSelectTile } from "./types";

/**
 * Clinical History is a section of the report, and the catalogue already has
 * boxes authored for it — eleven shipped indication boxes, from "Known case of
 * glioma post-resection…" to "Right upper quadrant pain…".
 *
 * They were landing in Findings. `radiology_quick_findings` has no history
 * column, so the factory seed files a history box's sentence in `finding_text`
 * like any other box, and the one patch builder hands `finding_text` to the
 * overlay as `incoming.findings`. The report therefore stated an indication as
 * an observation of the scan — and the strip's own field filter is what hid it:
 * no strip renders `field="clinicalHistory"`, so the only surfaces that offer
 * these boxes are the ones that never look at `field` at all.
 *
 * The Clinical History section already had its own infrastructure before this —
 * `clinicalHistoryText` in the store, the append/remove rules in
 * `lib/clinicalHistoryText`, `setField("clinicalHistory", …)` and a chip strip
 * backed by its own table. Nothing here adds a second editor or a second place
 * to store history: a history box contributes through the same toggle the chips
 * use, and the sentence simply never enters the body patch.
 */

const SEED = factorySeedRows(TILES as never);
const SECTIONS = ["findings", "impression", "technique", "recommendation"] as const;

/** The seed's row for a tile, as the wire returns it. */
function seedBox(index: number): ClinicalQuickFindingBox & { field: string } {
  const r = SEED[index]!;
  return {
    id: index + 1,
    label: r.label,
    studyType: r.studyType,
    findingText: r.findingText,
    impressionText: r.impressionText,
    techniqueText: r.techniqueText,
    recommendationText: r.recommendationText,
    concept: r.concept,
    anatomicalSection: r.anatomicalSection,
    conflictGroup: r.conflictGroup,
    baselineReplaces: r.baselineReplaces,
    properties: r.properties,
    field: r.field,
  };
}

function resetFor(modality = "MR", region = "Brain"): void {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, patchUndoStack: [],
    patchRedoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
    isFinalized: false, isDirty: false,
    reportingContext: buildReportingStudyContext({
      modality, studyDescription: region, regions: [region], source: "auto",
    }),
  });
}

const HISTORY = TILES.map((t, i) => ({ tile: t, index: i }))
  .filter(({ tile }) => (tile.field ?? "") === "clinicalHistory");

describe("clinical-history boxes are routed to Clinical History, not into the report body", () => {
  beforeEach(() => resetFor());

  it("has the eleven shipped indication boxes to route", () => {
    // Not a number to satisfy: if the catalogue's history set moves, the two
    // population tests below changed meaning too and must be re-read.
    expect(HISTORY.map((h) => h.tile.label.trim()).sort()).toEqual([
      "Acute stroke", "Back pain + radiculopathy", "Chronic headache",
      "Glioma follow-up", "Known malignancy", "RUQ pain", "Routine anomaly scan",
      "Screening mammography", "Seizure evaluation", "Standard H&P", "Trauma",
    ].sort());
  });

  it("the test fixture files every shipped box exactly where the factory seed files it", () => {
    // The fixture is what a dozen suites drive their clicks through. If it and
    // the seed disagree about which column a sentence lives in, those suites are
    // measuring a box the clinic never gets — and `field` is the column that
    // decides where a click sends the sentence.
    const drift: string[] = [];
    TILES.forEach((tile: QuickSelectTile, i: number) => {
      const row = SEED[i]!;
      const box = clinicalBoxForTile(tile);
      for (const col of ["findingText", "impressionText", "techniqueText", "recommendationText"] as const) {
        const seeded = (row[col] ?? "").trim();
        const fitted = (box[col] ?? "").trim();
        if (seeded !== fitted) drift.push(`${tile.field} · ${tile.label} · ${col}: seed=${JSON.stringify(seeded)} fixture=${JSON.stringify(fitted)}`);
      }
      if ((row.field ?? "").trim() !== (box as { field?: string | null }).field?.trim()) {
        drift.push(`${tile.label} · field: seed=${JSON.stringify(row.field)} fixture=${JSON.stringify((box as { field?: string | null }).field)}`);
      }
    });
    expect(drift).toEqual([]);
  });

  it("names history boxes by the column the database says they own", () => {
    const history = SEED.map((_, i) => i).filter((i) => isClinicalHistoryBox(seedBox(i)));
    expect(history.length, "the seed ships history boxes; the predicate must find them").toBe(HISTORY.length);
    for (const i of history) expect(isClinicalHistoryBox(seedBox(i))).toBe(true);
    // A findings/impression/recommendation/technique box is NOT history: routing
    // those away from the body would be the same defect wearing the opposite hat.
    const notHistory = SEED.map((_, i) => i).filter((i) => !isClinicalHistoryBox(seedBox(i)));
    expect(notHistory.length).toBe(SEED.length - HISTORY.length);
    for (const field of ["findings", "impression", "recommendation", "technique"]) {
      const sample = notHistory.find((i) => (SEED[i]!.field ?? "") === field);
      if (sample !== undefined) expect(isClinicalHistoryBox(seedBox(sample)), SEED[sample]!.label).toBe(false);
    }
  });

  it("keeps every clinical-history sentence out of Findings, Impression, Technique and Recommendation", () => {
    const faults: string[] = [];
    const verdicts: Record<string, number> = {};
    for (const { tile, index } of HISTORY) {
      const box = seedBox(index);
      const phrase = box.findingText.trim();
      expect(phrase.length, `${box.label} has no sentence at all`).toBeGreaterThan(0);

      // The box's own scope, not one fixed study: a US Abdomen box clicked in a
      // Brain context can be refused for the region, and a refusal is not a pass.
      resetFor(tile.scopeModality ?? "MR", tile.scopeBodyPart || "Brain");
      const verdict = useWorkspace.getState().applyPathologyOverlay(
        quickFindingPatch(box, { region: tile.scopeBodyPart || "Brain" }, {} as QuickSelectParameterValues),
      );
      verdicts[String(verdict)] = (verdicts[String(verdict)] ?? 0) + 1;
      const s = useWorkspace.getState();
      // A history box carries nothing but its indication, so a correct click
      // leaves the whole body untouched. Checking for the phrase itself would
      // miss it: the merge engine canonicalises some of these sentences on the
      // way in, and nine of the eleven wrote while not containing their own
      // exact text.
      const written = SECTIONS
        .map((x) => [x, (s[`${x}Text` as keyof typeof s] as string | undefined) ?? ""] as const)
        .filter(([, text]) => text.trim().length > 0)
        .map(([x, text]) => `${box.label} → ${x}: ${text.slice(0, 120)}`);
      faults.push(...written);
    }
    expect(faults, `overlay verdicts: ${JSON.stringify(verdicts)}`).toEqual([]);
  });

  it("carries the history sentence on the patch as a Clinical History contribution", () => {
    for (const { index } of HISTORY) {
      const box = seedBox(index);
      const patch = quickFindingPatch(box, { region: box.studyType || "Brain" });
      expect(patch.clinicalHistory, box.label).toBe(box.findingText.trim());
      for (const section of SECTIONS) {
        expect((patch.incoming as Record<string, string | undefined>)[section] ?? "", `${box.label} still writes ${section}`).toBe("");
      }
    }
  });

  it("routes every shipped box once, and only a history box to Clinical History", () => {
    const misrouted: string[] = [];
    let historyCount = 0;
    for (let i = 0; i < SEED.length; i++) {
      const box = seedBox(i);
      const route = quickFindingClickRoute(quickFindingPatch(box, { region: box.studyType || "Brain" }));
      const isHistory = isClinicalHistoryBox(box);
      if (isHistory) historyCount++;
      if (isHistory && route.clinicalHistory === null) misrouted.push(`${box.label}: history box contributes nothing`);
      if (!isHistory && route.clinicalHistory !== null) misrouted.push(`${box.label}: body box routed to Clinical History`);
      // `writesBody` must agree with what the box actually declares outside its
      // history sentence, or a mixed box loses a half of its click.
      const carriesBody = [box.impressionText, box.techniqueText, box.recommendationText]
        .some((t) => (t ?? "").trim().length > 0)
        || (!isHistory && (box.findingText ?? "").trim().length > 0);
      if (route.writesBody !== carriesBody) {
        misrouted.push(`${box.label}: writesBody=${String(route.writesBody)} but the box carries ${String(carriesBody)}`);
      }
    }
    expect(misrouted).toEqual([]);
    expect(historyCount).toBe(HISTORY.length);
  });

  it("obeying the route puts every shipped indication in Clinical History and nowhere else", () => {
    const faults: string[] = [];
    for (const { tile, index } of HISTORY) {
      const box = seedBox(index);
      resetFor(tile.scopeModality ?? "MR", tile.scopeBodyPart || "Brain");
      const route = quickFindingClickRoute(quickFindingPatch(box, { region: tile.scopeBodyPart || "Brain" }));
      if (!route.clinicalHistory) { faults.push(`${box.label}: not routed`); continue; }
      if (route.writesBody) { faults.push(`${box.label}: routed into the body as well`); continue; }
      useWorkspace.getState().toggleClinicalHistoryContribution(route.clinicalHistory, true, "");
      const s = useWorkspace.getState();
      if (!s.clinicalHistoryText.includes(box.findingText.trim())) {
        faults.push(`${box.label}: absent from Clinical History (${s.clinicalHistoryText})`);
      }
      for (const section of SECTIONS) {
        if (String(s[`${section}Text` as keyof typeof s]).trim()) faults.push(`${box.label} → ${section}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it("leaves the other three sections of a history box alone when it carries them", () => {
    // A box authored as history that ALSO declares an impression line keeps that
    // line in Impression. Routing is per sentence, per column — not per box.
    const box: ClinicalQuickFindingBox & { field: string } = {
      ...seedBox(HISTORY[0]!.index),
      impressionText: "No acute intracranial abnormality.",
    };
    resetFor();
    useWorkspace.getState().applyPathologyOverlay(quickFindingPatch(box, { region: "Brain" }));
    const s = useWorkspace.getState();
    expect(s.impressionText).toContain("No acute intracranial abnormality.");
    expect(s.findingsText).toBe("");
    expect(s.clinicalHistoryText).toBe("");
  });
});

describe("the Clinical History contribution a history box makes", () => {
  const PHRASE = "Known case of glioma post-resection. Follow-up for recurrence.";

  beforeEach(() => resetFor());

  it("appends to Clinical History and changes no other section", () => {
    const verdict = useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    const s = useWorkspace.getState();
    expect(verdict).toBe("applied");
    expect(s.clinicalHistoryText).toBe(PHRASE);
    for (const section of ["findingsText", "impressionText", "techniqueText", "recommendationText"]) {
      expect(s[section as keyof typeof s], section).toBe("");
    }
  });

  it("never writes the same indication twice", () => {
    const state = useWorkspace.getState();
    state.toggleClinicalHistoryContribution(PHRASE, true, "");
    state.toggleClinicalHistoryContribution(PHRASE, true, "");
    const text = useWorkspace.getState().clinicalHistoryText;
    expect(text.split(PHRASE).length - 1, text).toBe(1);
  });

  it("keeps the radiologist's own wording and withdraws only the phrase it inserted", () => {
    useWorkspace.setState({ clinicalHistoryText: "Headache for three weeks.\n" });
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    const after = useWorkspace.getState().clinicalHistoryText;
    expect(after.startsWith("Headache for three weeks."), after).toBe(true);

    const removed = useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, false, "");
    expect(removed).toBe("removed");
    expect(useWorkspace.getState().clinicalHistoryText).toBe("Headache for three weeks.");
  });

  it("leaves an edited phrase exactly as the radiologist left it", () => {
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    useWorkspace.setState({ clinicalHistoryText: "Known case of glioma post-resection. Two years off treatment." });
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, false, "");
    expect(useWorkspace.getState().clinicalHistoryText)
      .toBe("Known case of glioma post-resection. Two years off treatment.");
  });

  it("refuses a laterality phrase nobody gave a side to, and writes nothing", () => {
    const sided = "Weakness on the {side} side, sudden onset.";
    const verdict = useWorkspace.getState().toggleClinicalHistoryContribution(sided, true, "");
    expect(verdict).toBe("refused");
    expect(useWorkspace.getState().clinicalHistoryText).toBe("");
    // With a side chosen it lands, resolved — the same rule the chips apply.
    expect(useWorkspace.getState().toggleClinicalHistoryContribution(sided, true, "left")).toBe("applied");
    expect(useWorkspace.getState().clinicalHistoryText).toContain("Weakness on the left side");
  });

  it("refuses on a signed report", () => {
    useWorkspace.setState({ isFinalized: true });
    const verdict = useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    expect(verdict).toBe("refused");
    expect(useWorkspace.getState().clinicalHistoryText).toBe("");
  });

  it("is one undo frame for one click", () => {
    useWorkspace.setState({ clinicalHistoryText: "Headache for three weeks." });
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    expect(useWorkspace.getState().clinicalHistoryText).toContain(PHRASE);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().clinicalHistoryText).toBe("Headache for three weeks.");
  });

  it("tidies only the seam it leaves, keeping the sentences either side", () => {
    // The phrase sits between two things the radiologist wrote. A removal that
    // just cuts the characters out leaves a double space where the sentence used
    // to join; a removal that reflows the field rewrites what they typed. This
    // section's rule is neither, and it is the rule that keeps a withdrawal from
    // becoming an edit.
    useWorkspace.setState({
      clinicalHistoryText: `Headache for three weeks. ${PHRASE} No visual disturbance.`,
    });
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, false, "");
    expect(useWorkspace.getState().clinicalHistoryText)
      .toBe("Headache for three weeks. No visual disturbance.");
  });

  it("marks the report dirty so the draft save sees the click", () => {
    useWorkspace.setState({ isDirty: false });
    useWorkspace.getState().toggleClinicalHistoryContribution(PHRASE, true, "");
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("treats an empty phrase as nothing to contribute", () => {
    expect(useWorkspace.getState().toggleClinicalHistoryContribution("   ", true, "")).toBe("refused");
    expect(useWorkspace.getState().clinicalHistoryText).toBe("");
  });
});

describe("the click path consults the routing before it builds a body patch", () => {
  // The workspace hook is a React hook with no renderer in this package's test
  // setup, so this one is a source contract. Everything above is executable and
  // population-wide; this exists because the routing lives in one caller, and a
  // caller that stopped consulting it would silently write history into
  // Findings again. It pins the order, not a spelling: the predicate is read,
  // and the history contribution is written, before the overlay is asked.
  it("routes through Clinical History in useWorkspaceClinicalUi", () => {
    const source = readHookSource();
    const toggle = sliceFrom(source, "const handleQuickToggle = useCallback");
    // The route decision itself is executable and population-wide (above). This
    // pins only that the handler makes it and obeys it before asking the overlay
    // to write anything. The guard is matched as a condition rather than as a
    // substring on purpose: an earlier version of this assertion accepted
    // `if (false && patch.clinicalHistory)` and so let the whole branch survive
    // while doing nothing.
    expect(toggle).toContain("quickFindingClickRoute(patch)");
    expect(toggle, "the history guard must be live, not short-circuited").toMatch(/if \(route\.clinicalHistory\) \{/);
    expect(toggle).toContain("toggleClinicalHistoryContribution");
    expect(
      toggle.indexOf("toggleClinicalHistoryContribution"),
      "the history branch must precede the overlay call it replaces",
    ).toBeLessThan(toggle.indexOf("applyPathologyOverlay"));
  });

  it("lights a history box from the section it wrote, in the panel that offers it", () => {
    // The panel is the only surface that offers a clinical-history box at all —
    // every strip filters by `field`, and none renders `clinicalHistory`. Its
    // selected state comes from the ledger, and a history box has no ledger row,
    // so a panel that read only `selectedIds` would write the indication and show
    // nothing lit: the next click would be taken for a first one and duplicate it.
    const panel = readPanelSource();
    const active = sliceFrom(panel, "const isFindingActive =", "\n  /**");
    expect(active).toContain("hasHistoryChipContribution");
    expect(active).toContain("clinicalHistoryText");
    expect(panel).toContain("onToggle(f, !isFindingActive(f))");
    expect(panel).toContain("const selected = isFindingActive(f)");
  });

  it("gives both Quick Select panels the section they read", () => {
    // Two hosts render the panel. One of them left without the text would offer
    // the same box with a chip that never lights, which is the defect above.
    for (const host of [
      "components/radiology/workspace/ReportCanvas.tsx",
      "components/radiology/workspace/ReportingToolsRail.tsx",
    ]) {
      const src = readSource(host);
      expect(src, host).toMatch(/<QuickFindingsPanel[\s\S]{0,2600}?clinicalHistoryText=\{clinicalHistoryText\}/);
    }
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSource(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
}

function readHookSource(): string {
  return readSource("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
}

function readPanelSource(): string {
  return readSource("components/radiology/QuickFindingsPanel.tsx");
}

function sliceFrom(source: string, marker: string, endMarker = "\n  }, ["): string {
  const start = source.indexOf(marker);
  expect(start, `the source no longer contains ${marker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end, `the slice from ${marker} never closed`).toBeGreaterThan(start);
  return source.slice(start, end);
}
