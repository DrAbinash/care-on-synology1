/**
 * X-ray Chest Clinical Sub-Master V3 — architecture and clinical-consistency
 * tests (spec §20).
 *
 * These run against the REAL workspace store, not source-text greps: applying
 * a palette tile must reconcile the ledger, protect manual prose, refresh the
 * impression and drive the existing critical/AI machinery exactly the way the
 * MRI Brain sub-master does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext, isXrayChestReportingContext } from "./reportingStudyContext";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { CANONICAL_CONCEPTS } from "./conceptCanon/contentPacks";
import { detectCriticalFindings } from "./criticalResults";
import { CHEST_ATOM_SOURCE, chestBundleId, unfilledChestTokens } from "./xrayChestAtoms";
import { CHEST_NORMAL_SENTENCES, buildChestNormalAtoms } from "./xrayChestNormalAtoms";
import {
  XRAY_CHEST_PRESETS,
  XRAY_CHEST_SUB_MASTERS,
  buildTilePatch,
  chestCriticalTileIds,
  chestPresetById,
  chestSubMasterById,
  tileAvailable,
  type ChestSubMasterId,
  type ChestTile,
} from "./xrayChestSubMasters";
import { buildChestDeviceAtoms, composeDeviceSentence } from "./xrayChestDevices";
import { buildChestLesionAtoms, composeLesionSentence } from "./xrayChestLesions";
import { buildChestMeasureAtoms, pneumothoraxBand, ctrIsEnlarged, tensionSignPresent } from "./xrayChestMeasures";
import { buildChestComparisonAtom, unanchoredComparisonWarning } from "./xrayChestComparison";
import { chestTextContradictions } from "./xrayChestContradictions";
import { parseXrayChestViews } from "./xrayChestViews";

const TECH_PA =
  "PA erect chest radiograph. Adequate inspiration. No significant rotation. Adequate penetration. No motion artifact. Apices and costophrenic angles are fully included.";
const TECH_AP_PORTABLE =
  "AP chest radiograph. Portable examination performed at the bedside. Low-volume film with crowding of bronchovascular markings. Patient rotation limits assessment of mediastinal width and hilar symmetry.";

function resetWorkspace(technique = TECH_PA) {
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
      modality: "CR",
      studyDescription: "CHEST X-RAY",
      regions: ["X-Ray Chest PA"],
      source: "billed",
    }),
  });
}

const ctxPA = () => parseXrayChestViews(TECH_PA);
const ctxAP = () => parseXrayChestViews(TECH_AP_PORTABLE);

const tile = (subMasterId: ChestSubMasterId, tileId: string): ChestTile => {
  const found = chestSubMasterById(subMasterId)?.tiles.find((t) => t.id === tileId);
  if (!found) throw new Error(`missing tile ${subMasterId}/${tileId}`);
  return found;
};

const applyTile = (subMasterId: ChestSubMasterId, tileId: string, template = {}) =>
  useWorkspace.getState().applyMacroBundle(buildTilePatch(tile(subMasterId, tileId), "Chest", template));

const applyPreset = (id: string) => {
  const preset = chestPresetById(id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return useWorkspace.getState().applyMacroBundle(preset.build({ region: "Chest", ctx: ctxPA() }));
};

const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

describe("sub-master data integrity", () => {
  it("carries the sixteen clinical sub-masters in the specified order", () => {
    expect(XRAY_CHEST_SUB_MASTERS.map((s) => s.id)).toEqual([
      "routine", "infection", "tb", "edema", "pleural", "pneumothorax", "collapse",
      "copd", "ild", "nodule", "trauma", "cardiac", "pediatric", "icu", "postop", "advanced",
    ]);
  });

  it("keeps tile ids unique and every tile carrying at least one atom", () => {
    const ids = new Set<string>();
    for (const sm of XRAY_CHEST_SUB_MASTERS) {
      expect(sm.label.length).toBeGreaterThan(0);
      expect(sm.hint.length).toBeGreaterThan(0);
      for (const t of sm.tiles) {
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
        expect(t.atoms.length).toBeGreaterThan(0);
        for (const atom of t.atoms) {
          expect(atom.concept).toMatch(/^[a-z0-9_]+$/);
          // A tile must write findings, an impression, or a recommendation.
          expect(
            atom.findings.trim().length + (atom.impression ?? "").length + (atom.recommendation ?? "").length,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("registers every catalog concept in the shared content canon", () => {
    // Unregistered concepts silently fall back to heuristic sentence ownership.
    const missing: string[] = [];
    for (const sm of XRAY_CHEST_SUB_MASTERS) {
      for (const t of sm.tiles) {
        for (const atom of t.atoms) {
          if (!CANONICAL_CONCEPTS.has(atom.concept)) missing.push(`${sm.id}/${t.id}: ${atom.concept}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("renders clean prose for every tile at every laterality", () => {
    // Catalog prose is written with bracket tokens. A duplicated or unfilled
    // token is a defect that reaches the patient report, and no runtime
    // behaviour catches it — so render the whole catalog, not a sample.
    const defects: string[] = [];
    const template = {
      laterality: "right" as const,
      zone: "upper zone",
      size: "2 cm",
      level: "T8",
      priorDate: "12.03.2026",
    };
    for (const sm of XRAY_CHEST_SUB_MASTERS) {
      for (const t of sm.tiles) {
        for (const laterality of ["right", "left", "bilateral"] as const) {
          const built = buildTilePatch(t, "Chest", { ...template, laterality });
          for (const o of built.observations) {
            for (const [field, text] of Object.entries(o.incoming)) {
              const label = `${sm.id}/${t.id} (${laterality}) ${field}`;
              if (!text) continue;
              if (/\[(side|zone|size|level|date)\]/i.test(text)) defects.push(`${label}: unfilled token — ${text}`);
              if (/\b(right|left|bilateral)\s+\1\b/i.test(text)) defects.push(`${label}: repeated laterality — ${text}`);
              if (/\b(\w+)\s+\1\b/i.test(text)) defects.push(`${label}: repeated word — ${text}`);
              if (/\s{2,}|, ?,|\.\s*\./.test(text)) defects.push(`${label}: malformed spacing — ${text}`);
            }
          }
        }
      }
    }
    expect(defects).toEqual([]);
  });

  it("uses the same ledger source as every other structured sub-master", () => {
    expect(CHEST_ATOM_SOURCE).toBe("structured-template");
    resetWorkspace();
    applyTile("infection", "in-consolidation", { laterality: "right", zone: "upper zone" });
    expect(useWorkspace.getState().appliedPathologyPatches.every((p) => p.source === "structured-template")).toBe(true);
  });
});

describe("normal baseline and normal→abnormal reconciliation (spec §5)", () => {
  beforeEach(() => resetWorkspace());

  it("one-click normal PA writes the canonical chest baseline", () => {
    applyPreset("normal-chest-pa");
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.lungsClear);
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.trachea);
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.pleura);
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.bones);
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.noDevices);
  });

  it("normal AP portable refuses the projection-dependent lines", () => {
    const atoms = buildChestNormalAtoms({ ctx: ctxAP() });
    const text = atoms.observations.map((o) => o.findingsText ?? "").join(" ");
    expect(text).toContain(CHEST_NORMAL_SENTENCES.cardiacNotAssessed);
    expect(text).not.toContain(CHEST_NORMAL_SENTENCES.cardiacNormal);
    // Low-volume film cannot claim adequate expansion; rotated film cannot
    // certify mediastinal width or hilar symmetry.
    expect(text).not.toContain(CHEST_NORMAL_SENTENCES.expansion);
    expect(text).not.toContain(CHEST_NORMAL_SENTENCES.mediastinum);
    expect(text).not.toContain(CHEST_NORMAL_SENTENCES.hila);
  });

  it("an abnormal opacity supersedes the 'lungs clear' baseline", () => {
    applyPreset("normal-chest-pa");
    expect(findings()).toContain("clear without focal air-space opacity");
    applyTile("infection", "in-consolidation", { laterality: "right", zone: "upper zone" });
    expect(findings()).not.toContain("clear without focal air-space opacity");
    expect(findings()).toContain("Lobar/segmental consolidation involving the right upper zone.");
  });

  it("an effusion supersedes 'no pleural effusion or pneumothorax'", () => {
    applyPreset("normal-chest-pa");
    applyTile("pleural", "pl-moderate", { laterality: "left" });
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.pleura);
    expect(findings()).toContain("Moderate left pleural effusion.");
    expect(impression()).toContain("Left pleural effusion (moderate)");
  });

  it("a device supersedes 'no lines, tubes or devices are identified'", () => {
    applyPreset("normal-chest-pa");
    const { bundleId, observations } = buildChestDeviceAtoms({
      kind: "etTube",
      position: "satisfactory",
      tip: "at the level of the carina",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.noDevices);
    expect(findings()).toContain("Endotracheal tube in situ");
  });

  it("removing the abnormal restores the baseline sentence", () => {
    applyPreset("normal-chest-pa");
    const built = buildTilePatch(tile("pneumothorax", "pt-small"), "Chest", { laterality: "right" });
    useWorkspace.getState().applyMacroBundle(built);
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.pleura);
    useWorkspace.getState().removeMacroBundle(built.bundleId);
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.pleura);
  });
});

describe("projection gating of interpretation", () => {
  const cardio = tile("cardiac", "ca-enlarged");
  const retro = tile("copd", "cp-retrosternal");
  const widths = tile("cardiac", "ca-widening");

  it("blocks the cardiomegaly tile on an AP-only film", () => {
    expect(tileAvailable(cardio, ctxPA()).ok).toBe(true);
    const gate = tileAvailable(cardio, ctxAP());
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("PA");
  });

  it("blocks the retrosternal-space tile until a lateral is recorded", () => {
    expect(tileAvailable(retro, ctxPA()).ok).toBe(false);
    const withLateral = parseXrayChestViews(`${TECH_PA} Additional lateral projection obtained.`);
    expect(tileAvailable(retro, withLateral).ok).toBe(true);
  });

  it("blocks a mediastinal-width tile on a rotated film", () => {
    expect(tileAvailable(widths, ctxAP()).ok).toBe(false);
    expect(tileAvailable(widths, ctxAP()).missing.join()).toMatch(/rotation/i);
  });

  it("free-gas tile needs an erect PA projection", () => {
    const freeAir = tile("advanced", "ad-free-air");
    expect(tileAvailable(freeAir, ctxAP()).ok).toBe(false);
    expect(tileAvailable(freeAir, ctxPA()).ok).toBe(true);
  });
});

describe("descriptive language is never a diagnosis", () => {
  it("TB-pattern tiles do not assert active tuberculosis", () => {
    resetWorkspace();
    applyTile("tb", "tb-upper-zone", { laterality: "right" });
    applyTile("tb", "tb-fibro-cavitary", { laterality: "right" });
    expect(findings().toLowerCase()).not.toMatch(/active (pulmonary )?tuberculosis|ptb\b|positive for tb/i);
    expect(findings()).toContain("Upper-zone predominant heterogeneous opacity on the right.");
  });

  it("hyperinflation alone never becomes COPD", () => {
    resetWorkspace();
    const built = buildTilePatch(tile("copd", "cp-hyperinflation"), "Chest");
    const prose = built.observations.map((o) => `${o.findingsText ?? ""} ${o.incoming.impression ?? ""}`).join(" ");
    expect(prose.toLowerCase()).not.toMatch(/chronic obstructive pulmonary disease|\bcopd\b/);
  });

  it("a single opacity never becomes cardiac failure", () => {
    resetWorkspace();
    applyTile("edema", "ed-interstitial");
    expect(impression().toLowerCase()).not.toMatch(/cardiac failure|congestive cardiac failure|heart failure/);
  });

  it("nodule characterisation never asserts benignity or malignancy", () => {
    const atoms = buildChestLesionAtoms({
      laterality: "right",
      zone: "upper zone",
      sizeMm: 24,
      appearance: "irregular",
      margins: "ill-defined",
    });
    const prose = atoms.observations.map((o) => `${o.findingsText ?? ""} ${o.incoming.impression ?? ""}`).join(" ");
    expect(prose.toLowerCase()).not.toMatch(/malignan|benign|carcinoma|metasta|neoplas/);
    expect(prose).toContain("requiring further characterization as selected by the radiologist");
  });

  it("CT recommendation appears only when the radiologist selects it", () => {
    const without = buildChestLesionAtoms({ laterality: "left", zone: "mid zone" });
    expect(without.observations.some((o) => (o.recommendationText ?? o.incoming.recommendation ?? "") !== "")).toBe(false);
    const withCt = buildChestLesionAtoms({ laterality: "left", zone: "mid zone", recommendCt: true });
    expect(withCt.observations.some((o) => (o.incoming.recommendation ?? "").includes("CT correlation"))).toBe(true);
  });

  it("a normal chest film does not exclude occult trauma", () => {
    resetWorkspace();
    applyTile("trauma", "tr-not-exclusion");
    expect(impression()).toMatch(/does not exclude occult thoracic injury/i);
  });
});

describe("canonical pattern coverage (spec §4, §6, §7, §9, §12)", () => {
  it("pneumonia: consolidation carries side and zone into both Findings and Impression", () => {
    resetWorkspace();
    applyTile("infection", "in-consolidation", { laterality: "right", zone: "mid zone" });
    expect(findings()).toContain("Lobar/segmental consolidation involving the right mid zone.");
    expect(impression()).toContain("Consolidation in the right mid zone");
    expect(unfilledChestTokens(`${findings()} ${impression()}`)).toEqual([]);
  });

  it("collapse: volume loss reconciles the clear-lung baseline and reverses on removal", () => {
    resetWorkspace();
    applyPreset("normal-chest-pa");
    applyTile("collapse", "co-lobar", { laterality: "left" });
    expect(findings()).toContain("Lobar/segmental volume loss on the left.");
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.lungsClear);
    useWorkspace.getState().removeMacroBundle(chestBundleId("tile", "co-lobar"));
    expect(findings()).toContain(CHEST_NORMAL_SENTENCES.lungsClear);
  });

  it("edema: vascular redistribution supersedes the normal vascular line", () => {
    resetWorkspace();
    applyPreset("normal-chest-pa");
    applyTile("edema", "ed-redistribution");
    expect(findings()).toContain("Pulmonary vascular redistribution/congestion.");
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.vasculature);
  });

  it("ILD: the reticular pattern stays descriptive, with CT left as a selection", () => {
    resetWorkspace();
    applyTile("ild", "il-reticular");
    expect(findings()).toContain("Bilateral reticular/reticulonodular interstitial opacities.");
    expect(findings().toLowerCase()).not.toMatch(/usual interstitial pneumonia|\buit\b|idiopathic pulmonary fibrosis|\bipf\b/);
  });

  it("trauma: a rib fracture records the locality the radiologist chose", () => {
    resetWorkspace();
    applyTile("trauma", "tr-rib", { laterality: "left", zone: "lower zone" });
    expect(findings()).toContain("Rib fracture, left lower zone, where visible.");
    expect(unfilledChestTokens(findings())).toEqual([]);
  });
});

describe("pneumothorax, tension and size (spec §8)", () => {
  it("tension is a pattern of signs, never a size threshold", () => {
    expect(pneumothoraxBand(0.5)).toBe("small");
    expect(pneumothoraxBand(3)).toBe("large");
    // A large rim alone is not tension.
    expect(tensionSignPresent({})).toBe(false);
    expect(tensionSignPresent({ mediastinalShiftAway: true })).toBe(true);
  });

  it("a large pneumothorax and a tension-pattern film are separate records", () => {
    resetWorkspace();
    applyTile("pneumothorax", "pt-large", { laterality: "right" });
    expect(impression()).toMatch(/Large right pneumothorax/);
    expect(impression()).not.toMatch(/tension/);
    applyTile("pneumothorax", "pt-tension-signs");
    expect(impression().toLowerCase()).toContain("tension-pattern radiographic signs");
  });
});

describe("measurements (spec §11)", () => {
  it("gates the cardiothoracic ratio on a PA projection", () => {
    expect(ctrIsEnlarged(0.62, true)).toBe(true);
    expect(ctrIsEnlarged(0.45, true)).toBe(false);
    expect(ctrIsEnlarged(0.62, false)).toBeNull();
  });

  it("writes the AP caveat instead of a ratio verdict", () => {
    const { observations } = buildChestMeasureAtoms({ ctr: 0.62, paAvailable: false });
    expect(observations[0]?.findingsText).toMatch(/cannot be accurately assessed/i);
  });

  it("records a measured pneumothorax rim with severity", () => {
    const { observations } = buildChestMeasureAtoms({
      pneumothorax: { laterality: "left", rimCm: 3.2 },
    });
    expect(observations[0]?.findingsText).toMatch(/rim approximately 3.2 cm/);
    expect(observations[0]?.severity).toBe("severe");
  });
});

describe("lines, tubes and devices (spec §13)", () => {
  it("never invents a tip distance", () => {
    const sentence = composeDeviceSentence({ kind: "cvc", laterality: "right", position: "satisfactory" });
    expect(sentence).toMatch(/tip is not adequately visualised/i);
    expect(sentence).not.toMatch(/\d+\s*cm/);
    // "satisfactory" without a seen course/tip is downgraded honestly.
    expect(sentence).toMatch(/position cannot be confirmed/i);
  });

  it("records a measured distance only when the radiologist typed one", () => {
    const sentence = composeDeviceSentence({
      kind: "etTube",
      position: "satisfactory",
      tip: "above the carina",
      tipCm: 4,
    });
    expect(sentence).toContain("tip 4 cm above the carina");
  });

  it("malposition is impression-worthy and severe", () => {
    const { observations } = buildChestDeviceAtoms({
      kind: "chestDrain",
      laterality: "left",
      position: "malpositioned",
      course: "directed toward the apex",
    });
    expect(observations[0]?.severity).toBe("severe");
    expect(observations[0]?.incoming.impression).toMatch(/Malpositioned intercostal drain/);
  });

  it("a device supersedes the no-device baseline through the ledger", () => {
    resetWorkspace();
    applyPreset("normal-chest-pa");
    const { bundleId, observations } = buildChestDeviceAtoms({
      kind: "pacemaker",
      position: "satisfactory",
      course: "two leads in expected position",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(findings()).not.toContain(CHEST_NORMAL_SENTENCES.noDevices);
    expect(findings()).toMatch(/Pacemaker in situ/);
  });
});

describe("comparison is anchored to a real prior (spec §15)", () => {
  it("builds comparison prose only from a dated prior", () => {
    const { observations } = buildChestComparisonAtom({
      subject: "opacity",
      change: "improved",
      priorDateIso: "2026-08-14",
      priorStudyName: "CHEST X-RAY",
    });
    expect(observations[0]?.findingsText).toMatch(/Compared with CHEST X-RAY dated 14 August 2026/i);
    expect(observations[0]?.findingsText).toMatch(/interval improvement/i);
  });

  it("warns when comparison wording has no dated reference", () => {
    expect(unanchoredComparisonWarning("No significant interval change.")).toMatch(/without a dated prior/i);
    expect(unanchoredComparisonWarning("Compared with CHEST X-RAY dated 2026-08-14.")).toBeNull();
  });

  it("an ordinary description is not mistaken for a comparison", () => {
    // "increased" is common descriptive prose on a chest film.
    expect(unanchoredComparisonWarning("Increased retrosternal clear space on the lateral view.")).toBeNull();
  });
});

describe("validation (spec §17)", () => {
  const withFindings = (text: string, extra: Record<string, unknown> = {}) =>
    chestTextContradictions({ findingsText: text, impressionText: "", techniqueText: TECH_PA, ...extra });

  it("clear lungs + focal opacity", () => {
    expect(withFindings(`${CHEST_NORMAL_SENTENCES.lungsClear} Right upper lobe consolidation.`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/coexists with a parenchymal opacity/i)]),
    );
  });

  it("no effusion + effusion", () => {
    expect(withFindings(`${CHEST_NORMAL_SENTENCES.pleura} Moderate left pleural effusion.`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/coexists with an effusion/i)]),
    );
  });

  it("normal cardiac size + cardiomegaly", () => {
    expect(withFindings("Cardiac silhouette is within normal limits. Cardiomegaly."))
      .toEqual(expect.arrayContaining([expect.stringMatching(/coexists with cardiomegaly/i)]));
  });

  it("normal mediastinum + widening", () => {
    expect(withFindings(`${CHEST_NORMAL_SENTENCES.mediastinum} Mediastinal widening.`))
      .toEqual(expect.arrayContaining([expect.stringMatching(/coexists with mediastinal widening/i)]));
  });

  it("no device + device object", () => {
    expect(withFindings(`${CHEST_NORMAL_SENTENCES.noDevices} Pacemaker in situ with two leads.`))
      .toEqual(expect.arrayContaining([expect.stringMatching(/coexists with a device finding/i)]));
  });

  it("normal study + significant abnormality", () => {
    expect(withFindings("Normal study. Large right pneumothorax."))
      .toEqual(expect.arrayContaining([expect.stringMatching(/significant abnormality/i)]));
  });

  it("PA-only assumption on AP is flagged from the recorded projection", () => {
    const warnings = chestTextContradictions({
      findingsText: "Cardiac size is normal.",
      impressionText: "",
      techniqueText: TECH_AP_PORTABLE,
    });
    expect(warnings.some((w) => /AP projection|projection that cannot support/i.test(w))).toBe(true);
  });

  it("unfilled fill-in tokens are reported rather than shipped", () => {
    expect(withFindings("Focal air-space opacity involving the [side] [zone]."))
      .toEqual(expect.arrayContaining([expect.stringMatching(/unfilled placeholder/i)]));
  });

  it("a denial never counts as the abnormality it denies", () => {
    expect(withFindings(CHEST_NORMAL_SENTENCES.pleura)).toEqual([]);
  });
});

/**
 * The centre already ships live X-Ray protocol prose (migrations/
 * zzzz_xr_gold_standard_content.sql → radiology_protocols.normal_text), and
 * radiologists mix that text with this sub-master. Validation must therefore
 * read the seeded wording as normal prose — not flag a correctly caveated AP
 * report — and still catch a real seeded-normal + sub-master-abnormal clash.
 */
