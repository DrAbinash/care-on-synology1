import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Quick Select box must not print an anatomical side nobody chose.
 *
 * WHY THIS FILE EXISTS. Three shipped tiles did. "Pneumothorax" — labelled
 * generically and categorised `critical` — wrote, verbatim:
 *
 *   "Tension pneumothorax on the right with mediastinal shift to the left."
 *
 * One click therefore asserted tension physiology, a right-sided pneumothorax
 * and a leftward mediastinal shift, none of which the radiologist had said, and
 * the same click wrote the row into the ledger as the radiologist's own
 * observation. "Pulmonary nodule" placed the nodule in the right upper lobe and
 * mammography's "Spiculated mass" in the right upper outer quadrant. Two of the
 * three sit on the `favorite`/`critical` strips a reporting radiologist sees
 * first.
 *
 * The mechanism to fix them was already shipped and already used by the
 * renal-calculus, meniscus, rotator-cuff, hip and maxillary-sinus tiles: `{side}`
 * in the prose plus `properties:"side"` makes the strip render its
 * Right/Left/Bilateral control, and `unresolvedQuickSelectParameters` refuses the
 * click until one is chosen. These three had simply never been converted.
 *
 * WHY THE CENSUS IS SCOPED TO CHEST AND BREAST. The rule is measured over every
 * tile in the two body parts this change converts. It is not repo-wide: the brain
 * tiles belong to the brain correction workstream (see the owner's file-ownership
 * ruling), and several shipped tiles use "bilateral" or "right upper quadrant" as
 * description rather than as the side a lesion sits on. A rule that swept those in
 * would be a list of noise rather than a check on anything.
 */

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "@/lib/zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { Side } from "@/lib/sideSwap";

function tile(label: string): QuickSelectTile {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`shipped tile missing: ${label}`);
  return found;
}

function chestContext() {
  return buildReportingStudyContext({
    modality: "CT",
    studyDescription: "CT Chest",
    regions: ["Chest"],
    source: "auto",
  });
}

function reset() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: chestContext(),
    studies: [{ id: "audit-study", patient: { name: "SYN Audit", sex: "M" }, modality: "CT" }],
    activeStudyId: "audit-study",
    activeStudyInstanceUID: "1.2.826.AUDIT",
    completedStudyIds: new Set<string>(),
  } as never);
}

/** Every side word the tile's own prose asserts. */
function statedSides(t: QuickSelectTile): number {
  const text = [t.sentence, t.impressionSentence ?? "", t.recommendationSentence ?? ""].join(" ");
  return [...text.matchAll(/\b(right|left|bilateral)\b/gi)].length;
}

/** Whether the tile asks for the side instead of deciding it. */
function asksForSide(t: QuickSelectTile): boolean {
  return (t.properties ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes("side");
}

function click(label: string, side?: Side | "") {
  return useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tile(label), "findings", side === undefined ? {} : { side }),
  );
}

describe("the three converted boxes", () => {
  beforeEach(reset);

  it("ask for a side, and no longer decide one", () => {
    const px = tile("Pneumothorax");
    expect(asksForSide(px)).toBe(true);
    expect(px.sentence).toBe("Pneumothorax on the {side}.");
    // "Tension" and "mediastinal shift" are separate diagnoses, not a fuller
    // way of saying "pneumothorax". A box cannot be allowed to add them.
    expect(px.sentence.toLowerCase()).not.toMatch(/tension|shift|mediastin/);

    const nodule = tile("Pulmonary nodule");
    expect(asksForSide(nodule)).toBe(true);
    expect(nodule.sentence).toContain("in the {side} upper lobe");
    expect(nodule.sentence.toLowerCase()).not.toMatch(/\b(right|left)\b/);

    const mass = tile("Spiculated mass");
    expect(asksForSide(mass)).toBe(true);
    expect(mass.sentence).toContain("in the {side} upper outer quadrant");
    expect(mass.sentence.toLowerCase()).not.toMatch(/\b(right|left)\b/);
  });

  it("refuses a click with no side chosen, and writes nothing", () => {
    for (const label of ["Pneumothorax", "Pulmonary nodule", "Spiculated mass"]) {
      reset();
      const before = useWorkspace.getState().findingsText;
      expect(click(label), `${label} applied without a chosen side`).not.toBe("applied");
      const s = useWorkspace.getState();
      expect(s.findingsText).toBe(before);
      expect(s.appliedPathologyPatches).toHaveLength(0);
    }
  });

  it.each(["left", "right", "bilateral"] as const)("writes the chosen side into Pneumothorax: %s", (side) => {
    reset();
    expect(click("Pneumothorax", side)).toBe("applied");
    const text = useWorkspace.getState().findingsText;
    expect(text).toContain(`Pneumothorax on the ${side}.`);
    expect(text).not.toContain("{side}");
    expect(text.toLowerCase()).not.toMatch(/tension|mediastinal shift/);
  });

  it("never leaves an un-substituted {side} on the page", () => {
    reset();
    click("Pulmonary nodule", "left");
    click("Spiculated mass", "right");
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("in the left upper lobe");
    expect(s.findingsText).toContain("in the right upper outer quadrant");
    expect(s.findingsText).not.toContain("{side}");
  });
});

