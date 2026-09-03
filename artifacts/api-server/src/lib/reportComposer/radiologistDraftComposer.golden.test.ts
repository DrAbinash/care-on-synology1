/**
 * Golden clinic suite for CARE radiologist Draft Report composer.
 *
 * Cases A–L prove clinical-truth invariants using:
 *   - buildRadiologistDraftContext / prompt projection
 *   - deterministicComposeFromSnapshot (offline clinic fallback)
 *   - validateComposerOutput (deterministic safety)
 *   - snapshot freshness / finalize contracts (source + pure helpers)
 *
 * These do NOT call Ollama. Local inference timing is measured separately
 * when a composer model is configured.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { buildUserPrompt } from "./composeEngine";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { validateComposerOutput } from "./validateOutput";
import { computeSnapshotHashes, isComposeJobStale } from "./snapshot";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import { buildCareSystemPrompt } from "./persona";

function snap(partial: Partial<ComposerInputSnapshot>): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    findings: "",
    impression: "",
    recommendation: "",
    observations: [],
    ...partial,
  });
}

function assertAbnormalitiesRepresented(draftText: string, needles: string[]) {
  const lower = draftText.toLowerCase();
  for (const n of needles) {
    expect(lower, `missing abnormality fragment: ${n}`).toContain(n.toLowerCase());
  }
}

function assertNoInventedMajor(snapshot: ComposerInputSnapshot, draft: ReturnType<typeof deterministicComposeFromSnapshot>) {
  const v = validateComposerOutput(snapshot, draft);
  expect(v.unsupportedMentions, v.warnings.join("; ")).toEqual([]);
  expect(v.ok).toBe(true);
}

describe("buildRadiologistDraftContext — clinical input (no UI chrome)", () => {
  it("assembles study identity, observations, measurements, screening, scaffold hint", () => {
    const snapshot = snap({
      modality: "MR",
      region: "Cervical Spine",
      regions: ["Cervical Spine"],
      bodyPart: "SPINE_CERVICAL",
      family: "spine",
      spineSegment: "cervical",
      protocol: "Plain",
      reportTitle: "MRI CERVICAL SPINE PLAIN",
      technique: "Multiplanar multisequence MRI of the cervical spine.",
      findings:
        "Cervical lordosis is preserved. Cord signal is normal. No significant disc bulge at other levels.",
      observations: [
        {
          concept: "disc_osteophyte",
          source: "quick-select",
          region: "Cervical Spine",
          level: "C5-C6",
          laterality: "bilateral",
          severity: "moderate",
          findingsText: "C5-C6 DOC with ant thecal sac compression and bilat foraminal narrowing. Canal 11.2 mm.",
          impressionText: "C5-C6 disc osteophyte complex with canal/foraminal compromise.",
        },
      ],
    });
    const ctx = buildRadiologistDraftContext(snapshot);
    expect(ctx.studyIdentity.modality).toBe("MR");
    expect(ctx.studyIdentity.spineSegment).toBe("cervical");
    expect(ctx.studyIdentity.contrastHint).toBe("plain");
    expect(ctx.observations).toHaveLength(1);
    expect(ctx.measurements.some((m) => /11\.2/.test(m))).toBe(true);
    expect(ctx.normalScaffoldHint).toBe(true);
    expect(ctx.screeningWordingRequired).toBe(false);

    const prompt = renderRadiologistDraftContextPrompt(ctx, "FULL_REPORT");
    expect(prompt).toContain("=== CLINICAL TRUTH");
    expect(prompt).toContain("RADIOLOGIST OBSERVATIONS");
    expect(prompt).toContain("C5-C6");
    expect(prompt).not.toContain("data-testid");
    expect(prompt).not.toContain("Quick Select panel");
  });
});

describe("Golden A — MRI Brain normal scaffold", () => {
  it("preserves scaffold; empty/abnormal-free impression path; no invented pathology", () => {
    const findings = [
      "Brain parenchyma appears normal.",
      "Ventricular system is normal.",
      "No evidence of acute infarct or hemorrhage.",
      "Major intracranial vessels show normal flow voids.",
    ].join("\n");
    const snapshot = snap({
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      technique: "Multiplanar multisequence MRI of the brain.",
      findings,
      observations: [],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    expect(draft.findings).toContain("Brain parenchyma appears normal");
    expect(draft.recommendation).toBe("");
    assertNoInventedMajor(snapshot, draft);
    const persona = buildCareSystemPrompt("FULL_REPORT", snapshot);
    expect(persona).toContain("MRI BRAIN RULES");
  });
});

describe("Golden B — Brain Fazekas 1", () => {
  it("overlays Fazekas 1 onto scaffold and grounds impression", () => {
    const snapshot = snap({
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "Brain parenchyma otherwise unremarkable. Ventricular system is normal.",
      observations: [
        {
          concept: "fazekas",
          source: "quick-select",
          region: "Brain",
          severity: "mild",
          findingsText: "Few punctate T2/FLAIR hyperintensities in the bilateral periventricular white matter — Fazekas grade 1.",
          impressionText: "Mild chronic small-vessel ischemic changes (Fazekas 1).",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, ["fazekas", "grade 1"]);
    expect(draft.findings).toContain("Ventricular system is normal");
    assertNoInventedMajor(snapshot, draft);
  });
});

describe("Golden C — Brain Fazekas 2 + atrophy", () => {
  it("keeps both abnormalities and scaffold", () => {
    const snapshot = snap({
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      findings:
        "Grey-white differentiation is preserved. No acute infarct. Posterior fossa structures are normal.",
      observations: [
        {
          concept: "fazekas",
          source: "structured",
          findingsText: "Confluent periventricular T2/FLAIR hyperintensities — Fazekas grade 2.",
          impressionText: "Moderate chronic small-vessel ischemic changes (Fazekas 2).",
        },
        {
          concept: "atrophy",
          source: "quick-select",
          severity: "mild",
          findingsText: "Mild cerebral atrophy with prominent CSF spaces.",
          impressionText: "Mild cerebral atrophy.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, [
      "fazekas grade 2",
      "mild cerebral atrophy",
    ]);
    expect(draft.findings).toContain("No acute infarct");
    assertNoInventedMajor(snapshot, draft);
  });
});

describe("Golden D — Brain chronic infarct", () => {
  it("preserves laterality and does not invent acute hemorrhage", () => {
    const snapshot = snap({
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      findings: "No acute diffusion restriction. Remainder of brain parenchyma is unremarkable.",
      observations: [
        {
          concept: "chronic_infarct",
          source: "quick-select",
          laterality: "left",
          findingsText: "Chronic lacunar infarct in the left lentiform nucleus.",
          impressionText: "Chronic left lentiform lacunar infarct.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, ["left", "lacunar"]);
    const bad = validateComposerOutput(snapshot, {
      ...draft,
      impression: "Acute hemorrhage with chronic left infarct.",
    });
    expect(bad.ok).toBe(false);
    expect(bad.unsupportedMentions).toContain("hemorrhage");
  });
});

describe("Golden E — MRI LS multilevel degeneration", () => {
  it("preserves L4-L5 and L5-S1 levels", () => {
    const snapshot = snap({
      region: "LS Spine",
      regions: ["LS Spine"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Conus terminates normally. Distal cord signal is normal.",
      observations: [
        {
          concept: "disc_bulge",
          level: "L4-L5",
          findingsText: "L4-L5 diffuse disc bulge indenting the thecal sac.",
          impressionText: "L4-L5 disc bulge with thecal sac indentation.",
        },
        {
          concept: "desiccation",
          level: "L5-S1",
          findingsText: "L5-S1 disc desiccation with mild bulge.",
          impressionText: "L5-S1 degenerative disc disease.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, ["L4-L5", "L5-S1"]);
    const v = validateComposerOutput(snapshot, draft);
    expect(v.levelChanges).toEqual([]);
    assertNoInventedMajor(snapshot, draft);
  });
});

describe("Golden F — LS + Whole Spine Screening", () => {
  it("marks screening wording mandatory and flags full-spine miswording", () => {
    const snapshot = snap({
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      protocol: "Plain + Whole Spine Screening",
      reportTitle: "MRI LS SPINE WITH WHOLE SPINE SCREENING",
      technique:
        "Multiplanar multisequence MRI of the lumbosacral spine. Limited-planar, limited-sequence screening of the whole spine was also performed.",
      findings: "Lumbar alignment is maintained.",
      observations: [
        {
          concept: "disc_bulge",
          level: "L4-L5",
          findingsText: "L4-L5 mild disc bulge.",
        },
      ],
    });
    const ctx = buildRadiologistDraftContext(snapshot);
    expect(ctx.screeningWordingRequired).toBe(true);
    const prompt = buildUserPrompt("FULL_REPORT", snapshot);
    expect(prompt).toMatch(/LIMITED PLANAR AND LIMITED SEQUENCE/i);

    const badDraft = {
      findings: "Multiplanar multisequence whole spine MRI shows L4-L5 mild disc bulge.",
      impression: "L4-L5 mild disc bulge.",
      recommendation: "",
      unresolvedQuestions: [] as string[],
      warnings: [] as string[],
    };
    const v = validateComposerOutput(snapshot, badDraft);
    expect(v.warnings.some((w) => w.includes("screening_wording"))).toBe(true);
  });
});

describe("Golden G — Cervical C5-C6 disc-osteophyte complex", () => {
  it("preserves level/laterality and records exact clinical input for deliverable", () => {
    const snapshot = snap({
      region: "Cervical Spine",
      regions: ["Cervical Spine"],
      bodyPart: "SPINE_CERVICAL",
      family: "spine",
      spineSegment: "cervical",
      protocol: "Plain",
      reportTitle: "MRI CERVICAL SPINE PLAIN",
      technique: "Multiplanar multisequence MRI of the cervical spine without contrast.",
      findings: "Cervical cord signal is normal. Alignment is maintained.",
      observations: [
        {
          concept: "disc_osteophyte",
          source: "quick-select",
          region: "Cervical Spine",
          level: "C5-C6",
          laterality: "bilateral",
          findingsText:
            "C5-C6 disc osteophyte complex causing anterior thecal sac compression and bilateral foraminal narrowing.",
          impressionText:
            "C5-C6 degenerative disc-osteophyte complex with associated canal/thecal sac and bilateral neural foraminal compromise.",
        },
      ],
    });
    const clinicalInput = buildUserPrompt("FULL_REPORT", snapshot);
    expect(clinicalInput).toContain("C5-C6");
    expect(clinicalInput).toContain("bilateral");

    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, [
      "C5-C6",
      "disc osteophyte",
      "bilateral",
    ]);
    expect(draft.findings).toContain("Cervical cord signal is normal");
    assertNoInventedMajor(snapshot, draft);

    // Deliverable fixtures written for the walkthrough report.
    const outDir = "/opt/cursor/artifacts";
    try {
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "golden-g-clinical-input.txt"), clinicalInput);
      writeFileSync(
        join(outDir, "golden-g-deterministic-output.json"),
        JSON.stringify(draft, null, 2),
      );
    } catch {
      // Artifact dir may be unavailable in some runners — test still asserts above.
    }
  });
});

describe("Golden H — Cervical multilevel + AP canal measurements", () => {
  it("preserves exact canal measurements", () => {
    const snapshot = snap({
      region: "Cervical Spine",
      regions: ["Cervical Spine"],
      bodyPart: "SPINE_CERVICAL",
      family: "spine",
      spineSegment: "cervical",
      findings: "Cord signal is normal.",
      observations: [
        {
          concept: "canal_ap",
          findingsText: "AP canal diameters: C3 11.2 mm, C4 11.8 mm, C5 12.1 mm, C6 10.9 mm, C7 13.4 mm.",
        },
        {
          concept: "disc_bulge",
          level: "C6-C7",
          severity: "mild",
          findingsText: "C6-C7 mild disc bulge.",
        },
      ],
    });
    const ctx = buildRadiologistDraftContext(snapshot);
    expect(ctx.measurements.join(" ")).toMatch(/11\.2\s*mm/);
    expect(ctx.measurements.join(" ")).toMatch(/10\.9\s*mm/);
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(draft.findings, ["11.2 mm", "10.9 mm", "C6-C7"]);
    const dropped = validateComposerOutput(snapshot, {
      findings: "C6-C7 mild disc bulge.",
      impression: "C6-C7 mild disc bulge.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    // Multiple canal diameters → ambiguous correlation; remain advisory (not hard-fail).
    expect(dropped.warnings.some((w) => /dropped measurements|measurement/i.test(w))).toBe(true);
    expect(dropped.errors).not.toContain("measurement_mutation");
    expect(dropped.ok).toBe(true);
  });
});

describe("Golden I — Dorsal compression fracture", () => {
  it("preserves level and does not invent cord compression unless supplied", () => {
    const snapshot = snap({
      region: "Dorsal Spine",
      regions: ["Dorsal Spine"],
      bodyPart: "SPINE_DORSAL",
      family: "spine",
      spineSegment: "dorsal",
      findings: "Dorsal alignment otherwise maintained.",
      observations: [
        {
          concept: "compression_fracture",
          level: "D7-D8",
          findingsText: "Compression fracture of D8 vertebral body with mild height loss.",
          impressionText: "D8 vertebral compression fracture.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, ["D8", "compression"]);
    const inventCord = validateComposerOutput(snapshot, {
      findings: draft.findings,
      impression: "D8 fracture with cord compression.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(inventCord.ok).toBe(false);
    expect(inventCord.unsupportedMentions).toContain("cord compression");
  });
});

describe("Golden J — Dorsal spondylodiscitis", () => {
  it("grounds impression and keeps empty recommendation unless supplied", () => {
    const snapshot = snap({
      region: "Dorsal Spine",
      regions: ["Dorsal Spine"],
      bodyPart: "SPINE_DORSAL",
      family: "spine",
      spineSegment: "dorsal",
      findings: "",
      observations: [
        {
          concept: "spondylodiscitis",
          level: "D9-D10",
          findingsText:
            "D9-D10 spondylodiscitis with endplate destruction and prevertebral soft-tissue thickening.",
          impressionText: "D9-D10 spondylodiscitis.",
          recommendationText: "Clinical correlation with inflammatory markers and follow-up MRI as clinically indicated.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(`${draft.findings}\n${draft.impression}`, ["D9-D10", "spondylodiscitis"]);
    expect(draft.recommendation).toMatch(/inflammatory markers/i);
    assertNoInventedMajor(snapshot, draft);

    const noRec = snap({
      ...snapshot,
      observations: snapshot.observations.map((o) => ({ ...o, recommendationText: undefined })),
    });
    const draft2 = deterministicComposeFromSnapshot(noRec, "FULL_REPORT");
    expect(draft2.recommendation).toBe("");
  });
});

describe("Golden K — manual protected sentence + structured observations", () => {
  it("keeps protected manual sentence in scaffold/output path", () => {
    const protectedSentence =
      "Patient reports prior cervical surgery; hardware-related artifact limits evaluation at C3-C4.";
    const snapshot = snap({
      region: "Cervical Spine",
      regions: ["Cervical Spine"],
      bodyPart: "SPINE_CERVICAL",
      family: "spine",
      spineSegment: "cervical",
      findings: `${protectedSentence}\nCord signal is otherwise normal.`,
      observations: [
        {
          concept: "disc_bulge",
          source: "structured",
          level: "C5-C6",
          findingsText: "C5-C6 mild disc bulge.",
        },
      ],
    });
    const ctx = buildRadiologistDraftContext(snapshot);
    expect(ctx.protectedManualText.findings).toContain(protectedSentence);
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    expect(draft.findings).toContain(protectedSentence);
    expect(draft.findings).toContain("C5-C6");
    assertNoInventedMajor(snapshot, draft);
  });
});

describe("Golden L — voice + Canvas + QS mixed observations", () => {
  it("dedupes same clinical slot and keeps mixed sources", () => {
    const snapshot = snap({
      region: "LS Spine",
      regions: ["LS Spine"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Conus is normal.",
      observations: [
        {
          concept: "disc_bulge",
          source: "voice",
          level: "L4-L5",
          laterality: "central",
          findingsText: "L4-L5 central disc bulge.",
        },
        {
          concept: "facet",
          source: "quick-select",
          level: "L4-L5",
          findingsText: "L4-L5 facet hypertrophy.",
        },
        {
          concept: "disc_bulge",
          source: "structured",
          level: "L5-S1",
          findingsText: "L5-S1 mild disc bulge.",
        },
      ],
    });
    const draft = deterministicComposeFromSnapshot(snapshot, "FULL_REPORT");
    assertAbnormalitiesRepresented(draft.findings, ["L4-L5 central disc bulge", "facet hypertrophy", "L5-S1"]);
    assertNoInventedMajor(snapshot, draft);
  });
});

describe("Safety / clinic contracts — finalize + stale + filler recommendation", () => {
  it("AI cannot finalize (jobService contract)", () => {
    const jobService = readFileSync(join(__dirname, "jobService.ts"), "utf8");
    expect(jobService).toContain("Report is finalized — composition not allowed");
    expect(jobService).toContain('if (persisted.finalized)');
  });

  it("stale draft protection works when observations change", () => {
    const a = snap({
      findings: "Normal.",
      observations: [{ concept: "bulge", level: "L4-L5", findingsText: "L4-L5 bulge" }],
    });
    const b = snap({
      findings: "Normal.",
      observations: [
        { concept: "bulge", level: "L4-L5", findingsText: "L4-L5 bulge" },
        { concept: "desiccation", level: "L5-S1", findingsText: "L5-S1 desiccation" },
      ],
    });
    const ha = computeSnapshotHashes(a);
    const hb = computeSnapshotHashes(b);
    expect(ha.reportRevision).not.toBe(hb.reportRevision);
    const decision = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: ha.reportRevision,
      storedFindingsHash: ha.findingsHash,
      storedImpressionHash: ha.impressionHash,
      storedInputHash: ha.inputHash,
      current: {
        reportRevision: hb.reportRevision,
        findingsHash: hb.findingsHash,
        impressionHash: hb.impressionHash,
        inputHash: hb.inputHash,
      },
    });
    expect(decision.stale).toBe(true);
  });

  it("clears filler Clinical correlation advised recommendation", () => {
    const snapshot = snap({
      findings: "Mild degenerative changes.",
      observations: [{ concept: "degen", findingsText: "Mild degenerative changes." }],
    });
    const draft = {
      findings: "Mild degenerative changes.",
      impression: "Mild degenerative changes.",
      recommendation: "Clinical correlation advised.",
      unresolvedQuestions: [] as string[],
      warnings: [] as string[],
    };
    const v = validateComposerOutput(snapshot, draft);
    expect(draft.recommendation).toBe("");
    expect(v.warnings).toContain("filler_recommendation_cleared");
  });

  it("recommendationText participates in observation hash", () => {
    const base = {
      concept: "infection",
      findingsText: "Possible spondylodiscitis.",
      impressionText: "Possible spondylodiscitis.",
    };
    const a = snap({ observations: [{ ...base }] });
    const b = snap({
      observations: [{ ...base, recommendationText: "Follow-up MRI in 6 weeks." }],
    });
    expect(computeSnapshotHashes(a).reportRevision).not.toBe(computeSnapshotHashes(b).reportRevision);
  });
});

describe("UI primary action label", () => {
  it("Draft from Observations / Selected Images are primary compose action labels", () => {
    const ui = readFileSync(
      join(
        __dirname,
        "../../../../diagnostic-erp/src/components/radiology/ReportComposerAssistant.tsx",
      ),
      "utf8",
    );
    expect(ui).toContain("Draft from Observations");
    expect(ui).toContain("Draft with Selected Images");
    expect(ui).toContain('data-testid="compose-in-background"');
    expect(ui).toContain('data-testid="ai-compose-mode"');
  });
});
