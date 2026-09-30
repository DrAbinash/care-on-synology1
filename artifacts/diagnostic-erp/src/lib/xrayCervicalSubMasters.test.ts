import { beforeEach, describe, expect, it } from "vitest";
import {
  CERVICAL_ATOM_SOURCE,
  applyCervicalTemplate,
  cervicalAtomsToPatches,
  cervicalBundleId,
  unfilledCervicalTokens,
} from "./xrayCervicalAtoms";
import {
  CANONICAL_CONCEPTS,
  isImpressionworthyAbnormal,
} from "./conceptCanon/contentPacks";
import { resolveCanonicalConcept } from "./conceptCanon/conceptCanon";
import { detectCriticalFindings } from "./criticalResults";
import { buildReportingStudyContext, isXrayCervicalReportingContext } from "./reportingStudyContext";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { useWorkspace } from "./zai-workspace/store";
import {
  CERVICAL_DISC_LEVELS,
  cervicalLevelConsistencyIssues,
  normalizeCervicalLevel,
} from "./xrayCervicalLevels";
import {
  CERVICAL_NORMAL_SENTENCES,
  buildCervicalNormalAtoms,
} from "./xrayCervicalNormalAtoms";
import {
  XRAY_CERVICAL_PRESETS,
  XRAY_CERVICAL_SUB_MASTERS,
  buildCervicalTilePatch,
  cervicalCriticalTileIds,
  cervicalPresetAvailability,
  cervicalPresetById,
  cervicalSectionOrder,
  cervicalSubMasterById,
  cervicalTileAvailability,
  isCervicalSectionName,
  type CervicalSubMasterId,
  type CervicalTile,
} from "./xrayCervicalSubMasters";
import {
  buildCervicalMeasureAtoms,
  cervicalMeasurementBlockers,
  formatCervicalMeasurement,
  meyerdingFromSlipPercent,
  parseCervicalMeasurement,
  prevertebralReferenceUpperMm,
} from "./xrayCervicalMeasures";
import {
  buildCervicalDynamicAtoms,
  derivedAngulationChangeDeg,
  derivedTranslationChangeMm,
} from "./xrayCervicalDynamic";
import {
  buildCervicalHardwareAtoms,
  cervicalHardwareContradiction,
  composeCervicalHardwareSentence,
} from "./xrayCervicalHardware";
import {
  cervicalImpressionOrderWarnings,
  cervicalTextContradictions,
  cervicalUnvisualizedLevelClaims,
} from "./xrayCervicalContradictions";
import {
  assessC7T1,
  assessDynamic,
  assessForaminal,
  assessOdontoid,
  c7t1Visualized,
  parseXrayCervicalViews,
  setCervicalAdequacyInTechnique,
  setCervicalInferiorLevelInTechnique,
  toggleCervicalViewInTechnique,
  type XrayCervicalTechniqueContext,
} from "./xrayCervicalViews";
import { matchStudyRegion } from "./studyRegion";

/**
 * The live seeded cervical protocol (migrations/zzzz_xr_gold_standard_content.sql,
 * tab 976) and the live billed study name. Tests assert against both, because a
 * sub-master that only works against invented technique prose is not the thing
 * that ships.
 */
const TECH_SEEDED =
  "AP, lateral, and open-mouth odontoid views of the cervical spine (adequacy requires C7-T1 visualization).";

const FULL_SERIES =
  "AP cervical radiograph. Lateral cervical radiograph. Open-mouth odontoid view. " +
  "The odontoid is adequately visualized. C7-T1 is adequately visualized. " +
  "The inferior visualization extends to T1. No significant rotation. No motion artifact.";

const NEUTRAL_LATERAL =
  "AP cervical radiograph. Lateral cervical radiograph. The inferior visualization extends to T1.";

const ctxSeeded = () => parseXrayCervicalViews(TECH_SEEDED);
const ctxFull = () => parseXrayCervicalViews(FULL_SERIES);
const ctxNeutral = () => parseXrayCervicalViews(NEUTRAL_LATERAL);
const ctxEmpty = () => parseXrayCervicalViews("");

function resetWorkspace(technique = FULL_SERIES) {
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
      studyDescription: "X-RAY CERVICAL SPINE AP/LAT",
      regions: ["X-Ray Cervical Spine"],
      source: "billed",
    }),
  });
}

const findings = () => useWorkspace.getState().findingsText;
const impression = () => useWorkspace.getState().impressionText;

function applyTile(
  subMasterId: CervicalSubMasterId,
  tileId: string,
  template: Parameters<typeof buildCervicalTilePatch>[2] = {},
): CervicalTile {
  const t = tile(subMasterId, tileId);
  useWorkspace
    .getState()
    .applyMacroBundle(buildCervicalTilePatch(t, "Cervical Spine", template));
  return t;
}

function applyPreset(id: string, ctx: XrayCervicalTechniqueContext = ctxFull()) {
  const preset = cervicalPresetById(id);
  if (!preset) throw new Error(`unknown preset ${id}`);
  return useWorkspace.getState().applyMacroBundle(preset.build({ region: "Cervical Spine", ctx }));
}

function tile(subMasterId: CervicalSubMasterId, tileId: string): CervicalTile {
  const t = cervicalSubMasterById(subMasterId)?.tiles.find((x) => x.id === tileId);
  if (!t) throw new Error(`unknown tile ${subMasterId}/${tileId}`);
  return t;
}

const allTiles = (): Array<{ sm: CervicalSubMaster; t: CervicalTile }> =>
  XRAY_CERVICAL_SUB_MASTERS.flatMap((sm) => sm.tiles.map((t) => ({ sm, t })));

