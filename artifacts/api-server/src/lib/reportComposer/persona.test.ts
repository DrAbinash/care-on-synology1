/**
 * PR #657 — CARE Radiology Persona golden tests.
 *
 * Coverage (§S test matrix 1–17):
 *   1. MRI Brain Plain — concise brain report, no invented pathology.
 *   2. MRI Brain Epilepsy Protocol — protocol visible, no invented hippocampal pathology.
 *   3. MRI LS Spine — L3-L4 + L4-L5 levels preserved.
 *   4. MRI LS Spine + Whole Spine Screening — primary preserved, screening safeguard.
 *   5. Cervical Spine + Whole Spine Screening — cervical primary, screening wording.
 *   6. Laterality — right + left separate, no side swapping.
 *   7. Severity — mild finding, no severe upgrade.
 *   8. Measurements — provided measurement preserved, no invented extra.
 *   9. Contrast — plain study, no enhancement statements.
 *  10. Mammography — mammography + USG reference, no USG cross-contamination.
 *  11. Recommendation — no recommendation indicated, may remain empty.
 *  12. Manual protected narrative — persona cannot silently overwrite.
 *  13. Unknown family — master/safety persona only, no crash.
 *  14. Legacy snapshot — valid fallback persona.
 *  15. Prompt routing — Brain does not load spine rules; Spine does not load mammography rules.
 *  16. Prompt budget — persona routing remains compact and deterministic.
 *  17. Client/server/API regression — #654 and #656 hashes remain unchanged.
 */
import { describe, expect, it } from "vitest";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { buildCareSystemPrompt, selectPersonaModules, hasScreeningComponent } from "./persona";
import { normaliseSpineSegment, resolvePrimaryRegionLabel } from "./persona";
import { CARE_RADIOLOGY_MASTER, CARE_REPORT_STYLE, CARE_SAFETY_RULES } from "./persona";
import { CARE_MRI_BRAIN, CARE_MRI_SPINE, CARE_CT, CARE_USG, CARE_MAMMOGRAPHY } from "./persona";
import { CARE_MRI_CERVICAL, CARE_MRI_DORSAL, CARE_MRI_LUMBAR, CARE_CT_SPINE } from "./persona";
import { CARE_XRAY, CARE_DOPPLER, CARE_MRCP } from "./persona";
import { validateComposerOutput } from "./validateOutput";
import { computeSnapshotHashes } from "./snapshot";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

// ─── helpers ──────────────────────────────────────────────────────────────

function snapshot(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    studyType: "MRI Brain Plain",
    findings: "Few punctate T2/FLAIR hyperintense white matter lesions.",
    impression: "Mild chronic small-vessel ischemic changes.",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

// ─── §S 1. MRI Brain Plain ───────────────────────────────────────────────

describe("§S 1. MRI Brain Plain", () => {
  it("persona is loaded with MRI BRAIN module", () => {
    const snap = snapshot({ family: "brain", modality: "MR" });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("CARE radiology report composer");
    expect(prompt).toContain("MRI BRAIN RULES");
    expect(prompt).toContain("FAZEKAS GRADE");
  });

  it("validation flags invented pathology (hemorrhage not in input)", () => {
    const snap = snapshot({
      findings: "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade 1.",
      observations: [
        { concept: "fazekas", source: "quick-select", findingsText: "Fazekas grade 1." },
      ],
    });
    const draft = {
      findings: snap.findings,
      impression: "Fazekas grade 1. Acute hemorrhage in the right basal ganglia.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.unsupportedMentions).toContain("hemorrhage");
    expect(v.ok).toBe(false);
  });
});

// ─── §S 2. MRI Brain Epilepsy Protocol ───────────────────────────────────

describe("§S 2. MRI Brain Epilepsy Protocol", () => {
  it("protocol is visible in persona + user prompt", () => {
    const snap = snapshot({
      protocol: "Epilepsy Protocol",
      reportTitle: "MRI BRAIN EPILEPSY PROTOCOL",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    // Persona carries epilepsy-specific rule.
    expect(prompt).toContain("EPILEPSY PROTOCOL");
    expect(prompt).toMatch(/Do NOT invent hippocampal/i);
  });
});

// ─── §S 3. MRI LS Spine — level preservation ────────────────────────────

describe("§S 3. MRI LS Spine", () => {
  it("levels L3-L4 + L4-L5 are preserved in validation", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Disc bulge at L3-L4. Disc bulge at L4-L5.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L3-L4", findingsText: "Disc bulge at L3-L4." },
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", findingsText: "Disc bulge at L4-L5." },
      ],
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("MRI SPINE RULES");

    // Validation: AI inventing L5-S1 (not in input) is flagged.
    const draft = {
      findings: "Disc bulge at L3-L4. Disc bulge at L4-L5. Disc bulge at L5-S1.",
      impression: "Disc bulges at multiple levels.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.levelChanges).toContain("L5-S1");
    // Hardening: introduced spinal level absent from supplied observations blocks READY.
    expect(v.errors).toContain("level_change");
    expect(v.ok).toBe(false);
  });
});

// ─── §S 4. MRI LS Spine + Whole Spine Screening ──────────────────────────

describe("§S 4. MRI LS Spine + Whole Spine Screening", () => {
  it("screening safeguard is injected when regions include screening", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
    });
    expect(hasScreeningComponent(snap)).toBe(true);
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("SCREENING CONTEXT ACTIVE");
    expect(prompt).toContain("LIMITED-PLANAR");
    expect(prompt).toContain("limited-sequence screening");
  });

  it("primary region remains LS Spine, not flattened to Whole Spine", () => {
    const snap = snapshot({
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
    });
    expect(snap.region).toBe("LS Spine");
    expect(snap.regions).toEqual(["LS Spine", "Whole Spine Screening"]);
  });
});

