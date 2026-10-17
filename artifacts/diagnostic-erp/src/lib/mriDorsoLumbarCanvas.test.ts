/**
 * mriDorsoLumbarCanvas.test.ts — the Dorso-Lumbar canvas, panel and AP table are
 * mounted as one composition and keep their promises (dorso-lumbar spec §2, §4,
 * §6, §13, §24, §31).
 *
 * There is no DOM render in this repo's test suite, so the UI contract is
 * enforced the same way the dorsal phase enforces it: the behavioural store
 * checks prove the state slice, and the source checks prove the wiring that a
 * later edit would otherwise quietly break — a component keeping its own level
 * array, a second way to apply a tile, a duplicated junction measurement, or
 * billing overwriting what the radiologist stated about the performed study.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  CLINICAL_RESET_FIELDS,
  emptyClinicalState,
} from "@/lib/zai-workspace/clinicalStateReset";
import {
  JUNCTION_LEDGER_REGION,
  JUNCTION_LEVEL,
  defaultDorsoLumbarState,
  dorsolumbarApLevels,
  dorsolumbarLevelKeyStrings,
} from "@/lib/mriDorsoLumbarCoverage";
import { dorsoLumbarLevelEntryOptions } from "@/lib/mriDorsoLumbarLevelEntry";
import { buildDorsoLumbarTileBundle } from "@/lib/mriDorsoLumbarSubMasters";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8");

const CANVAS = "src/components/radiology/reporting-canvas/MriDorsoLumbarCanvas.tsx";
const PANEL = "src/components/radiology/reporting-canvas/MriDorsoLumbarSubMasterPanel.tsx";
const AP_TABLE = "src/components/radiology/reporting-canvas/DorsoLumbarApCanalMeasurements.tsx";
const CANAL_CELL = "src/components/radiology/reporting-canvas/useCanalApCell.ts";
const RAIL = "src/components/radiology/workspace/ReportingToolsRail.tsx";
const HOOK = "src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";

describe("the coverage state slice", () => {
  beforeEach(() => {
    useWorkspace.setState({ dorsoLumbarNumbering: defaultDorsoLumbarState() });
  });

  it("is one store slice that every consumer reads", () => {
    expect(useWorkspace.getState().dorsoLumbarNumbering.superior).toBe(defaultDorsoLumbarState().superior);
    useWorkspace.getState().setDorsoLumbarNumbering({ superior: "T11-T12" });
    const after = useWorkspace.getState().dorsoLumbarNumbering;
    expect(after.superior).toBe("T11-T12");
    // a patch never replaces the whole state
    expect(after.inferior).toBe(defaultDorsoLumbarState().inferior);
    expect(dorsolumbarLevelKeyStrings(after).length).toBeLessThan(
      dorsolumbarLevelKeyStrings(defaultDorsoLumbarState()).length,
    );
  });

  it("resets with the study, so coverage cannot leak between patients", () => {
    // `selectStudy` no longer carries its own inline list of ~61 fields: the
    // clinical reset now lives in one shared definition that all three reset
    // paths spread (`lib/zai-workspace/clinicalStateReset.ts`). The property
    // this test protects is unchanged and is now asserted behaviourally rather
    // than by grepping one line of the store, which is what let the PARTIAL and
    // end-of-queue paths drift while this stayed green.
    expect(CLINICAL_RESET_FIELDS).toContain("dorsoLumbarNumbering");
    expect(emptyClinicalState().dorsoLumbarNumbering).toEqual(defaultDorsoLumbarState());

    const storeSrc = read("src/lib/zai-workspace/store.ts");
    const selectStudy = storeSrc.slice(storeSrc.indexOf("selectStudy: (id) => {"));
    expect(selectStudy.slice(0, 1200)).toMatch(/set\(\{\s*\.\.\.emptyClinicalState\(\),/);

    // End to end through the real store action. Fake timers keep the deferred
    // recomputeCopilot()/seedSystemNormalImpression() pair — which needs a
    // hydrated reportingContext this test does not build — from running.
    vi.useFakeTimers();
    try {
      useWorkspace.setState({
        dorsoLumbarNumbering: { ...defaultDorsoLumbarState(), superior: "T9-T10" },
        studies: [{ id: "dl-next", studyInstanceUID: "1.2.840.DL", clinicalHistory: "" }],
      } as never);
      expect(useWorkspace.getState().dorsoLumbarNumbering.superior).toBe("T9-T10");

      useWorkspace.getState().selectStudy("dl-next");

      expect(useWorkspace.getState().dorsoLumbarNumbering).toEqual(defaultDorsoLumbarState());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the canvas and panel read the resolver, never their own list", () => {
  it.each([[CANVAS], [PANEL], [AP_TABLE]])("%s derives its levels from the coverage resolver", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/dorsoLumbarNumbering|dorsolumbarApLevels|dorsolumbarLevelKeys|dorsoLumbarLevelEntryOptions/);
    expect(src).not.toMatch(/"T\d+(?:-[TL]\d+)?"\s*,\s*"T\d+/);
    expect(src).not.toMatch(/"L\d-[LS]\d"\s*,\s*"L\d/);
  });

  it("the panel reads the composed level list through the entry resolver", () => {
    const src = read(PANEL);
    expect(src).toMatch(/dorsoLumbarLevelEntryOptions\(state\)/);
    // the lumbar half stays the shared slice — composition, not a copy
    expect(src).toMatch(/lumbar: lumbarNumbering/);
    expect(src).toMatch(/setLumbarNumbering/);
  });

  it("the panel applies through the ledger and refuses gated tiles first", () => {
    const src = read(PANEL);
    expect(src).toMatch(/dorsoLumbarTileAvailability\(tile, ctx\)/);
    expect(src).toMatch(/buildDorsoLumbarTileBundle\(tile\.id, ctx\)/);
    expect(src).toMatch(/applyMacroBundle/);
    expect(src).toMatch(/removeMacroBundle/);
    // no direct prose writes: palettes never overwrite the radiologist's text
    expect(src).not.toMatch(/setFindingsText|setImpressionText/);
    // level entry goes only through the single dispatcher
    expect(src).toMatch(/buildDorsoLumbarLevelEntry\(/);
  });

  it("the level entry form cannot be reached for an unacquired level", () => {
    const src = read(PANEL);
    expect(src).toMatch(/disabled=\{disabled \|\| !ctx\.level\}/);
    expect(src).toMatch(/entry\.refused/);
  });
});

describe("the AP table (spec §13)", () => {
  it("offers exactly one cell per acquired level, and one for the bridge", () => {
    const state = defaultDorsoLumbarState({ superior: "T11-T12", inferior: "L2-L3" });
    const levels = dorsolumbarApLevels(state);
    expect(levels).toEqual(["T11-T12", JUNCTION_LEVEL, "L1-L2", "L2-L3"]);
    expect(levels.filter((l) => l === JUNCTION_LEVEL)).toHaveLength(1);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it("provenance is the canonical record, reached through one shared cell", () => {
    const src = read(AP_TABLE);
    // One row component, one writer, for every canal table in the product — so
    // the Dorso-Lumbar table cannot drift into a second relationship with the
    // record while the cervical / lumbar / dorsal one keeps another.
    expect(src).toMatch(/<CanalApRow/);
    expect(src).toMatch(/canalRows\(/);
    expect(src).toMatch(/canalApValueAt\(/);
    expect(src).toMatch(/formatApMeasurements/);
    // the writer lives in the shared cell, not in the table
    expect(read(CANAL_CELL)).toMatch(/recordCanalApManualValue/);
    // the bridge is grouped with the dorsal lettering, never measured twice, and
    // the level-entry form asks the same resolver the table does
    expect(src).toMatch(/dorsolumbarCanalSegment\(level\)/);
    expect(read(PANEL)).toMatch(/dorsolumbarCanalSegment\(ctx\.level\)/);
    // no measurement is compared against a hard-coded stenosis cut-off
    expect(src).not.toMatch(/[<>]=?\s*\d+(\.\d+)?\s*mm/);
    expect(src).toMatch(/no threshold converts a number into a severity/);
  });
});

describe("rail mount and billing initialization (spec §24, §31)", () => {
  it("mounts the Dorso-Lumbar canvas and panel behind its own predicate only", () => {
    const src = read(RAIL);
    const gate = src.indexOf("isMriDorsoLumbarReportingContext({");
    expect(gate, "the rail must gate the composition on the Dorso-Lumbar predicate").toBeGreaterThan(-1);
    const block = src.slice(gate, gate + 2000);
    const order = ["<MriDorsoLumbarCanvas", "<MriDorsoLumbarSubMasterPanel"].map((needle) => block.indexOf(needle));
    for (const [i, needle] of order.entries()) {
      expect(needle, `${needle} must be rendered by the Dorso-Lumbar gate`).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(needle, "and in canvas → panel order").toBeGreaterThan(order[i - 1]);
    }
    // the dorsal canvas/panel pair stays gated on the dorsal predicate
    expect(src).toMatch(/isMriDorsalReportingContext\(\{[\s\S]{0,900}?<MriDorsalSubMasterPanel/);
  });

  it("mounts every canal AP table once, in the Measure pane and not in Structure", () => {
    // ONE authoritative entry point. The four canal AP tables live on the tab a
    // radiologist already expects ("Measure"), inside one expandable section, and
    // they are gone from the "Structure" pane — a grid mounted in two panes can
    // fall out of step on `disabled` and shows the doctor two halves of one task.
    const src = read(RAIL).replace(/\r\n/g, "\n");
    const countIn = (hay: string, needle: string) => hay.split(needle).length - 1;
    const paneOf = (open: string, close: string) => {
      const start = src.indexOf(open);
      const end = src.indexOf(close, start);
      expect(start, `the rail must still declare the ${open} pane`).toBeGreaterThanOrEqual(0);
      expect(end, `${close} must close after ${open}`).toBeGreaterThan(start);
      return src.slice(start, end);
    };
    const structured = paneOf("structured: (", "measurements: (");
    const measurements = paneOf("measurements: (", "priors: ");

    // Positive control that the two pane slices are real and mutually exclusive.
    // Without it, "not in Structure" could pass vacuously on a mis-sliced region.
    expect(structured).toContain("<MriDorsoLumbarCanvas");
    expect(structured).toContain("<MriDorsalSubMasterPanel");
    expect(structured).not.toContain("<ReportImagePicker");
    expect(measurements).toContain("<ReportImagePicker");
    expect(measurements).not.toContain("<MriDorsoLumbarCanvas");

    // The one section the doctor has to find, on the Measure pane only, exactly once.
    expect(structured).not.toContain("AP Canal Measurements (mm)");
    expect(measurements).toContain("AP Canal Measurements (mm)");
    expect(countIn(src, 'data-testid="canal-ap-measurements-section"')).toBe(1);
    // and an honest line instead of an empty panel when the study earns no table
    expect(measurements).toContain("no disc-level canal AP table");

    for (const { gateVar, mount, gated } of [
      {
        gateVar: "canalApLumbar",
        mount: '<SpineApCanalMeasurements segment="lumbar"',
        gated: /canalApLumbar \? <SpineApCanalMeasurements segment="lumbar" disabled=\{contentLocked\} \/> : null/,
      },
      {
        gateVar: "canalApCervical",
        mount: '<SpineApCanalMeasurements segment="cervical"',
        gated: /canalApCervical \? <SpineApCanalMeasurements segment="cervical" disabled=\{contentLocked\} \/> : null/,
      },
      {
        gateVar: "canalApDorsal",
        mount: '<SpineApCanalMeasurements segment="dorsal"',
        gated: /canalApDorsal \? <SpineApCanalMeasurements segment="dorsal" disabled=\{contentLocked\} \/> : null/,
      },
      {
        gateVar: "canalApDorsoLumbar",
        mount: "<DorsoLumbarApCanalMeasurements",
        gated: /canalApDorsoLumbar \? <DorsoLumbarApCanalMeasurements disabled=\{contentLocked\} \/> : null/,
      },
    ]) {
      expect(structured, `${mount} must not stay mounted in the Structure pane`).not.toContain(mount);
      expect(measurements, `${mount} must mount in the Measure pane`).toContain(mount);
      expect(countIn(src, mount), `${mount} must mount exactly once across all tabs`).toBe(1);
      expect(measurements, `${mount} must stay behind ${gateVar} and the content lock`).toMatch(gated);
    }

    // The Measure-pane gates reuse the same four predicates as the Structure-pane
    // canvases, with the FULL argument set — protocolName and studyDescription are
    // what let a screening / Dorso-Lumbar booking resolve the right table.
    const args = src.slice(src.indexOf("const canalApGateArgs = {"), src.indexOf("const canalApLumbar ="));
    expect(args, "the shared canal gate argument set must exist").not.toBe("");
    for (const key of ["modality:", "region:", "family:", "spineSegment:", "protocolName:", "studyDescription:"]) {
      expect(args, `the canal gate must pass ${key}`).toContain(key);
    }
    for (const [predicate, gateVar] of [
      ["isMriLumbarReportingContext(canalApGateArgs)", "canalApLumbar"],
      ["isMriCervicalReportingContext(canalApGateArgs)", "canalApCervical"],
      ["isMriDorsalReportingContext(canalApGateArgs)", "canalApDorsal"],
      ["isMriDorsoLumbarReportingContext(canalApGateArgs)", "canalApDorsoLumbar"],
    ] as const) {
      expect(src, `${gateVar} must come from ${predicate}`).toContain(`const ${gateVar} = ${predicate};`);
    }
  });

  it("initialises the composition from billing without overriding the radiologist", () => {
    const src = read(HOOK);
    expect(src).toMatch(/if \(!ws\.studyCompositionOverridden && resolved\.composition && resolved\.provenance\) \{\s*ws\.setStudyComposition\(resolved\.composition, resolved\.provenance\);/);
    // the same effect still proposes the region roles
    expect(src).toMatch(/ws\.replaceScreeningRoles\(resolved\.roles\);/);
  });

  it("keeps MRI020 out of a wrapper that just stacks the two older canvases", () => {
    // Spec §0: a dedicated Dorso-Lumbar study is not the dorsal canvas plus the
    // lumbar canvas. The DL block must render its own components.
    const src = read(RAIL);
    const dlBlock = src.slice(
      src.indexOf("isMriDorsoLumbarReportingContext({"),
      src.indexOf("isMriDorsoLumbarReportingContext({") + 1800,
    );
    expect(dlBlock).not.toMatch(/<MriDorsalCanvas|<MriLumbarCanvas|<MriCervicalCanvas/);
  });
});

describe("tile application through the ledger", () => {
  beforeEach(() => {
    useWorkspace.setState({
      appliedPathologyPatches: [],
      patchUndoStack: [],
      lastPatchSnapshot: null,
      findingsText: "",
      impressionText: "",
      fieldProvenance: {},
      studyComposition: "dorsolumbar-dedicated",
      dorsoLumbarNumbering: defaultDorsoLumbarState({ superior: "T10-T11", inferior: "L3-L4" }),
    });
  });

  it("writes a junction tile into the canonical region and replaces itself", () => {
    const state = useWorkspace.getState().dorsoLumbarNumbering;
    const ctx = {
      level: "L1-T12",
      state,
      sequences: useWorkspace.getState().sequencesAvailable,
      domain: "junction" as const,
    };
    const built = buildDorsoLumbarTileBundle("dlj-epidural", ctx as never);
    expect(built.notice).toBeNull();
    useWorkspace.getState().applyMacroBundle({ bundleId: built.bundleId, observations: built.observations });
    const rows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => p.id !== "system-normal-study")
      .filter((p) => dorsoLumbarLevelEntryOptions(state).some((l) => l.junction && l.level === "T12-L1")
        && p.observation?.level === "D12-L1");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.observation?.region).toBe(JUNCTION_LEDGER_REGION);

    // the same tile at the same bridge in another spelling replaces, never adds
    const again = buildDorsoLumbarTileBundle("dlj-epidural", { ...ctx, level: JUNCTION_LEVEL } as never);
    expect(again.bundleId).toBe(built.bundleId);
    useWorkspace.getState().applyMacroBundle({ bundleId: again.bundleId, observations: again.observations });
    const after = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => p.observation?.bundleId === again.bundleId,
    );
    expect(after).toHaveLength(rows.length);
  });
});
