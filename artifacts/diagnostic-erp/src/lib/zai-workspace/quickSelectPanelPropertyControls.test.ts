/**
 * Audit item 18 — "connect the side/level/severity property controls".
 *
 * The Clinic Quick Select panel (`QuickFindingsPanel.tsx`, the box list under
 * "Clinic Quick Select" on the report canvas) renders a chip row under a selected
 * box. That row used to be UNREACHABLE: it returned null unless the parent passed
 * `onUpdateInstance`, and no call site in the repository ever did. The same two
 * props (`instances`, `onUpdateInstance`) were read by nothing either — the
 * workspace hook had no per-box property state at all.
 *
 * The consequence is not cosmetic. Measured against the catalogue the development
 * database holds (558 active boxes): 84 write `{level}` into a sentence, 17 write
 `{severity}`,
 * and `handleQuickToggle`'s fallback params were `{ side: quickSide }` alone. The
 * boundary that applies a Quick Select click (`store.ts` → `unresolvedQuickSelectParameters`
 * → "refused") resolves ONLY side/severity/level and only from `opts.severity` /
 * `opts.level` — there is no study-wide default behind them. So every one of those
 * boxes, clicked from this panel, wrote nothing, and the toast that said so told
 * the radiologist to "Pick it in the Quick Select bar" — a control this surface
 * does not have. The strip has had its own bar all along; the panel never did.
 *
 * What these tests pin:
 *   1. the boundary verdict for the two parameter families, in the exact shape the
 *      panel now sends (shipped wording, not a fixture sentence);
 *   2. that the panel's chip answers are the ONLY thing that can complete those
 *      sentences — an unanswered click still refuses, so no level is ever guessed;
 *   3. that every shipped box asking for a level or a severity is satisfiable by
 *      the chips that are now offered for it, and asks nothing the panel cannot
 *      answer (a box that asks what no chip offers is the defect class);
 *   4. every level the datalist offers passes the grammar that validates the
 *      click — an option the grammar rejects would refuse the click it advertises;
 *   5. the wiring itself, as a source contract (this package has no DOM harness):
 *      both mount sites pass both props, the panel reads what to show from the
 *      box's own sentences rather than the free-text `properties` column, the chip
 *      row is a module-scope component so typing a level is not remounted away,
 *      `side` stays study-wide, and the answers are cleared per patient.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./store";
import {
  quickFindingPatch,
  quickPanelClickParams,
  quickPropertyChipDecision,
  type ClinicalQuickFindingBox,
} from "./quickSelectTilePayload";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { MRI_LS_SPINE_STANDARD_NORMAL_NAME } from "./fullReportBaseline";
import {
  QUICK_SELECT_SEVERITIES,
  STANDARD_SPINE_LEVELS,
  isSuppliedLevel,
  quickSelectParametersIn,
  resolvedQuickSelectLevel,
  resolvedQuickSelectSeverity,
  unresolvedQuickSelectParameters,
} from "./quickSelectParameterContract";
import { quickSelectBoxWrittenText } from "./quickSelectBoxCatalogue";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";

const CTX = { region: "LS Spine", studyType: "LS Spine" };
const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_LS_SPINE_STANDARD_NORMAL_NAME)!;

/**
 * A contrast-only box, copied from the shape #448 has in the catalogue: the
 * boundary's contrast guard reads the prose, so this is the box the chip handler
 * must refuse to rewrite on a study reported without contrast.
 */
const GLIOMA_RECURRENCE: ClinicalQuickFindingBox = {
  id: 448,
  label: "Glioma recurrence",
  studyType: "Brain",
  field: "findings",
  findingText:
    "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, "
    + "with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for "
    + "tumor recurrence.",
  impressionText:
    "Heterogeneously enhancing lesion in the right frontal operculum with surrounding edema. "
    + "Findings are concerning for tumor recurrence.",
  techniqueText: "",
  recommendationText: "Urgent oncology referral.",
};