/** Every tile rendered into patient-facing prose, with a filled-in template. */
function renderedTileText(t: CervicalTile, template = {}): string {
  return buildCervicalTilePatch(t, "Cervical Spine", {
    level: "C5-C6",
    upperLevel: "C5",
    lowerLevel: "C6",
    laterality: "right",
    mm: "12",
    percent: "18",
    degrees: "9",
    line: "posterior vertebral",
    grade: "I",
    ...template,
  })
    .observations.flatMap((o) => [o.findingsText, o.incoming.impression ?? "", o.incoming.recommendation ?? ""])
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

describe("sub-master data integrity", () => {
  it("ships the ten sub-masters of spec §3 in report order, advanced last", () => {
    expect(XRAY_CERVICAL_SUB_MASTERS.map((sm) => sm.id)).toEqual([
      "routine",
      "degenerative",
      "trauma",
      "alignment",
      "dynamic",
      "congenital",
      "infection",
      "tumor",
      "postoperative",
      "advanced",
    ]);
  });

  it("gives every tile a unique id and at least one atom", () => {
    const seen = new Set<string>();
    for (const { sm, t } of allTiles()) {
      const key = `${sm.id}/${t.id}`;
      expect(seen.has(key), `${key} duplicated`).toBe(false);
      seen.add(key);
      expect(t.atoms.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.group.length).toBeGreaterThan(0);
    }
  });

  it("registers every emitted concept in the canonical content packs", () => {
    const missing: string[] = [];
    for (const { sm, t } of allTiles()) {
      for (const atom of t.atoms) {
        if (!CANONICAL_CONCEPTS.has(atom.concept)) missing.push(`${sm.id}/${t.id}: ${atom.concept}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves every cervical concept to itself, so no id shadows another pack alias", () => {
    // ALIAS_INDEX lets the first declaration win, so a new concept id that
    // normalizes onto an older pack's alias silently rewrites that older
    // concept's resolution. Idempotence is the cheap, total check.
    for (const { sm, t } of allTiles()) {
      for (const atom of t.atoms) {
        expect(resolveCanonicalConcept(atom.concept), `${sm.id}/${t.id}: ${atom.concept}`).toBe(
          atom.concept,
        );
      }
    }
  });

  it("keeps baseline sentences and abnormal supersession contracts identical", () => {
    // baselineReplaces must be a byte-for-byte normal sentence, or the
    // normal→abnormal reconciliation silently does nothing.
    const normals = new Set<string>(Object.values(CERVICAL_NORMAL_SENTENCES));
    for (const { sm, t } of allTiles()) {
      for (const atom of t.atoms) {
        if (!atom.baselineReplaces) continue;
        expect(normals.has(atom.baselineReplaces), `${sm.id}/${t.id}: ${atom.baselineReplaces}`).toBe(true);
      }
    }
  });

  it("writes clean prose for every tile at every laterality", () => {
    const defects: string[] = [];
    for (const { sm, t } of allTiles()) {
      for (const laterality of ["right", "left", "bilateral"] as const) {
        const text = renderedTileText(t, { laterality });
        if (unfilledCervicalTokens(text).length) {
          defects.push(`${sm.id}/${t.id}: unfilled ${unfilledCervicalTokens(text).join(",")}`);
        }
        if (/\b(right|left|bilateral)\s+\1\b/i.test(text)) {
          defects.push(`${sm.id}/${t.id}: duplicated laterality — ${text}`);
        }
        if (/\b(\w+)\s+\1\b/i.test(text.replace(/no no/g, ""))) {
          defects.push(`${sm.id}/${t.id}: repeated word — ${text}`);
        }
        if (/ {2,}|\(\s|\s\)/.test(text)) {
          defects.push(`${sm.id}/${t.id}: malformed spacing — ${text}`);
        }
        if (/\[[a-z]+\]/i.test(text)) {
          defects.push(`${sm.id}/${t.id}: leftover token — ${text}`);
        }
      }
    }
    expect(defects).toEqual([]);
  });

  it("keeps every tile section inside the §14 report order vocabulary", () => {
    for (const { sm, t } of allTiles()) {
      for (const atom of t.atoms) {
        const section = atom.anatomicalSection ?? "other";
        expect(isCervicalSectionName(section), `${sm.id}/${t.id}: ${section}`).toBe(true);
      }
    }
  });

  it("orders the routine core in the §14 composition order", () => {
    const routine = cervicalSubMasterById("routine");
    const sections = routine?.tiles.flatMap((t) => t.atoms.map((a) => a.anatomicalSection ?? "other")) ?? [];
    const indexes = sections.map((s) => cervicalSectionOrder(s));
    const ascending = indexes.every((v, i) => i === 0 || v >= indexes[i - 1]!);
    expect(ascending).toBe(true);
  });

  it("states the laterality once and the projection plainly", () => {
    const text = renderedTileText(tile("degenerative", "dg-foraminal-mild"), { laterality: "right" });
    expect(text).toMatch(/^Right neural foraminal narrowing at C5-C6 on the oblique views\.$/);
    expect(text).not.toMatch(/right.*right/i);
    const bilateral = renderedTileText(tile("degenerative", "dg-foraminal-mild"), { laterality: "bilateral" });
    expect(bilateral).toMatch(/^Bilateral neural foraminal narrowing/);
    expect(bilateral).not.toMatch(/bilateral.*bilateral/i);
  });
});

describe("view / adequacy gating (spec §2, §6, §7, §10)", () => {
  it("parses the live seeded protocol as AP + lateral + odontoid, with C7-T1 not certified", () => {
    const ctx = ctxSeeded();
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
    expect(ctx.performed.odontoid).toBe(true);
    // "adequacy requires C7-T1 visualization" states a requirement, not an
    // achievement, so the preset may not certify the junction from it.
    expect(ctx.adequacy.c7t1Visualization).toBe("unknown");
    expect(c7t1Visualized(ctx)).toBe(false);
    expect(assessC7T1(ctx).allowed).toBe(false);
  });

  it("gates odontoid tiles on a recorded, diagnostic odontoid view", () => {
    const tileObj = tile("trauma", "tr-odontoid-fracture");
    expect(cervicalTileAvailability(tileObj, ctxNeutral()).ok).toBe(false);
    expect(cervicalTileAvailability(tileObj, ctxSeeded()).ok).toBe(false);
    const limited = parseXrayCervicalViews(
      setCervicalAdequacyInTechnique(NEUTRAL_LATERAL, "odontoidVisualization", "limited"),
    );
    expect(cervicalTileAvailability(tileObj, limited).ok).toBe(false);
    expect(cervicalTileAvailability(tileObj, ctxFull()).ok).toBe(true);
  });

  it("explains which view a gated odontoid tile needs", () => {
    const gate = cervicalTileAvailability(tile("routine", "rt-ccj"), ctxNeutral());
    expect(gate.ok).toBe(false);
    expect(gate.missing.join(" ")).toMatch(/open-mouth odontoid/i);
  });

  it("still lets a suspected odontoid injury be reported without an adequate view", () => {
    // Strict gating must not create a blind alley: §7 of the library asks for
    // "odontoid fracture / suspicion", and suspicion is the honest answer on a
    // film that cannot see the dens.
    const suspicion = tile("trauma", "tr-odontoid-suspicion");
    expect(cervicalTileAvailability(suspicion, ctxSeeded()).ok).toBe(true);
    expect(cervicalTileAvailability(suspicion, ctxNeutral()).ok).toBe(true);
    const text = renderedTileText(suspicion);
    expect(text).toMatch(/open-mouth odontoid view or CT is required for assessment/);
    expect(text).toMatch(/not excluded/);
  });

  it("gates foraminal statements on the oblique for the side being reported", () => {
    const foraminal = tile("degenerative", "dg-foraminal-mild");
    expect(assessForaminal(ctxNeutral(), "right").allowed).toBe(false);
    const rightOnly = parseXrayCervicalViews(
      toggleCervicalViewInTechnique(toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "obliqueRight", true), "other", true),
    );
    expect(cervicalTileAvailability(foraminal, rightOnly, { laterality: "right" }).ok).toBe(true);
    expect(cervicalTileAvailability(foraminal, rightOnly, { laterality: "left" }).ok).toBe(false);
    expect(
      cervicalTileAvailability(foraminal, rightOnly, { laterality: "left" }).reason ?? "",
    ).toMatch(/left oblique/i);
  });

  it("refuses a foraminal assessment when rotation limits the oblique views", () => {
    const rotated = parseXrayCervicalViews(
      setCervicalAdequacyInTechnique(
        toggleCervicalViewInTechnique(FULL_SERIES, "obliqueRight", true),
        "rotation",
        "limited",
      ),
    );
    expect(assessForaminal(rotated, "right").allowed).toBe(false);
    expect(
      cervicalTileAvailability(tile("degenerative", "dg-foraminal-mild"), rotated, { laterality: "right" }).ok,
    ).toBe(false);
  });

  it("needs both positions before any dynamic tile is available", () => {
    const flexOnly = parseXrayCervicalViews(toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "flexion", true));
    expect(assessDynamic(flexOnly).allowed).toBe(false);
    expect(cervicalTileAvailability(tile("dynamic", "dy-instability"), flexOnly).ok).toBe(false);
    expect(
      cervicalTileAvailability(tile("dynamic", "dy-instability"), flexOnly).missing.join(" "),
    ).toMatch(/extension/i);
    const both = parseXrayCervicalViews(
      toggleCervicalViewInTechnique(
        toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "flexion", true),
        "extension",
        true,
      ),
    );
    expect(assessDynamic(both).allowed).toBe(true);
    expect(cervicalTileAvailability(tile("dynamic", "dy-instability"), both).ok).toBe(true);
  });

  it("blocks C7-T1 tiles until the recorded inferior limit reaches the junction", () => {
    const c7t1Tile = tile("degenerative", "dg-c7t1");
    expect(cervicalTileAvailability(c7t1Tile, ctxSeeded()).ok).toBe(false);
    const stopsAtC6 = parseXrayCervicalViews(
      setCervicalInferiorLevelInTechnique(NEUTRAL_LATERAL, "C6"),
    );
    expect(cervicalTileAvailability(c7t1Tile, stopsAtC6).ok).toBe(false);
    expect(cervicalTileAvailability(c7t1Tile, stopsAtC6).missing.join(" ")).toMatch(/C7-T1/i);
    expect(cervicalTileAvailability(c7t1Tile, ctxFull()).ok).toBe(true);
  });

  it("applies a tile only once its views are recorded, through the existing store", () => {
    resetWorkspace(NEUTRAL_LATERAL);
    const odontoidTile = tile("trauma", "tr-odontoid-fracture");
    expect(cervicalTileAvailability(odontoidTile, ctxNeutral()).ok).toBe(false);
    useWorkspace
      .getState()
      .applyMacroBundle(buildCervicalTilePatch(odontoidTile, "Cervical Spine", { level: "C2" }));
    // The canvas refuses a gated tile; the store is not the gate, so assert the
    // gate itself rather than pretending the write was blocked.
    expect(cervicalTileAvailability(odontoidTile, ctxFull()).ok).toBe(true);
  });
});

describe("normal baseline and normal→abnormal reconciliation (spec §5)", () => {
  it("certifies the odontoid only on an adequately visualized odontoid view", () => {
    const full = buildCervicalNormalAtoms({ ctx: ctxFull() });
    const text = full.observations.map((o) => o.findingsText).join(" ");
    expect(text).toContain(CERVICAL_NORMAL_SENTENCES.odontoidConfirmed);

    const qualified = buildCervicalNormalAtoms({ ctx: ctxSeeded() });
    const qText = qualified.observations.map((o) => o.findingsText).join(" ");
    expect(qText).toContain("when adequately visualized");
    expect(qText).not.toMatch(/alignment are unremarkable\./);
  });

  it("does not certify C7-T1 disc height on a film that stops at C6", () => {
    const stopsAtC6 = parseXrayCervicalViews(
      setCervicalInferiorLevelInTechnique(NEUTRAL_LATERAL, "C6"),
    );
    const text = buildCervicalNormalAtoms({ ctx: stopsAtC6 })
      .observations.map((o) => o.findingsText)
      .join(" ");
    expect(text).toContain("C7-T1 is not adequately visualized");
    expect(text).not.toContain(CERVICAL_NORMAL_SENTENCES.discsAll);
  });

  it("says alignment cannot be assessed when no lateral view was recorded", () => {
    const apOnly = parseXrayCervicalViews("AP cervical radiograph.");
    const text = buildCervicalNormalAtoms({ ctx: apOnly })
      .observations.map((o) => o.findingsText)
      .join(" ");
    expect(text).toMatch(/no lateral view is recorded/i);
  });

  it("writes the normal set as baseline-role observations", () => {
    const built = buildCervicalNormalAtoms({ ctx: ctxFull() });
    expect(built.observations.length).toBeGreaterThan(5);
    expect(built.observations.every((o) => o.role === "baseline")).toBe(true);
    expect(built.observations.every((o) => o.source === CERVICAL_ATOM_SOURCE)).toBe(true);
    // A baseline concept must never be impression-worthy, or the normal study
    // would suppress its own system normal impression.
    for (const o of built.observations) {
      expect(isImpressionworthyAbnormal(o.concept ?? ""), o.concept ?? "").toBe(false);
    }
  });

  it("replaces the normal disc line when a level is called narrowed", () => {
    resetWorkspace();
    applyPreset("normal-cervical");
    expect(findings()).toContain(CERVICAL_NORMAL_SENTENCES.discsAll);
    applyTile("degenerative", "dg-disc-moderate", { level: "C5-C6" });
    expect(findings()).not.toContain(CERVICAL_NORMAL_SENTENCES.discsAll);
    expect(findings()).toMatch(/Moderate disc-space reduction at C5-C6/i);
  });

  it("replaces the no-fracture line when a fracture is recorded", () => {
    resetWorkspace();
    applyPreset("normal-cervical");
    applyTile("trauma", "tr-compression-fracture", { level: "C4" });
    expect(findings()).not.toContain(CERVICAL_NORMAL_SENTENCES.noFracture);
    expect(findings()).toMatch(/Compression fracture of C4/i);
  });

  it("retires the no-instrumentation line when hardware is recorded", () => {
    resetWorkspace();
    applyPreset("normal-cervical");
    expect(findings()).toContain(CERVICAL_NORMAL_SENTENCES.noHardware);
    applyTile("postoperative", "po-acdf", { level: "C5-C6" });
    expect(findings()).not.toContain(CERVICAL_NORMAL_SENTENCES.noHardware);
    expect(findings()).toMatch(/Anterior cervical discectomy and fusion at C5-C6/i);
  });
});

describe("descriptive language is never a diagnosis (spec §6, §10, §11, §12)", () => {
  const forbidden: Array<{ re: RegExp; why: string }> = [
    { re: /muscle spasm/i, why: "straightening is not automatically spasm (spec §6)" },
    { re: /\bmetasta/i, why: "an indeterminate lesion is never called metastasis (spec §11)" },
    { re: /multiple myeloma|lymphoma/i, why: "aetiology stays with the radiologist (spec §11)" },
    { re: /tuberculosis|Pott/i, why: "an infection label is not generated from a pattern (spec §11)" },
    { re: /ankylos/i, why: "a spondyloarthropathy label is not generated (spec §11)" },
    { re: /\bDISH\b|diffuse idiopathic/i, why: "flowing osteophytes stay descriptive (spec §11)" },
    { re: /rheumatoid/i, why: "an atlanto-axial measurement is not called RA (spec §8)" },
    { re: /down syndrome/i, why: "instability is not attributed to a syndrome (spec §8)" },
    { re: /pathologic fracture/i, why: "collapse is not called pathologic on plain films (spec §11)" },
    { re: /osteomyelit/i, why: "infection is not diagnosed from one sign (spec §11)" },
    { re: /cord (signal|compression|oedema|edema)/i, why: "MRI cord conclusion (spec §1)" },
    { re: /canal stenosis|canal diameter/i, why: "MRI canal conclusion (spec §1)" },
    { re: /pfirrmann|modic|desiccat|T2 weigh/i, why: "MRI-only grading (spec §1)" },
    { re: /traversing root|exiting root|nerve root compression/i, why: "MRI root attribution (spec §1)" },
    { re: /ligamentum flavum|posterior longitudinal ligament ossification/i, why: "MRI-only ligament conclusion" },
    { re: /myelopathy/i, why: "cord dysfunction is not a plain-film conclusion (spec §1)" },
  ];

  it("keeps the whole catalog free of imported MRI conclusions and invented aetiologies", () => {
    const offences: string[] = [];
    for (const { sm, t } of allTiles()) {
      const text = renderedTileText(t);
      for (const { re, why } of forbidden) {
        if (re.test(text)) offences.push(`${sm.id}/${t.id}: ${why} — ${text.slice(0, 120)}`);
      }
    }
    for (const preset of XRAY_CERVICAL_PRESETS) {
      const text = preset
        .build({ region: "Cervical Spine", ctx: ctxFull(), level: "C5-C6", laterality: "right" })
        .observations.map((o) => `${o.findingsText} ${o.incoming.impression ?? ""}`)
        .join(" ");
      for (const { re, why } of forbidden) {
        if (re.test(text)) offences.push(`preset/${preset.id}: ${why}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("names the OPLL tile by what the film shows, not by cord effect", () => {
    const text = renderedTileText(tile("advanced", "ad-opll"));
    expect(text).toMatch(/Ossification along the posterior aspect/);
    expect(text).toMatch(/MRI for cord assessment when clinically indicated/);
  });

  it("keeps uncovertebral joints as a cervical-specific section (spec §4)", () => {
    const uncovertebral = allTiles().filter(
      ({ t }) => t.atoms.some((a) => a.concept === "uncovertebral_arthropathy"),
    );
    expect(uncovertebral.length).toBeGreaterThan(0);
    for (const { t } of uncovertebral) {
      expect(t.atoms.some((a) => a.anatomicalSection === "uncovertebral joints")).toBe(true);
    }
  });

  it("never calls equivocal lucency loosening, and only calls it that when convinced", () => {
    const equivocal = renderedTileText(tile("postoperative", "po-lucency-equivocal"));
    expect(equivocal).toMatch(/does not indicate loosening/);
    const convincing = renderedTileText(tile("postoperative", "po-lucency-convincing"));
    expect(convincing).toMatch(/concerning for loosening/);
    expect(cervicalHardwareContradiction(equivocal)).toBeNull();
  });

  it("requires the radiologist to select instability", () => {
    const ctx = parseXrayCervicalViews(
      toggleCervicalViewInTechnique(
        toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "flexion", true),
        "extension",
        true,
      ),
    );
    const without = buildCervicalDynamicAtoms({
      region: "Cervical Spine",
      ctx,
      entries: [{ level: "C5-C6", flexionTranslationMm: 4, extensionTranslationMm: 1 }],
    });
    const text = without.observations.map((o) => o.findingsText).join(" ");
    expect(text).toMatch(/inter-position change 3 mm/i);
    expect(text).not.toMatch(/instab/i);
    expect(without.observations[0]?.incoming.impression).toBeUndefined();

    const withChoice = buildCervicalDynamicAtoms({
      region: "Cervical Spine",
      ctx,
      entries: [
        { level: "C5-C6", flexionTranslationMm: 4, extensionTranslationMm: 1, interpretation: "instability" },
      ],
    });
    expect(withChoice.observations.map((o) => o.findingsText).join(" ")).toMatch(/instability/i);
  });

  it("applies no threshold that converts a measurement into a diagnosis", () => {
    // The prevertebral reference is quoted only for the two levels the seeded
    // knowledge pack publishes, and never as a verdict.
    expect(prevertebralReferenceUpperMm("C2")).toBe(7);
    expect(prevertebralReferenceUpperMm("C6")).toBe(22);
    expect(prevertebralReferenceUpperMm("C4")).toBeNull();
    expect(prevertebralReferenceUpperMm("C2", 8)).toBeNull();
    const atoms = buildCervicalMeasureAtoms(
      {
        region: "Cervical Spine",
        ageYears: 40,
        measurements: [{ kind: "prevertebral_soft_tissue", mm: 14, level: "C2", view: "lateral", source: "viewer-caliper" }],
      },
      ctxFull(),
    ).observations;
    const text = atoms.map((a) => a.findingsText).join(" ");
    expect(text).toMatch(/measures 14 mm at C2/);
    expect(text).toMatch(/published upper limit at C2 is 7 mm/);
    expect(text).not.toMatch(/swelling|haematoma|hematoma|injury|abnormal/i);
    expect(atoms[0]?.incoming.impression).toBeUndefined();
  });
});

describe("pattern coverage (spec §3, §4, §7, §9, §12)", () => {
  it("covers the shared cervical core of spec §4", () => {
    const concepts = new Set(allTiles().flatMap(({ t }) => t.atoms.map((a) => a.concept)));
    for (const needed of [
      "cervical_alignment",
      "cervical_alignment_lines",
      "vertebral_body_height",
      "cervical_disc_space",
      "posterior_elements",
      "facet_joint_normal",
      "uncovertebral_joints",
      "neural_foramina",
      "odontoid_integrity",
      "prevertebral_soft_tissue",
      "cervical_no_hardware",
    ]) {
      expect(concepts.has(needed), needed).toBe(true);
    }
  });

  it("supports all four alignment lines and every lordosis state (spec §6)", () => {
    const text = ["al-line-anterior", "al-line-posterior", "al-line-spinolaminar", "al-line-posterior-spinous"]
      .map((id) => renderedTileText(tile("alignment", id)))
      .join(" ");
    for (const line of ["anterior vertebral", "posterior vertebral", "spinolaminar", "posterior spinous"]) {
      expect(text).toContain(line);
    }
    const states = ["al-lordosis-preserved", "al-lordosis-straight", "al-lordosis-reversed"].map(
      (id) => tile("alignment", id).atoms[0]?.state,
    );
    expect(states).toEqual(["preserved", "straightened", "reversed"]);
  });

  it("names every disc segment from C2-C3 to C7-T1 (spec §4)", () => {
    expect(CERVICAL_DISC_LEVELS[CERVICAL_DISC_LEVELS.length - 1]).toBe("C7-T1");
    const ctx = parseXrayCervicalViews(
      setCervicalInferiorLevelInTechnique(
        setCervicalAdequacyInTechnique(NEUTRAL_LATERAL, "c7t1Visualization", "adequate"),
        "T1",
      ),
    );
    expect(cervicalTileAvailability(tile("degenerative", "dg-c7t1"), ctx).ok).toBe(true);
  });

  it("carries a level into every per-level degenerative tile slot", () => {
    const patch = buildCervicalTilePatch(tile("degenerative", "dg-disc-moderate"), "Cervical Spine", {
      level: "c6-7",
    }).observations[0];
    expect(patch?.level).toBe("C6-C7");
    expect(patch?.ownership.level).toBe("C6-C7");
  });

  it("supports the trauma patterns of library §10", () => {
    const concepts = new Set(
      cervicalSubMasterById("trauma")?.tiles.flatMap((t) => t.atoms.map((a) => a.concept)) ?? [],
    );
    for (const needed of [
      "compression_fracture",
      "burst_fracture",
      "cervical_cortical_disruption",
      "posterior_element_fracture",
      "cervical_facet_dislocation",
      "odontoid_fracture",
      "c1_fracture",
      "c1_lateral_mass_asymmetry",
      "atlanto_axial_instability",
      "prevertebral_swelling",
      "spondylolisthesis",
      "cervical_alignment_line_disruption",
      "cervical_series_inadequate",
    ]) {
      expect(concepts.has(needed), needed).toBe(true);
    }
  });

  it("keeps the seeded recommendation wording available to the trauma palette", () => {
    const text = renderedTileText(tile("trauma", "tr-precautions"));
    expect(text).toContain(
      "Spinal precautions should be maintained until clinically and radiologically cleared.",
    );
  });
});

describe("measurements and provenance (spec §8, §13)", () => {
  it("refuses a measurement whose view was not recorded", () => {
    const m = { kind: "atlanto_dental_interval", mm: 4, level: "C1-C2", view: "odontoid", source: "viewer-caliper" } as const;
    expect(cervicalMeasurementBlockers(m, ctxNeutral()).join(" ")).toMatch(/not recorded as performed/i);
    expect(cervicalMeasurementBlockers(m, ctxFull())).toEqual([]);
  });

  it("refuses an ADI from an inadequately visualized odontoid", () => {
    const limited = parseXrayCervicalViews(
      setCervicalAdequacyInTechnique(
        toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "odontoid", true),
        "odontoidVisualization",
        "limited",
      ),
    );
    expect(assessOdontoid(limited).allowed).toBe(false);
    const built = buildCervicalMeasureAtoms(
      {
        measurements: [
          { kind: "atlanto_dental_interval", mm: 4, level: "C1-C2", view: "odontoid", source: "viewer-caliper" },
        ],
      },
      limited,
    );
    expect(built.observations).toEqual([]);
    expect(built.rejected[0]?.reasons.join(" ")).toMatch(/inadequately visuali[sz]ed/i);
  });

  it("never estimates a value the radiologist did not enter", () => {
    const built = buildCervicalMeasureAtoms(
      { measurements: [{ kind: "segmental_angulation", degrees: null, level: "C5-C6", view: "lateral", source: "viewer-caliper" }] },
      ctxFull(),
    );
    expect(built.observations).toEqual([]);
    expect(built.rejected[0]?.reasons.join(" ")).toMatch(/Enter a measured value/i);
  });

  it("round-trips measurement provenance through the ledger field", () => {
    const m = {
      kind: "listhesis_translation",
      slipPercent: 18,
      level: "C5-C6",
      view: "lateral",
      source: "derived",
      derivedFrom: "body and slip widths",
    } as const;
    const raw = formatCervicalMeasurement(m);
    const parsed = parseCervicalMeasurement(raw);
    expect(parsed?.level).toBe("C5-C6");
    expect(parsed?.view).toBe("lateral");
    expect(parsed?.source).toBe("derived");
    expect(parsed?.derivedFrom).toBe("body and slip widths");
    expect(parsed?.value).toBe("18%");
  });

  it("derives a Meyerding grade only from a valid percentage", () => {
    expect(meyerdingFromSlipPercent(10)).toBe("I");
    expect(meyerdingFromSlipPercent(24.9)).toBe("I");
    expect(meyerdingFromSlipPercent(25)).toBe("II");
    expect(meyerdingFromSlipPercent(60)).toBe("III");
    expect(meyerdingFromSlipPercent(90)).toBe("IV");
    expect(meyerdingFromSlipPercent(0)).toBeNull();
    expect(meyerdingFromSlipPercent(null)).toBeNull();
    expect(meyerdingFromSlipPercent(Number.NaN)).toBeNull();
    expect(meyerdingFromSlipPercent(140)).toBeNull();
  });

  it("labels a derived grade as derived in the sentence", () => {
    const built = buildCervicalMeasureAtoms(
      { measurements: [{ kind: "listhesis_translation", slipPercent: 18, level: "C5-C6", view: "lateral", source: "viewer-caliper" }] },
      ctxFull(),
    );
    const o = built.observations[0];
    expect(o?.findingsText).toMatch(/Meyerding grade I derived from the measured slip/);
    expect(o?.state).toBe("meyerding I (derived)");
    expect(o?.incoming.impression).toBeUndefined();
  });

  it("requires a Cobb angle to name its end vertebrae in order", () => {
    const bad = { kind: "cobb_angle", degrees: 14, level: "C2-C7", view: "ap", source: "viewer-caliper", upperLevel: "C7", lowerLevel: "C2" } as const;
    expect(cervicalMeasurementBlockers(bad, ctxFull()).join(" ")).toMatch(/upward-to-downward/i);
    const good = { ...bad, upperLevel: "C2", lowerLevel: "C7" };
    expect(cervicalMeasurementBlockers(good, ctxFull())).toEqual([]);
  });
});

describe("dynamic flexion / extension (spec §10)", () => {
  const bothCtx = () =>
    parseXrayCervicalViews(
      setCervicalInferiorLevelInTechnique(
        toggleCervicalViewInTechnique(
          toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "flexion", true),
          "extension",
          true,
        ),
        "T1",
      ),
    );

  it("derives the inter-position change from the recorded values", () => {
    const e = { level: "C5-C6", flexionTranslationMm: 4, extensionTranslationMm: 1, flexionAngulationDeg: 12, extensionAngulationDeg: 2 };
    expect(derivedTranslationChangeMm(e)).toBe(3);
    expect(derivedAngulationChangeDeg(e)).toBe(10);
    expect(derivedTranslationChangeMm({ level: "C5-C6", flexionTranslationMm: 4 })).toBeNull();
  });

  it("writes nothing when the dynamic views were not performed", () => {
    const built = buildCervicalDynamicAtoms({
      ctx: ctxNeutral(),
      entries: [{ level: "C5-C6", flexionTranslationMm: 4, extensionTranslationMm: 1, interpretation: "instability" }],
    });
    expect(built.observations).toEqual([]);
    expect(built.blockedReason).toMatch(/flexion|extension/i);
  });

  it("requires both positions' values at one level", () => {
    const built = buildCervicalDynamicAtoms({
      ctx: bothCtx(),
      entries: [{ level: "C5-C6", flexionTranslationMm: 4 }],
    });
    expect(built.observations).toEqual([]);
    expect(built.rejected[0]?.reasons.join(" ")).toMatch(/record both the flexion and the extension value/i);
  });

  it("names the level and both positions in the sentence, and stores provenance", () => {
    const built = buildCervicalDynamicAtoms({
      ctx: bothCtx(),
      entries: [{ level: "c5-6", flexionTranslationMm: 4, extensionTranslationMm: 1 }],
    });
    const o = built.observations[0];
    expect(o?.level).toBe("C5-C6");
    expect(o?.findingsText).toMatch(/At C5-C6, anterior translation measures 4 mm in flexion and 1 mm in extension/);
    expect(o?.measurement).toMatch(/change 3 mm \(derived\)/);
    expect(o?.measurement).toMatch(/view flexion \+ extension/);
  });

  it("refuses a single vertebra as a motion segment", () => {
    const built = buildCervicalDynamicAtoms({
      ctx: bothCtx(),
      entries: [{ level: "C5", flexionTranslationMm: 4, extensionTranslationMm: 1 }],
    });
    expect(built.rejected[0]?.reasons.join(" ")).toMatch(/not a motion segment/i);
  });
});

describe("post-operative hardware (spec §12)", () => {
  it("composes the construct sentence from the selected components and levels", () => {
    const text = composeCervicalHardwareSentence({
      procedure: "acdf",
      levels: ["c5-6", "C6/7"],
      components: ["plate", "screws"],
      continuity: "intact",
      position: "unchanged",
      lucency: "equivocal",
    });
    expect(text).toMatch(/anterior cervical discectomy and fusion at C5-C6 and C6-C7/);
    expect(text).toMatch(/Plate and screws visualized at C5-C6 and C6-C7\./);
    expect(text).toMatch(/Equivocal perihardware lucency, which alone does not indicate loosening\./);
  });

  it("reports a non-cervical level instead of guessing it", () => {
    const built = buildCervicalHardwareAtoms(
      { procedure: "acdf", levels: ["L4-L5", "C5-C6"] },
      ctxFull(),
    );
    expect(built.warnings.join(" ")).toMatch(/L4-L5.*not a cervical level/i);
    expect(built.observations[0]?.findingsText).toContain("C5-C6");
  });

  it("flags intact-plus-broken as the §15 hardware contradiction", () => {
    const text =
      "Hardware is continuous and in position without perihardware lucency. Hardware breakage is demonstrated at C5-C6.";
    expect(cervicalHardwareContradiction(text)).toMatch(/both intact and broken/i);
    expect(
      cervicalTextContradictions({
        findingsText: text,
        impressionText: "",
        techniqueText: FULL_SERIES,
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/hardware/i)]));
  });

  it("does not certify continuity without a lateral view", () => {
    const built = buildCervicalHardwareAtoms(
      { procedure: "acdf", levels: ["C5-C6"], continuity: "intact", lucency: "absent" },
      parseXrayCervicalViews("AP cervical radiograph."),
    );
    expect(built.warnings.join(" ")).toMatch(/No lateral cervical view is recorded/i);
  });

  it("records adjacent-segment degeneration as its own observation", () => {
    const built = buildCervicalHardwareAtoms(
      { procedure: "acdf", levels: ["C5-C6"], adjacentSegmentDegeneration: true, adjacentSegmentLevels: ["C4-C5"] },
      ctxFull(),
    );
    const asd = built.observations.find((o) => o.concept === "adjacent_segment_degeneration");
    expect(asd?.findingsText).toMatch(/Adjacent-segment degeneration at C4-C5/);
  });
});

describe("validation (spec §15)", () => {
  const warn = (findingsText: string, technique = FULL_SERIES, impressionText = "") =>
    cervicalTextContradictions({ findingsText, impressionText, techniqueText: technique });

  it("detects normal alignment together with a listhesis", () => {
    expect(
      warn("Cervical alignment and lordosis are maintained. Anterolisthesis of C5 over C6 at the C5-C6 level."),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/listhesis/i)]));
  });

  it("detects the same disc called preserved and narrowed", () => {
    const warnings = warn("Disc height preserved at C5-C6. Moderate disc-space reduction at C5-C6.");
    expect(warnings.join(" ")).toMatch(/C5-C6 disc is described as both preserved and narrowed/);
  });

  it("does not complain when different discs are preserved and narrowed", () => {
    expect(
      warn("Disc height preserved at C7-T1. Moderate disc-space reduction at C5-C6."),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/both preserved and narrowed/)]));
  });

  it("detects no-fracture together with a fracture", () => {
    expect(warn("No acute fracture or listhesis is identified. Odontoid fracture is present.")).toEqual(
      expect.arrayContaining([expect.stringMatching(/No fracture/i)]),
    );
  });

  it("detects normal prevertebral tissues together with swelling", () => {
    expect(
      warn("Prevertebral soft tissues are not widened. Prevertebral soft-tissue swelling at C6."),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/prevertebral/i)]));
  });

  it("detects a normal-study statement beside a significant abnormality", () => {
    expect(
      warn("No acute osseous abnormality identified. There is a C4 fracture with 50% height loss."),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/normal-study statement/i)]));
  });

  it("flags a foraminal claim that has no oblique view", () => {
    const warnings = warn(
      "Right neural foraminal narrowing at C5-C6 on the right oblique view.",
      NEUTRAL_LATERAL,
    );
    expect(warnings.join(" ")).toMatch(/foraminal/i);
    expect(warnings.join(" ")).toMatch(/right oblique/i);
    const okCtx = toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "obliqueRight", true);
    expect(warn("Right neural foraminal narrowing at C5-C6 on the right oblique view.", okCtx)).toEqual([]);
  });

  it("does not flag a denial of foraminal narrowing", () => {
    expect(warn("No neural foraminal narrowing on the available views.", NEUTRAL_LATERAL)).toEqual([]);
  });

  it("flags an odontoid certification without a diagnostic odontoid view", () => {
    const warnings = warn("The odontoid is intact and C1-C2 alignment is normal.", NEUTRAL_LATERAL);
    expect(warnings.join(" ")).toMatch(/odontoid/i);
    expect(
      warn("The odontoid and C1-C2 are unremarkable when adequately visualized on the views obtained.", NEUTRAL_LATERAL),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/odontoid/i)]));
  });

  it("flags a dynamic claim on neutral films only", () => {
    expect(warn("There is dynamic instability at C5-C6.", NEUTRAL_LATERAL)).toEqual(
      expect.arrayContaining([expect.stringMatching(/dynamic/i)]),
    );
    expect(warn("No dynamic instability is demonstrated.", NEUTRAL_LATERAL)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/dynamic/i)]),
    );
  });

  it("flags C7-T1 statements the recorded film cannot support", () => {
    const stopsAtC6 = setCervicalInferiorLevelInTechnique(NEUTRAL_LATERAL, "C6");
    expect(warn("Disc-space narrowing at C7-T1.", stopsAtC6)).toEqual(
      expect.arrayContaining([expect.stringMatching(/C7-T1/i)]),
    );
    expect(warn("C7-T1 is not adequately visualized.", stopsAtC6)).toEqual([]);
  });

  it("detects level and numbering inconsistencies", () => {
    const warnings = warn("Anterolisthesis of C5 over C7 at the C5-C6 level.");
    expect(warnings.join(" ")).toMatch(/not adjacent/i);
    expect(cervicalLevelConsistencyIssues("Disc space narrowing at C8.")).toHaveLength(1);
  });

  it("surfaces unfilled catalog tokens before the report can print them", () => {
    expect(warn("Moderate disc-space reduction at [level].")).toEqual(
      expect.arrayContaining([expect.stringMatching(/\[level\]/)]),
    );
    expect(unfilledCervicalTokens("Disruption of the [line] alignment line.")).toEqual(["[line]"]);
  });

  it("warns when the technique field records nothing at all", () => {
    expect(warn("The odontoid is intact.", "")).toEqual(
      expect.arrayContaining([expect.stringMatching(/no views are recorded|odontoid/i)]),
    );
  });

  it("accepts a correctly reported cervical film", () => {
    expect(
      warn(
        "Cervical alignment and lordosis are maintained. Vertebral body heights are preserved. " +
          "Disc spaces are preserved from C2-C3 to C7-T1. Visualized posterior elements are intact. " +
          "Prevertebral soft tissues are not widened. Odontoid and C1-C2 alignment are unremarkable.",
        FULL_SERIES,
        "No acute osseous abnormality identified on the provided cervical spine radiographs.",
      ),
    ).toEqual([]);
  });
});

