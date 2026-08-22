import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  formatsMissingOnServer,
  mergeAuthoritativeFormats,
  formatDedupeKey,
} from "./zai-workspace/reportFormatSync";
import {
  DEFAULT_REPORT_FORMATS,
  hydrateFormat,
  lookupFormatsForContext,
  payloadForApi,
} from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { matchStudyRegion } from "./studyRegion";
import {
  resolveChocolateOwnership,
  builtinOwnershipForTileId,
} from "./chocolateMacroOwnership";
import { mergeChocolateTilesWithServer, type ServerChocolateFinding } from "./chocolateMacrosApi";
import { applyPathologyPatch, applySideToIncoming } from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { defaultsForKey, type ChocolateTile } from "./findingsMacros";

const REGIONS = ["Brain", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine", "Spine"];

function ctxFor(description: string) {
  const region = matchStudyRegion(`MR ${description}`, REGIONS);
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: description,
    regions: region ? [region] : [],
    source: region ? "auto" : "unresolved",
  });
}

describe("server whole-report format sync helpers", () => {
  it("save payload retains all 5 clinical sections (no demographics)", () => {
    const p = payloadForApi({
      name: "MRI Brain — Normal",
      modality: "MR",
      bodyPart: "Brain",
      diagnosisTags: ["normal"],
      clinicalHistory: "Headache.",
      technique: "MRI brain 3T.",
      findings: "Basal ganglia are normal.",
      impression: "Normal MRI brain.",
      recommendation: "Clinical correlation.",
      isCommon: true,
    });
    expect(p.clinicalHistory).toBe("Headache.");
    expect(p.technique).toBe("MRI brain 3T.");
    expect(p.findings).toContain("Basal ganglia");
    expect(p.impression).toContain("Normal");
    expect(p.recommendation).toContain("Clinical");
    expect(JSON.stringify(p)).not.toMatch(/accession|patient|letterhead|signature/i);
  });

  it("reload on another simulated session uses server ids as authoritative", () => {
    const sessionA = [
      hydrateFormat({ id: "10", name: "MRI Brain — Normal", modality: "MR", bodyPart: "Brain", findings: "A", impression: "B", technique: "T", recommendation: "R", clinicalHistory: "H" }),
    ];
    const sessionBCache: typeof sessionA = [];
    const merged = mergeAuthoritativeFormats(sessionA, sessionBCache, { offlineFallback: true });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("10");
    expect(mergeAuthoritativeFormats([], sessionA, { offlineFallback: true })[0].id).toBe("10");
    expect(mergeAuthoritativeFormats([], sessionA, { offlineFallback: false })).toEqual([]);
  });

  it("canonical Brain vs Cervical filtering still holds for server-shaped formats", () => {
    const brain = ctxFor("MRI Brain Plain");
    const cervical = ctxFor("MRI Cervical Spine");
    const formats = DEFAULT_REPORT_FORMATS.map((f, i) => hydrateFormat({ ...f, id: String(i + 1) }));
    expect(lookupFormatsForContext(formats, "MR", brain).every((f) => f.bodyPart === "Brain")).toBe(true);
    const cerv = lookupFormatsForContext(formats, "MR", cervical);
    expect(cerv.some((f) => f.bodyPart === "Cervical Spine")).toBe(true);
    expect(cerv.some((f) => f.bodyPart === "Brain")).toBe(false);
  });

  it("migrate localStorage format without duplicate", () => {
    const local = [
      { name: "MRI Brain — Normal", modality: "MR", bodyPart: "Brain" },
      { name: "Custom Fazekas", modality: "MR", bodyPart: "Brain" },
    ];
    const server = [{ name: "MRI Brain — Normal", modality: "MR", bodyPart: "Brain" }];
    const missing = formatsMissingOnServer(local, server);
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe("Custom Fazekas");
    expect(formatDedupeKey(local[0])).toBe(formatDedupeKey(server[0]));
  });
});