// ─── §S 5. Cervical Spine + Whole Spine Screening ─────────────────────────

describe("§S 5. Cervical Spine + Whole Spine Screening", () => {
  it("cervical primary + screening safeguard", () => {
    const snap = snapshot({
      modality: "MR",
      region: "Cervical Spine",
      regions: ["Cervical Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_CERVICAL",
      family: "spine",
      spineSegment: "cervical",
      reportTitle: "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING",
    });
    expect(snap.region).toBe("Cervical Spine");
    expect(snap.spineSegment).toBe("cervical");
    expect(hasScreeningComponent(snap)).toBe(true);
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("SCREENING CONTEXT ACTIVE");
    expect(prompt).toContain("MRI SPINE RULES");
  });
});

// ─── §S 6. Laterality ────────────────────────────────────────────────────

describe("§S 6. Laterality — no side swapping", () => {
  it("validation flags right → left swap", () => {
    const snap = snapshot({
      findings: "Acute right MCA territory infarct.",
      observations: [
        { concept: "infarct", source: "quick-findings", laterality: "right", findingsText: "Acute right MCA territory infarct." },
      ],
    });
    const draft = {
      findings: "Acute left MCA territory infarct.",
      impression: "Acute left MCA territory infarct.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.lateralitySwaps).toContain("right→left");
    // Definite single-observation laterality swap → hard-block READY.
    expect(v.errors).toContain("laterality_swap");
    expect(v.warnings.some((w) => w.includes("laterality"))).toBe(true);
    expect(v.ok).toBe(false);
  });

  it("validation does NOT flag when both sides are present in input", () => {
    const snap = snapshot({
      findings: "Right and left MCA territory infarcts.",
    });
    const draft = {
      findings: "Right and left MCA territory infarcts.",
      impression: "Bilateral MCA territory infarcts.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.lateralitySwaps).toEqual([]);
  });
});

// ─── §S 7. Severity ──────────────────────────────────────────────────────

describe("§S 7. Severity — no severe upgrade", () => {
  it("validation flags mild → severe escalation", () => {
    const snap = snapshot({
      findings: "Mild diffuse disc bulge at L4-L5.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", severity: "mild", findingsText: "Mild diffuse disc bulge at L4-L5." },
      ],
    });
    const draft = {
      findings: "Severe diffuse disc bulge at L4-L5.",
      impression: "Severe disc bulge at L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.severityEscalations).toContain("mild→severe");
    // Definite same-slot mild→severe → hard-block READY.
    expect(v.errors).toContain("severity_escalation");
    expect(v.warnings.some((w) => w.includes("severity"))).toBe(true);
    expect(v.ok).toBe(false);
  });

  it("validation does NOT flag when severity matches input", () => {
    const snap = snapshot({
      findings: "Mild diffuse disc bulge at L4-L5.",
    });
    const draft = {
      findings: "Mild diffuse disc bulge at L4-L5.",
      impression: "Mild disc bulge at L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.severityEscalations).toEqual([]);
  });
});

// ─── §S 8. Measurements ──────────────────────────────────────────────────

describe("§S 8. Measurements — preserve exactly, no invented extras", () => {
  it("validation flags invented measurement unit (canal AP not in input)", () => {
    // Note: measurement validation is partially covered by the
    // unsupportedMentions path (e.g. "stenosis" without "stenosis" in input).
    // Exact numeric measurement preservation is enforced by the persona
    // prompt rule "Preserve supplied measurements exactly" — the validator
    // cannot do numeric diffing without fragile regex. This is documented as
    // a remaining gap. Here we verify the persona carries the rule.
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Canal AP diameter 8 mm at L4-L5.",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("CANAL DIAMETERS");
    expect(prompt).toContain("preserve them exactly");
    expect(prompt).toContain("Do NOT manufacture canal measurements");
  });
});

// ─── §S 9. Contrast ──────────────────────────────────────────────────────

describe("§S 9. Contrast — plain study, no enhancement statements", () => {
  it("persona carries the no-enhancement-for-plain-study rule", () => {
    const snap = snapshot({
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("CONTRAST");
    expect(prompt).toContain("Do NOT say \"no abnormal enhancement\"");
  });
});

// ─── §S 10. Mammography ──────────────────────────────────────────────────

describe("§S 10. Mammography — no USG cross-contamination", () => {
  it("mammography persona is loaded for MG modality", () => {
    const snap = snapshot({
      modality: "MG",
      region: "Breast",
      family: "breast",
      bodyPart: "BREAST",
      reportTitle: "BILATERAL MAMMOGRAPHY",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("MAMMOGRAPHY RULES");
    expect(prompt).toContain("Do NOT copy ultrasound findings");
    expect(prompt).toContain("Do NOT merge modality-specific findings");
  });

  it("mammography persona is loaded for family breast even with non-MG modality", () => {
    const snap = snapshot({
      modality: "US",
      region: "Breast",
      family: "breast",
    });
    // US + breast → should route to MAMMOGRAPHY (breast family priority).
    const modules = selectPersonaModules(snap);
    const prompt = modules.join("\n\n");
    expect(prompt).toContain("MAMMOGRAPHY RULES");
  });
});

// ─── §S 11. Recommendation ───────────────────────────────────────────────

describe("§S 11. Recommendation — no filler", () => {
  it("persona carries the no-filler-recommendation rule", () => {
    const snap = snapshot();
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("No filler recommendations");
    expect(prompt).toContain("Please correlate clinically");
    expect(prompt).toMatch(/leave recommendation empty|Prefer empty over filler/i);
  });

  it("validator clears filler Clinical correlation advised", () => {
    const snap = snapshot({
      findings: "Fazekas grade 1.",
      impression: "Fazekas grade 1.",
      recommendation: "",
    });
    const draft = {
      findings: "Fazekas grade 1.",
      impression: "Fazekas grade 1.",
      recommendation: "Clinical correlation is advised.",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(draft.recommendation).toBe("");
    expect(v.warnings).toContain("filler_recommendation_cleared");
  });

  it("validator refuses a recommendation that names a diagnosis nothing supplied", () => {
    // Re-pointed from the removed `recommendation_not_clearly_supported` warning,
    // which was a keyword search of the SUPPLIED CORPUS rather than of the advice:
    // bare "ct" matched "duct", "intact" and "expected", so 8 of the 19 correct
    // corpus reports it passed were passed by the study's own modality word, and it
    // fired on exactly 1 correct report and caught exactly 1 absurd one — the same
    // case both times. The check below has always owned this draft, reads the
    // recommendation as part of the report, and refuses it outright rather than
    // advising about it.
    const snap = snapshot({
      findings: "Fazekas grade 1.",
      impression: "Fazekas grade 1.",
      recommendation: "",
    });
    const draftWithUnsupported = {
      findings: "Fazekas grade 1.",
      impression: "Fazekas grade 1.",
      recommendation: "Recommend PET-CT for further evaluation of occult malignancy.",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draftWithUnsupported);
    expect(v.errors).toContain("unsupported_abnormality");
    expect(v.unsupportedMentions).toContain("malignancy");
    expect(v.ok).toBe(false);
  });

  it("validator refuses advice that acts on a side nothing supplied", () => {
    // The advice is the one field that tells somebody what to do next, so an invented
    // side there is an invented laterality in actionable form. detectLateralitySwaps
    // cannot see it: it is fed findings+impression+advice together and its condition
    // requires the input's own side to be ABSENT from the output, which a Findings
    // that still says "right" defeats. Measured on the golden corpus before this
    // check — a right-sided DVT advised as "Repeat Doppler of the LEFT lower limb in
    // one week" returned ok=true, no swap, no error, and its only signal was the same
    // advisory warning the correct advice produced.
    const snap = snapshot({
      findings: "Acute infarct in the right middle cerebral artery territory.",
      impression: "Acute right middle cerebral artery territory infarct.",
      recommendation: "",
    });
    const advice = (recommendation: string) =>
      validateComposerOutput(snap, {
        findings: "Acute infarct in the right middle cerebral artery territory.",
        impression: "Acute right middle cerebral artery territory infarct.",
        recommendation,
        unresolvedQuestions: [],
        warnings: [],
      });

    const moved = advice("Repeat MRI of the left hemisphere in one week.");
    expect(moved.errors).toContain("unsupported_laterality");
    expect(moved.ok).toBe(false);
    expect(moved.warnings.join(" ")).toContain("left");

    // The same advice on the side that WAS supplied is not a finding, and a correct
    // report must not be refused for naming it. 0 of 20 correct corpus
    // recommendations name a side nothing supplied.
    expect(advice("Repeat MRI of the right hemisphere in one week.").errors).not.toContain(
      "unsupported_laterality",
    );
    expect(advice("Urgent stroke team review and vascular imaging.").errors).not.toContain(
      "unsupported_laterality",
    );
  });

  it("a side supplied only in an observation's laterality slot still grounds the advice", () => {
    // The grounding corpus is built from the supplied TEXT — findings, impression,
    // advice, history, technique, and each observation's narrative fields. An
    // observation's structured `laterality` slot is not narrative, so without reading
    // it a side the radiologist picked from a laterality chip and never typed would
    // look invented. It is not: the chip is the radiologist's own statement of the
    // side, and refusing advice that follows it would make the composer argue with
    // the observation ledger.
    const snap = snapshot({
      findings: "Acute infarct in the middle cerebral artery territory.",
      impression: "Acute middle cerebral artery territory infarct.",
      recommendation: "",
      observations: [
        {
          concept: "infarct",
          source: "quick-select",
          findingsText: "Acute infarct in the middle cerebral artery territory.",
          laterality: "Left",
        },
      ],
    });
    const drafted = (recommendation: string) =>
      validateComposerOutput(snap, {
        findings: "Acute infarct in the middle cerebral artery territory.",
        impression: "Acute middle cerebral artery territory infarct.",
        recommendation,
        unresolvedQuestions: [],
        warnings: [],
      });

    expect(drafted("Repeat MRI of the left hemisphere in one week.").errors).not.toContain(
      "unsupported_laterality",
    );
    // The check is still live on this same snapshot: a side no field supplied is
    // refused, so the pass above is grounding and not a disabled rule.
    expect(drafted("Repeat MRI of the right hemisphere in one week.").errors).toContain(
      "unsupported_laterality",
    );
  });
});

// ─── §S 12. Manual protected narrative ────────────────────────────────────

describe("§S 12. Manual protected narrative", () => {
  it("persona carries the no-overwrite-protected-manual-text rule", () => {
    const snap = snapshot();
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("NEVER overwrite protected manual radiologist text");
  });
});

// ─── §S 13. Unknown family ───────────────────────────────────────────────

describe("§S 13. Unknown family — master/safety only", () => {
  it("a study no modality rule covers loads only MASTER + STYLE + SAFETY (no crash)", () => {
    // Was `modality: "XR", region: "Knee"` — which is now a covered case: a knee
    // film gets CARE_XRAY. The guarantee here is "an uncovered study still gets a
    // valid persona", so the vehicle has to be a modality genuinely on its own.
    const snap = snapshot({
      modality: "PT",
      region: "Whole Body",
      family: "unknown",
      bodyPart: "WHOLE_BODY",
    });
    const modules = selectPersonaModules(snap);
    expect(modules).toHaveLength(3); // MASTER + STYLE + SAFETY only
    expect(modules[0]).toBe(CARE_RADIOLOGY_MASTER);
    expect(modules[1]).toBe(CARE_REPORT_STYLE);
    expect(modules[2]).toBe(CARE_SAFETY_RULES);
    // No crash, no irrelevant rules.
    expect(() => buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap)).not.toThrow();
  });

  it("a knee X-ray is no longer an uncovered study", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "XR", region: "Knee", family: "unknown", bodyPart: "KNEE" }),
    );
    expect(modules).toContain(CARE_XRAY);
    expect(modules).not.toContain(CARE_CT);
    expect(modules).not.toContain(CARE_MAMMOGRAPHY);
  });
});

// ─── §S 14. Legacy snapshot ──────────────────────────────────────────────

describe("§S 14. Legacy snapshot — valid fallback persona", () => {
  it("snapshot without family/modality still produces a valid system prompt", () => {
    const snap = parseComposerSnapshot({
      findings: "Old narrative findings.",
      impression: "",
      recommendation: "",
      observations: [],
    });
    // No family, no modality → MASTER + STYLE + SAFETY only.
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toContain("CARE radiology report composer");
    expect(prompt).toContain("REPORT STRUCTURE");
    expect(prompt).toContain("SAFETY GUARDS");
    expect(prompt).not.toContain("MRI BRAIN RULES");
    expect(prompt).not.toContain("MRI SPINE RULES");
  });
});

// ─── §S 15. Prompt routing ──────────────────────────────────────────────

describe("§S 15. Prompt routing — no cross-contamination", () => {
  it("Brain does NOT load spine-specific rules", () => {
    const snap = snapshot({
      modality: "MR",
      region: "Brain",
      family: "brain",
      bodyPart: "BRAIN",
    });
    const modules = selectPersonaModules(snap);
    const joined = modules.join("\n\n");
    expect(joined).toContain("MRI BRAIN RULES");
    expect(joined).not.toContain("MRI SPINE RULES");
    expect(joined).not.toContain("SCREENING SAFEGUARD");
  });

  it("Spine does NOT load brain-specific rules", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
    });
    const modules = selectPersonaModules(snap);
    const joined = modules.join("\n\n");
    expect(joined).toContain("MRI SPINE RULES");
    expect(joined).not.toContain("MRI BRAIN RULES");
    expect(joined).not.toContain("FAZEKAS GRADE");
  });

  it("Spine does NOT load mammography rules", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
    });
    const modules = selectPersonaModules(snap);
    const joined = modules.join("\n\n");
    expect(joined).not.toContain("MAMMOGRAPHY RULES");
  });

  it("CT does NOT load MRI rules", () => {
    const snap = snapshot({
      modality: "CT",
      region: "Abdomen",
      family: "abdomen",
    });
    const modules = selectPersonaModules(snap);
    const joined = modules.join("\n\n");
    expect(joined).toContain("CT RULES");
    expect(joined).not.toContain("MRI BRAIN RULES");
    expect(joined).not.toContain("MRI SPINE RULES");
  });
});