describe("the catalogue rule — no Chest or Breast box states a side it does not ask for", () => {
  it("measured over every CT Chest and MG Breast tile that writes findings prose", () => {
    // Scoped to the body parts this change converts, and deliberately not
    // repo-wide: the brain tiles are the brain workstream's, and several shipped
    // tiles say "bilateral" or "right upper quadrant" as description rather than
    // as a lesion side (the normal-breast parenchyma line, the history shortcuts).
    // A rule that swept those in would be a list of noise, not a safety check.
    const scope = DEFAULT_QUICK_SELECT_TILES.filter(
      (t) => t.field === "findings"
        && (t.scopeBodyPart === "Chest" || t.scopeBodyPart === "Breast"),
    );
    expect(scope.length).toBeGreaterThan(0);
    const offenders = scope
      .filter((t) => statedSides(t) > 0 && !asksForSide(t))
      .map((t) => t.label)
      .sort();
    expect(offenders).toEqual(["Normal breast"]);
    // The NORMAL counterpart of a sided abnormality box: "Bilateral breast
    // parenchyma is symmetric" is a statement about symmetry, not a side a
    // lesion was placed on. It stays; anything else joining this list is a box
    // that decided a side on the radiologist's behalf.
    for (const label of offenders) {
      const t = tile(label);
      expect(statedSides(t), `${label} must only ever say "bilateral"`).toBe(
        [...[t.sentence, t.impressionSentence ?? "", t.recommendationSentence ?? ""].join(" ")
          .matchAll(/\bbilateral\b/gi)].length,
      );
    }
  });
});

describe("the ledger row jump reaches every spine canvas", () => {
  // Clicking a row in the observation ledger selects it and is meant to scroll
  // the report canvas to that level. Each spine canvas anchors its blocks under
  // its OWN segment prefix, so the single unqualified lookup only ever matched
  // lumbar — a cervical or dorsal row click selected the row and moved nothing.
  // This is a coupling test rather than a rendered one (jsdom has no
  // scrollIntoView, and ReportCanvas needs the whole workspace): it reads the
  // prefixes the canvases actually emit and requires the lookup to try each.
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const src = (rel: string) =>
    (readFileSync(join(process.cwd(), "artifacts/diagnostic-erp/src", rel), "utf8") as string)
      .replace(/\r\n/g, "\n");

  it("every anchor prefix a canvas ships is one the lookup tries", () => {
    const canvases = [
      "components/radiology/reporting-canvas/MriLumbarCanvas.tsx",
      "components/radiology/reporting-canvas/MriCervicalCanvas.tsx",
      "components/radiology/reporting-canvas/MriDorsalCanvas.tsx",
      "components/radiology/reporting-canvas/MriDorsoLumbarCanvas.tsx",
    ];
    const anchors = new Set<string>();
    for (const file of canvases) {
      for (const m of src(file).matchAll(/id=\{`r2-([\w-]*?)region-\$\{/g)) {
        anchors.add(m[1] ?? "");
      }
    }
    // Guard the guard: four segments must be found, or this test would pass
    // against an empty set.
    expect([...anchors].sort()).toEqual(["", "cerv-", "dl-", "dors-"]);

    const lookup = src("components/radiology/workspace/ReportCanvas.tsx");
    const tried = /const target = \[([^\]]*)\]/.exec(lookup);
    expect(tried, "the level-anchor lookup is gone from ReportCanvas").not.toBeNull();
    const prefixes = [...tried![1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).sort();
    expect(prefixes).toEqual([...anchors].sort());
  });
});

describe("the production DB door carries the same words", () => {
  it("the newest factory-box seed migration has the converted prose", () => {
    // `radiology_quick_findings` rows are seeded from generated SQL, not from
    // this data file: a repo-side fix that never reaches a new revision does not
    // change what the clinic clicks. Read the newest revision off the disk.
    const { readdirSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const dir = join(process.cwd(), "migrations");
    const files = (readdirSync(dir) as string[])
      .filter((n) => /_quick_select_factory_boxes_r\d{3}_[0-9a-f]{12}\.sql$/.test(n))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    const sql = readFileSync(join(dir, files[files.length - 1]), "utf8").replace(/\r\n/g, "\n");
    expect(sql).toContain("'Pneumothorax on the {side}.'");
    expect(sql).toContain("in the {side} upper lobe");
    expect(sql).toContain("in the {side} upper outer quadrant");
    expect(sql).not.toContain("Tension pneumothorax on the right");
  });

  it("the seed is in step with the catalogue, not merely present", () => {
    // Measured, not assumed: with only the prose assertion above, editing a tile
    // in the data file and forgetting to regenerate the migration left every
    // test green — the SQL still held the OLD sentence and nothing compared the
    // two. The clinic clicks the SQL. This is the comparison.
    const { readdirSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const dir = join(process.cwd(), "migrations");
    const files = (readdirSync(dir) as string[])
      .filter((n) => /_quick_select_factory_boxes_r\d{3}_[0-9a-f]{12}\.sql$/.test(n))
      .sort();
    const sql = readFileSync(join(dir, files[files.length - 1]), "utf8")
      .replace(/\r\n/g, "\n");
    for (const label of ["Pneumothorax", "Pulmonary nodule", "Spiculated mass"]) {
      const sentence = tile(label).sentence.replace(/'/g, "''");
      expect(sql, `${label}: the seed migration still carries prose the catalogue no longer has`)
        .toContain(`'${sentence}'`);
    }
  });
});
