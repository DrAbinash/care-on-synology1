import { describe, expect, it } from "vitest";
import { matchStudyRegion } from "./studyRegion";
import {
  buildReportingStudyContext,
  contentStudyTypes,
  matchesContentScope,
  studyMatchHaystack,
  type ReportingStudyContext,
} from "./reportingStudyContext";
import { chocolateBoxSetFor } from "./findingsMacros";
import {
  pickStructuredTemplateForRegion,
  studyRegionToBodyPart,
} from "./pickStructuredTemplate";
import { suggestCompletion } from "./copilotCompletion";
import { analyzeCopilot, type CopilotContext } from "./copilotOrchestrator";
import { lookupTilesForContext } from "./zai-workspace/quick-select-library";
import { lookupMacrosForContext } from "./zai-workspace/snippet-macros-library";
import { lookupFormatsForContext } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_SNIPPET_MACROS } from "./zai-workspace/snippet-macros-library";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { criticalWatchListFor } from "./radiologyMasterTemplates";
import { pickQuickProtocol } from "./pickQuickProtocol";

const REGIONS = [
  "Brain",
  "Cervical Spine",
  "Dorsal Spine",
  "LS Spine",
  "Whole Spine",
  "Spine",
  "Knee",
];

const TEMPLATES = [
  { id: 1, templateName: "MRI Brain Plain", modality: "MRI", bodyPart: "BRAIN", studyType: "PLAIN" },
  { id: 2, templateName: "MRI LS Spine", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN" },
  { id: 3, templateName: "MRI Cervical Spine", modality: "MRI", bodyPart: "SPINE_CERVICAL", studyType: "PLAIN" },
  { id: 4, templateName: "MRI Dorsal Spine", modality: "MRI", bodyPart: "SPINE_DORSAL", studyType: "PLAIN" },
];

const PROTOCOLS = [
  { id: 1, name: "MRI Brain Routine", studyType: "Brain", techniqueText: "Brain technique", isGoldStandard: false, isDefault: true, sortOrder: 10, isActive: true },
  { id: 2, name: "MRI Cervical Spine", studyType: "Cervical Spine", techniqueText: "Cervical technique", isGoldStandard: false, isDefault: true, sortOrder: 10, isActive: true },
  { id: 3, name: "MRI LS Spine", studyType: "LS Spine", techniqueText: "Lumbar technique", isGoldStandard: false, isDefault: true, sortOrder: 10, isActive: true },
  { id: 4, name: "MRI Dorsal Spine", studyType: "Dorsal Spine", techniqueText: "Dorsal technique", isGoldStandard: false, isDefault: true, sortOrder: 10, isActive: true },
];

function resolve(modality: string, description: string, override?: string[]): ReportingStudyContext {
  const auto = matchStudyRegion(`${modality} ${description}`, REGIONS);
  const regions = override && override.length > 0 ? override : (auto ? [auto] : []);
  return buildReportingStudyContext({
    modality,
    studyDescription: description,
    regions,
    source: override ? "override" : (auto ? "auto" : "unresolved"),
  });
}

function snapshot(ctx: ReportingStudyContext) {
  const macros = chocolateBoxSetFor(ctx);
  const template = pickStructuredTemplateForRegion(TEMPLATES, ctx.modality, ctx.region);
  const protocol = pickQuickProtocol(PROTOCOLS, ctx.region);
  const tiles = lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctx);
  const snippets = lookupMacrosForContext(DEFAULT_SNIPPET_MACROS, "MR", ctx);
  const formats = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
  return {
    region: ctx.region,
    bodyPart: ctx.bodyPart,
    family: ctx.family,
    spineSegment: ctx.spineSegment,
    macroKey: macros?.key ?? null,
    macroLabels: macros?.tiles.map((t) => t.label) ?? [],
    templateBodyPart: template?.bodyPart ?? null,
    protocolStudyType: protocol?.studyType ?? null,
    findingTileScopes: [...new Set(tiles.map((t) => t.scopeBodyPart).filter(Boolean))],
    snippetScopes: [...new Set(snippets.map((s) => s.scopeBodyPart).filter(Boolean))],
    formatBodyParts: [...new Set(formats.map((f) => f.bodyPart))],
    contentTypes: contentStudyTypes(ctx.regions),
  };
}