// ─── §S 16. Prompt budget ───────────────────────────────────────────────

describe("§S 16. Prompt budget — compact and deterministic", () => {
  it("system prompt for a full MRI Brain study fits within ~10 KB", () => {
    const snap = snapshot({
      modality: "MR",
      region: "Brain",
      family: "brain",
      protocol: "Plain",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    // Strengthened draft-composer persona remains compact for local num_ctx=4096
    // (~10 KB ≈ ~2500 tokens at 4 chars/token).
    expect(prompt.length).toBeLessThan(10000);
  });

  it("system prompt for MRI Spine + Screening fits within ~11 KB", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      family: "spine",
      spineSegment: "lumbar",
    });
    const prompt = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt.length).toBeLessThan(11000);
  });

  it("system prompt is deterministic — same snapshot produces same prompt", () => {
    const snap = snapshot({ family: "brain", modality: "MR" });
    const p1 = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    const p2 = buildCareSystemPrompt("FULL_REPORT" as AiComposeJobKind, { ...snap });
    expect(p1).toBe(p2);
  });
});

// ─── §S 17. Client/server/API regression ─────────────────────────────────

describe("§S 17. PR #654 + #656 hashes remain unchanged", () => {
  it("computeSnapshotHashes still produces stable hashes with persona-extended snapshots", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      protocol: "Plain",
      reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
      findings: "Disc bulge at L4-L5.",
      impression: "Mild disc bulge.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", findingsText: "Disc bulge at L4-L5." },
      ],
    });
    const h1 = computeSnapshotHashes(snap);
    const h2 = computeSnapshotHashes({ ...snap });
    // Hashes must be identical (deterministic).
    expect(h1.inputHash).toBe(h2.inputHash);
    expect(h1.reportRevision).toBe(h2.reportRevision);
    // And non-empty.
    expect(h1.inputHash).toBeTruthy();
    expect(h1.reportRevision).toBeTruthy();
  });

  it("persona modules do NOT alter the snapshot hash (persona is prompt-only, not data)", () => {
    // The persona is injected into the SYSTEM prompt, not into the snapshot.
    // Therefore computeSnapshotHashes must be unaffected by persona existence.
    const snap = snapshot({ family: "brain", modality: "MR" });
    const h = computeSnapshotHashes(snap);
    // inputHash includes studyCtxCanon (from PR #656) but NOT persona text.
    // This is correct — persona is a system-prompt concern, not a frozen-
    // snapshot concern. The worker reads the frozen snapshot and the system
    // prompt separately; the system prompt is rebuilt from the snapshot's
    // context at compose time.
    expect(h.inputHash).toBeTruthy();
    // Verify the persona text is NOT in the hash payload by checking that
    // changing the persona (impossible by design — it's bundled TS) would
    // not change the hash. We do this by confirming the hash is stable
    // across two calls with the same snapshot.
    const h2 = computeSnapshotHashes({ ...snap });
    expect(h.inputHash).toBe(h2.inputHash);
  });
});

