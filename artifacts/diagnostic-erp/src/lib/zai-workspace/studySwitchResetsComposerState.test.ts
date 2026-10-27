import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { buildComposerCatalog, emptyComposerDraft, pendingFromComposerDraft, renderComposerPhrase } from "@/lib/findingComposerModel";

/**
 * Nothing one examination produced may be present in the next.
 *
 * WHY THIS FILE EXISTS. The reporting route (`/radiology/report/:studyId` in
 * `App.tsx:493`) renders ONE `RadiologyReportingWorkspace` and only swaps its
 * `studyId` prop when the next patient opens, so React reuses the instance and
 * never remounts it. The store resets on `selectStudy` — but four carriers of
 * clinical intent live in component state instead, and were therefore surviving
 * the switch:
 *
 *   • the Quick Select strip's chosen side / severity / typed level
 *     (`quick-select-strip.tsx`), which then substitute straight into the next
 *     patient's Findings;
 *   • the Finding Composer's half-typed draft and the `editingId` of the row it
 *     was editing (`useFindingComposerDraft`), which `applyComposerFinding`
 *     cannot resolve in the new ledger and so adds as a NEW observation;
 *   • the cervical and lumbar per-level blocks, whose ledger re-sync ran only
 *     while the block was CLOSED, so a block left open kept the previous
 *     patient's morphology, canal, foraminal, Pfirrmann and Modic selections with
 *     "Apply to report" enabled.
 *
 * The first describe block is behavioural: it drives the real
 * `applyComposerFinding` → `selectStudy` path over two synthetic studies and
 * asserts the next study starts with nothing. The second block is a wiring
 * contract, and it is labelled as one: this repo's Vitest project is
 * `environment: "node"` with no jsdom or React Testing Library installed, so a
 * component cannot be mounted here. It reads the shipped source, locates the
 * effect that performs each reset, and requires the effect to be keyed on the
 * study identity — the exact thing that was missing. The last test proves that
 * checker bites rather than merely matching any text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) =>
  readFileSync(join(here, "../../components/radiology", rel), "utf8").replace(/\r\n/g, "\n");

const STUDY_A = { id: "study-a", patient: { name: "SYN Alpha", sex: "M" }, modality: "MR" };
const STUDY_B = { id: "study-b", patient: { name: "SYN Beta", sex: "F" }, modality: "MR" };

function reset() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    studies: [STUDY_A, STUDY_B],
    activeStudyId: null,
    completedStudyIds: new Set<string>(),
    reportingContext: useWorkspace.getState().reportingContext,
  } as never);
}

/** The lumbar disc-bulge entry the Finding Composer can build a patch from. */
function bulgeEntry() {
  const catalog = buildComposerCatalog([], "Lumbar Spine");
  const entry = catalog.find((c) => c.key === "builtin-disc-bulge") ?? catalog[0];
  if (!entry) throw new Error("composer catalogue is empty — the fixture cannot build a finding");
  return entry;
}

describe("opening the next study leaves nothing of the previous one", () => {
  beforeEach(reset);

  it("a finding composed on study A is absent from study B", () => {
    useWorkspace.getState().selectStudy("study-a");
    const entry = bulgeEntry();
    const draft = {
      ...emptyComposerDraft("Lumbar Spine"),
      catalogKey: entry.key,
      level: "L4-L5",
      severity: "mild",
      laterality: "left",
    };
    const pending = pendingFromComposerDraft(draft, entry, renderComposerPhrase(draft, entry));
    expect(useWorkspace.getState().applyComposerFinding(pending)).toBe("applied");

    const s = useWorkspace.getState();
    expect(s.appliedPathologyPatches).toHaveLength(1);
    expect(s.findingsText).toContain("L4-L5");
    // The id the composer would carry if the radiologist pressed "Edit".
    const composedId = s.appliedPathologyPatches[0]!.id;

    // The real switch: what the worklist's Report action drives.
    useWorkspace.getState().selectStudy("study-b");
    const b = useWorkspace.getState();
    expect(b.activeStudyId).toBe("study-b");
    expect(b.findingsText).toBe("");
    expect(b.impressionText).toBe("");
    expect(b.techniqueText).toBe("");
    expect(b.recommendationText).toBe("");
    expect(b.appliedPathologyPatches).toHaveLength(0);
    expect(b.fieldProvenance).toEqual({});
    expect(b.pendingPathologyPatch).toBeNull();
    expect(b.patchUndoStack).toHaveLength(0);
    expect(b.lastPatchSnapshot).toBeNull();
    expect(b.isDirty).toBe(false);
    // The finding that belonged to Alpha is gone from everything Beta can write:
    // the four prose sections, the ledger and the pending overwrite. Scanning the
    // whole store would be wrong — the shipped `reportFormats` library legitimately
    // contains the string "L4-L5" in lumbar normal templates nobody has applied.
    const clinical = JSON.stringify([
      b.findingsText, b.impressionText, b.techniqueText, b.recommendationText,
      b.clinicalHistoryText, b.appliedPathologyPatches, b.pendingPathologyPatch,
      b.lastPatchSnapshot, b.fieldProvenance,
    ]);
    expect(clinical).not.toContain("L4-L5");

    // And the stale edit the component used to be able to submit: an editingId
    // Alpha created, resolved against Beta's empty ledger, must find nothing.
    expect(b.appliedPathologyPatches.some((p) => p.id === composedId)).toBe(false);
  });

  it("advanceToNextStudy resets the same way", () => {
    useWorkspace.getState().selectStudy("study-a");
    const entry = bulgeEntry();
    const draft = { ...emptyComposerDraft("Lumbar Spine"), catalogKey: entry.key, level: "L2-L3" };
    useWorkspace.getState().applyComposerFinding(
      pendingFromComposerDraft(draft, entry, renderComposerPhrase(draft, entry)),
    );
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);

    useWorkspace.setState({ completedStudyIds: new Set(["study-a"]) } as never);
    useWorkspace.getState().advanceToNextStudy();
    const b = useWorkspace.getState();
    expect(b.activeStudyId).toBe("study-b");
    expect(b.appliedPathologyPatches).toHaveLength(0);
    expect(b.findingsText).not.toContain("L2-L3");
  });
});