/**
 * The wiring is pinned by reading the shipped files: this package has no DOM
 * harness (no `renderHook` anywhere in it), so a rule that lives only in a hook
 * body could previously only be checked by eye. Anything that CAN be driven is
 * driven above — `quickPanelClickParams` exists so the panel's answer set is a
 * function these tests can call.
 */
const panel = readSource("../../components/radiology/QuickFindingsPanel.tsx");
const hook = readSource("../../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const canvas = readSource("../../components/radiology/workspace/ReportCanvas.tsx");
const rail = readSource("../../components/radiology/workspace/ReportingToolsRail.tsx");
const strip = readSource("../../components/radiology/zai-workspace/quick-select-strip.tsx");
const contract = readSource("./quickSelectParameterContract.ts");

type CatalogTile = (typeof DEFAULT_QUICK_SELECT_TILES)[number];

function tile(label: string): CatalogTile {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`Quick Select tile "${label}" is missing from the catalog`);
  return found as CatalogTile;
}

/**
 * The box as `/api/radiology/quick-findings` returns one and the panel holds it —
 * the same adapter `quickSelectLsSpineImpressions.test.ts` uses, so these clicks
 * go through the builder the live panel uses (`quickFindingPatch`) rather than a
 * hand-written payload. `id` is per-test only: the production row id decides the
 * ledger row id, and a fixture id is as good as any for a pure builder.
 */
function box(label: string, id: number): ClinicalQuickFindingBox {
  const t = tile(label) as unknown as CatalogTile & Record<string, string | undefined>;
  return {
    id,
    label: t.label,
    studyType: "LS Spine",
    findingText: t.sentence,
    impressionText: (t as unknown as { impressionSentence?: string }).impressionSentence ?? "",
    techniqueText: "",
    recommendationText: (t as unknown as { recommendationSentence?: string }).recommendationSentence ?? "",
    concept: t.concept ?? null,
    anatomicalSection: t.anatomicalSection,
    conflictGroup: t.conflictGroup,
    baselineReplaces: t.baselineReplaces,
    properties: t.properties,
    field: t.field,
  };
}

const S = () => useWorkspace.getState();
const findings = () => S().findingsText;
const impression = () => S().impressionText;

function openNormalLsSpine() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    impressionNeedsRefresh: false,
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    startingCanvasBaseline: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
  });
  S().applyFormatById(LS_NORMAL.id);
}

const hasSentence = (text: string, sentence: string) =>
  splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence));

beforeEach(() => {
  vi.restoreAllMocks();
  openNormalLsSpine();
});

describe("the two parameter families at the store boundary, in the shape the panel sends", () => {
  it("writes the chosen spine level into the shipped sentence", () => {
    const b = box("Facet arthropathy (pick level)", 4001);
    expect(S().applyPathologyOverlay(quickFindingPatch(b, CTX, { level: "L2-L3" }))).toBe("applied");
    expect(hasSentence(findings(), "Facet arthropathy at L2-L3.")).toBe(true);
    expect(impression()).toContain("Facet arthropathy at L2-L3.");
    expect(impression()).not.toContain("{level}");
  });

  it("writes the chosen severity and the study-wide side into the shipped sentence", () => {
    const b = box("Foraminal stenosis L4-L5", 4002);
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, { side: "left", severity: "moderate" }),
    )).toBe("applied");
    expect(findings().toLowerCase()).toContain("moderate left neural foraminal stenosis at l4-l5");
    expect(impression().toLowerCase()).toContain("moderate left neural foraminal stenosis at l4-l5");
    expect(impression()).not.toContain("{severity}");
  });

  it("a grade change replaces the sentence in place — one row, not two conclusions", () => {
    // The chip-move path withdraws and re-applies through the same builder; this
    // is the invariant that re-apply depends on: mild → severe leaves ONE
    // conclusion about the foramina, and it says severe.
    const b = box("Foraminal stenosis L4-L5", 4003);
    S().applyPathologyOverlay(quickFindingPatch(b, CTX, { side: "left", severity: "moderate" }));
    S().applyPathologyOverlay(quickFindingPatch(b, CTX, { side: "left", severity: "severe" }));
    const lines = impression().split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.filter((l) => /neural foraminal stenosis at l4-l5/i.test(l))).toHaveLength(1);
    expect(lines.join(" ")).toMatch(/severe left neural foraminal stenosis/i);
    expect(lines.join(" ")).not.toMatch(/moderate left neural foraminal/i);
  });
});