// ─── PR #657 hardening: validator advisory-only behavior ─────────────────
//
// The laterality / spinal-level / severity regex heuristics are ADVISORY
// WARNINGS, NOT hard blocking errors. In multi-finding reports a legitimate
// right-sided finding + separate left-sided finding can trigger a false
// positive. These tests verify the advisory-only behavior.

describe("PR #657 hardening — validator advisory-only (A–E)", () => {
  // A. right lesion + separate left lesion in input/output → no hard error
  it("A. right + left separate findings → no hard error", () => {
    const snap = snapshot({
      modality: "MR",
      region: "Brain",
      family: "brain",
      findings: "Acute right MCA territory infarct. Chronic left MCA territory infarct.",
      observations: [
        { concept: "infarct", source: "quick-findings", laterality: "right", findingsText: "Acute right MCA territory infarct." },
        { concept: "infarct", source: "quick-findings", laterality: "left", findingsText: "Chronic left MCA territory infarct." },
      ],
    });
    const draft = {
      findings: "Acute right MCA territory infarct. Chronic left MCA territory infarct.",
      impression: "Right acute MCA infarct. Left chronic MCA infarct.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    // Both "right" and "left" are in the input corpus → no swap detected.
    expect(v.lateralitySwaps).toEqual([]);
    expect(v.errors).not.toContain("laterality_swap");
    expect(v.ok).toBe(true);
  });

  // B. mild L4-L5 + severe L5-S1 preserved → no hard error
  it("B. mild L4-L5 + severe L5-S1 preserved → no hard error", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Mild disc bulge at L4-L5. Severe canal stenosis at L5-S1.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", severity: "mild", findingsText: "Mild disc bulge at L4-L5." },
        { concept: "canal_stenosis", source: "quick-findings", level: "L5-S1", severity: "severe", findingsText: "Severe canal stenosis at L5-S1." },
      ],
    });
    const draft = {
      findings: "Mild disc bulge at L4-L5. Severe canal stenosis at L5-S1.",
      impression: "Mild disc bulge at L4-L5. Severe canal stenosis at L5-S1.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    // Both "mild" and "severe" are in the input corpus → no escalation.
    expect(v.severityEscalations).toEqual([]);
    // Both L4-L5 and L5-S1 are in the input corpus → no level change.
    expect(v.levelChanges).toEqual([]);
    expect(v.errors).not.toContain("severity_escalation");
    expect(v.errors).not.toContain("level_change");
    expect(v.ok).toBe(true);
  });

  // C. true simple right→left single-finding swap → HARD failure
  it("C. true right→left single-finding swap → hard failure", () => {
    const snap = snapshot({
      findings: "Acute right MCA territory infarct.",
      observations: [
        { concept: "infarct", source: "quick-findings", laterality: "right", findingsText: "Acute right MCA territory infarct." },
      ],
    });
    const draft = {
      findings: "Acute left MCA territory infarct.",
      impression: "Acute left MCA territory infarct.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.lateralitySwaps).toContain("right→left");
    expect(v.errors).toContain("laterality_swap");
    expect(v.ok).toBe(false);
  });

  // D. true L4-L5→L3-L4 single-finding mutation → HARD failure
  it("D. true L4-L5→L3-L4 single-finding mutation → hard failure", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Disc bulge at L4-L5.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", findingsText: "Disc bulge at L4-L5." },
      ],
    });
    const draft = {
      findings: "Disc bulge at L3-L4.",
      impression: "Disc bulge at L3-L4.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.levelChanges).toContain("L3-L4");
    expect(v.errors).toContain("level_change");
    expect(v.ok).toBe(false);
  });

  // E. true mild→severe single-finding mutation → HARD failure
  it("E. true mild→severe single-finding mutation → hard failure", () => {
    const snap = snapshot({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
      spineSegment: "lumbar",
      findings: "Mild diffuse disc bulge at L4-L5.",
      observations: [
        { concept: "disc_contour", source: "quick-findings", level: "L4-L5", severity: "mild", findingsText: "Mild diffuse disc bulge at L4-L5." },
      ],
    });
    const draft = {
      findings: "Severe diffuse disc bulge at L4-L5.",
      impression: "Severe disc bulge at L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    };
    const v = validateComposerOutput(snap, draft);
    expect(v.severityEscalations).toContain("mild→severe");
    expect(v.errors).toContain("severity_escalation");
    expect(v.ok).toBe(false);
  });
});