/**
 * Extracts the body + dependency array of the effect that performs `resetCall`
 * in `text`, and reports whether it is keyed on `studyToken`.
 *
 * Deliberately comment-tolerant and anchored on the reset call rather than on a
 * line count: a source slice that silently returns "" because a longer comment
 * shifted it is how these checks used to pass while asserting nothing.
 */
function studySwitchEffect(text: string, resetCall: RegExp): { body: string; deps: string } | null {
  let found: { body: string; deps: string } | null = null;
  // Walk every useEffect, keep the first one that performs the reset.
  const scanner = /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[([^\]]*)\]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(text)) !== null) {
    if (resetCall.test(m[1])) {
      found = { body: m[1], deps: m[2] };
      break;
    }
  }
  return found;
}

describe("each component carrier re-syncs when the study changes", () => {
  it("the Quick Select strip clears its chosen side, severity and level", () => {
    const f = src("zai-workspace/quick-select-strip.tsx");
    const eff = studySwitchEffect(f, /setQsSide\(""\)/);
    expect(eff, "no effect clears the Quick Select chips").not.toBeNull();
    expect(eff!.body).toContain("setQsSeverity(");
    expect(eff!.body).toContain("setQsLevel(");
    expect(eff!.deps, "the chip reset is not keyed on the study")
      .toMatch(/activeStudyId|study\?\.id/);
  });

  it("the Finding Composer discards the previous study's whole draft", () => {
    const f = src("reporting-canvas/FindingComposer.tsx");
    const hook = f.slice(f.indexOf("export function useFindingComposerDraft"));
    expect(hook.length, "useFindingComposerDraft not found").toBeGreaterThan(40);
    const eff = studySwitchEffect(hook, /emptyComposerDraft\(region\)/);
    expect(eff, "no effect resets the composer draft").not.toBeNull();
    expect(eff!.deps, "the draft reset is not keyed on the study").toMatch(/activeStudyId/);
    expect(hook).toMatch(/useWorkspace\(\(s\) => s\.activeStudyId\)/);
  });

  it.each([
    ["cervical", "reporting-canvas/MriCervicalLevelBlock.tsx"],
    ["lumbar", "reporting-canvas/MriLumbarLevelBlock.tsx"],
  ])("the %s level block re-syncs open as well as closed", (_which, file) => {
    const f = src(file);
    // Anchored on the ledger spread rather than a bare `setSel(`: these blocks
    // call setSel from several effects (a keyboard chip-cycler among them), and
    // matching the first of those would have asserted nothing about the reset.
    const eff = studySwitchEffect(f, /setSel\(\{[\s\S]{0,80}\.\.\.ledgerSel/);
    expect(eff, `no effect re-syncs the ${_which} selections from the ledger`).not.toBeNull();
    // The whole point: `!open` alone used to gate this, so a block left open on
    // the previous patient never refreshed.
    expect(eff!.body).toMatch(/switched\s*\|\|\s*!open|!open\s*\|\|\s*switched/);
    expect(eff!.deps, "the selection re-sync is not keyed on the study").toMatch(/activeStudyId/);
  });
});

describe("the checker proves itself", () => {
  it("a reset that is NOT keyed on the study is reported as unkeyed", () => {
    // Guard the guard. This is the shape the shipped code had before: the reset
    // exists, the dependency array names only the region. If the contract above
    // could not tell the two apart it would be decoration.
    const before = `
      useEffect(() => {
        setQsSide("");
      }, [region]);
    `;
    const eff = studySwitchEffect(before, /setQsSide\(""\)/);
    expect(eff).not.toBeNull();
    expect(eff!.deps).not.toMatch(/activeStudyId|study\?\.id/);

    // And a file with no such effect at all must be reported as missing, not empty.
    expect(studySwitchEffect("export const x = 1;", /setQsSide\(""\)/)).toBeNull();
  });
});