describe("the panel's own answer set (quickPanelClickParams)", () => {
  it("is what a panel click carries, and the strip/dialog/voice answers still win", () => {
    // The hook may only fall back to it — a caller that asked the radiologist
    // directly passes `params`, and this box's chip must not overwrite that.
    expect(hook).toMatch(/params\s*\?\?\s*quickPanelClickParams\(quickInstances\.get\(finding\.id\), quickSide\)/);
  });

  it("an unanswered box reaches the boundary with nothing chosen, and is refused", () => {
    // This is the pre-fix shape, now named: the panel supplied no severity and no
    // level for any box, so 84 `{level}` and 17 `{severity}` boxes could not be
    // clicked from it at all.
    const b = box("Facet arthropathy (pick level)", 4100);
    const before = { findings: findings(), impression: impression(), rows: S().appliedPathologyPatches.length };
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, quickPanelClickParams(undefined, "left")),
    )).toBe("refused");
    expect(findings()).toBe(before.findings);
    expect(S().appliedPathologyPatches.length).toBe(before.rows);
  });

  it("the chip's answer is what makes the same click land", () => {
    const b = box("Facet arthropathy (pick level)", 4101);
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, quickPanelClickParams({ level: "L3-L4" }, "left")),
    )).toBe("applied");
    expect(hasSentence(findings(), "Facet arthropathy at L3-L4.")).toBe(true);
  });

  it("carries a held severity into the sided sentence with the study-wide side", () => {
    const b = box("Foraminal stenosis L4-L5", 4102);
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, quickPanelClickParams({ severity: "severe" }, "right")),
    )).toBe("applied");
    expect(findings().toLowerCase()).toContain("severe right neural foraminal stenosis at l4-l5");
  });

  it("an empty chip answer is not a default: clearing the severity refuses again", () => {
    const b = box("Foraminal stenosis L4-L5", 4103);
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, quickPanelClickParams({ severity: "" }, "left")),
    )).toBe("refused");
    expect(impression()).not.toMatch(/neural foraminal stenosis/i);
  });

  it("never invents a side the study-wide selector has not answered", () => {
    expect(quickPanelClickParams(undefined, "")).toEqual({ side: "", severity: "", level: "" });
    const b = box("Foraminal stenosis L4-L5", 4104);
    expect(S().applyPathologyOverlay(
      quickFindingPatch(b, CTX, quickPanelClickParams({ severity: "mild" }, "")),
    )).toBe("refused");
  });
});