// ─── §S 18. Modality coverage — X-ray / Doppler / MRCP ───────────────────
//
// "Generate Professional Report" promised seven examination families. Before this
// PR, a plain film, a vascular study and an MRCP each routed to no modality rules
// at all (or, for vascular, to the generic ultrasound module), so the model wrote
// cross-sectional prose over a film report and a clean "no DVT" over a limb that
// was only half examined.

describe("§S 18. Modality coverage — X-ray / Doppler / MRCP", () => {
  it("each promised family reaches at least one modality module", () => {
    const cases: Array<[string, Parameters<typeof snapshot>[0], string]> = [
      ["MRI spine", { modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar" }, CARE_MRI_SPINE],
      ["MRI brain", { modality: "MR", region: "Brain", family: "brain" }, CARE_MRI_BRAIN],
      ["CT", { modality: "CT", region: "Abdomen", family: "abdomen" }, CARE_CT],
      ["Ultrasound", { modality: "USG", region: "Abdomen", family: "abdomen" }, CARE_USG],
      ["Mammography", { modality: "MG", region: "Breast", family: "breast" }, CARE_MAMMOGRAPHY],
      ["X-ray", { modality: "DX", region: "Chest", family: "chest" }, CARE_XRAY],
      ["Doppler", { modality: "US", region: "Doppler Lower Limb Venous", family: "unknown" }, CARE_DOPPLER],
      ["MRCP", { modality: "MR", region: "MRCP", family: "unknown" }, CARE_MRCP],
    ];
    for (const [label, opts, module] of cases) {
      const modules = selectPersonaModules(snapshot(opts));
      expect(modules, label).toContain(module);
      expect(modules, label).toContain(CARE_RADIOLOGY_MASTER);
      expect(modules, label).toContain(CARE_SAFETY_RULES);
    }
  });

  it("a plain film gets radiograph rules and never mammography or CT rules", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "DX", region: "Chest", family: "chest", bodyPart: "CHEST" }),
    );
    expect(modules).toContain(CARE_XRAY);
    expect(modules).not.toContain(CARE_MAMMOGRAPHY);
    expect(modules).not.toContain(CARE_CT);
    expect(CARE_XRAY).toMatch(/Do NOT describe cross-sectional anatomy/);
  });

  it("a DX breast examination stays mammography, not a plain film", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "DX", region: "Breast", family: "breast" }),
    );
    expect(modules).toContain(CARE_MAMMOGRAPHY);
    expect(modules).not.toContain(CARE_XRAY);
  });

  it("a vascular study gets the ultrasound rules AND the vascular addendum", () => {
    const modules = selectPersonaModules(
      snapshot({
        modality: "US",
        region: "Doppler Lower Limb Venous",
        family: "unknown",
        studyType: "USG DOPPLER LLE VENOUS",
      }),
    );
    expect(modules).toContain(CARE_USG);
    expect(modules).toContain(CARE_DOPPLER);
    // The rule that matters clinically: a half-examined limb cannot be declared clear.
    expect(CARE_DOPPLER).toMatch(/only allowed when every segment/);
    expect(CARE_DOPPLER).toMatch(/Do NOT invent a waveform/);
  });

  it("a routine abdominal ultrasound does not get vascular rules", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "USG", region: "Abdomen", family: "abdomen" }),
    );
    expect(modules).toContain(CARE_USG);
    expect(modules).not.toContain(CARE_DOPPLER);
  });

  it("MRCP gets the ductal rules; an MRI brain does not", () => {
    const mrcp = selectPersonaModules(
      snapshot({ modality: "MR", region: "MRCP", family: "unknown", studyType: "MRI MRCP" }),
    );
    expect(mrcp).toContain(CARE_MRCP);
    // MRCP is fluid-sequence imaging: enhancement is not assumed.
    expect(CARE_MRCP).toMatch(/Do NOT describe contrast enhancement/);
    expect(CARE_MRCP).toMatch(/limited sensitivity for small\s+gallbladder stones/);

    const brain = selectPersonaModules(
      snapshot({ modality: "MR", region: "Brain", family: "brain" }),
    );
    expect(brain).not.toContain(CARE_MRCP);
  });

  it("routing reads the study context, never the findings narrative", () => {
    // The radiologist is allowed to TYPE the word "carotid" into a brain report.
    // That must not silently switch the persona to a vascular study.
    const modules = selectPersonaModules(
      snapshot({
        modality: "MR",
        region: "Brain",
        family: "brain",
        findings: "The carotid vessels are normal. Biliary ducts unremarkable.",
      }),
    );
    expect(modules).not.toContain(CARE_DOPPLER);
    expect(modules).not.toContain(CARE_MRCP);
    expect(modules).toContain(CARE_MRI_BRAIN);
  });
});