describe("reporting content wiring — one resolved context for all consumers", () => {
  it("MRI Brain: brain template, macros, tiles, snippets, impressions/formats", () => {
    const ctx = resolve("MR", "MRI Brain Plain");
    const s = snapshot(ctx);
    expect(s.region).toBe("Brain");
    expect(s.bodyPart).toBe("BRAIN");
    expect(s.macroKey).toBe("brain");
    expect(s.macroLabels).toContain("Infarct");
    expect(s.macroLabels).not.toContain("L1-2 Level");
    expect(s.templateBodyPart).toBe("BRAIN");
    expect(s.protocolStudyType).toBe("Brain");
    expect(s.findingTileScopes.every((b) => b === "Brain")).toBe(true);
    expect(s.snippetScopes.every((b) => b === "Brain")).toBe(true);
    expect(s.formatBodyParts).toEqual(["Brain"]);
    expect(matchesContentScope(ctx, "LS Spine")).toBe(false);
  });

  it("MRI Cervical Spine: cervical-specific, not lumbar, generic Spine only as inherited fallback", () => {
    const ctx = resolve("MR", "MRI Cervical Spine");
    const s = snapshot(ctx);
    expect(s.region).toBe("Cervical Spine");
    expect(s.bodyPart).toBe("SPINE_CERVICAL");
    expect(s.spineSegment).toBe("cervical");
    expect(s.macroKey).toBe("cervical");
    expect(s.macroLabels).toContain("C5-6 Level");
    expect(s.macroLabels).toContain("Disc Bulge"); // inherited common
    expect(s.macroLabels).not.toContain("L1-2 Level");
    expect(s.templateBodyPart).toBe("SPINE_CERVICAL");
    expect(s.protocolStudyType).toBe("Cervical Spine");
    expect(s.findingTileScopes).not.toContain("LS Spine");
    expect(s.findingTileScopes).not.toContain("Brain");
    expect(s.snippetScopes).not.toContain("LS Spine");
    expect(s.formatBodyParts).not.toContain("LS Spine");
    expect(s.formatBodyParts).not.toContain("Brain");
    expect(s.contentTypes).toEqual(["Cervical Spine", "Spine"]);
  });

  it("MRI Lumbosacral Spine: lumbar content, not cervical", () => {
    const ctx = resolve("MR", "MRI LS Spine");
    const s = snapshot(ctx);
    expect(s.region).toBe("LS Spine");
    expect(s.bodyPart).toBe("SPINE_LS");
    expect(s.macroKey).toBe("lumbar");
    expect(s.macroLabels).toContain("L1-2 Level");
    expect(s.macroLabels).not.toContain("C5-6 Level");
    expect(s.templateBodyPart).toBe("SPINE_LS");
    expect(s.protocolStudyType).toBe("LS Spine");
    expect(s.findingTileScopes).toContain("LS Spine");
    expect(s.findingTileScopes).not.toContain("Brain");
    expect(s.snippetScopes).toContain("LS Spine");
    expect(s.formatBodyParts).toContain("LS Spine");
    expect(s.formatBodyParts).not.toContain("Brain");
  });

  it("MRI Dorsal/Thoracic Spine: dorsal content, not cervical/lumbar-specific tiles", () => {
    const ctx = resolve("MR", "MRI Dorsal Spine");
    const s = snapshot(ctx);
    expect(s.region).toBe("Dorsal Spine");
    expect(s.bodyPart).toBe("SPINE_DORSAL");
    expect(s.macroKey).toBe("dorsal");
    expect(s.macroLabels).toContain("D7-8 Level");
    expect(s.macroLabels).not.toContain("C5-6 Level");
    expect(s.macroLabels).not.toContain("L1-2 Level");
    expect(s.templateBodyPart).toBe("SPINE_DORSAL");
    expect(s.protocolStudyType).toBe("Dorsal Spine");
  });

  it("manual region override: DICOM Cervical → Brain changes every selector without using description", () => {
    const auto = resolve("MR", "MRI Cervical Spine");
    expect(auto.region).toBe("Cervical Spine");
    const overridden = resolve("MR", "MRI Cervical Spine", ["Brain"]);
    expect(overridden.source).toBe("override");
    expect(overridden.studyDescription).toBe("MRI Cervical Spine");
    const s = snapshot(overridden);
    expect(s.region).toBe("Brain");
    expect(s.macroKey).toBe("brain");
    expect(s.macroLabels).toContain("Infarct");
    expect(s.macroLabels).not.toContain("C5-6 Level");
    expect(s.templateBodyPart).toBe("BRAIN");
    expect(s.protocolStudyType).toBe("Brain");
    expect(s.formatBodyParts).toEqual(["Brain"]);
    expect(studyMatchHaystack(overridden)).toBe("brain");
    expect(studyMatchHaystack(overridden)).not.toContain("cervical");
  });

  it("unknown / unmatched study: safe empty fallback, no Brain or Spine content", () => {
    const ctx = resolve("MR", "Nuclear medicine bone scan");
    expect(ctx.source).toBe("unresolved");
    expect(ctx.region).toBeNull();
    expect(chocolateBoxSetFor(ctx)).toBeNull();
    expect(pickStructuredTemplateForRegion(TEMPLATES, ctx.modality, ctx.region, ctx.studyDescription)).toBeNull();
    expect(pickQuickProtocol(PROTOCOLS, ctx.region)).toBeNull();
    expect(lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctx).every((t) => !t.scopeBodyPart)).toBe(true);
    expect(lookupMacrosForContext(DEFAULT_SNIPPET_MACROS, "MR", ctx).every((m) => !m.scopeBodyPart)).toBe(true);
    expect(lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx)).toEqual([]);
  });

  it("Knee (known tab, no mapped template/macros): does not guess Brain", () => {
    const ctx = resolve("MR", "MRI Knee");
    expect(ctx.region).toBe("Knee");
    expect(ctx.family).toBe("unknown");
    expect(studyRegionToBodyPart("Knee")).toBeNull();
    expect(chocolateBoxSetFor(ctx)).toBeNull();
    expect(pickStructuredTemplateForRegion(TEMPLATES, "MR", "Knee", "MRI Brain Plain")).toBeNull();
  });
});