describe("an unanswered chip still refuses — the panel never guesses a level or a grade", () => {
  it("refuses a {level} box whose chip is empty, and writes nothing", () => {
    const before = { findings: findings(), impression: impression(), rows: S().appliedPathologyPatches.length };
    // This is the pre-fix shape: `handleQuickToggle` passed `{ side: quickSide }`
    // and no level at all, which is why every click on these boxes was refused.
    expect(S().applyPathologyOverlay(quickFindingPatch(box("Facet arthropathy (pick level)", 4004), CTX))).toBe("refused");
    expect(S().applyPathologyOverlay(
      quickFindingPatch(box("Facet arthropathy (pick level)", 4004), CTX, { level: "" }),
    )).toBe("refused");
    expect(findings()).toBe(before.findings);
    expect(impression()).toBe(before.impression);
    expect(S().appliedPathologyPatches.length).toBe(before.rows);
  });

  it("refuses a {severity} box whose chip is empty, and writes nothing", () => {
    const b = box("Foraminal stenosis L4-L5", 4005);
    const before = { findings: findings(), impression: impression(), rows: S().appliedPathologyPatches.length };
    expect(S().applyPathologyOverlay(quickFindingPatch(b, CTX, { side: "left" }))).toBe("refused");
    expect(findings()).toBe(before.findings);
    expect(S().appliedPathologyPatches.length).toBe(before.rows);
  });

  it("the guard the chip handler uses sees exactly what the boundary sees", () => {
    // `handleUpdateQuickInstance` decides to withdraw a box by asking
    // `unresolvedQuickSelectParameters` the same question the store asks, over the
    // same `templates` field. If the two ever disagree, the control and the report
    // disagree — so both halves are asserted on one patch here.
    const b = box("Facet arthropathy (pick level)", 4006);
    const unanswered = quickFindingPatch(b, CTX, { level: "" });
    expect(unresolvedQuickSelectParameters(unanswered.templates ?? {}, { side: "", level: "" }))
      .toEqual(["level"]);
    expect(S().applyPathologyOverlay(unanswered)).toBe("refused");

    const answered = quickFindingPatch(b, CTX, { level: "L4-L5" });
    expect(unresolvedQuickSelectParameters(answered.templates ?? {}, { side: "", level: "L4-L5" }))
      .toEqual([]);
    expect(S().applyPathologyOverlay(answered)).toBe("applied");
  });
});

describe("every shipped box that asks for a parameter has a chip that can answer it", () => {
  const asking = (name: "level" | "severity") => DEFAULT_QUICK_SELECT_TILES.filter((t) => {
    const text = [
      (t as unknown as Record<string, string | undefined>).sentence,
      (t as unknown as Record<string, string | undefined>).impressionSentence,
      (t as unknown as Record<string, string | undefined>).techniqueSentence,
      (t as unknown as Record<string, string | undefined>).recommendationSentence,
    ].filter(Boolean).join(" ");
    return quickSelectParametersIn(text).has(name);
  });

  it("the shipped level boxes are satisfied by one level answer and nothing else", () => {
    const levelTiles = asking("level");
    expect(levelTiles.length).toBeGreaterThan(0);
    for (const t of levelTiles) {
      const b = box(t.label, 5000);
      const patch = quickFindingPatch(b, CTX, { side: "left", severity: "moderate", level: "L2-L3" });
      expect(
        unresolvedQuickSelectParameters(patch.templates ?? {}, { side: "left", severity: "moderate", level: "L2-L3" }),
        `box "${t.label}" asks for something no chip answers`,
      ).toEqual([]);
    }
  });

  it("the shipped severity boxes are satisfied by the severity chips", () => {
    const severityTiles = asking("severity");
    expect(severityTiles.length).toBeGreaterThan(0);
    for (const t of severityTiles) {
      const b = box(t.label, 5100);
      const patch = quickFindingPatch(b, CTX, { side: "left", severity: "moderate", level: "L2-L3" });
      expect(
        unresolvedQuickSelectParameters(patch.templates ?? {}, { side: "left", severity: "moderate", level: "L2-L3" }),
        `box "${t.label}" asks for something no chip answers`,
      ).toEqual([]);
    }
  });

  it("no shipped box can be satisfied by a level the grammar would reject", () => {
    // The datalist is what a radiologist reaches for; the grammar is what decides
    // the click. One entry that the grammar refuses is a chip that refuses the
    // click it advertises, so the list is checked against the authority rather
    // than against a typed-out expectation of it.
    for (const level of STANDARD_SPINE_LEVELS) {
      expect(resolvedQuickSelectLevel(level), `datalist option "${level}"`).not.toBe("");
      expect(isSuppliedLevel(level), `datalist option "${level}"`).toBe(true);
    }
    for (const severity of QUICK_SELECT_SEVERITIES) {
      expect(resolvedQuickSelectSeverity(severity), `severity chip "${severity}"`).toBe(severity);
    }
  });
});