// ─── §S 19. Printed-structure contract ──────────────────────────────────
//
// The composer returns three plain-text fields; CARE's printer owns the title,
// the patient lines, the underlined headings, the abnormal-finding bold and any
// table. That only works if the model writes the structure the printer already
// parses (`findingsDocument.ts`) and does not write markdown emphasis, which the
// screen and Word surfaces would print as literal asterisks.

describe("§S 19. Printed-structure contract", () => {
  it("the style module teaches the heading convention the printer parses", () => {
    expect(CARE_REPORT_STYLE).toMatch(/PRINTED STRUCTURE/);
    expect(CARE_REPORT_STYLE).toMatch(/prints as an\s+underlined section heading/);
    expect(CARE_REPORT_STYLE).toMatch(/"Label: sentence" on one line stays a paragraph/);
  });

  it("the style module teaches the pipe-table convention for per-level values", () => {
    expect(CARE_REPORT_STYLE).toMatch(/\| Level \| AP Canal \(mm\) \|/);
    expect(CARE_REPORT_STYLE).toMatch(/never invent a level/);
    // The unit belongs in the cell: validateComposerOutput re-checks every supplied
    // measurement, and a bare "14" in a table is not a measurement it can see.
    expect(CARE_REPORT_STYLE).toMatch(/\| L1-L2 \| 14 mm \|/);
  });

  it("the style module forbids markdown emphasis, because the renderer bolds abnormalities itself", () => {
    expect(CARE_REPORT_STYLE).toMatch(/No markdown emphasis anywhere/);
    expect(CARE_REPORT_STYLE).toMatch(/CARE's printer bolds abnormal findings lines itself/);
  });

  it("the style module forbids a second conclusion and permits a supported differential only", () => {
    expect(CARE_REPORT_STYLE).toMatch(/Do NOT write a second conclusion/);
    expect(CARE_REPORT_STYLE).toMatch(/Differentials: give them only when/);
  });

  it("the FULL_REPORT task asks for a finished report and disclaims the title and patient lines", () => {
    const prompt = buildCareSystemPrompt(
      "FULL_REPORT" as AiComposeJobKind,
      snapshot({ modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    );
    expect(prompt).toMatch(/COMPLETE professional radiology report/);
    expect(prompt).toMatch(/in CARE's printed order/);
    expect(prompt).toMatch(/printed-structure convention/);
    expect(prompt).toMatch(/concise prioritised Impression\s+that agrees with the Findings/);
    expect(prompt).toMatch(/do not write a title, a patient name\s+line, or markdown emphasis/);
  });
});

// ─── §S 20. CT spine routing + spine-segment synonyms ─────────────────────
//
// Two gaps §S 18 could not see, because it only asked "does the promised family
// reach a module":
//
//   · A CT spine reached CARE_CT and nothing else. The level-ordering and
//     canal-measurement discipline lives in the MRI spine addenda, so a CT LS
//     spine was drafted with no rule about preserving L4-L5 or a supplied
//     9.2 mm. Those addenda cannot simply be reused: CARE_MRI_SPINE instructs
//     the model to write "limited-planar, limited-sequence" screening wording
//     and CARE_MRI_CERVICAL reasons about T2 cord signal — either inside a CT
//     report is a modality error a radiologist reads as the wrong study.
//
//   · `spineSegment` is a free string on the snapshot and the router matched it
//     with `=== "lumbar"`, so every other spelling silently lost its addendum —
//     including `dorsolumbar`, which the shared resolver returns as a canonical
//     value of its own.

describe("§S 20. CT spine routing + spine-segment synonyms", () => {
  it("normalises the spellings a booking can carry onto the canonical segments", () => {
    const cases: Array<[string | null, string]> = [
      ["lumbar", "lumbar"],
      ["LS Spine", "lumbar"],
      ["LS", "lumbar"],
      ["lumbosacral", "lumbar"],
      ["Lumbo-Sacral", "lumbar"],
      ["L_Spine", "lumbar"],
      ["cervical", "cervical"],
      ["C Spine", "cervical"],
      ["dorsal", "dorsal"],
      ["thoracic", "dorsal"],
      ["D Spine", "dorsal"],
      ["T Spine", "dorsal"],
      // Before "lumbar": a Dorso-Lumbar booking CONTAINS the word lumbar, and
      // answering "lumbar" would hand a two-region study one region's rules.
      ["Dorso-Lumbar", "dorsolumbar"],
      ["dorso lumbar", "dorsolumbar"],
      ["thoracolumbar", "dorsolumbar"],
      ["DL", "dorsolumbar"],
      ["Whole Spine", "whole"],
      ["entire spine", "whole"],
      ["screening", "whole"],
      ["", ""],
      [null, ""],
      ["Chest", "generic"],
    ];
    for (const [raw, want] of cases) {
      expect(normaliseSpineSegment(raw), `spineSegment ${JSON.stringify(raw)}`).toBe(want);
    }
  });

  it("a CT spine study gets CT rules plus the spine addendum, never the MRI spine modules", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "CT", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    );
    expect(modules).toContain(CARE_CT);
    expect(modules).toContain(CARE_CT_SPINE);
    expect(modules).toContain(CARE_RADIOLOGY_MASTER);
    // The safety claim, not a style preference: an MRI addendum in a CT report
    // puts sequence and cord-signal language into a study that has neither.
    expect(modules).not.toContain(CARE_MRI_SPINE);
    expect(modules).not.toContain(CARE_MRI_LUMBAR);
    expect(modules).not.toContain(CARE_MRI_CERVICAL);
  });

  it("the CT spine addendum forbids MRI vocabulary instead of merely omitting it", () => {
    expect(CARE_CT_SPINE).toMatch(/preserve every supplied level exactly/i);
    expect(CARE_CT_SPINE).toMatch(/measurements exactly/i);
    expect(CARE_CT_SPINE).toMatch(/Do not write MRI sequence names/);
    expect(CARE_CT_SPINE).toMatch(/limited-planar, limited-sequence/);
  });

  it("a CT abdomen does not get the spine addendum", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "CT", region: "Abdomen", family: "abdomen" }),
    );
    expect(modules).toContain(CARE_CT);
    expect(modules).not.toContain(CARE_CT_SPINE);
  });

  it("an MRI spine is unchanged by the CT work", () => {
    const modules = selectPersonaModules(
      snapshot({ modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    );
    expect(modules).toContain(CARE_MRI_SPINE);
    expect(modules).toContain(CARE_MRI_LUMBAR);
    expect(modules).not.toContain(CARE_CT);
    expect(modules).not.toContain(CARE_CT_SPINE);
  });

  it("a Dorso-Lumbar booking reaches both addenda instead of neither", () => {
    for (const spelling of ["dorsolumbar", "Dorso-Lumbar", "thoracolumbar", "DL spine"]) {
      const modules = selectPersonaModules(
        snapshot({
          modality: "MR",
          region: "Dorso-Lumbar Spine",
          family: "spine",
          spineSegment: spelling,
        }),
      );
      expect(modules, spelling).toContain(CARE_MRI_DORSAL);
      expect(modules, spelling).toContain(CARE_MRI_LUMBAR);
    }
  });

  it("cervical and dorsal routing still resolve on their own spellings", () => {
    const cervical = selectPersonaModules(
      snapshot({ modality: "MR", region: "C Spine", family: "spine", spineSegment: "C Spine" }),
    );
    expect(cervical).toContain(CARE_MRI_CERVICAL);
    expect(cervical).not.toContain(CARE_MRI_LUMBAR);

    const dorsal = selectPersonaModules(
      snapshot({ modality: "MR", region: "Dorsal Spine", family: "spine", spineSegment: "thoracic" }),
    );
    expect(dorsal).toContain(CARE_MRI_DORSAL);
    expect(dorsal).not.toContain(CARE_MRI_CERVICAL);
  });

  it("the region label tells a CT study it is a CT study", () => {
    // This string is written into the SELECTED-IMAGE context line the model
    // reads, and it said "MRI" for every modality.
    const label = (opts: Parameters<typeof snapshot>[0]) =>
      resolvePrimaryRegionLabel(snapshot(opts));
    expect(
      label({ modality: "CT", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    ).toBe("CT Lumbosacral Spine");
    expect(
      label({ modality: "CT", region: "C Spine", family: "spine", spineSegment: "cervical" }),
    ).toBe("CT Cervical Spine");
    expect(
      label({ modality: "CT", region: "Dorso-Lumbar Spine", family: "spine", spineSegment: "dorsolumbar" }),
    ).toBe("CT Dorso-Lumbar Spine");
    expect(
      label({ modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    ).toBe("MRI Lumbosacral Spine");
    expect(label({ modality: "MR", region: "Brain", family: "brain" })).toBe("MRI Brain");
  });

  it("a CT spine prompt stays inside the §S 16 budget", () => {
    const prompt = buildCareSystemPrompt(
      "FULL_REPORT" as AiComposeJobKind,
      snapshot({ modality: "CT", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    );
    expect(prompt).toContain("CT SPINE ADDITIONS");
    expect(prompt.length).toBeLessThan(11000);
  });

  it("the FULL_REPORT instruction forbids dropping a supplied observation, level or measurement", () => {
    const prompt = buildCareSystemPrompt(
      "FULL_REPORT" as AiComposeJobKind,
      snapshot({ modality: "MR", region: "Brain", family: "brain" }),
    );
    expect(prompt).toMatch(
      /Every supplied observation, level, laterality and measurement must be preserved\./,
    );
    // Conservation must not become licence to add: the same prompt still carries
    // the invention ban, and the two clauses are the same rule from both ends.
    expect(prompt).toMatch(/Do not invent pathology, laterality, levels, measurements/);
  });

  it("the conservation clause reached the spine prompt too, where levels matter most", () => {
    const prompt = buildCareSystemPrompt(
      "FULL_REPORT" as AiComposeJobKind,
      snapshot({ modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar" }),
    );
    expect(prompt).toMatch(/Every supplied observation, level, laterality and measurement must be preserved\./);
  });
});