describe("impression, staleness and manual protection (spec §14)", () => {
  beforeEach(() => resetWorkspace());

  it("composes the impression from accepted ledger observations", () => {
    applyPreset("normal-cervical");
    applyTile("trauma", "tr-prevertebral-swelling", { level: "C6" });
    expect(impression()).toMatch(/Prevertebral soft-tissue swelling at C6/i);
  });

  it("keeps acute injury ahead of degeneration in the authored priorities", () => {
    const fracture = /fracture|dislocation|odontoid|atlanto|prevertebral (swelling|gas)|injury/i;
    const degenerative = /spondyl|foraminal|disc[- ]space|degenerative/i;
    expect(fracture.test("Unstable cervical fracture at C5.")).toBe(true);
    expect(degenerative.test("Multilevel cervical spondylotic changes.")).toBe(true);
    // Critical presets are authored first inside every palette.
    const trauma = XRAY_CERVICAL_PRESETS.filter((p) => p.subMasterId === "trauma");
    expect(trauma.findIndex((p) => p.criticalPattern)).toBeLessThan(
      trauma.findIndex((p) => !p.criticalPattern),
    );
  });

  it("marks the impression stale when linked findings are hand-edited, without overwriting", () => {
    applyTile("degenerative", "dg-disc-moderate", { level: "C5-C6" });
    const before = impression();
    useWorkspace.getState().setField(
      "findings",
      `${findings()}\nAdditional dictated sentence about the craniocervical junction.`,
      { source: "manual", replaceProvenance: false },
    );
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(impression()).toBe(before);
    useWorkspace.getState().refreshImpressionFromLedger();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(impression()).toContain(before.trim());
  });

  it("protects ledger contributions against a wholesale manual rewrite", () => {
    applyTile("alignment", "al-lordosis-straight");
    useWorkspace.getState().setField("findings", "Only the radiologist's own dictated findings.", "manual");
    expect(useWorkspace.getState().appliedPathologyPatches.every((p) => p.protected)).toBe(true);
    expect(findings()).toBe("Only the radiologist's own dictated findings.");
  });

  it("keeps dictated text when a bundle is removed", () => {
    const built = buildCervicalTilePatch(tile("degenerative", "dg-facet"), "Cervical Spine", { level: "C5-C6" });
    useWorkspace.getState().applyMacroBundle(built);
    const dictated = "Dictated after review of the prior study.";
    useWorkspace.getState().setField("findings", `${findings()}\n${dictated}`, "manual");
    const outcome = useWorkspace.getState().removeMacroBundle(built.bundleId);
    expect(["preserved-manual", "removed", "no-op-unproven"]).toContain(outcome);
    expect(findings()).toContain(dictated);
  });

  it("undoes a whole tile in one step", () => {
    applyPreset("normal-cervical");
    const afterNormal = findings();
    applyTile("infection", "in-disc-endplate", { level: "C5-C6" });
    expect(findings()).not.toBe(afterNormal);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(findings()).toBe(afterNormal);
  });

  it("writes every observation through the structured-template source", () => {
    applyPreset("multilevel-spondylosis");
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);
    for (const p of useWorkspace.getState().appliedPathologyPatches) {
      expect(p.observation?.source).toBe(CERVICAL_ATOM_SOURCE);
    }
  });
});