describe("what one chip move does to the report (quickPropertyChipDecision)", () => {
  it("keeps the answer when the box is not on the report, without consulting the preview", () => {
    const b = box("Facet arthropathy (pick level)", 4200);
    const patch = quickFindingPatch(b, CTX, { level: "L2-L3" });
    let asked = 0;
    const d = quickPropertyChipDecision({
      sections: patch.templates!,
      values: { side: "left", level: "L2-L3" },
      onPage: false,
      previewRefusal: () => { asked += 1; return "contrast-only box on a study reported without contrast"; },
    });
    expect(d.action).toBe("store-only");
    expect(asked).toBe(0);
  });

  it("withdraws a box whose answer no longer completes its own sentence", () => {
    // The M10 class: leaving it on the report would keep the OLD wording under a
    // control that now shows nothing, and the boundary refuses the re-apply, so
    // the only honest outcome is that the sentence goes with the answer.
    const b = box("Facet arthropathy (pick level)", 4201);
    const patch = quickFindingPatch(b, CTX, { level: "" });
    let asked = 0;
    const d = quickPropertyChipDecision({
      sections: patch.templates!,
      values: { side: "left", level: "" },
      onPage: true,
      previewRefusal: () => { asked += 1; return ""; },
    });
    expect(d.action).toBe("withdraw");
    expect(asked).toBe(0);
    expect(S().applyPathologyOverlay(patch)).toBe("refused");
  });

  it("changes nothing when the re-apply would be refused, and carries the refusal back", () => {
    const b = box("Facet arthropathy (pick level)", 4202);
    const patch = quickFindingPatch(b, CTX, { level: "L2-L3" });
    const d = quickPropertyChipDecision({
      sections: patch.templates!,
      values: { side: "left", level: "L2-L3" },
      onPage: true,
      previewRefusal: () => "contrast-only box on a study reported without contrast",
    });
    expect(d.action).toBe("unchanged");
    expect(d.refusal).toMatch(/^contrast/);
  });

  it("withdraws and writes again when nothing objects, asking the preview once", () => {
    const b = box("Facet arthropathy (pick level)", 4203);
    const patch = quickFindingPatch(b, CTX, { level: "L4-L5" });
    let asked = 0;
    const d = quickPropertyChipDecision({
      sections: patch.templates!,
      values: { side: "left", level: "L4-L5" },
      onPage: true,
      previewRefusal: () => { asked += 1; return ""; },
    });
    expect(d.action).toBe("re-apply");
    expect(asked).toBe(1);
  });

  it("the prefix the refusal branch reads is the one the live preview produces", () => {
    // Not a hand-written string: if `previewPathologyOverlay` ever stopped
    // prefixing its contrast verdict, `startsWith("contrast")` would be a guard
    // that never fires, and the box would be withdrawn anyway.
    useWorkspace.setState({
      reportingContext: buildReportingStudyContext({
        modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
      }),
    } as never);
    const patch = quickFindingPatch(GLIOMA_RECURRENCE, { region: "Brain", studyType: "Brain" }, {});
    const rows = S().appliedPathologyPatches;
    const d = quickPropertyChipDecision({
      sections: patch.templates!,
      values: { side: "", severity: "", level: "" },
      onPage: true,
      previewRefusal: () => S().previewPathologyOverlay(patch).refusal ?? "",
    });
    expect(d.action).toBe("unchanged");
    expect(d.refusal.startsWith("contrast")).toBe(true);
    // …and asking cost nothing: the read-only half wrote no row and deleted none.
    expect(S().appliedPathologyPatches.length).toBe(rows.length);
    expect(S().appliedPathologyPatches.some((p) => p.catalogId === 448)).toBe(false);
  });
});