describe("validation against the live seeded protocol prose", () => {
  const SEEDED_PA_TECH = "Erect PA view of the chest at full inspiration.";
  const SEEDED_PA_NORMAL =
    "The lung fields are clear with no focal consolidation, mass, or interstitial abnormality. " +
    "No pleural effusion or pneumothorax. The cardiac silhouette is normal in size " +
    "(cardiothoracic ratio within normal limits). The mediastinum and hila are unremarkable. " +
    "The visualized bony thorax and soft tissues are normal. The diaphragm and costophrenic angles are clear.";
  const SEEDED_AP_TECH = "AP view of the chest (supine / paediatric / limited-mobility technique).";
  const SEEDED_AP_NORMAL =
    "Allowing for AP projection and magnification, the lung fields are clear. No large effusion " +
    "or pneumothorax. The cardiac size cannot be accurately assessed on the AP projection. " +
    "The mediastinum is central.";

  it("accepts the seeded PA normal description as self-consistent", () => {
    expect(
      chestTextContradictions({
        findingsText: SEEDED_PA_NORMAL,
        impressionText: "",
        techniqueText: SEEDED_PA_TECH,
      }),
    ).toEqual([]);
  });

  it("accepts the seeded AP description: its own caveat is not a contradiction", () => {
    expect(
      chestTextContradictions({
        findingsText: SEEDED_AP_NORMAL,
        impressionText: "",
        techniqueText: SEEDED_AP_TECH,
      }),
    ).toEqual([]);
  });

  it("flags a seeded PA normal description once a sub-master opacity is added", () => {
    resetWorkspace(SEEDED_PA_TECH);
    applyTile("infection", "in-consolidation", { laterality: "right", zone: "mid zone" });
    expect(
      chestTextContradictions({
        findingsText: `${SEEDED_PA_NORMAL} ${findings()}`,
        impressionText: "",
        techniqueText: SEEDED_PA_TECH,
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/coexists with a parenchymal opacity/i)]));
  });

  it("flags the seeded PA cardiac statement when the film is AP", () => {
    const warnings = chestTextContradictions({
      findingsText: SEEDED_PA_NORMAL,
      impressionText: "",
      techniqueText: SEEDED_AP_TECH,
    });
    expect(warnings.some((w) => /AP projection|projection that cannot support it/i.test(w))).toBe(true);
    // …and exactly one cardiac warning, not one per mechanism.
    expect(warnings.filter((w) => /cardiac|cardiomegaly/i.test(w))).toHaveLength(1);
  });

  it("flags a cardiac conclusion when no projection was recorded at all", () => {
    const warnings = chestTextContradictions({
      findingsText: "The cardiac silhouette is normal in size.",
      impressionText: "",
      techniqueText: "",
    });
    expect(warnings.some((w) => /projection that cannot support it/i.test(w))).toBe(true);
  });
});

