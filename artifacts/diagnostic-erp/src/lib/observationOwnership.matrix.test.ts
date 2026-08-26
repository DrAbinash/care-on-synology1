/**
 * Ownership matrix for every enriched DEFAULT_QUICK_SELECT_TILE.
 *
 * (a) resolveConcept returns a non-null concept
 * (b) sibling grades mutex
 * (c) different level / laterality coexist
 * (d) deselect removes the contribution
 * (e) baseline restores on normal-slot deselect
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import {
  buildCanonicalObservation,
  hasStructuredOwnership,
  observationsMutuallyExclusive,
  resolveConcept,
} from "./observationSlot";
import { conflictGroupWordsMissingFromText } from "./ownershipFieldValidation";
import { contributionPresent } from "./observationLedger";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";

const ENRICHED = DEFAULT_QUICK_SELECT_TILES.filter((t) => t.conflictGroup);

function overlayTile(
  tile: (typeof DEFAULT_QUICK_SELECT_TILES)[number],
  id: string,
  extra?: { side?: "left" | "right" | ""; region?: string },
) {
  const findings = extra?.side ? tile.sentence.replace(/\{side\}/g, extra.side) : tile.sentence;
  const impression = extra?.side
    ? tile.impressionSentence?.replace(/\{side\}/g, extra.side)
    : tile.impressionSentence;
  return useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings, impression },
    templates: { findings, impression },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: extra?.region ?? tile.scopeBodyPart,
    label: tile.label,
    findingsText: findings,
    side: extra?.side,
    properties: tile.properties,
  });
}

function reset(region: string) {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    impressionNeedsRefresh: false,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
  });
}

describe("ownership matrix — enriched DEFAULT_QUICK_SELECT_TILES", () => {
  beforeEach(() => reset("Brain"));

  it("every enriched tile resolves a concept (R1/R4)", () => {
    const failures: string[] = [];
    for (const tile of ENRICHED) {
      const concept = resolveConcept({
        conflictGroup: tile.conflictGroup,
        anatomicalSection: tile.anatomicalSection,
        findingsText: tile.sentence,
        label: tile.label,
      });
      if (!concept.concept) {
        failures.push(`${tile.label} conflictGroup=${tile.conflictGroup} → null concept`);
        continue;
      }
      const obs = buildCanonicalObservation({
        id: tile.id,
        region: tile.scopeBodyPart,
        conflictGroup: tile.conflictGroup,
        anatomicalSection: tile.anatomicalSection,
        baselineReplaces: tile.baselineReplaces,
        label: tile.label,
        findingsText: tile.sentence,
        properties: tile.properties,
      });
      if (!hasStructuredOwnership(obs)) {
        failures.push(`${tile.label} structured ownership false`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("R1: conflictGroup words appear in tile text (R5 normals exempt)", () => {
    const failures: string[] = [];
    for (const tile of ENRICHED) {
      if (tile.category === "normal" && tile.baselineReplaces) continue;
      const missing = conflictGroupWordsMissingFromText(tile.conflictGroup ?? "", tile.sentence);
      if (missing.length > 0) {
        failures.push(`${tile.label}: missing ${missing.join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("sibling grades mutex on the same slot", () => {
    reset("LS Spine");
    const canal = ENRICHED.filter((t) => t.conflictGroup === "canal stenosis");
    expect(canal.length).toBeGreaterThanOrEqual(2);
    const mild = canal.find((t) => /mild/i.test(t.label))!;
    const severe = canal.find((t) => /severe/i.test(t.label))!;
    overlayTile(mild, "c-mild");
    overlayTile(severe, "c-severe");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("Severe canal stenosis");
    expect(findings).not.toContain("Mild canal stenosis");
    const a = buildCanonicalObservation({
      region: "LS Spine",
      conflictGroup: mild.conflictGroup,
      findingsText: mild.sentence,
      label: mild.label,
    });
    const b = buildCanonicalObservation({
      region: "LS Spine",
      conflictGroup: severe.conflictGroup,
      findingsText: severe.sentence,
      label: severe.label,
    });
    expect(observationsMutuallyExclusive(a, b)).toBe(true);
  });

  it("different laterality coexist", () => {
    const hemorrhage = ENRICHED.find((t) => t.label === "Basal ganglia hemorrhage")!;
    overlayTile(hemorrhage, "h-l", { side: "left" });
    overlayTile(hemorrhage, "h-r", { side: "right" });
    const findings = useWorkspace.getState().findingsText.toLowerCase();
    expect(findings).toMatch(/left/);
    expect(findings).toMatch(/right/);
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(2);
  });

  it("different disc levels coexist", () => {
    reset("LS Spine");
    const l45 = ENRICHED.find((t) => t.label === "Disc herniation L4-L5")!;
    const l34 = ENRICHED.find((t) => t.label === "Disc bulge L3-L4")!;
    overlayTile(l45, "d-l45");
    overlayTile(l34, "d-l34");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toContain("L4-L5");
    expect(findings).toContain("L3-L4");
  });

  it("deselect removes the contribution (sentence ownership)", () => {
    const tile = ENRICHED.find((t) => t.conflictGroup === "fazekas" && t.label === "Fazekas 1")!;
    overlayTile(tile, `qf-${tile.label}`);
    expect(contributionPresent(useWorkspace.getState().findingsText, tile.sentence)).toBe(true);
    const outcome = useWorkspace.getState().removeObservation(`qf-${tile.label}`);
    expect(outcome).toBe("removed");
    expect(contributionPresent(useWorkspace.getState().findingsText, tile.sentence)).toBe(false);
  });

  it("baseline restores on pathology deselect of a normal-slot (R5 ventricles)", () => {
    const hydro = ENRICHED.find((t) => t.label === "Hydrocephalus")!;
    const ventricles = ENRICHED.find((t) => t.label === "Normal ventricles")!;
    overlayTile(ventricles, "qf-vent");
    overlayTile(hydro, "qf-hydro");
    expect(useWorkspace.getState().findingsText).toMatch(/hydrocephalus/i);
    expect(useWorkspace.getState().findingsText).not.toContain(
      "Ventricular system and cisternal spaces are normal in size and configuration",
    );
    const outcome = useWorkspace.getState().removeObservation("qf-hydro");
    expect(outcome).toBe("removed");
    expect(useWorkspace.getState().findingsText).toContain(hydro.baselineReplaces!);
  });

  it("every critical-category tile has conflictGroup (R6)", () => {
    const missing = DEFAULT_QUICK_SELECT_TILES.filter(
      (t) => t.category === "critical" && !t.conflictGroup,
    );
    expect(missing.map((t) => t.label)).toEqual([]);
  });
});