describe("criticalWatchListFor uses resolved region, not generic spine tokens", () => {
  it("Cervical Spine does not inherit lumbar-only watch terms", () => {
    const cervical = criticalWatchListFor("MR", "MRI Cervical Spine", "Cervical Spine");
    const lumbar = criticalWatchListFor("MR", "MRI LS Spine", "LS Spine");
    expect(cervical).toContain("myelomalacia");
    expect(cervical).not.toContain("cauda equina compression");
    expect(lumbar).toContain("cauda equina compression");
    expect(lumbar).not.toContain("myelomalacia");
  });

  it("manual override to Brain drops spine-segment watch terms despite cervical description", () => {
    const terms = criticalWatchListFor("MR", "MRI Cervical Spine", "Brain");
    expect(terms).toContain("acute infarct");
    expect(terms).not.toContain("myelomalacia");
    expect(terms).not.toContain("cauda equina compression");
  });
});

describe("copilot / completion gates follow resolved region", () => {
  const base: CopilotContext = {
    modality: "MR",
    studyDescription: "MRI Cervical Spine",
    clinicalHistory: "",
    findings: "Acute infarct in the right MCA territory.",
    impression: [],
    recommendation: "",
    technique: "",
    selectedFindingLabels: [],
  };

  it("region override to Brain enables brain missing-observation rules despite cervical description", () => {
    const r = analyzeCopilot({ ...base, region: "Brain" });
    expect(r.items.map((i) => i.id)).toContain("missing:brain-swi");
  });

  it("resolved Cervical Spine does not fire brain spectroscopy/SWI gates from description alone", () => {
    const r = analyzeCopilot({ ...base, region: "Cervical Spine", findings: "An enhancing lesion is noted." });
    expect(r.items.map((i) => i.id)).not.toContain("legacy:brain-spectroscopy");
  });

  it("suggestCompletion uses region over noisy description", () => {
    const brain = suggestCompletion("The ventricular system is", { studyDescription: "MRI Cervical Spine", region: "Brain" });
    expect(brain?.completion).toMatch(/normal in size/i);
    const spine = suggestCompletion("The ventricular system is", { studyDescription: "MRI Brain", region: "Cervical Spine" });
    expect(spine).toBeNull();
  });
});

describe("findingsMacros requires resolved context", () => {
  it("returns null without a region instead of regex-guessing Brain/Spine", () => {
    expect(chocolateBoxSetFor(null)).toBeNull();
    expect(chocolateBoxSetFor(buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Cervical Spine",
      regions: [],
      source: "unresolved",
    }))).toBeNull();
  });
});