describe("impression, staleness and manual protection (spec §16)", () => {
  beforeEach(() => resetWorkspace());

  it("composes the impression from accepted ledger observations", () => {
    applyPreset("normal-chest-pa");
    applyTile("pneumothorax", "pt-small", { laterality: "right" });
    expect(impression()).toMatch(/right pneumothorax/i);
  });

  it("marks the impression stale when linked findings are hand-edited, without overwriting", () => {
    applyTile("infection", "in-consolidation", { laterality: "right", zone: "mid zone" });
    const before = impression();
    useWorkspace.getState().setField(
      "findings",
      `${findings()}\nAdditional dictated sentence about the pleura.`,
      { source: "manual", replaceProvenance: false },
    );
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(impression()).toBe(before);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(impression()).toContain(before.trim());
  });

  it("wholesale manual rewrite of findings protects ledger contributions", () => {
    applyTile("edema", "ed-redistribution");
    useWorkspace.getState().setField("findings", "Only the radiologist's own dictated findings.", "manual");
    expect(useWorkspace.getState().appliedPathologyPatches.every((p) => p.protected)).toBe(true);
    expect(findings()).toBe("Only the radiologist's own dictated findings.");
  });

  it("bundle removal keeps dictated text", () => {
    const built = buildTilePatch(tile("collapse", "co-lobar"), "Chest", { laterality: "left" });
    useWorkspace.getState().applyMacroBundle(built);
    const dictated = "Dictated after discussion with the referring physician.";
    useWorkspace.getState().setField("findings", `${findings()}\n${dictated}`, "manual");
    const outcome = useWorkspace.getState().removeMacroBundle(built.bundleId);
    expect(["preserved-manual", "removed", "no-op-unproven"]).toContain(outcome);
    expect(findings()).toContain(dictated);
  });

  it("undo reverses a whole palette tile in one step", () => {
    applyPreset("normal-chest-pa");
    const afterNormal = findings();
    applyTile("ild", "il-reticular");
    expect(findings()).not.toBe(afterNormal);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(findings()).toBe(afterNormal);
  });
});

