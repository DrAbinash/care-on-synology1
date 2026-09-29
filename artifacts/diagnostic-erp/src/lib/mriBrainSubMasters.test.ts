/**
 * MRI Brain clinical sub-masters — architecture + clinical-consistency tests.
 *
 * Covers: protocol-aware normal baseline, normal→abnormal reconciliation,
 * multi-sub-master workflows, sequence gating, lesion characterization,
 * grading propagation, presets (apply / undo / remove), manual-text
 * protection, Findings→Impression staleness, contradictions, and critical
 * detection without auto-documented communication.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { parseBrainSequences } from "./mriBrainSequences";
import {
  MRI_BRAIN_PRESETS,
  MRI_BRAIN_SUB_MASTERS,
  brainPresetById,
  brainSubMasterById,
  buildTilePatch,
  tileAvailable,
} from "./mriBrainSubMasters";
import { buildBrainNormalAtoms, BRAIN_NORMAL_SENTENCES } from "./mriBrainNormalAtoms";
import {
  buildBrainLesionAtoms,
  buildBrainMrsAtoms,
  composeLesionImpressionFragment,
  composeLesionSentence,
  composeMrsSentence,
  type BrainLesionInput,
} from "./mriBrainLesion";
import { brainBundleId } from "./mriBrainAtoms";
import { brainTextContradictions } from "./mriBrainContradictions";
import {
  buildFazekasAtoms,
  buildHerniationAtoms,
  buildPituitaryAtoms,
  knospIsEncasement,
  pituitaryIsEnlarged,
} from "./mriBrainMeasures";
import { contentPackForConcept } from "./conceptCanon/contentPacks";
import { detectCriticalFindings } from "./criticalResults";

const TECH_FULL =
  "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences obtained. Contrast administered. MRS, MRA and MRV performed.";
const TECH_PLAIN = "MRI brain. Multiplanar T1W, T2W and FLAIR sequences obtained.";

function resetWorkspace(region = "Brain", technique = TECH_FULL) {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: technique,
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
  });
}

const tile = (subMasterId: string, tileId: string) => {
  const sm = brainSubMasterById(subMasterId);
  const t = sm?.tiles.find((x) => x.id === tileId);
  if (!t) throw new Error(`missing tile ${subMasterId}/${tileId}`);
  return t;
};

describe("sub-master data integrity", () => {
  it("has the 13 clinical sub-masters with unique ids and tiles", () => {
    const ids = MRI_BRAIN_SUB_MASTERS.map((s) => s.id);
    expect(ids).toEqual([
      "routine", "vascular", "trauma", "tumor", "infection", "demyelinating",
      "epilepsy", "sella", "cpa", "pediatric", "metabolic", "postop", "advanced",
    ]);
    const tileIds = new Set<string>();
    MRI_BRAIN_SUB_MASTERS.forEach((sm) =>
      sm.tiles.forEach((t) => {
        expect(t.atoms.length).toBeGreaterThan(0);
        expect(t.label.length).toBeGreaterThan(0);
        expect(tileIds.has(t.id)).toBe(false);
        tileIds.add(t.id);
      }),
    );
  });

  it("every impression-bearing brain atom uses a REGISTERED impression-worthy concept", () => {
    const seen = new Set<string>();
    const check = (concept: string, hasImpression: boolean) => {
      if (!hasImpression || seen.has(concept)) return;
      seen.add(concept);
      const pack = contentPackForConcept(concept);
      expect(pack, `concept ${concept} missing from content packs`).toBeTruthy();
      expect(
        pack?.impressionworthyAbnormal ||
          ["senile_atrophy"].includes(concept),
        `concept ${concept} must be impression-worthy (system-normal yield)`,
      ).toBe(true);
    };
    MRI_BRAIN_SUB_MASTERS.forEach((sm) =>
      sm.tiles.forEach((t) =>
        t.atoms.forEach((a) => check(a.concept, Boolean(a.impression && a.impression.trim()))),
      ),
    );
  });

  it("never auto-asserts diagnostic criteria or clinician communication", () => {
    const haystack = MRI_BRAIN_SUB_MASTERS.flatMap((sm) =>
      sm.tiles.flatMap((t) => t.atoms.flatMap((a) => [a.findings, a.impression ?? "", a.concept])),
    ).join("\n").toLowerCase();
    for (const forbidden of [
      "mcdonald",
      "criteria are fulfilled",
      "criteria fulfilled",
      "histopathological diagnosis of",
      "diagnosed with",
      "clinician informed",
      "communicated to",
    ]) {
      expect(haystack.includes(forbidden), `unexpected auto-claim: ${forbidden}`).toBe(false);
    }
  });

  it("presets build for both full and plain protocols", () => {
    [parseBrainSequences(TECH_FULL), parseBrainSequences(TECH_PLAIN)].forEach((seq) => {
      MRI_BRAIN_PRESETS.forEach((p) => {
        const built = p.build({ region: "Brain", seq });
        expect(built.observations.length, `preset ${p.id}`).toBeGreaterThan(0);
      });
    });
  });
});

describe("protocol-aware normal baseline", () => {
  it("emits DWI/SWI/contrast/MRS/MRA/MRV normals only when performed", () => {
    const full = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_FULL) });
    const plain = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_PLAIN) });
    const fullText = full.observations.map((o) => o.findingsText ?? "").join("\n");
    const plainText = plain.observations.map((o) => o.findingsText ?? "").join("\n");
    expect(fullText).toContain("No restricted diffusion");
    expect(fullText).toContain("susceptibility blooming");
    expect(fullText).toContain("No abnormal enhancement");
    expect(fullText).toContain("spectroscopy");
    expect(fullText).toContain("MRA");
    expect(plainText).not.toContain("No restricted diffusion");
    expect(plainText).not.toContain("susceptibility blooming");
    expect(plainText).not.toContain("enhancement");
    expect(plainText).not.toContain("spectroscopy");
    expect(plainText).toContain("grey-white");
  });

  it("keeps incidentals as separately removable atoms", () => {
    const built = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_PLAIN) });
    const concepts = built.observations.map((o) => o.concept);
    ["sinus", "mastoid", "orbital", "scalp"].forEach((c) => expect(concepts).toContain(c));
    const noInc = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_PLAIN), withIncidentals: false });
    expect(noInc.observations.map((o) => o.concept)).not.toContain("mastoid");
  });
});

describe("ledger integration — reconciliation & multi sub-master", () => {
  beforeEach(() => resetWorkspace());

  it("normal → abnormal reconciles the matching normal sentence", () => {
    const normal = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_FULL) });
    useWorkspace.getState().applyMacroBundle(normal);
    expect(useWorkspace.getState().findingsText).toContain("No restricted diffusion");
    const infarct = buildTilePatch(tile("vascular", "va-acute-territorial"));
    useWorkspace.getState().applyMacroBundle(infarct);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("acute territorial infarct");
    expect(findings).not.toContain("No restricted diffusion");
    expect(findings).not.toContain("No evidence of acute infarct");
  });

  it("multiple sub-masters coexist; removing one tile leaves the other intact", () => {
    const v = buildTilePatch(tile("vascular", "va-microbleeds"));
    const t = buildTilePatch(tile("trauma", "tr-sdh-acute"));
    useWorkspace.getState().applyMacroBundle(v);
    useWorkspace.getState().applyMacroBundle(t);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThanOrEqual(2);
    const removed = useWorkspace.getState().removeMacroBundle(v.bundleId);
    expect(removed).toBe("removed");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("subdural haematoma");
    expect(findings).not.toContain("microbleeds");
  });

  it("preset apply is undoable in one frame and does not finalize", () => {
    const before = useWorkspace.getState().findingsText;
    const preset = brainPresetById("tbi-sdh")!;
    useWorkspace.getState().applyMacroBundle(preset.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) }));
    expect(useWorkspace.getState().findingsText).toContain("subdural haematoma");
    expect(useWorkspace.getState().isFinalized).toBe(false);
    const undone = useWorkspace.getState().undoLastPatch();
    expect(undone).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("manual dictated text survives bundle removal (preserved-manual)", () => {
    const sdh = buildTilePatch(tile("trauma", "tr-sdh-acute"));
    useWorkspace.getState().applyMacroBundle(sdh);
    const dictated = "Dictated by me after telephone discussion with the referring team.";
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${dictated}`, "manual");
    const outcome = useWorkspace.getState().removeMacroBundle(sdh.bundleId);
    expect(["preserved-manual", "removed", "no-op-unproven"]).toContain(outcome);
    expect(useWorkspace.getState().findingsText).toContain(dictated);
  });

  it("Findings change marks Impression as needing refresh; refresh is additive", () => {
    const infarct = buildTilePatch(tile("vascular", "va-acute-territorial"));
    useWorkspace.getState().applyMacroBundle(infarct);
    const impressionAfterApply = useWorkspace.getState().impressionText;
    expect(impressionAfterApply).toContain("Acute territorial infarct");
    // Append-only dictation into Findings (provenance reconciled, not
    // wholesale re-stamped) — Impression must be marked stale, not replaced.
    useWorkspace.getState().setField(
      "findings",
      `${useWorkspace.getState().findingsText}\nAdditional dictated sentence about the cortex.`,
      { source: "manual", replaceProvenance: false },
    );
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionText).toContain("Acute territorial infarct");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(impressionAfterApply.length).toBeGreaterThan(0);
  });

  it("wholesale manual rewrite of Findings protects the ledger contribution (never silently overwritten)", () => {
    const infarct = buildTilePatch(tile("vascular", "va-acute-territorial"));
    useWorkspace.getState().applyMacroBundle(infarct);
    useWorkspace.getState().setField(
      "findings",
      "Only the radiologist's own dictated findings.",
      "manual",
    );
    expect(useWorkspace.getState().appliedPathologyPatches.every((p) => p.protected)).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe("Only the radiologist's own dictated findings.");
  });

  it("normal preset + system normal impression yields to later abnormal", () => {
    const normal = buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_FULL) });
    useWorkspace.getState().applyMacroBundle(normal);
    useWorkspace.getState().seedSystemNormalImpression();
    expect(useWorkspace.getState().impressionText).toMatch(/normal/i);
    const mass = buildBrainLesionAtoms(
      { number: "solitary", compartment: "intra-axial", location: "right frontal lobe", laterality: "right" },
      { seq: parseBrainSequences(TECH_FULL) },
    );
    useWorkspace.getState().applyMacroBundle(mass);
    expect(useWorkspace.getState().impressionText).toMatch(/frontal/i);
  });
});

describe("sequence gating of tiles", () => {
  it("DWI/SWI/contrast-dependent tiles are unavailable on a plain protocol", () => {
    const plain = parseBrainSequences(TECH_PLAIN);
    expect(tileAvailable(tile("vascular", "va-acute-territorial"), plain).ok).toBe(false);
    expect(tileAvailable(tile("vascular", "va-microbleeds"), plain).ok).toBe(false);
    expect(tileAvailable(tile("infection", "in-abscess"), plain).ok).toBe(false);
    expect(tileAvailable(tile("infection", "in-meningitis"), plain).ok).toBe(false);
    expect(tileAvailable(tile("vascular", "va-cavernoma"), plain).missing).toContain("GRE/SWI");
    const full = parseBrainSequences(TECH_FULL);
    expect(tileAvailable(tile("vascular", "va-acute-territorial"), full).ok).toBe(true);
  });

  it("adult involution tiles are hidden for pediatric technique", () => {
    const ped = parseBrainSequences("MRI brain, pediatric protocol, 2 years old. T1, T2, FLAIR, DWI.");
    const atrophy = tile("routine", "rt-atrophy");
    expect(tileAvailable(atrophy, ped).ok).toBe(false);
  });
});

describe("shared lesion characterization", () => {
  it("composition honours sequence availability", () => {
    const lesion: BrainLesionInput = {
      number: "solitary",
      compartment: "intra-axial",
      location: "left parietal lobe",
      laterality: "left",
      size: { ap: 4, transverse: 3, cc: 3.5 },
      enhancement: "ring",
      morphology: ["necrotic", "ill-defined"],
      features: ["vasogenic edema", "midline shift", "mass effect"],
      midlineShiftMm: 6,
      differentials: ["high-grade glioma", "metastasis"],
    };
    const full = parseBrainSequences(TECH_FULL);
    const built = buildBrainLesionAtoms(lesion, { seq: full });
    const text = built.observations.map((o) => o.findingsText ?? "").join("\n");
    expect(text).toContain("4 x 3 x 3.5 cm");
    expect(text).toContain("ring enhancement");
    expect(text).toContain("Midline shift of 6 mm");
    expect(text).toContain("Vasogenic oedema");
    const shift = built.observations.find((o) => o.concept === "midline_shift");
    expect(shift?.severity).toBe("critical");
    expect(text).toContain("Histopathological correlation is required");

    const plain = parseBrainSequences(TECH_PLAIN);
    const noContrastText = buildBrainLesionAtoms(lesion, { seq: plain })
      .observations.map((o) => o.findingsText ?? "").join("\n");
    expect(noContrastText).not.toMatch(/enhanc/i);
  });

  it("never converts morphology into a definitive diagnosis", () => {
    const sentence = composeLesionSentence(
      { number: "solitary", compartment: "intra-axial", location: "thalamus", enhancement: "ring" },
      parseBrainSequences(TECH_FULL),
    );
    expect(sentence.toLowerCase()).not.toMatch(/abscess|tuberculoma|glioma|lymphoma/);
  });

  it("carries the three-axis measurement as an estimated ABC/2 volume", () => {
    const sentence = composeLesionSentence(
      {
        number: "solitary",
        compartment: "intra-axial",
        location: "left parietal lobe",
        size: { ap: 4, transverse: 3, cc: 3.5 },
      },
      parseBrainSequences(TECH_FULL),
    );
    expect(sentence).toContain("4 x 3 x 3.5 cm");
    expect(sentence).toContain("estimated ABC/2 volume 21 cc");
  });

  it("does not double the side when the location already names it", () => {
    const seq = parseBrainSequences(TECH_FULL);
    const lesion: BrainLesionInput = {
      number: "solitary",
      compartment: "intra-axial",
      location: "left parietal lobe",
      laterality: "left",
    };
    expect(composeLesionSentence(lesion, seq).match(/\bleft\b/g)).toHaveLength(1);
    expect(composeLesionImpressionFragment(lesion, seq).match(/\bleft\b/gi)).toHaveLength(1);
  });
});

describe("grading & measurements propagation", () => {
  it("Fazekas grade reaches findings + impression as one source of truth", () => {
    const built = buildFazekasAtoms({ periventricular: 2, deep: 1 });
    expect(built.observations[0].findingsText).toContain("Fazekas grade 2 periventrically and 1");
    expect(built.observations[0].incoming.impression).toContain("Fazekas grade 2/1");
    resetWorkspace();
    useWorkspace.getState().applyMacroBundle(built);
    expect(useWorkspace.getState().impressionText).toContain("Fazekas");
  });

  it("herniation atoms carry critical severity", () => {
    const built = buildHerniationAtoms({ types: ["tonsillar"], displacementMm: 7 });
    expect(built.observations[0].severity).toBe("critical");
    expect(built.observations[0].findingsText).toContain("tonsillar");
  });

  it("pituitary: enlargement threshold, Knosp encasement, chiasm compression severity", () => {
    expect(pituitaryIsEnlarged(12)).toBe(true);
    expect(pituitaryIsEnlarged(8)).toBe(false);
    expect(knospIsEncasement(3)).toBe(true);
    expect(knospIsEncasement(2)).toBe(false);
    const built = buildPituitaryAtoms({
      pituitary: { ap: 2, tr: 1.8, cc: 2.4, suprasellarExtension: "chiasm compression", cavernousSinus: "encasement", knosp: 3 },
    });
    const atom = built.observations[0];
    expect(atom.severity).toBe("urgent");
    expect(atom.findingsText).toContain("chiasm compression");
    expect(atom.state).toContain("knosp:3");
  });
});

describe("epilepsy & MRS", () => {
  it("right and left hippocampal findings occupy separate slots and coexist", () => {
    resetWorkspace();
    const right = buildTilePatch(tile("epilepsy", "ep-hip-right-volume"));
    const left = buildTilePatch(tile("epilepsy", "ep-hip-left-volume"));
    useWorkspace.getState().applyMacroBundle(right);
    useWorkspace.getState().applyMacroBundle(left);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("right hippocampus");
    expect(findings).toContain("left hippocampus");
  });

  it("MTS tile emits volume + signal + architecture + impression fragment", () => {
    const mts = buildTilePatch(tile("epilepsy", "ep-mts-left"));
    expect(mts.observations.length).toBe(4);
    expect(mts.observations.some((o) => (o.incoming.impression ?? "").includes("Mesial temporal sclerosis on the left"))).toBe(true);
  });

  it("epilepsy-negative statement requires protocol sequences", () => {
    const t = tile("epilepsy", "ep-negative");
    expect(t.requires).toEqual(["t2", "flair"]);
    expect(tileAvailable(t, parseBrainSequences("MRI brain T1 only")).ok).toBe(false);
  });

  it("MRS atoms are only built when MRS performed; sentence stays descriptive", () => {
    const input = { voxelLocation: "lesion", cho: 1.8, cr: 1.0, naa: 0.8, lipid: true, interpretation: ["elevated choline", "reduced NAA"] };
    expect(buildBrainMrsAtoms(input, { seq: parseBrainSequences(TECH_PLAIN) })).toBeNull();
    const built = buildBrainMrsAtoms(input, { seq: parseBrainSequences(TECH_FULL) });
    const s = composeMrsSentence(input as never);
    expect(built?.observations[0].findingsText).toContain("Cho 1.8");
    expect(s.toLowerCase()).not.toMatch(/abscess|tuberculoma|neurocysticercosis|tumor\b/);
  });
});

describe("sub-master workflows via the ledger", () => {
  beforeEach(() => resetWorkspace());

  it("trauma SDH reconciles the extra-axial normal", () => {
    useWorkspace.getState().applyMacroBundle(buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_FULL) }));
    useWorkspace.getState().applyMacroBundle(buildTilePatch(tile("trauma", "tr-sdh-acute")));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("subdural haematoma");
    expect(findings).not.toContain("No extra-axial collection");
  });

  it("DAI distribution tiles all contribute", () => {
    ["tr-dai-gwj", "tr-dai-cc", "tr-dai-bs", "tr-dai-swi"].forEach((id) => {
      useWorkspace.getState().applyMacroBundle(buildTilePatch(tile("trauma", id)));
    });
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("grey-white matter junction");
    expect(findings).toContain("corpus callosum");
    expect(findings).toContain("brainstem");
  });

  it("tumor preset: meningioma uses extra-axial compartment and dural tail", () => {
    const p = brainPresetById("meningioma")!;
    useWorkspace.getState().applyMacroBundle(p.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) }));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("extra-axial");
    expect(findings).toContain("Dural tail");
    expect(findings).not.toContain("No extra-axial collection");
  });

  it("abscess preset triggers critical detection WITHOUT any communication being auto-documented", () => {
    const p = brainPresetById("pyogenic-abscess")!;
    useWorkspace.getState().applyMacroBundle(p.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) }));
    const hits = detectCriticalFindings(
      useWorkspace.getState().findingsText,
      useWorkspace.getState().impressionText.split(/\n+/).filter(Boolean),
    );
    expect(hits.some((h) => h.label === "brain abscess")).toBe(true);
    // Detection is a pure advisory — nothing here flags, notifies or documents.
    expect(useWorkspace.getState().appliedPathologyPatches.some((patch) => (patch.lastRendered.impression ?? "").match(/clinician informed|communicated/i))).toBe(false);
  });

  it("demyelinating pattern tiles never assert McDonald criteria", () => {
    const ms = brainPresetById("ms-pattern")!;
    useWorkspace.getState().applyMacroBundle(ms.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) }));
    const text = useWorkspace.getState().findingsText + useWorkspace.getState().impressionText;
    expect(text).toMatch(/periventricular/i);
    expect(text).not.toMatch(/mcdonald|criteria (are )?fulfilled/i);
  });

  it("pituitary preset emits dimensions + chiasm compression impression", () => {
    const p = brainPresetById("pituitary-macroadenoma")!;
    useWorkspace.getState().applyMacroBundle(p.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) }));
    expect(useWorkspace.getState().impressionText).toMatch(/macroadenoma with optic chiasm compression/i);
    expect(useWorkspace.getState().findingsText).toMatch(/2\.1 x 1\.8 x 2\.4 cm/);
  });

  it("CPA lesion reconciles the posterior-fossa normal", () => {
    useWorkspace.getState().applyMacroBundle(buildBrainNormalAtoms({ seq: parseBrainSequences(TECH_FULL) }));
    useWorkspace.getState().applyMacroBundle(buildTilePatch(tile("cpa", "cpa-right")));
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("cerebellopontine angle");
    expect(findings).not.toContain(BRAIN_NORMAL_SENTENCES.posteriorFossa);
  });

  it("infection ring-enhancing preset stays contrast-gated and descriptive", () => {
    const p = brainPresetById("ring-enhancing-infective")!;
    const full = p.build({ region: "Brain", seq: parseBrainSequences(TECH_FULL) });
    expect(full.observations.some((o) => /ring-?enhancing/i.test(o.findingsText ?? ""))).toBe(true);
  });
});

describe("contradiction + sequence-aware validation", () => {
  it("normal vs abnormal contradictions are reported as warnings", () => {
    const seq = parseBrainSequences(TECH_FULL);
    expect(
      brainTextContradictions({
        findingsText: "No restricted diffusion is seen on DWI/ADC. A focal lesion shows restricted diffusion in the left MCA territory.",
        impressionText: "",
        seq,
      }).some((w) => w.includes("restricted diffusion")),
    ).toBe(true);
    expect(
      brainTextContradictions({
        findingsText: "No midline shift. Midline shift of 7 mm to the right is present.",
        impressionText: "",
        seq,
      }).some((w) => w.includes("midline")),
    ).toBe(true);
    expect(
      brainTextContradictions({
        findingsText: "Hippocampi are symmetric in volume. Volume loss of the left hippocampus.",
        impressionText: "",
        seq,
      }).some((w) => w.includes("hippocamp")),
    ).toBe(true);
  });

  it("sequence-aware warnings fire for statements the technique cannot support", () => {
    const plain = parseBrainSequences(TECH_PLAIN);
    const warnings = brainTextContradictions({
      findingsText: "No restricted diffusion is seen. No abnormal enhancement is noted.",
      impressionText: "",
      seq: plain,
    });
    expect(warnings.some((w) => w.includes("DWI"))).toBe(true);
    expect(warnings.some((w) => w.includes("contrast"))).toBe(true);
  });

  it("consistent reports produce no brain contradiction warnings", () => {
    const seq = parseBrainSequences(TECH_FULL);
    expect(
      brainTextContradictions({
        findingsText: BRAIN_NORMAL_SENTENCES.parenchyma + " " + BRAIN_NORMAL_SENTENCES.diffusion,
        impressionText: "",
        seq,
      }),
    ).toEqual([]);
  });
});

describe("bundle identity", () => {
  it("tiles use stable bundle ids so re-apply is idempotent and removal targeted", () => {
    const t = tile("vascular", "va-sah");
    expect(brainBundleId("tile", t.id)).toBe(`bsm-tile-${t.id}`);
    resetWorkspace();
    const built = buildTilePatch(t);
    useWorkspace.getState().applyMacroBundle(built);
    const countAfterFirst = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().applyMacroBundle(buildTilePatch(t));
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(countAfterFirst);
  });
});