describe("impression ordering and unvisualized levels (spec §14)", () => {
  it("flags a degenerative impression listed above an acute injury", () => {
    expect(
      cervicalImpressionOrderWarnings([
        "Multilevel cervical spondylotic changes, most pronounced at C5-C6.",
        "Anterolisthesis of C5 over C6 with malalignment.",
      ]),
    ).toEqual([expect.stringMatching(/listed after a lower-priority finding/)]);
  });

  it("accepts an impression ordered acute-first", () => {
    expect(
      cervicalImpressionOrderWarnings([
        "Odontoid fracture — unstable craniocervical injury.",
        "Dynamic instability at C5-C6.",
        "Multilevel cervical spondylotic changes.",
        "Post-operative cervical hardware as described.",
      ]),
    ).toEqual([]);
  });

  it("says nothing about a single-line impression", () => {
    expect(cervicalImpressionOrderWarnings(["No acute osseous abnormality."])).toEqual([]);
    expect(cervicalImpressionOrderWarnings([])).toEqual([]);
  });

  it("flags levels the recorded inferior limit cannot show", () => {
    const stopsAtC6 = parseXrayCervicalViews(
      setCervicalInferiorLevelInTechnique(NEUTRAL_LATERAL, "C6"),
    );
    expect(
      cervicalUnvisualizedLevelClaims("Disc-space narrowing at C7-T1.", stopsAtC6).join(" "),
    ).toMatch(/C7-T1.*inferior visualization limit is C6/);
    expect(
      cervicalUnvisualizedLevelClaims("Disc-space narrowing at C7-T1.", ctxFull()),
    ).toEqual([]);
  });
});