describe("explicit chocolate macro ownership", () => {
  it("explicit macro ownership replaces normal block", () => {
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    const tile = defaultsForKey("brain").find((t) => t.id === "brain-basal-ganglia-hemorrhage")!;
    expect(tile.anatomicalSection).toBe("basal ganglia");
    const incoming = applySideToIncoming(
      { findings: tile.text, impression: tile.impressionText },
      "right",
    );
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming,
      ownership: {
        anatomicalSection: tile.anatomicalSection,
        conflictGroup: tile.conflictGroup,
        baselineReplaces: tile.baselineReplaces,
      },
      provenance: { findings: provenanceFromText(brain.findings, "template") },
      source: "macro",
    });
    expect(result.narrative.findings.toLowerCase()).toContain("right basal ganglia");
    expect(result.narrative.findings.toLowerCase()).not.toMatch(/basal ganglia are normal/);
  });

  it("Right → Left relateralization of owned pathology", () => {
    const templates = {
      findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
      impression: "Acute {side} basal ganglia hemorrhage.",
    };
    const right = applySideToIncoming(templates, "right");
    const left = applySideToIncoming(templates, "left");
    expect(right.findings).toContain("right");
    expect(left.findings).toContain("left");
    expect(left.findings).not.toContain("right");
  });

  it("conflicting macro replaces previous owned pathology", () => {
    const afterFirst = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: "Basal ganglia are normal in signal intensity.",
        impression: "Normal MRI brain.",
        recommendation: "",
      },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        findings: provenanceFromText("Basal ganglia are normal in signal intensity.", "template"),
      },
      source: "macro",
    });
    const afterSecond = applyPathologyPatch({
      existing: afterFirst.narrative,
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the left basal ganglia with edema.",
        impression: "Acute left basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: afterFirst.provenance,
      source: "macro",
    });
    expect(afterSecond.narrative.findings.toLowerCase()).toContain("left basal ganglia");
    expect(afterSecond.narrative.findings.match(/hemorrhage/gi)?.length ?? 0).toBe(1);
  });

  it("unrelated macros coexist", () => {
    const afterHem = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: "Brain parenchyma shows normal signal intensity. Basal ganglia are normal.",
        impression: "Normal MRI brain.",
        recommendation: "",
      },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      source: "macro",
    });
    const afterWm = applyPathologyPatch({
      existing: afterHem.narrative,
      incoming: {
        findings: "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade 1.",
      },
      ownership: { anatomicalSection: "white matter", conflictGroup: "fazekas" },
      provenance: afterHem.provenance,
      source: "macro",
    });
    expect(afterWm.narrative.findings.toLowerCase()).toContain("hemorrhage");
    expect(afterWm.narrative.findings.toLowerCase()).toContain("fazekas");
  });

  it("legacy macro still works safely (append-only)", () => {
    const resolved = resolveChocolateOwnership({
      id: "brain-senile",
      label: "Senile Changes",
      legacyAppend: true,
    });
    expect(resolved.mode).toBe("legacy-append");
    expect(builtinOwnershipForTileId("brain-infarct")?.conflictGroup).toBe("infarct");
  });

  it("manual unrelated text remains untouched", () => {
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: "Basal ganglia are normal. Manual note: correlate with EEG.",
        impression: "Normal MRI brain.",
        recommendation: "",
      },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        findings: {
          ...provenanceFromText("Basal ganglia are normal.", "template"),
          ...provenanceFromText("Manual note: correlate with EEG.", "manual"),
        },
      },
      source: "macro",
    });
    expect(result.narrative.findings).toContain("Manual note: correlate with EEG.");
  });

  it("server-side macro survives reload merge", () => {
    const local: ChocolateTile[] = [
      { id: "brain-infarct", label: "Infarct", text: "Local infarct text." },
    ];
    const server: ServerChocolateFinding[] = [
      {
        id: 42,
        modality: "MR",
        bodyPart: "Brain",
        groupName: "brain",
        shortName: "Infarct",
        findingText: "Server infarct text with ownership.",
        impressionText: "Acute infarct.",
        isCritical: false,
        sortOrder: 0,
        clientKey: "brain-infarct",
        anatomicalSection: "mca",
        conflictGroup: "infarct",
        baselineReplaces: "",
        supportsLaterality: true,
        sectionsOwned: "findings,impression",
      },
    ];
    const merged = mergeChocolateTilesWithServer(local, server, "brain");
    const infarct = merged.find((t) => t.id === "brain-infarct")!;
    expect(infarct.text).toContain("Server infarct");
    expect(infarct.serverId).toBe(42);
    expect(infarct.anatomicalSection).toBe("mca");
  });

  it("offline/cache does not create divergent permanent state when server empty and not authoritative", () => {
    const server: never[] = [];
    const localCache = [
      hydrateFormat({ id: "local-1", name: "Temp", modality: "MR", bodyPart: "Brain", findings: "x", impression: "y", technique: "", recommendation: "", clinicalHistory: "" }),
    ];
    // Without offline fallback, empty server → empty (caller must not overwrite cache permanently).
    expect(mergeAuthoritativeFormats(server, localCache, { offlineFallback: false })).toEqual([]);
    // Offline path may keep cache temporarily.
    expect(mergeAuthoritativeFormats(server, localCache, { offlineFallback: true })).toHaveLength(1);
  });
});
