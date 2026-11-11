/**
 * studySwitchResetsScratchSurfaces.test.ts — cross-study residue must not
 * survive a study switch.
 *
 * The workspace is deliberately NOT remounted between studies: the route swaps
 * the study id and the store performs a clinical reset. Four composer surfaces
 * held their scratch in plain component state outside that reset, so patient
 * A's typed answers travelled to patient B (audit findings F-02/F-03/F-04/F-08):
 *
 *  - F-02 the spine sub-master panels (side, root, mm, mm2, pct, cm, cm2,
 *    degree, level, conus level, vertebra, direction — and the lesion forms
 *    inside them): A's 'left', '12 mm', 'L4' sat in the scratch row under B's
 *    name, and the next tile click wrote them into B's observation.
 *  - F-03 the Findings Library: selected map and baseId never reset, and the
 *    auto-pick only runs when baseId is empty, so A's ticked abnormalities
 *    merged into B's report via 'Apply to report'.
 *  - F-04 the Measurement Assistant: typed values survived the switch and the
 *    insert path appended the compiled text to the CURRENT study's findings.
 *  - F-08 the quick-select drawer's side selector: A's 'Left' silently
 *    lateralized B's first sided finding.
 *
 * The fix has two shapes, both asserted here as source pins in this repo's
 * documented no-DOM idiom (see quickSelectLaterality.contract.test.ts, which
 * cured the same class on the Quick Select strip):
 *
 *  1. quickSide is reset by an effect keyed on the ACTIVE study (not the queue
 *     row, which can be null on deep links);
 *  2. the panels are keyed by the study id at their mount sites, so React
 *     unmounts and remounts them on switch — every useState inside, including
 *     the lesion forms, re-initializes with the patient.
 *
 * What this cannot catch: a panel that re-introduces NEW un-keyed scratch
 * state. The enumerated surfaces are the ones the audit measured.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8");

const CLINICAL_UI = "src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const RAIL = "src/components/radiology/workspace/ReportingToolsRail.tsx";
const LEGACY_BOX = "src/components/radiology/LegacyBox.tsx";

const clinicalUi = read(CLINICAL_UI).replace(/\r\n/g, "\n");
const rail = read(RAIL).replace(/\r\n/g, "\n");
const legacyBox = read(LEGACY_BOX).replace(/\r\n/g, "\n");

describe("F-08: the quick-select drawer's side resets with the study", () => {
  it("resets quickSide on activeStudyId change", () => {
    // Keyed on activeStudyId (the store truth), not workflow.currentRow —
    // on a deep link the MR-defaulted reading queue may not contain the row,
    // and a null currentRow would leave the stale side in place.
    expect(clinicalUi).toMatch(/useEffect\(\(\) => \{\s*setQuickSide\(""\);\s*\}, \[activeStudyId\]\);/);
  });

  it("still starts laterality-neutral for a fresh session", () => {
    // The previous fix (quickSelectLaterality contract) must not regress.
    expect(clinicalUi).toMatch(/const \[quickSide, setQuickSide\] = useState<Side \| "">\(""\)/);
  });
});

describe("F-02: the spine sub-master panels remount with the study", () => {
  it.each([
    ["lumbar-submaster", "MriLumbarSubMasterPanel"],
    ["dorsal-submaster", "MriDorsalSubMasterPanel"],
    ["dorsolumbar-submaster", "MriDorsoLumbarSubMasterPanel"],
  ])("keys <%s> by the active study", (keyPrefix, panel) => {
    // A study-scoped key makes React unmount the panel on switch: side, root,
    // mm, level, conus, vertebra, direction AND the lesion forms inside all
    // re-initialize. The audited effect-style reset (enumerate every setter)
    // drifts when a field is added; a remount cannot.
    expect(rail).toContain(`<${panel}`);
    expect(rail).toContain(`key={\`${keyPrefix}-\${activeStudyId ?? "none"}\`}`);
  });
});

describe("F-03/F-04: the library and measurement assistant remount with the study", () => {
  it("keys FindingsLibraryPanel by the study", () => {
    expect(legacyBox).toContain(
      'key={`library-${props.studyId ?? props.worklistId ?? "none"}`}',
    );
  });

  it("keys MeasurementAssistantPanel by the study", () => {
    expect(legacyBox).toContain(
      'key={`measure-${props.studyId ?? props.worklistId ?? "none"}`}',
    );
  });

  it("still binds the measurement panel's study id prop (save/history calls)", () => {
    // F-04 also requires the API calls to carry the ACTIVE study id — the
    // prop binding existed; this pins it so a future refactor cannot drop it
    // while leaving the key in place.
    expect(legacyBox).toContain("studyId={props.studyId ?? undefined}");
  });
});