describe("critical results (spec §16)", () => {
  const criticalTiles: Array<{ palette: CervicalSubMasterId; tile: string; level?: string }> = [
    { palette: "trauma", tile: "tr-fracture-dislocation", level: "C5-C6" },
    { palette: "trauma", tile: "tr-odontoid-fracture", level: "C2" },
    { palette: "trauma", tile: "tr-adi-widening", level: "C1-C2" },
    { palette: "trauma", tile: "tr-prevertebral-swelling", level: "C6" },
    { palette: "trauma", tile: "tr-burst-fracture", level: "C5" },
    { palette: "alignment", tile: "al-anterolisthesis", level: "C5-C6" },
    { palette: "dynamic", tile: "dy-instability", level: "C5-C6" },
    { palette: "postoperative", tile: "po-breakage", level: "C5-C6" },
    { palette: "postoperative", tile: "po-migration", level: "C5-C6" },
    { palette: "postoperative", tile: "po-lucency-convincing", level: "C5-C6" },
    { palette: "advanced", tile: "ad-prevertebral-gas" },
  ];

  for (const { palette, tile: tileId, level } of criticalTiles) {
    it(`raises a critical for ${palette}/${tileId}`, () => {
      resetWorkspace(FULL_SERIES);
      applyTile(palette, tileId, { level: level ?? "C5-C6" });
      expect(detectCriticalFindings(findings(), [impression()]).length).toBeGreaterThan(0);
    });
  }

  it("does not raise a critical on a normal cervical film", () => {
    resetWorkspace(FULL_SERIES);
    applyPreset("normal-cervical");
    expect(detectCriticalFindings(findings(), [impression()])).toEqual([]);
  });

  it("never documents communication on its own", () => {
    resetWorkspace(FULL_SERIES);
    applyTile("trauma", "tr-fracture-dislocation", { level: "C5-C6" });
    expect(detectCriticalFindings(findings(), [impression()]).length).toBeGreaterThan(0);
    expect(useWorkspace.getState().criticalFindings).toEqual([]);
  });

  it("marks the tiles that map onto the seeded critical-pattern library", () => {
    const critical = cervicalCriticalTileIds();
    for (const id of [
      "trauma/tr-fracture-dislocation",
      "trauma/tr-odontoid-fracture",
      "trauma/tr-prevertebral-swelling",
      "dynamic/dy-instability",
      "postoperative/po-breakage",
    ]) {
      expect(critical).toContain(id);
    }
  });
});

