/**
 * mriBrainVascularScreening.test.ts — a screening pass stays a screening pass
 * (mra/mrv spec §14, §15, §23).
 *
 * §14 says this module is "intentionally NOT a second dedicated MRA editor", which is a
 * claim about shape rather than about size. So the tests here check three things the UI
 * cannot fake: the sentences it can produce never contain a grade, a percentage, a dome
 * or a nidus; the slots it writes are its own, never the dedicated per-segment vessel
 * slots a screening row could overwrite; and the limitation caveat appears exactly once
 * while the module contributes and not at all once it does not.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contentPackForConcept } from "@/lib/conceptCanon/contentPacks";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { ALL_VASCULAR_TILES } from "@/lib/mriBrainVascularSubMasters";
import {
  SCREENING_FORBIDDEN_WORKFLOWS,
  SCREENING_OBSERVATIONS,
  SCREENING_OBSERVATION_LABELS,
  SCREENING_PROHIBITED_WORDING,
  SCREENING_VESSEL_FAMILIES,
  screeningAtoms,
  screeningChecklistRows,
  screeningConceptEntries,
  screeningContributes,
  type ScreeningRecord,
} from "@/lib/mriBrainVascularScreening";
import { MRA_SCREENING_PROSE, VASCULAR_LIBRARY_PROSE } from "@/lib/mriBrainVascularProse";
import { VESSEL_DEFINITIONS, vesselByKey, vesselConceptEntries } from "@/lib/mriBrainVessels";
import { defaultVascularTechnique, type VascularTechniqueState } from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(
  path.resolve(HERE, "../../../../docs/tasks/mri-brain-mra-mrv-submaster-v3.md"),
  "utf8",
).replace(/\r\n/g, "\n");

const BRAIN = parseBrainSequences("MRI Brain: T1, T2, FLAIR, DWI with ADC");
function tech(keys: Record<string, boolean> = {}): VascularTechniqueState {
  const state = defaultVascularTechnique();
  for (const [key, value] of Object.entries(keys)) {
    state.acquired[key as keyof typeof state.acquired] = Boolean(value);
  }
  return state;
}
const CTX = { technique: tech({ mraTof: true }), brain: BRAIN };
const NO_ANGIO = { technique: defaultVascularTechnique(), brain: BRAIN };

const allRowsText = (record: ScreeningRecord): string => {
  const row = screeningAtoms(record, CTX);
  return row.atoms.map((a) => `${a.findings} ${a.impression ?? ""} ${a.state ?? ""}`).join(" ");
};

beforeEach(() => {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    lastPatchSnapshot: null,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    vascularTechnique: defaultVascularTechnique(),
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain with basic intracranial MRA",
      regions: ["brain"],
      source: "auto",
    }),
  });
});

describe("§14 the checklist is the specification's", () => {
  it("lists the six arterial families with the sides §14 names", () => {
    expect(SCREENING_VESSEL_FAMILIES.map((f) => f.id)).toEqual([
      "ica", "aca", "mca", "pca", "vertebral", "basilar",
    ]);
    const rows = screeningChecklistRows();
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.key)).toEqual([
      "ica-right", "ica-left",
      "aca-right", "aca-left",
      "mca-right", "mca-left",
      "pca-right", "pca-left",
      "vertebral-right", "vertebral-left",
      "basilar-unpaired",
    ]);
    expect(rows.find((r) => r.side === "left")!.label).toMatch(/^left /);
    expect(rows.find((r) => r.key === "basilar-unpaired")!.label).toBe("basilar artery");
  });

  it("covers real segments of the dedicated vessel registry", () => {
    const known = new Set(VESSEL_DEFINITIONS.map((v) => v.key.replace(/-(right|left)$/, "")));
    for (const family of SCREENING_VESSEL_FAMILIES) {
      for (const segment of family.covers) {
        expect(known.has(segment), `${family.id} covers ${segment}`).toBe(true);
      }
    }
    // The registry rows a family stands for must actually exist on both sides.
    expect(vesselByKey("mca-m1-left")).toBeTruthy();
    expect(vesselByKey("vertebral-intracranial-right")).toBeTruthy();
  });

  it("carries §14's seven quick observations, in order", () => {
    const start = SPEC.indexOf("Quick observations:");
    const end = SPEC.indexOf("Normal screening seed:", start);
    const listed = SPEC
      .slice(SPEC.indexOf("\n", start) + 1, end)
      .split("\n")
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter((line) => line && !line.startsWith("="));
    expect(listed).toHaveLength(SCREENING_OBSERVATIONS.length);
    expect(SCREENING_OBSERVATIONS).toEqual([
      "grosslyPatent",
      "focalFlowReduction",
      "significantStenosisSuspected",
      "nonVisualizationSuspected",
      "grossAneurysmalOutpouching",
      "majorAnatomicVariant",
      "otherSignificantAbnormality",
    ]);
    // Each spec bullet is recognisable in its label, whichever way round they are worded.
    listed.forEach((bullet, i) => {
      const label = SCREENING_OBSERVATION_LABELS[SCREENING_OBSERVATIONS[i]];
      const words = bullet.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
      const hit = words.filter((w) => label.toLowerCase().includes(w));
      expect(hit.length, `${bullet} → ${label}`).toBeGreaterThanOrEqual(2);
    });
  });

  it("quotes the canonical normal seed and limitation verbatim", () => {
    const findings = screeningAtoms({ performed: true, normalSeedSelected: true }, CTX).atoms
      .map((a) => a.findings)
      .join("\n");
    expect(findings).toContain(MRA_SCREENING_PROSE.normal);
    expect(findings).toContain(MRA_SCREENING_PROSE.limitation);
    expect(MRA_SCREENING_PROSE.normal).toBe(
      "Major intracranial arteries demonstrate preserved flow-related signal without gross focal stenosis, occlusion or aneurysmal dilatation.",
    );
  });
});

describe("§14 the limitation appears exactly once, while screening contributes", () => {
  it("is absent when the module records nothing", () => {
    expect(screeningContributes({ performed: true })).toBe(false);
    expect(screeningAtoms({ performed: true }, CTX).errors).toBeTruthy();
    expect(screeningAtoms({ performed: false, normalSeedSelected: true }, CTX).errors?.[0])
      .toMatch(/limited angiographic acquisition was performed/);
  });

  it("appears once for a seed-only, row-only and note-only contribution", () => {
    for (const record of [
      { performed: true, normalSeedSelected: true },
      { performed: true, rows: [{ key: "mca-right" as const, observation: "grosslyPatent" as const }] },
      { performed: true, manualNote: "Limited coverage of the posterior circulation." },
    ] satisfies ScreeningRecord[]) {
      const atoms = screeningAtoms(record, CTX).atoms;
      expect(atoms.filter((a) => a.concept === "mra_screening_limitation")).toHaveLength(1);
    }
  });

  it("cannot be printed twice by applying the module twice", () => {
    const record: ScreeningRecord = { performed: true, normalSeedSelected: true };
    const row = screeningAtoms(record, CTX);
    const apply = () => useWorkspace.getState().applyMacroBundle({
      bundleId: row.bundleId,
      observations: brainAtomsToPatches("Brain", row.bundleId, row.atoms),
    });
    apply();
    apply();
    const findings = useWorkspace.getState().findingsText;
    expect(findings.match(/SCREENING MR ANGIOGRAPHY IS A LIMITED/g)?.length).toBe(1);
    expect(useWorkspace.getState().removeMacroBundle(row.bundleId)).toBe("removed");
    expect(useWorkspace.getState().findingsText).not.toMatch(/SCREENING MR ANGIOGRAPHY/);
  });
});

describe("§14 a screening row says what the limited acquisition saw", () => {
  it("keeps the suspicion in the wording instead of grading it", () => {
    const atoms = screeningAtoms({
      performed: true,
      rows: [
        { key: "mca-right", observation: "significantStenosisSuspected" },
        { key: "ica-left", observation: "nonVisualizationSuspected" },
        { key: "vertebral-right", observation: "focalFlowReduction" },
      ],
    }, CTX).atoms;
    const text = atoms.map((a) => `${a.findings} ${a.impression ?? ""}`).join(" ");
    expect(text).toMatch(/occlusion is suspected rather than confirmed/);
    expect(text).toMatch(/without a graded stenosis/);
    expect(text).toMatch(/suspected on a limited acquisition/);
  });

  it("produces no dedicated-workflow wording for any of the seven observations", () => {
    for (const observation of SCREENING_OBSERVATIONS) {
      const text = allRowsText({
        performed: true,
        rows: [{ key: "mca-right", observation, note: "short irregular contour" }],
      });
      expect(SCREENING_PROHIBITED_WORDING.test(text), `${observation}: ${text}`).toBe(false);
    }
  });

  it("holds the right and left of one family apart, and never touches a dedicated slot", () => {
    const dedicated = new Set(vesselConceptEntries().map((e) => e.concept));
    const row = screeningAtoms({
      performed: true,
      rows: [
        { key: "mca-right", observation: "grosslyPatent" },
        { key: "mca-left", observation: "grosslyPatent" },
        { key: "basilar-unpaired", observation: "majorAnatomicVariant" },
      ],
    }, CTX);
    for (const atom of row.atoms) {
      expect(dedicated.has(atom.concept), atom.concept).toBe(false);
      expect(atom.concept).toMatch(/^mra_screening/);
    }
    applyRow(row);
    const live = useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale);
    expect(live.filter((p) => p.observation?.concept.startsWith("mra_screening_mca_"))).toHaveLength(2);
  });

  it("asks what was seen before accepting an 'other significant abnormality'", () => {
    const row = screeningAtoms({
      performed: true,
      rows: [{ key: "pca-left", observation: "otherSignificantAbnormality" }],
    }, CTX);
    expect(row.errors?.[0]).toMatch(/needs what was seen in the left PCA/);
    expect(row.atoms).toEqual([]);
    expect(screeningAtoms({
      performed: true,
      rows: [{ key: "pca-left", observation: "otherSignificantAbnormality", note: "duplication of the P1 segment." }],
    }, CTX).atoms[0]!.findings).toContain("duplication of the P1 segment.");
  });

  it("refuses a row that is not on the checklist", () => {
    const row = screeningAtoms({
      performed: true,
      // Well-formed as a key, but §14's checklist has no ACom row: screening stays compact.
      rows: [{ key: "acom-unpaired", observation: "grosslyPatent" }],
    }, CTX);
    expect(row.errors?.[0]).toMatch(/is not a row of the §14 screening checklist/);
  });

  it("needs the acquisition, not the booking", () => {
    expect(screeningAtoms({ performed: true, normalSeedSelected: true }, NO_ANGIO).blocked?.notice)
      .toMatch(/no arterial statement/i);
  });
});

describe("§14/§15 the screening baseline reconciles with the rest of the report", () => {
  it("supersedes the dedicated all-normal MRA sentence rather than echoing it", () => {
    const normal = ALL_VASCULAR_TILES.find((t) => t.id === "mra-normal")!;
    useWorkspace.getState().applyMacroBundle({
      bundleId: "bsm-test-mra-normal",
      observations: brainAtomsToPatches("Brain", "bsm-test-mra-normal", normal.atoms),
    });
    expect(useWorkspace.getState().findingsText).toContain("uniform high-velocity signal");
    const row = screeningAtoms({ performed: true, normalSeedSelected: true }, CTX);
    expect(row.atoms.find((a) => a.concept === "mra_screening")!.baselineReplaces)
      .toBe(VASCULAR_LIBRARY_PROSE.mraIntracranialNormal);
    applyRow(row);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain(MRA_SCREENING_PROSE.normal);
    expect(findings).not.toContain("uniform high-velocity signal");
  });

  it("warns when the normal seed is recorded beside an abnormal row", () => {
    const row = screeningAtoms({
      performed: true,
      normalSeedSelected: true,
      rows: [{ key: "mca-right", observation: "significantStenosisSuspected" }],
    }, CTX);
    expect(row.warnings?.[0]).toMatch(/normal seed is recorded beside an abnormal/);
    expect(row.atoms.length).toBeGreaterThan(2);
  });
});

describe("§14 the module cannot be promoted by its own data shape", () => {
  it("names the dedicated workflows it must not expose", () => {
    expect(SCREENING_FORBIDDEN_WORKFLOWS).toEqual([
      "full aneurysm morphology workflow",
      "formal neck/dome ratio workflow",
      "NASCET calculations",
      "detailed AVM angioarchitecture/grading",
      "detailed vessel-wall characterisation",
      "exhaustive segment-by-segment stenosis grading",
    ]);
  });

  it("carries no field where any of them could be entered", () => {
    const fields = [
      ...Object.keys({ performed: true, normalSeedSelected: true, rows: [], manualNote: "" }),
      ...Object.keys({ key: "", observation: "grosslyPatent", note: "" }),
    ];
    for (const forbidden of SCREENING_FORBIDDEN_WORKFLOWS) {
      const words = forbidden.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const leaked = fields.filter((f) => words.some((w) => f.toLowerCase().includes(w)));
      expect(leaked, forbidden).toEqual([]);
    }
    expect(SCREENING_PROHIBITED_WORDING.test("dome height 8 mm, neck width 4 mm")).toBe(true);
    expect(SCREENING_PROHIBITED_WORDING.test("70% NASCET")).toBe(true);
  });

  it("offers a recommendation only when the radiologist asks for one", () => {
    const plain = screeningAtoms({ performed: true, normalSeedSelected: true }, CTX);
    expect(plain.atoms.find((a) => a.concept === "mra_screening_limitation")!.recommendation)
      .toBeUndefined();
    const recommended = screeningAtoms({
      performed: true,
      normalSeedSelected: true,
      recommendDedicatedVascularEvaluation: true,
      recommendationDetail: "the suspected right MCA abnormality",
    }, CTX);
    expect(
      recommended.atoms.find((a) => a.concept === "mra_screening_limitation")!.recommendation,
    ).toBe(
      "Recommend dedicated MR angiography — the suspected right MCA abnormality.",
    );
  });

  it("registers every concept it can write", () => {
    for (const entry of screeningConceptEntries()) {
      expect(contentPackForConcept(entry.concept), entry.concept).toBeTruthy();
      expect(entry.label).not.toMatch(/\bMRA of\b/);
    }
    expect(screeningConceptEntries()).toHaveLength(screeningChecklistRows().length + 2);
  });
});

function applyRow(row: ReturnType<typeof screeningAtoms>) {
  useWorkspace.getState().applyMacroBundle({
    bundleId: row.bundleId,
    observations: brainAtomsToPatches("Brain", row.bundleId, row.atoms),
  });
}