describe("critical results (spec §18)", () => {
  // Detection is asserted against the sub-master's OWN generated prose, not
  // hand-written text: if the catalog wording and the term table ever drift
  // apart, this fails.
  const criticalTiles: { palette: ChestSubMasterId; tile: string; note: string }[] = [
    { palette: "pneumothorax", tile: "pt-tension-signs", note: "tension-pattern signs" },
    { palette: "pleural", tile: "pl-large", note: "large effusion with mass effect" },
    { palette: "advanced", tile: "ad-free-air", note: "subdiaphragmatic free gas" },
    { palette: "trauma", tile: "tr-pneumothorax", note: "post-traumatic pneumothorax" },
  ];

  for (const { palette, tile, note } of criticalTiles) {
    it(`raises a critical for ${palette}/${tile} (${note})`, () => {
      resetWorkspace();
      applyTile(palette, tile, { laterality: "left" });
      expect(detectCriticalFindings(findings(), [impression()]).length).toBeGreaterThan(0);
    });
  }

  it("raises a critical for a malpositioned line written through the device model", () => {
    resetWorkspace();
    const { bundleId, observations } = buildChestDeviceAtoms({
      kind: "cvc",
      laterality: "right",
      position: "malpositioned",
      tip: "within the right atrium",
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    expect(detectCriticalFindings(findings(), [impression()]).length).toBeGreaterThan(0);
  });

  it("does not raise a critical on a normal chest film", () => {
    resetWorkspace();
    applyPreset("normal-chest-pa");
    expect(detectCriticalFindings(findings(), [impression()])).toEqual([]);
  });

  it("never documents communication on its own", () => {
    // Detection is pure: the record is written only through the existing
    // CARE critical-result workflow, so the store stays untouched.
    resetWorkspace();
    applyTile("pneumothorax", "pt-tension-signs");
    const hits = detectCriticalFindings(findings(), [impression()]);
    expect(hits.length).toBeGreaterThan(0);
    expect(useWorkspace.getState().criticalFindings).toEqual([]);
  });

  it("marks the tiles that map onto the critical-pattern library", () => {
    const critical = chestCriticalTileIds();
    for (const id of ["pt-large", "pt-tension-signs", "pl-large", "ad-free-air", "tr-pneumothorax"]) {
      expect(critical).toContain(id);
    }
  });
});

describe("AI stays proposal-only (spec §19)", () => {
  it("AI prose creates no ledger observation and cannot finalize", () => {
    resetWorkspace();
    const before = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().setField("findings", "Right mid-zone consolidation.", { source: "ai-draft" });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(before);
    expect(useWorkspace.getState().isFinalized).toBe(false);
  });

  it("AI text does not overwrite a radiologist's manual impression", () => {
    resetWorkspace();
    useWorkspace.getState().setField("impression", "Clinical impression typed by the radiologist.", "manual");
    useWorkspace.getState().setFieldIfEmpty("impression", "AI suggestion", "ai-draft");
    expect(impression()).toBe("Clinical impression typed by the radiologist.");
  });
});

describe("study context predicate", () => {
  it("accepts a billed CR chest study", () => {
    expect(
      isXrayChestReportingContext({
        modality: "CR",
        region: "X-Ray Chest PA",
        family: "chest",
        studyDescription: "CHEST X-RAY",
      }),
    ).toBe(true);
  });

  it("rejects CT and USG chest studies", () => {
    expect(isXrayChestReportingContext({ modality: "CT", region: "Chest", family: "chest" })).toBe(false);
    expect(isXrayChestReportingContext({ modality: "US", region: "Chest", family: "chest" })).toBe(false);
  });

  it("rejects an X-ray of another body part", () => {
    expect(isXrayChestReportingContext({ modality: "CR", region: "X-Ray Knee", family: "unknown" })).toBe(false);
  });

  it("accepts a portable chest tab without a modality string", () => {
    expect(isXrayChestReportingContext({ region: "X-Ray Portable Chest" })).toBe(true);
  });
});

describe("bundle identity", () => {
  it("names chest bundles with their own prefix", () => {
    expect(chestBundleId("tile", "pt-large")).toBe("xcb-tile-pt-large");
  });
});