describe("AI stays proposal-only (spec §16)", () => {
  it("AI prose creates no ledger observation and cannot finalize", () => {
    resetWorkspace();
    const before = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().setField("findings", "Possible C5-C6 anterolisthesis.", { source: "ai-draft" });
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBe(before);
    expect(useWorkspace.getState().isFinalized).toBe(false);
  });

  it("AI text does not overwrite a radiologist's manual impression", () => {
    resetWorkspace();
    useWorkspace.getState().setField("impression", "Clinical impression typed by the radiologist.", "manual");
    useWorkspace.getState().setFieldIfEmpty("impression", "AI suggestion", "ai-draft");
    expect(impression()).toBe("Clinical impression typed by the radiologist.");
  });

  it("never finalizes a suspected fracture or instability without a radiologist action", () => {
    resetWorkspace();
    useWorkspace.getState().setField("findings", "Suspicious lucency through the odontoid.", { source: "ai-draft" });
    expect(useWorkspace.getState().isFinalized).toBe(false);
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
  });
});

describe("study context and billed mapping (spec §18)", () => {
  it("accepts a billed CR cervical study on its tab name", () => {
    expect(
      isXrayCervicalReportingContext({
        modality: "CR",
        region: "X-Ray Cervical Spine",
        family: "spine",
        studyDescription: "X-RAY CERVICAL SPINE AP/LAT",
      }),
    ).toBe(true);
  });

  it("rejects MRI / CT / US cervical studies — the radiography canvas is modality-bound", () => {
    expect(isXrayCervicalReportingContext({ modality: "MR", region: "Cervical Spine", family: "spine" })).toBe(false);
    expect(isXrayCervicalReportingContext({ modality: "CT", region: "Cervical Spine", family: "spine" })).toBe(false);
    expect(isXrayCervicalReportingContext({ modality: "US", region: "Neck", family: "unknown" })).toBe(false);
  });

  it("does not hijack another spine segment or body part", () => {
    expect(isXrayCervicalReportingContext({ modality: "CR", region: "X-Ray Lumbar Spine", family: "spine" })).toBe(false);
    expect(isXrayCervicalReportingContext({ modality: "CR", region: "X-Ray Dorsal Spine", family: "spine" })).toBe(false);
    expect(isXrayCervicalReportingContext({ modality: "CR", region: "X-Ray Knee", family: "unknown" })).toBe(false);
    expect(isXrayCervicalReportingContext({ modality: "CR", region: "X-Ray Cervical Ribs", family: "unknown" })).toBe(true);
  });

  it("accepts a cervical X-ray tab with no modality string", () => {
    expect(isXrayCervicalReportingContext({ region: "X-Ray Cervical Spine" })).toBe(true);
  });

  it("resolves both live billed cervical names onto the seeded tab", () => {
    // CSV catalog: XRAYCERVICAL = "X-RAY CERVICAL SPINE AP/LAT",
    //             XRAYCERVL   = "X-RAY CERVICAL SPINE LAT".
    const tabs = ["X-Ray Cervical Spine", "X-Ray Dorsal Spine", "X-Ray Lumbar Spine", "Spine"];
    expect(matchStudyRegion("X-RAY CERVICAL SPINE AP/LAT", tabs)).toBe("X-Ray Cervical Spine");
    expect(matchStudyRegion("X-RAY CERVICAL SPINE LAT", tabs)).toBe("X-Ray Cervical Spine");
  });

  it("names cervical bundles with their own prefix", () => {
    expect(cervicalBundleId("tile", "dg-c7t1")).toBe("xccb-tile-dg-c7t1");
  });

  it("keeps the template renderer honest about unknown levels", () => {
    expect(applyCervicalTemplate("Narrowing at [level].", { level: "c5-6" })).toBe("Narrowing at C5-C6.");
    expect(applyCervicalTemplate("Narrowing at [level].", { level: "L4-L5" })).toBe("Narrowing at L4-L5.");
    expect(normalizeCervicalLevel("T4")).toBeNull();
  });
});