describe("the panel wiring (source contract)", () => {
  it("both call sites pass the two props that make the chip row reachable", () => {
    for (const [name, src] of [["ReportCanvas", canvas], ["ReportingToolsRail", rail]] as const) {
      expect(src, `${name} mounts QuickFindingsPanel`).toContain("<QuickFindingsPanel");
      expect(src, `${name} passes the held property answers`).toContain("instances={quickInstances}");
      expect(src, `${name} passes the chip handler`).toContain("onUpdateInstance={handleUpdateQuickInstance}");
    }
  });

  it("what the chips ask is read from the box's own sentences, not the properties column", () => {
    expect(panel).toContain("quickSelectParametersIn(quickSelectBoxWrittenText(f))");
    expect(panel).not.toMatch(/parseProperties\(f\.properties\)/);
    // 18 of the 84 level boxes never declare "level" in `properties`; deriving the
    // row from that column is how a box asks for something no chip offers.
  });

  it("the chip row offers severity and level only — laterality stays study-wide", () => {
    const row = panel.slice(panel.indexOf("export function PropertyChips("), panel.indexOf("export default function QuickFindingsPanel("));
    expect(row).toContain('asked.has("severity")');
    expect(row).toContain('asked.has("level")');
    expect(row).not.toMatch(/inst\.side/);
    expect(row).not.toMatch(/\{\s*side:/);
    expect(row).not.toMatch(/chronicity|inst\.value/);
  });

  it("the chip row is a module-scope component, so a typed level survives the next keystroke", () => {
    // A component declared inside the panel's render body gets a new function
    // identity on every render; React treats that as a new subtree and remounts
    // the `<input>`, which drops focus after one character.
    expect(panel).toMatch(/^export function PropertyChips\(/m);
    expect(panel).not.toMatch(/^\s+function PropertyChips\(/m);
  });

  it("the answers belong to the patient on screen and are cleared for the next one", () => {
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*setQuickSide\(""\);\s*setQuickInstances\(new Map\(\)\);\s*\}, \[activeStudyId\]\);/);
  });

  it("the handler asks that decision and saves nothing the report disagrees with", () => {
    const handler = hook.slice(hook.indexOf("const handleUpdateQuickInstance"));
    expect(handler).toMatch(
      /quickPropertyChipDecision\(\{[\s\S]*?previewRefusal: \(\) => useWorkspace\.getState\(\)\.previewPathologyOverlay\(patch\)\.refusal \?\? ""/,
    );
    // The unchanged path returns BEFORE the answer is stored: a chip showing a
    // value the report does not carry is the same disagreement, other direction.
    const unchanged = handler.indexOf('if (decision.action === "unchanged") {');
    const saved = handler.indexOf("setQuickInstances(store);");
    expect(unchanged).toBeGreaterThan(-1);
    expect(unchanged).toBeLessThan(saved);
    expect(handler.slice(unchanged, saved)).toContain("return;");
    expect(handler).toMatch(/if \(decision\.action === "store-only"\) return;/);
    expect(handler).toMatch(/if \(decision\.action === "re-apply"\) handleQuickToggle\(finding, true, params\);/);
  });

  it("one level list for both surfaces", () => {
    expect(contract).toMatch(/export const STANDARD_SPINE_LEVELS/);
    expect(strip).not.toMatch(/const STANDARD_SPINE_LEVELS/);
    expect(panel).not.toMatch(/const STANDARD_SPINE_LEVELS/);
    // Each surface imports the shared list rather than holding its own — two
    // typed-out lists are how a chip offers a level the report then prints
    // differently.
    for (const [name, src] of [["strip", strip], ["panel", panel]] as const) {
      expect(src, `${name} names the shared level list`).toContain("STANDARD_SPINE_LEVELS,");
      expect(src, `${name} takes it from the parameter contract`).toContain(
        '} from "@/lib/zai-workspace/quickSelectParameterContract";');
    }
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}