describe("preset gating", () => {
  it("blocks the odontoid preset until a diagnostic odontoid view exists", () => {
    const preset = cervicalPresetById("odontoid-fracture");
    expect(preset).toBeDefined();
    expect(cervicalPresetAvailability(preset!, ctxNeutral()).ok).toBe(false);
    expect(cervicalPresetAvailability(preset!, ctxFull()).ok).toBe(true);
  });

  it("blocks the dynamic preset on neutral films", () => {
    const preset = cervicalPresetById("dynamic-instability");
    expect(cervicalPresetAvailability(preset!, ctxNeutral()).ok).toBe(false);
    const both = parseXrayCervicalViews(
      toggleCervicalViewInTechnique(
        toggleCervicalViewInTechnique(NEUTRAL_LATERAL, "flexion", true),
        "extension",
        true,
      ),
    );
    expect(cervicalPresetAvailability(preset!, both).ok).toBe(true);
  });

  it("blocks the foraminal preset without the oblique for the chosen side", () => {
    const preset = cervicalPresetById("spondylotic-foraminal-narrowing");
    expect(cervicalPresetAvailability(preset!, ctxFull(), { laterality: "right" }).ok).toBe(false);
    const withObliques = parseXrayCervicalViews(
      toggleCervicalViewInTechnique(
        toggleCervicalViewInTechnique(FULL_SERIES, "obliqueRight", true),
        "obliqueLeft",
        true,
      ),
    );
    expect(cervicalPresetAvailability(preset!, withObliques, { laterality: "bilateral" }).ok).toBe(true);
  });

  it("requires an adequately seen C7-T1 for the full-series normal", () => {
    const preset = cervicalPresetById("normal-cervical-full-series");
    expect(cervicalPresetAvailability(preset!, ctxSeeded()).ok).toBe(false);
    expect(cervicalPresetAvailability(preset!, ctxFull()).ok).toBe(true);
  });

  it("gives every preset a palette and a label", () => {
    for (const p of XRAY_CERVICAL_PRESETS) {
      expect(cervicalSubMasterById(p.subMasterId)).toBeDefined();
      expect(p.label.length).toBeGreaterThan(3);
    }
  });
});
